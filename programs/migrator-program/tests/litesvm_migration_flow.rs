use std::{env, mem::size_of, path::PathBuf};

use litesvm::LiteSVM;
use migrator_program::{
    state::MigrationConfig, MIGRATION_CONFIG_SEED, TOKEN_PROGRAM_ID, UPGRADEABLE_LOADER_PROGRAM_ID,
    VAULT_AUTHORITY_SEED,
};
use solana_account::Account;
use solana_address::Address;
use solana_instruction::{AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_message::{Message, VersionedMessage};
use solana_signer::Signer;
use solana_transaction::versioned::VersionedTransaction;

const OLD_MINT_BYTES: [u8; 32] = [41u8; 32];
const NEW_MINT_BYTES: [u8; 32] = [42u8; 32];
const VAULT_NEW_QX_BYTES: [u8; 32] = [43u8; 32];
const USER_OLD_QX_BYTES: [u8; 32] = [44u8; 32];
const USER_NEW_QX_BYTES: [u8; 32] = [45u8; 32];

const INITIAL_RESERVE: u64 = 1_000;
const INITIAL_USER_OLD_BALANCE: u64 = 250;
const INITIAL_USER_NEW_BALANCE: u64 = 0;
const MIGRATION_AMOUNT: u64 = 100;

fn resolve_program_path() -> Option<PathBuf> {
    if let Ok(path) = env::var("MIGRATOR_PROGRAM_SBF_PATH") {
        let p = PathBuf::from(path);
        if p.exists() {
            return Some(p);
        }
        eprintln!(
            "[litesvm_migration_flow] MIGRATOR_PROGRAM_SBF_PATH set but file missing: {}",
            p.display()
        );
    }

    let fallback = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../target/deploy/migrator_program.so")
        .canonicalize()
        .unwrap_or_else(|_| {
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target/deploy/migrator_program.so")
        });

    if fallback.exists() {
        Some(fallback)
    } else {
        None
    }
}

fn migration_config_from_bytes(data: &[u8]) -> MigrationConfig {
    assert!(data.len() >= size_of::<MigrationConfig>());
    unsafe { std::ptr::read_unaligned(data.as_ptr() as *const MigrationConfig) }
}

fn make_program_data_metadata(upgrade_authority: Address) -> Vec<u8> {
    let mut data = vec![0u8; 45];
    data[0..4].copy_from_slice(&3u32.to_le_bytes());
    data[4..12].copy_from_slice(&0u64.to_le_bytes());
    data[12] = 1;
    data[13..45].copy_from_slice(upgrade_authority.as_array());
    data
}

fn make_mint_data(supply: u64, decimals: u8) -> Vec<u8> {
    let mut data = vec![0u8; 82];
    data[0..4].copy_from_slice(&0u32.to_le_bytes());
    data[36..44].copy_from_slice(&supply.to_le_bytes());
    data[44] = decimals;
    data[45] = 1;
    data[46..50].copy_from_slice(&0u32.to_le_bytes());
    data
}

fn make_token_account_data(mint: &Address, owner: &Address, amount: u64) -> Vec<u8> {
    let mut data = vec![0u8; 165];
    data[0..32].copy_from_slice(mint.as_array());
    data[32..64].copy_from_slice(owner.as_array());
    data[64..72].copy_from_slice(&amount.to_le_bytes());
    data[72..76].copy_from_slice(&0u32.to_le_bytes());
    data[108] = 1;
    data[121..129].copy_from_slice(&0u64.to_le_bytes());
    data[129..133].copy_from_slice(&0u32.to_le_bytes());
    data
}

fn token_amount_from_data(data: &[u8]) -> u64 {
    u64::from_le_bytes(data[64..72].try_into().unwrap())
}

fn mint_supply_from_data(data: &[u8]) -> u64 {
    u64::from_le_bytes(data[36..44].try_into().unwrap())
}

struct MigrationFlowFixture {
    svm: LiteSVM,
    program_id: Address,
    initializer: Keypair,
    ops_admin: Keypair,
    user: Keypair,
    config_pda: Address,
    vault_authority_pda: Address,
    program_data: Address,
    old_qx_mint: Address,
    new_qx_mint: Address,
    vault_new_qx: Address,
    user_old_qx: Address,
    user_new_qx: Address,
}

impl MigrationFlowFixture {
    fn setup() -> Option<Self> {
        let Some(program_path) = resolve_program_path() else {
            eprintln!(
                "[litesvm_migration_flow] skip: no program artifact found. Set MIGRATOR_PROGRAM_SBF_PATH or build target/deploy/migrator_program.so"
            );
            return None;
        };

        let mut svm = LiteSVM::new();
        let program_id = Address::new_unique();
        svm.add_program_from_file(program_id, program_path.to_string_lossy().as_ref())
            .expect("program should load from .so when file exists");

        let initializer = Keypair::new();
        let ops_admin = Keypair::new();
        let user = Keypair::new();
        svm.airdrop(&initializer.pubkey(), 2_000_000_000)
            .expect("airdrop for initializer should succeed");
        svm.airdrop(&ops_admin.pubkey(), 1_000_000_000)
            .expect("airdrop for ops_admin should succeed");
        svm.airdrop(&user.pubkey(), 1_000_000_000)
            .expect("airdrop for user should succeed");

        let loader_program = Address::new_from_array(UPGRADEABLE_LOADER_PROGRAM_ID);
        let token_program = Address::new_from_array(TOKEN_PROGRAM_ID);
        let (config_pda, _) = Address::find_program_address(&[MIGRATION_CONFIG_SEED], &program_id);
        let (vault_authority_pda, _) =
            Address::find_program_address(&[VAULT_AUTHORITY_SEED], &program_id);
        let (program_data, _) =
            Address::find_program_address(&[program_id.as_ref()], &loader_program);

        let old_qx_mint = Address::new_from_array(OLD_MINT_BYTES);
        let new_qx_mint = Address::new_from_array(NEW_MINT_BYTES);
        let vault_new_qx = Address::new_from_array(VAULT_NEW_QX_BYTES);
        let user_old_qx = Address::new_from_array(USER_OLD_QX_BYTES);
        let user_new_qx = Address::new_from_array(USER_NEW_QX_BYTES);

        svm.set_account(
            config_pda,
            Account {
                lamports: 1_000_000_000,
                data: vec![],
                owner: Address::default(),
                executable: false,
                rent_epoch: 0,
            },
        )
        .expect("config PDA placeholder should be set");

        svm.set_account(
            vault_authority_pda,
            Account {
                lamports: 1_000_000,
                data: vec![],
                owner: program_id,
                executable: false,
                rent_epoch: 0,
            },
        )
        .expect("vault authority PDA should be set");

        svm.set_account(
            program_data,
            Account {
                lamports: 1_000_000_000,
                data: make_program_data_metadata(initializer.pubkey()),
                owner: loader_program,
                executable: false,
                rent_epoch: 0,
            },
        )
        .expect("program_data account should be set");

        svm.set_account(
            old_qx_mint,
            Account {
                lamports: 1_000_000,
                data: make_mint_data(INITIAL_USER_OLD_BALANCE, 9),
                owner: token_program,
                executable: false,
                rent_epoch: 0,
            },
        )
        .expect("old mint should be set");

        svm.set_account(
            new_qx_mint,
            Account {
                lamports: 1_000_000,
                data: make_mint_data(INITIAL_RESERVE, 9),
                owner: token_program,
                executable: false,
                rent_epoch: 0,
            },
        )
        .expect("new mint should be set");

        svm.set_account(
            vault_new_qx,
            Account {
                lamports: 1_000_000,
                data: make_token_account_data(&new_qx_mint, &vault_authority_pda, INITIAL_RESERVE),
                owner: token_program,
                executable: false,
                rent_epoch: 0,
            },
        )
        .expect("reserve vault token account should be set");

        svm.set_account(
            user_old_qx,
            Account {
                lamports: 1_000_000,
                data: make_token_account_data(
                    &old_qx_mint,
                    &user.pubkey(),
                    INITIAL_USER_OLD_BALANCE,
                ),
                owner: token_program,
                executable: false,
                rent_epoch: 0,
            },
        )
        .expect("user old token account should be set");

        svm.set_account(
            user_new_qx,
            Account {
                lamports: 1_000_000,
                data: make_token_account_data(&new_qx_mint, &user.pubkey(), INITIAL_USER_NEW_BALANCE),
                owner: token_program,
                executable: false,
                rent_epoch: 0,
            },
        )
        .expect("user new token account should be set");

        Some(Self {
            svm,
            program_id,
            initializer,
            ops_admin,
            user,
            config_pda,
            vault_authority_pda,
            program_data,
            old_qx_mint,
            new_qx_mint,
            vault_new_qx,
            user_old_qx,
            user_new_qx,
        })
    }

    fn send_initialize_config(&mut self, start_ts: i64, end_ts: i64) {
        let mut data = vec![0u8];
        data.extend_from_slice(&start_ts.to_le_bytes());
        data.extend_from_slice(&end_ts.to_le_bytes());

        let ix = Instruction {
            program_id: self.program_id,
            accounts: vec![
                AccountMeta::new(self.initializer.pubkey(), true),
                AccountMeta::new_readonly(self.ops_admin.pubkey(), true),
                AccountMeta::new(self.config_pda, false),
                AccountMeta::new_readonly(self.vault_authority_pda, false),
                AccountMeta::new_readonly(self.vault_new_qx, false),
                AccountMeta::new_readonly(self.old_qx_mint, false),
                AccountMeta::new_readonly(self.new_qx_mint, false),
                AccountMeta::new_readonly(Address::new_from_array(TOKEN_PROGRAM_ID), false),
                AccountMeta::new_readonly(Address::default(), false),
                AccountMeta::new_readonly(self.program_data, false),
            ],
            data,
        };

        let blockhash = self.svm.latest_blockhash();
        let msg =
            Message::new_with_blockhash(&[ix], Some(&self.initializer.pubkey()), &blockhash);
        let tx = VersionedTransaction::try_new(
            VersionedMessage::Legacy(msg),
            &[&self.initializer, &self.ops_admin],
        )
        .expect("signed tx should be created");

        self.svm
            .send_transaction(tx)
            .expect("initialize_config should succeed");
    }

    fn send_migrate_exact(&mut self, amount: u64) {
        let mut data = vec![2u8];
        data.extend_from_slice(&amount.to_le_bytes());

        let ix = Instruction {
            program_id: self.program_id,
            accounts: vec![
                AccountMeta::new_readonly(self.user.pubkey(), true),
                AccountMeta::new(self.config_pda, false),
                AccountMeta::new_readonly(self.vault_authority_pda, false),
                AccountMeta::new(self.vault_new_qx, false),
                AccountMeta::new(self.user_old_qx, false),
                AccountMeta::new(self.user_new_qx, false),
                AccountMeta::new(self.old_qx_mint, false),
                AccountMeta::new_readonly(self.new_qx_mint, false),
                AccountMeta::new_readonly(Address::new_from_array(TOKEN_PROGRAM_ID), false),
            ],
            data,
        };

        let blockhash = self.svm.latest_blockhash();
        let msg = Message::new_with_blockhash(&[ix], Some(&self.user.pubkey()), &blockhash);
        let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&self.user])
            .expect("signed tx should be created");

        self.svm
            .send_transaction(tx)
            .expect("migrate_exact should succeed");
    }

    fn send_set_pause(&mut self, paused: bool) {
        let ix = Instruction {
            program_id: self.program_id,
            accounts: vec![
                AccountMeta::new_readonly(self.ops_admin.pubkey(), true),
                AccountMeta::new(self.config_pda, false),
            ],
            data: vec![1u8, if paused { 1 } else { 0 }],
        };

        let blockhash = self.svm.latest_blockhash();
        let msg = Message::new_with_blockhash(&[ix], Some(&self.ops_admin.pubkey()), &blockhash);
        let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&self.ops_admin])
            .expect("signed tx should be created");

        self.svm
            .send_transaction(tx)
            .expect("set_pause should succeed");
    }

    fn send_migrate_exact_expect_err(&mut self, amount: u64) {
        let mut data = vec![2u8];
        data.extend_from_slice(&amount.to_le_bytes());

        let ix = Instruction {
            program_id: self.program_id,
            accounts: vec![
                AccountMeta::new_readonly(self.user.pubkey(), true),
                AccountMeta::new(self.config_pda, false),
                AccountMeta::new_readonly(self.vault_authority_pda, false),
                AccountMeta::new(self.vault_new_qx, false),
                AccountMeta::new(self.user_old_qx, false),
                AccountMeta::new(self.user_new_qx, false),
                AccountMeta::new(self.old_qx_mint, false),
                AccountMeta::new_readonly(self.new_qx_mint, false),
                AccountMeta::new_readonly(Address::new_from_array(TOKEN_PROGRAM_ID), false),
            ],
            data,
        };

        let blockhash = self.svm.latest_blockhash();
        let msg = Message::new_with_blockhash(&[ix], Some(&self.user.pubkey()), &blockhash);
        let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&self.user])
            .expect("signed tx should be created");

        assert!(
            self.svm.send_transaction(tx).is_err(),
            "migrate_exact should fail"
        );
    }

    fn set_config_window(&mut self, start_ts: i64, end_ts: i64) {
        let mut account = self
            .svm
            .get_account(&self.config_pda)
            .expect("config account should exist");
        let mut config = migration_config_from_bytes(&account.data);
        config.start_ts = start_ts;
        config.end_ts = end_ts;
        account.data = unsafe {
            std::slice::from_raw_parts(
                (&config as *const MigrationConfig).cast::<u8>(),
                size_of::<MigrationConfig>(),
            )
            .to_vec()
        };
        self.svm
            .set_account(self.config_pda, account)
            .expect("config account should be updated");
    }

    fn set_token_balance(&mut self, token_account: Address, amount: u64) {
        let mut account = self
            .svm
            .get_account(&token_account)
            .expect("token account should exist");
        account.data[64..72].copy_from_slice(&amount.to_le_bytes());
        self.svm
            .set_account(token_account, account)
            .expect("token account should be updated");
    }

    fn send_migrate_exact_with_custom_accounts_expect_err(
        &mut self,
        amount: u64,
        vault_new_qx: Address,
        old_qx_mint: Address,
        new_qx_mint: Address,
    ) {
        let mut data = vec![2u8];
        data.extend_from_slice(&amount.to_le_bytes());

        let ix = Instruction {
            program_id: self.program_id,
            accounts: vec![
                AccountMeta::new_readonly(self.user.pubkey(), true),
                AccountMeta::new(self.config_pda, false),
                AccountMeta::new_readonly(self.vault_authority_pda, false),
                AccountMeta::new(vault_new_qx, false),
                AccountMeta::new(self.user_old_qx, false),
                AccountMeta::new(self.user_new_qx, false),
                AccountMeta::new(old_qx_mint, false),
                AccountMeta::new_readonly(new_qx_mint, false),
                AccountMeta::new_readonly(Address::new_from_array(TOKEN_PROGRAM_ID), false),
            ],
            data,
        };

        let blockhash = self.svm.latest_blockhash();
        let msg = Message::new_with_blockhash(&[ix], Some(&self.user.pubkey()), &blockhash);
        let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&self.user])
            .expect("signed tx should be created");

        assert!(
            self.svm.send_transaction(tx).is_err(),
            "migrate_exact should fail"
        );
    }

    fn config(&self) -> MigrationConfig {
        let account = self
            .svm
            .get_account(&self.config_pda)
            .expect("config account should exist");
        migration_config_from_bytes(&account.data)
    }

    fn token_balance(&self, token_account: &Address) -> u64 {
        let account = self
            .svm
            .get_account(token_account)
            .expect("token account should exist");
        token_amount_from_data(&account.data)
    }

    fn mint_supply(&self, mint: &Address) -> u64 {
        let account = self.svm.get_account(mint).expect("mint account should exist");
        mint_supply_from_data(&account.data)
    }
}

#[test]
fn initialize_config_persists_expected_state() {
    let Some(mut fixture) = MigrationFlowFixture::setup() else {
        return;
    };

    fixture.send_initialize_config(0, i64::MAX);

    let config = fixture.config();
    assert_eq!(config.discriminator, MigrationConfig::DISCRIMINATOR);
    assert_eq!(config.version, 1);
    assert_eq!(config.paused, 0);
    assert_eq!(config.admin, *fixture.ops_admin.pubkey().as_array());
    assert_eq!(config.old_qx_mint, *fixture.old_qx_mint.as_array());
    assert_eq!(config.new_qx_mint, *fixture.new_qx_mint.as_array());
    assert_eq!(config.token_program_id, TOKEN_PROGRAM_ID);
    assert_eq!(config.vault_authority, *fixture.vault_authority_pda.as_array());
    assert_eq!(config.vault_new_qx, *fixture.vault_new_qx.as_array());
    assert_eq!(config.total_migrated, 0);
    assert_eq!(config.start_ts, 0);
    assert_eq!(config.end_ts, i64::MAX);
}

#[test]
fn migrate_exact_burns_old_and_transfers_new_one_to_one() {
    let Some(mut fixture) = MigrationFlowFixture::setup() else {
        return;
    };

    fixture.send_initialize_config(0, i64::MAX);

    assert_eq!(fixture.token_balance(&fixture.user_old_qx), INITIAL_USER_OLD_BALANCE);
    assert_eq!(fixture.token_balance(&fixture.user_new_qx), INITIAL_USER_NEW_BALANCE);
    assert_eq!(fixture.token_balance(&fixture.vault_new_qx), INITIAL_RESERVE);
    assert_eq!(fixture.mint_supply(&fixture.old_qx_mint), INITIAL_USER_OLD_BALANCE);
    assert_eq!(fixture.mint_supply(&fixture.new_qx_mint), INITIAL_RESERVE);

    fixture.send_migrate_exact(MIGRATION_AMOUNT);

    let config = fixture.config();
    assert_eq!(config.total_migrated, MIGRATION_AMOUNT);
    assert_eq!(
        fixture.token_balance(&fixture.user_old_qx),
        INITIAL_USER_OLD_BALANCE - MIGRATION_AMOUNT
    );
    assert_eq!(
        fixture.token_balance(&fixture.user_new_qx),
        INITIAL_USER_NEW_BALANCE + MIGRATION_AMOUNT
    );
    assert_eq!(
        fixture.token_balance(&fixture.vault_new_qx),
        INITIAL_RESERVE - MIGRATION_AMOUNT
    );
    assert_eq!(
        fixture.mint_supply(&fixture.old_qx_mint),
        INITIAL_USER_OLD_BALANCE - MIGRATION_AMOUNT
    );
    assert_eq!(fixture.mint_supply(&fixture.new_qx_mint), INITIAL_RESERVE);
}

#[test]
fn migrate_exact_rejects_when_paused_without_mutating_balances() {
    let Some(mut fixture) = MigrationFlowFixture::setup() else {
        return;
    };

    fixture.send_initialize_config(0, i64::MAX);
    fixture.send_set_pause(true);

    let old_before = fixture.token_balance(&fixture.user_old_qx);
    let new_before = fixture.token_balance(&fixture.user_new_qx);
    let reserve_before = fixture.token_balance(&fixture.vault_new_qx);
    let old_supply_before = fixture.mint_supply(&fixture.old_qx_mint);
    let total_before = fixture.config().total_migrated;

    fixture.send_migrate_exact_expect_err(MIGRATION_AMOUNT);

    assert_eq!(fixture.config().paused, 1);
    assert_eq!(fixture.config().total_migrated, total_before);
    assert_eq!(fixture.token_balance(&fixture.user_old_qx), old_before);
    assert_eq!(fixture.token_balance(&fixture.user_new_qx), new_before);
    assert_eq!(fixture.token_balance(&fixture.vault_new_qx), reserve_before);
    assert_eq!(fixture.mint_supply(&fixture.old_qx_mint), old_supply_before);
}

#[test]
fn migrate_exact_rejects_when_reserve_is_insufficient() {
    let Some(mut fixture) = MigrationFlowFixture::setup() else {
        return;
    };

    fixture.send_initialize_config(0, i64::MAX);
    fixture.set_token_balance(fixture.vault_new_qx, MIGRATION_AMOUNT - 1);

    let old_before = fixture.token_balance(&fixture.user_old_qx);
    let new_before = fixture.token_balance(&fixture.user_new_qx);
    let total_before = fixture.config().total_migrated;

    fixture.send_migrate_exact_expect_err(MIGRATION_AMOUNT);

    assert_eq!(fixture.config().total_migrated, total_before);
    assert_eq!(fixture.token_balance(&fixture.user_old_qx), old_before);
    assert_eq!(fixture.token_balance(&fixture.user_new_qx), new_before);
    assert_eq!(fixture.token_balance(&fixture.vault_new_qx), MIGRATION_AMOUNT - 1);
}

#[test]
fn migrate_exact_rejects_when_window_is_closed() {
    let Some(mut fixture) = MigrationFlowFixture::setup() else {
        return;
    };

    fixture.send_initialize_config(0, i64::MAX);
    fixture.set_config_window(0, -1);

    let old_before = fixture.token_balance(&fixture.user_old_qx);
    let new_before = fixture.token_balance(&fixture.user_new_qx);

    fixture.send_migrate_exact_expect_err(MIGRATION_AMOUNT);

    assert_eq!(fixture.token_balance(&fixture.user_old_qx), old_before);
    assert_eq!(fixture.token_balance(&fixture.user_new_qx), new_before);
    assert_eq!(fixture.config().total_migrated, 0);
}

#[test]
fn migrate_exact_rejects_when_old_mint_account_does_not_match_config() {
    let Some(mut fixture) = MigrationFlowFixture::setup() else {
        return;
    };

    fixture.send_initialize_config(0, i64::MAX);
    let wrong_old_mint = Address::new_unique();

    fixture.send_migrate_exact_with_custom_accounts_expect_err(
        MIGRATION_AMOUNT,
        fixture.vault_new_qx,
        wrong_old_mint,
        fixture.new_qx_mint,
    );

    assert_eq!(fixture.token_balance(&fixture.user_old_qx), INITIAL_USER_OLD_BALANCE);
    assert_eq!(fixture.token_balance(&fixture.user_new_qx), INITIAL_USER_NEW_BALANCE);
    assert_eq!(fixture.config().total_migrated, 0);
}

#[test]
fn migrate_exact_rejects_when_new_mint_account_does_not_match_config() {
    let Some(mut fixture) = MigrationFlowFixture::setup() else {
        return;
    };

    fixture.send_initialize_config(0, i64::MAX);

    let wrong_new_mint = Address::new_unique();
    fixture
        .svm
        .set_account(
            wrong_new_mint,
            Account {
                lamports: 1_000_000,
                data: make_mint_data(INITIAL_RESERVE, 9),
                owner: Address::new_from_array(TOKEN_PROGRAM_ID),
                executable: false,
                rent_epoch: 0,
            },
        )
        .expect("wrong new mint account should be set");

    let old_before = fixture.token_balance(&fixture.user_old_qx);
    let user_new_before = fixture.token_balance(&fixture.user_new_qx);
    let reserve_before = fixture.token_balance(&fixture.vault_new_qx);
    let total_before = fixture.config().total_migrated;

    fixture.send_migrate_exact_with_custom_accounts_expect_err(
        MIGRATION_AMOUNT,
        fixture.vault_new_qx,
        fixture.old_qx_mint,
        wrong_new_mint,
    );

    assert_eq!(fixture.token_balance(&fixture.user_old_qx), old_before);
    assert_eq!(fixture.token_balance(&fixture.user_new_qx), user_new_before);
    assert_eq!(fixture.token_balance(&fixture.vault_new_qx), reserve_before);
    assert_eq!(fixture.config().total_migrated, total_before);
}

#[test]
fn migrate_exact_rejects_when_vault_account_does_not_match_config() {
    let Some(mut fixture) = MigrationFlowFixture::setup() else {
        return;
    };

    fixture.send_initialize_config(0, i64::MAX);

    let wrong_vault_new_qx = Address::new_unique();
    fixture
        .svm
        .set_account(
            wrong_vault_new_qx,
            Account {
                lamports: 1_000_000,
                data: make_token_account_data(
                    &fixture.new_qx_mint,
                    &fixture.vault_authority_pda,
                    INITIAL_RESERVE,
                ),
                owner: Address::new_from_array(TOKEN_PROGRAM_ID),
                executable: false,
                rent_epoch: 0,
            },
        )
        .expect("wrong vault token account should be set");

    let old_before = fixture.token_balance(&fixture.user_old_qx);
    let user_new_before = fixture.token_balance(&fixture.user_new_qx);
    let reserve_before = fixture.token_balance(&fixture.vault_new_qx);
    let wrong_vault_before = fixture.token_balance(&wrong_vault_new_qx);
    let total_before = fixture.config().total_migrated;

    fixture.send_migrate_exact_with_custom_accounts_expect_err(
        MIGRATION_AMOUNT,
        wrong_vault_new_qx,
        fixture.old_qx_mint,
        fixture.new_qx_mint,
    );

    assert_eq!(fixture.token_balance(&fixture.user_old_qx), old_before);
    assert_eq!(fixture.token_balance(&fixture.user_new_qx), user_new_before);
    assert_eq!(fixture.token_balance(&fixture.vault_new_qx), reserve_before);
    assert_eq!(fixture.token_balance(&wrong_vault_new_qx), wrong_vault_before);
    assert_eq!(fixture.config().total_migrated, total_before);
}

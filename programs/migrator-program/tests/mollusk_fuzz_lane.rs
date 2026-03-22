use std::{env, path::PathBuf};

use migrator_program::{
    errors::MigrationError, state::MigrationConfig, MIGRATION_CONFIG_SEED, TOKEN_PROGRAM_ID,
    UPGRADEABLE_LOADER_PROGRAM_ID, VAULT_AUTHORITY_SEED,
};
use mollusk_svm::{
    program::{
        create_keyed_account_for_builtin_program, keyed_account_for_bpf_loader_v2_program,
        keyed_account_for_bpf_loader_v3_program, keyed_account_for_system_program, loader_keys,
    },
    result::Check,
    Mollusk,
};
use solana_account::{Account, ReadableAccount};
use solana_instruction::{AccountMeta, Instruction};
use solana_program_error::ProgramError;
use solana_pubkey::Pubkey;

const OLD_MINT_BYTES: [u8; 32] = [41u8; 32];
const NEW_MINT_BYTES: [u8; 32] = [42u8; 32];
const VAULT_NEW_QX_BYTES: [u8; 32] = [43u8; 32];
const USER_OLD_QX_BYTES: [u8; 32] = [44u8; 32];
const USER_NEW_QX_BYTES: [u8; 32] = [45u8; 32];

const INITIAL_RESERVE: u64 = 1_000;
const INITIAL_USER_OLD_BALANCE: u64 = 250;
const INITIAL_USER_NEW_BALANCE: u64 = 0;
const MIGRATION_AMOUNT: u64 = 100;
const MIGRATION_CAP: u64 = INITIAL_USER_OLD_BALANCE;

fn resolve_sbf_out_dir() -> Option<PathBuf> {
    if let Ok(path) = env::var("MIGRATOR_PROGRAM_SBF_PATH") {
        let p = PathBuf::from(path);
        if p.exists() {
            return p.parent().map(PathBuf::from);
        }
        eprintln!(
            "[mollusk_fuzz_lane] MIGRATOR_PROGRAM_SBF_PATH set but file missing: {}",
            p.display()
        );
    }

    let fallback_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../target/deploy")
        .canonicalize()
        .unwrap_or_else(|_| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target/deploy"));
    let fallback_artifact = fallback_dir.join("migrator_program.so");

    if fallback_artifact.exists() {
        Some(fallback_dir)
    } else {
        None
    }
}

fn setup_mollusk(program_id: &Pubkey) -> Option<Mollusk> {
    let require_artifact = env::var_os("MOLLUSK_REQUIRE_ARTIFACT").is_some();
    let Some(sbf_out_dir) = resolve_sbf_out_dir() else {
        if require_artifact {
            panic!(
                "[mollusk_fuzz_lane] required SBF artifact missing. Build target/deploy/migrator_program.so or set MIGRATOR_PROGRAM_SBF_PATH"
            );
        }
        eprintln!(
            "[mollusk_fuzz_lane] skip: no program artifact found. Build target/deploy/migrator_program.so or set MIGRATOR_PROGRAM_SBF_PATH"
        );
        return None;
    };

    env::set_var("SBF_OUT_DIR", &sbf_out_dir);
    Some(Mollusk::new(program_id, "migrator_program"))
}

fn migration_config_from_bytes(data: &[u8]) -> MigrationConfig {
    assert!(data.len() >= MigrationConfig::SIZE);
    unsafe { std::ptr::read_unaligned(data.as_ptr() as *const MigrationConfig) }
}

fn make_program_data_metadata(upgrade_authority: Pubkey) -> Vec<u8> {
    let mut data = vec![0u8; 45];
    data[0..4].copy_from_slice(&3u32.to_le_bytes());
    data[4..12].copy_from_slice(&0u64.to_le_bytes());
    data[12] = 1;
    data[13..45].copy_from_slice(upgrade_authority.as_ref());
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

fn make_token_account_data(mint: &Pubkey, owner: &Pubkey, amount: u64) -> Vec<u8> {
    let mut data = vec![0u8; 165];
    data[0..32].copy_from_slice(mint.as_ref());
    data[32..64].copy_from_slice(owner.as_ref());
    data[64..72].copy_from_slice(&amount.to_le_bytes());
    data[72..76].copy_from_slice(&0u32.to_le_bytes());
    data[108] = 1;
    data[121..129].copy_from_slice(&0u64.to_le_bytes());
    data[129..133].copy_from_slice(&0u32.to_le_bytes());
    data
}

fn token_amount(account: &Account) -> u64 {
    u64::from_le_bytes(account.data()[64..72].try_into().unwrap())
}

fn account_by_key<'a>(accounts: &'a [(Pubkey, Account)], pubkey: &Pubkey) -> &'a Account {
    accounts
        .iter()
        .find(|(key, _)| key == pubkey)
        .map(|(_, account)| account)
        .expect("expected account to be present")
}

fn migration_error(error: MigrationError) -> ProgramError {
    ProgramError::Custom(error as u32)
}

struct FixtureAccounts {
    program_id: Pubkey,
    accounts: Vec<(Pubkey, Account)>,
    initializer: Pubkey,
    ops_admin: Pubkey,
    user: Pubkey,
    config_pda: Pubkey,
    vault_authority_pda: Pubkey,
    program_data: Pubkey,
    old_qx_mint: Pubkey,
    new_qx_mint: Pubkey,
    vault_new_qx: Pubkey,
    user_old_qx: Pubkey,
    user_new_qx: Pubkey,
    system_program: Pubkey,
}

impl FixtureAccounts {
    fn initialize_config_ix(&self, start_ts: i64, end_ts: i64, migration_cap: u64) -> Instruction {
        let mut data = vec![0u8];
        data.extend_from_slice(&start_ts.to_le_bytes());
        data.extend_from_slice(&end_ts.to_le_bytes());
        data.extend_from_slice(&migration_cap.to_le_bytes());

        Instruction::new_with_bytes(
            self.program_id,
            &data,
            vec![
                AccountMeta::new(self.initializer, true),
                AccountMeta::new_readonly(self.ops_admin, true),
                AccountMeta::new(self.config_pda, false),
                AccountMeta::new_readonly(self.vault_authority_pda, false),
                AccountMeta::new(self.vault_new_qx, false),
                AccountMeta::new_readonly(self.old_qx_mint, false),
                AccountMeta::new_readonly(self.new_qx_mint, false),
                AccountMeta::new_readonly(Pubkey::new_from_array(TOKEN_PROGRAM_ID), false),
                AccountMeta::new_readonly(self.system_program, false),
                AccountMeta::new_readonly(self.program_data, false),
            ],
        )
    }

    fn set_pause_ix(&self, paused: bool) -> Instruction {
        Instruction::new_with_bytes(
            self.program_id,
            &[1u8, if paused { 1 } else { 0 }],
            vec![
                AccountMeta::new_readonly(self.ops_admin, true),
                AccountMeta::new(self.config_pda, false),
            ],
        )
    }

    fn migrate_exact_ix(&self, amount_in: u64) -> Instruction {
        let mut data = vec![2u8];
        data.extend_from_slice(&amount_in.to_le_bytes());

        Instruction::new_with_bytes(
            self.program_id,
            &data,
            vec![
                AccountMeta::new_readonly(self.user, true),
                AccountMeta::new(self.config_pda, false),
                AccountMeta::new_readonly(self.vault_authority_pda, false),
                AccountMeta::new(self.vault_new_qx, false),
                AccountMeta::new(self.user_old_qx, false),
                AccountMeta::new(self.user_new_qx, false),
                AccountMeta::new(self.old_qx_mint, false),
                AccountMeta::new_readonly(self.new_qx_mint, false),
                AccountMeta::new_readonly(Pubkey::new_from_array(TOKEN_PROGRAM_ID), false),
            ],
        )
    }
}

fn base_accounts(program_id: Pubkey) -> FixtureAccounts {
    let initializer = Pubkey::new_unique();
    let ops_admin = Pubkey::new_unique();
    let user = Pubkey::new_unique();
    let loader_program = Pubkey::new_from_array(UPGRADEABLE_LOADER_PROGRAM_ID);
    let token_program = Pubkey::new_from_array(TOKEN_PROGRAM_ID);

    let (config_pda, _) = Pubkey::find_program_address(&[MIGRATION_CONFIG_SEED], &program_id);
    let (vault_authority_pda, _) =
        Pubkey::find_program_address(&[VAULT_AUTHORITY_SEED], &program_id);
    let (program_data, _) = Pubkey::find_program_address(&[program_id.as_ref()], &loader_program);

    let old_qx_mint = Pubkey::new_from_array(OLD_MINT_BYTES);
    let new_qx_mint = Pubkey::new_from_array(NEW_MINT_BYTES);
    let vault_new_qx = Pubkey::new_from_array(VAULT_NEW_QX_BYTES);
    let user_old_qx = Pubkey::new_from_array(USER_OLD_QX_BYTES);
    let user_new_qx = Pubkey::new_from_array(USER_NEW_QX_BYTES);
    let (system_program, system_program_account) = keyed_account_for_system_program();
    let (loader_v2_program, loader_v2_program_account) = keyed_account_for_bpf_loader_v2_program();
    let (loader_v3_program, loader_v3_program_account) = keyed_account_for_bpf_loader_v3_program();
    let (loader_v1_program, loader_v1_program_account) = create_keyed_account_for_builtin_program(
        &loader_keys::LOADER_V1,
        "solana_bpf_loader_deprecated_program",
    );

    let accounts = vec![
        (initializer, Account::new(2_000_000_000, 0, &system_program)),
        (ops_admin, Account::new(1_000_000_000, 0, &system_program)),
        (user, Account::new(1_000_000_000, 0, &system_program)),
        (config_pda, Account::default()),
        (vault_authority_pda, Account::new(1_000_000, 0, &program_id)),
        (
            program_data,
            Account {
                lamports: 1_000_000_000,
                data: make_program_data_metadata(initializer),
                owner: loader_program,
                executable: false,
                rent_epoch: 0,
            },
        ),
        (
            old_qx_mint,
            Account {
                lamports: 1_000_000,
                data: make_mint_data(INITIAL_USER_OLD_BALANCE, 9),
                owner: token_program,
                executable: false,
                rent_epoch: 0,
            },
        ),
        (
            new_qx_mint,
            Account {
                lamports: 1_000_000,
                data: make_mint_data(INITIAL_RESERVE, 9),
                owner: token_program,
                executable: false,
                rent_epoch: 0,
            },
        ),
        (
            vault_new_qx,
            Account {
                lamports: 1_000_000,
                data: make_token_account_data(&new_qx_mint, &vault_authority_pda, INITIAL_RESERVE),
                owner: token_program,
                executable: false,
                rent_epoch: 0,
            },
        ),
        (
            user_old_qx,
            Account {
                lamports: 1_000_000,
                data: make_token_account_data(&old_qx_mint, &user, INITIAL_USER_OLD_BALANCE),
                owner: token_program,
                executable: false,
                rent_epoch: 0,
            },
        ),
        (
            user_new_qx,
            Account {
                lamports: 1_000_000,
                data: make_token_account_data(&new_qx_mint, &user, INITIAL_USER_NEW_BALANCE),
                owner: token_program,
                executable: false,
                rent_epoch: 0,
            },
        ),
        (token_program, Account::default()),
        (system_program, system_program_account),
        (loader_v1_program, loader_v1_program_account),
        (loader_v2_program, loader_v2_program_account),
        (loader_v3_program, loader_v3_program_account),
    ];

    FixtureAccounts {
        program_id,
        accounts,
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
        system_program,
    }
}

#[test]
fn mollusk_initialize_config_binds_expected_state_and_cap() {
    let program_id = Pubkey::new_unique();
    let Some(mollusk) = setup_mollusk(&program_id) else {
        return;
    };

    let fixture = base_accounts(program_id);

    let result = mollusk.process_and_validate_instruction(
        &fixture.initialize_config_ix(0, i64::MAX, MIGRATION_CAP),
        &fixture.accounts,
        &[Check::success()],
    );

    assert_eq!(
        result.inner_instructions.len(),
        2,
        "initialize_config should issue the expected system-program CPIs"
    );

    let config_account = account_by_key(&result.resulting_accounts, &fixture.config_pda);
    assert_eq!(config_account.owner(), &program_id);
    assert_eq!(config_account.data().len(), MigrationConfig::SIZE);

    let config = migration_config_from_bytes(config_account.data());
    assert_eq!(config.discriminator, MigrationConfig::DISCRIMINATOR);
    assert_eq!(config.version, MigrationConfig::VERSION);
    assert_eq!(config.admin, *fixture.ops_admin.as_array());
    assert_eq!(config.old_qx_mint, *fixture.old_qx_mint.as_array());
    assert_eq!(config.new_qx_mint, *fixture.new_qx_mint.as_array());
    assert_eq!(
        config.vault_authority,
        *fixture.vault_authority_pda.as_array()
    );
    assert_eq!(config.vault_new_qx, *fixture.vault_new_qx.as_array());
    assert_eq!(config.total_migrated, 0);
    assert_eq!(config.migration_cap(), MIGRATION_CAP);
    assert_eq!(config.start_ts, 0);
    assert_eq!(config.end_ts, i64::MAX);
}

#[test]
fn mollusk_initialize_config_rejects_cap_above_reserve_without_state_mutation() {
    let program_id = Pubkey::new_unique();
    let Some(mollusk) = setup_mollusk(&program_id) else {
        return;
    };

    let fixture = base_accounts(program_id);

    let result = mollusk.process_and_validate_instruction(
        &fixture.initialize_config_ix(0, i64::MAX, INITIAL_RESERVE + 1),
        &fixture.accounts,
        &[Check::err(migration_error(
            MigrationError::InsufficientVaultLiquidity,
        ))],
    );

    assert_eq!(result.inner_instructions.len(), 0);
    let config_account = account_by_key(&result.resulting_accounts, &fixture.config_pda);
    assert!(config_account.data().is_empty());
    assert_eq!(config_account.owner(), &Pubkey::default());
}

#[test]
fn mollusk_pause_then_migrate_stops_before_any_token_cpi() {
    let program_id = Pubkey::new_unique();
    let Some(mollusk) = setup_mollusk(&program_id) else {
        return;
    };

    let fixture = base_accounts(program_id);

    let init_result = mollusk.process_and_validate_instruction(
        &fixture.initialize_config_ix(0, i64::MAX, MIGRATION_CAP),
        &fixture.accounts,
        &[Check::success()],
    );

    let pause_result = mollusk.process_and_validate_instruction(
        &fixture.set_pause_ix(true),
        &init_result.resulting_accounts,
        &[Check::success()],
    );

    let old_before = token_amount(account_by_key(
        &pause_result.resulting_accounts,
        &fixture.user_old_qx,
    ));
    let new_before = token_amount(account_by_key(
        &pause_result.resulting_accounts,
        &fixture.user_new_qx,
    ));
    let reserve_before = token_amount(account_by_key(
        &pause_result.resulting_accounts,
        &fixture.vault_new_qx,
    ));

    let migrate_result = mollusk.process_and_validate_instruction(
        &fixture.migrate_exact_ix(MIGRATION_AMOUNT),
        &pause_result.resulting_accounts,
        &[Check::err(migration_error(MigrationError::ProtocolPaused))],
    );

    assert_eq!(migrate_result.inner_instructions.len(), 0);

    let config = migration_config_from_bytes(
        account_by_key(&migrate_result.resulting_accounts, &fixture.config_pda).data(),
    );
    assert_eq!(config.paused, 1);
    assert_eq!(config.total_migrated, 0);
    assert_eq!(
        token_amount(account_by_key(
            &migrate_result.resulting_accounts,
            &fixture.user_old_qx
        )),
        old_before
    );
    assert_eq!(
        token_amount(account_by_key(
            &migrate_result.resulting_accounts,
            &fixture.user_new_qx
        )),
        new_before
    );
    assert_eq!(
        token_amount(account_by_key(
            &migrate_result.resulting_accounts,
            &fixture.vault_new_qx
        )),
        reserve_before
    );
}

#[test]
fn mollusk_fixture_roundtrip_replays_initialize_config_success_and_error() {
    let program_id = Pubkey::new_unique();
    let Some(mut mollusk) = setup_mollusk(&program_id) else {
        return;
    };

    let fixture = base_accounts(program_id);

    let success_ix = fixture.initialize_config_ix(0, i64::MAX, MIGRATION_CAP);
    let success_result = mollusk.process_instruction(&success_ix, &fixture.accounts);
    let success_fixture = mollusk_svm::fuzz::mollusk::build_fixture_from_mollusk_test(
        &mollusk,
        &success_ix,
        &fixture.accounts,
        &success_result,
    );
    mollusk.process_and_validate_fixture(&success_fixture);

    let error_ix = fixture.initialize_config_ix(0, i64::MAX, INITIAL_RESERVE + 1);
    let error_result = mollusk.process_instruction(&error_ix, &fixture.accounts);
    let error_fixture = mollusk_svm::fuzz::mollusk::build_fixture_from_mollusk_test(
        &mollusk,
        &error_ix,
        &fixture.accounts,
        &error_result,
    );
    mollusk.process_and_validate_fixture(&error_fixture);
}

use std::{env, path::PathBuf};

use migrator_program::{
    errors::MigrationError, state::MigrationConfig, ASSOCIATED_TOKEN_PROGRAM_ID,
    MIGRATION_CONFIG_SEED, TOKEN_PROGRAM_ID, UPGRADEABLE_LOADER_PROGRAM_ID, VAULT_AUTHORITY_SEED,
};
use mollusk_svm::{
    program::{
        create_keyed_account_for_builtin_program, create_program_account_loader_v2,
        keyed_account_for_bpf_loader_v2_program, keyed_account_for_bpf_loader_v3_program,
        keyed_account_for_system_program, loader_keys,
    },
    result::Check,
    Mollusk,
};
use mollusk_svm_programs_token::{
    associated_token::{
        account as associated_token_program_account, add_program as add_associated_token_program,
    },
    token::ELF as TOKENKEG_ELF,
};
use solana_account::{Account, ReadableAccount};
use solana_instruction::{AccountMeta, Instruction};
use solana_program_error::ProgramError;
use solana_program_option::COption;
use solana_program_pack::Pack;
use solana_pubkey::Pubkey;
use solana_rent::Rent;
use spl_token_interface::instruction::{
    initialize_account3, initialize_mint2, mint_to, set_authority, AuthorityType,
};
use spl_token_interface::state::{Account as TokenAccount, AccountState, Mint};

const OLD_MINT_BYTES: [u8; 32] = [41u8; 32];
const NEW_MINT_BYTES: [u8; 32] = [42u8; 32];
const VAULT_NEW_QX_BYTES: [u8; 32] = [43u8; 32];
const USER_OLD_QX_BYTES: [u8; 32] = [44u8; 32];

const INITIAL_USER_OLD_BALANCE: u64 = 250;
const INITIAL_USER_NEW_BALANCE: u64 = 0;
const MIGRATION_AMOUNT: u64 = 100;
const MIGRATION_CAP: u64 = INITIAL_USER_OLD_BALANCE;
const INITIAL_RESERVE: u64 = MIGRATION_CAP;

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
    let mut mollusk = Mollusk::new(program_id, "migrator_program");
    mollusk.add_program_with_loader_and_elf(
        &Pubkey::new_from_array(TOKEN_PROGRAM_ID),
        &loader_keys::LOADER_V2,
        TOKENKEG_ELF,
    );
    add_associated_token_program(&mut mollusk);
    Some(mollusk)
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
    let mint = Mint {
        mint_authority: COption::None,
        supply,
        decimals,
        is_initialized: true,
        freeze_authority: COption::None,
    };
    let mut data = vec![0u8; Mint::LEN];
    Mint::pack(mint, &mut data).expect("mint pack");
    data
}

fn make_token_account_data(mint: &Pubkey, owner: &Pubkey, amount: u64) -> Vec<u8> {
    let token_account = TokenAccount {
        mint: Pubkey::new_from_array(*mint.as_array()),
        owner: Pubkey::new_from_array(*owner.as_array()),
        amount,
        delegate: COption::None,
        state: AccountState::Initialized,
        is_native: COption::None,
        delegated_amount: 0,
        close_authority: COption::None,
    };
    let mut data = vec![0u8; TokenAccount::LEN];
    TokenAccount::pack(token_account, &mut data).expect("token account pack");
    data
}

fn token_amount(account: &Account) -> u64 {
    u64::from_le_bytes(account.data()[64..72].try_into().unwrap())
}

fn associated_token_address(owner: &Pubkey, mint: &Pubkey) -> Pubkey {
    let associated_token_program = Pubkey::new_from_array(ASSOCIATED_TOKEN_PROGRAM_ID);
    Pubkey::find_program_address(
        &[owner.as_ref(), TOKEN_PROGRAM_ID.as_slice(), mint.as_ref()],
        &associated_token_program,
    )
    .0
}

fn create_associated_token_account_instruction(
    funding_address: &Pubkey,
    wallet_address: &Pubkey,
    token_mint_address: &Pubkey,
    token_program_id: &Pubkey,
) -> Instruction {
    Instruction::new_with_bytes(
        Pubkey::new_from_array(ASSOCIATED_TOKEN_PROGRAM_ID),
        &[0],
        vec![
            AccountMeta::new(*funding_address, true),
            AccountMeta::new(
                associated_token_address(wallet_address, token_mint_address),
                false,
            ),
            AccountMeta::new_readonly(*wallet_address, false),
            AccountMeta::new_readonly(*token_mint_address, false),
            AccountMeta::new_readonly(
                Pubkey::from_str_const("11111111111111111111111111111111"),
                false,
            ),
            AccountMeta::new_readonly(*token_program_id, false),
        ],
    )
}

fn account_by_key<'a>(accounts: &'a [(Pubkey, Account)], pubkey: &Pubkey) -> &'a Account {
    accounts
        .iter()
        .find(|(key, _)| key == pubkey)
        .map(|(_, account)| account)
        .expect("expected account to be present")
}

fn migration_config_to_bytes(config: &MigrationConfig) -> Vec<u8> {
    unsafe {
        core::slice::from_raw_parts(
            (config as *const MigrationConfig).cast::<u8>(),
            MigrationConfig::SIZE,
        )
    }
    .to_vec()
}

fn set_config_window_in_accounts(
    accounts: &mut [(Pubkey, Account)],
    config_pda: &Pubkey,
    start_ts: i64,
    end_ts: i64,
) {
    let config_account = accounts
        .iter_mut()
        .find(|(key, _)| key == config_pda)
        .map(|(_, account)| account)
        .expect("config account should be present");
    let mut config = migration_config_from_bytes(config_account.data());
    config.start_ts = start_ts;
    config.end_ts = end_ts;
    config_account.data = migration_config_to_bytes(&config);
}

fn migration_error(error: MigrationError) -> ProgramError {
    ProgramError::Custom(error as u32)
}

struct FixtureAccounts {
    program_id: Pubkey,
    accounts: Vec<(Pubkey, Account)>,
    initializer: Pubkey,
    ops_admin: Pubkey,
    funding_authority: Pubkey,
    user: Pubkey,
    config_pda: Pubkey,
    vault_authority_pda: Pubkey,
    program_data: Pubkey,
    old_qx_mint: Pubkey,
    new_qx_mint: Pubkey,
    funding_new_qx: Pubkey,
    vault_new_qx: Pubkey,
    refund_recipient_new_qx: Pubkey,
    user_old_qx: Pubkey,
    user_new_qx: Pubkey,
    system_program: Pubkey,
}

fn process_instruction(
    mollusk: &Mollusk,
    instruction: &Instruction,
    accounts: &[(Pubkey, Account)],
    checks: &[Check],
) -> Vec<(Pubkey, Account)> {
    mollusk
        .process_and_validate_instruction(instruction, accounts, checks)
        .resulting_accounts
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
                AccountMeta::new_readonly(self.funding_authority, true),
                AccountMeta::new(self.funding_new_qx, false),
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

    fn withdraw_unclaimed_ix(&self) -> Instruction {
        Instruction::new_with_bytes(
            self.program_id,
            &[3u8],
            vec![
                AccountMeta::new(self.config_pda, false),
                AccountMeta::new_readonly(self.vault_authority_pda, false),
                AccountMeta::new(self.vault_new_qx, false),
                AccountMeta::new(self.refund_recipient_new_qx, false),
                AccountMeta::new_readonly(self.new_qx_mint, false),
                AccountMeta::new_readonly(Pubkey::new_from_array(TOKEN_PROGRAM_ID), false),
            ],
        )
    }
}

fn base_accounts(program_id: Pubkey) -> FixtureAccounts {
    let initializer = Pubkey::new_unique();
    let ops_admin = Pubkey::new_unique();
    let funding_authority = Pubkey::new_unique();
    let user = Pubkey::new_unique();
    let loader_program = Pubkey::new_from_array(UPGRADEABLE_LOADER_PROGRAM_ID);
    let token_program = Pubkey::new_from_array(TOKEN_PROGRAM_ID);

    let (config_pda, _) = Pubkey::find_program_address(&[MIGRATION_CONFIG_SEED], &program_id);
    let (vault_authority_pda, _) =
        Pubkey::find_program_address(&[VAULT_AUTHORITY_SEED], &program_id);
    let (program_data, _) = Pubkey::find_program_address(&[program_id.as_ref()], &loader_program);

    let old_qx_mint = Pubkey::new_from_array(OLD_MINT_BYTES);
    let new_qx_mint = Pubkey::new_from_array(NEW_MINT_BYTES);
    let funding_new_qx = Pubkey::new_unique();
    let vault_new_qx = Pubkey::new_from_array(VAULT_NEW_QX_BYTES);
    let refund_recipient_new_qx = associated_token_address(&funding_authority, &new_qx_mint);
    let user_old_qx = Pubkey::new_from_array(USER_OLD_QX_BYTES);
    let user_new_qx = associated_token_address(&user, &new_qx_mint);
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
        (funding_authority, Account::new(1_000_000_000, 0, &system_program)),
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
                data: make_token_account_data(&new_qx_mint, &vault_authority_pda, 0),
                owner: token_program,
                executable: false,
                rent_epoch: 0,
            },
        ),
        (
            funding_new_qx,
            Account {
                lamports: 1_000_000,
                data: make_token_account_data(&new_qx_mint, &funding_authority, INITIAL_RESERVE),
                owner: token_program,
                executable: false,
                rent_epoch: 0,
            },
        ),
        (
            refund_recipient_new_qx,
            Account {
                lamports: 1_000_000,
                data: make_token_account_data(&new_qx_mint, &funding_authority, 0),
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
        (
            token_program,
            create_program_account_loader_v2(TOKENKEG_ELF),
        ),
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
        funding_authority,
        user,
        config_pda,
        vault_authority_pda,
        program_data,
        old_qx_mint,
        new_qx_mint,
        funding_new_qx,
        vault_new_qx,
        refund_recipient_new_qx,
        user_old_qx,
        user_new_qx,
        system_program,
    }
}

fn base_accounts_for_real_spl_bootstrap(program_id: Pubkey) -> FixtureAccounts {
    let initializer = Pubkey::new_unique();
    let ops_admin = Pubkey::new_unique();
    let funding_authority = Pubkey::new_unique();
    let user = Pubkey::new_unique();
    let loader_program = Pubkey::new_from_array(UPGRADEABLE_LOADER_PROGRAM_ID);
    let token_program = Pubkey::new_from_array(TOKEN_PROGRAM_ID);
    let associated_token_program = Pubkey::new_from_array(ASSOCIATED_TOKEN_PROGRAM_ID);

    let (config_pda, _) = Pubkey::find_program_address(&[MIGRATION_CONFIG_SEED], &program_id);
    let (vault_authority_pda, _) =
        Pubkey::find_program_address(&[VAULT_AUTHORITY_SEED], &program_id);
    let (program_data, _) = Pubkey::find_program_address(&[program_id.as_ref()], &loader_program);

    let old_qx_mint = Pubkey::new_from_array(OLD_MINT_BYTES);
    let new_qx_mint = Pubkey::new_from_array(NEW_MINT_BYTES);
    let funding_new_qx = Pubkey::new_unique();
    let vault_new_qx = Pubkey::new_from_array(VAULT_NEW_QX_BYTES);
    let refund_recipient_new_qx = associated_token_address(&funding_authority, &new_qx_mint);
    let user_old_qx = Pubkey::new_from_array(USER_OLD_QX_BYTES);
    let user_new_qx = associated_token_address(&user, &new_qx_mint);
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
        (funding_authority, Account::new(1_000_000_000, 0, &system_program)),
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
            Account::new(
                Rent::default().minimum_balance(Mint::LEN),
                Mint::LEN,
                &token_program,
            ),
        ),
        (
            new_qx_mint,
            Account::new(
                Rent::default().minimum_balance(Mint::LEN),
                Mint::LEN,
                &token_program,
            ),
        ),
        (
            vault_new_qx,
            Account::new(
                Rent::default().minimum_balance(TokenAccount::LEN),
                TokenAccount::LEN,
                &token_program,
            ),
        ),
        (
            funding_new_qx,
            Account::new(
                Rent::default().minimum_balance(TokenAccount::LEN),
                TokenAccount::LEN,
                &token_program,
            ),
        ),
        (refund_recipient_new_qx, Account::default()),
        (
            user_old_qx,
            Account::new(
                Rent::default().minimum_balance(TokenAccount::LEN),
                TokenAccount::LEN,
                &token_program,
            ),
        ),
        (user_new_qx, Account::default()),
        (
            token_program,
            create_program_account_loader_v2(TOKENKEG_ELF),
        ),
        (associated_token_program, associated_token_program_account()),
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
        funding_authority,
        user,
        config_pda,
        vault_authority_pda,
        program_data,
        old_qx_mint,
        new_qx_mint,
        funding_new_qx,
        vault_new_qx,
        refund_recipient_new_qx,
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
        3,
        "initialize_config should issue the expected create-and-fund CPIs"
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
    assert_eq!(config.refund_recipient(), *fixture.funding_authority.as_array());
    assert_eq!(config.start_ts, 0);
    assert_eq!(config.end_ts, i64::MAX);
    assert_eq!(token_amount(account_by_key(&result.resulting_accounts, &fixture.funding_new_qx)), 0);
    assert_eq!(token_amount(account_by_key(&result.resulting_accounts, &fixture.vault_new_qx)), MIGRATION_CAP);
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
fn mollusk_migrate_exact_executes_burn_and_transfer_cpis() {
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

    let old_before = token_amount(account_by_key(
        &init_result.resulting_accounts,
        &fixture.user_old_qx,
    ));
    let new_before = token_amount(account_by_key(
        &init_result.resulting_accounts,
        &fixture.user_new_qx,
    ));
    let reserve_before = token_amount(account_by_key(
        &init_result.resulting_accounts,
        &fixture.vault_new_qx,
    ));

    let migrate_result = mollusk.process_and_validate_instruction(
        &fixture.migrate_exact_ix(MIGRATION_AMOUNT),
        &init_result.resulting_accounts,
        &[Check::success()],
    );

    assert_eq!(
        migrate_result.inner_instructions.len(),
        2,
        "migrate_exact should emit burn and transfer token CPIs",
    );

    let config = migration_config_from_bytes(
        account_by_key(&migrate_result.resulting_accounts, &fixture.config_pda).data(),
    );
    assert_eq!(config.paused, 0);
    assert_eq!(config.total_migrated, MIGRATION_AMOUNT);
    assert_eq!(
        token_amount(account_by_key(
            &migrate_result.resulting_accounts,
            &fixture.user_old_qx
        )),
        old_before - MIGRATION_AMOUNT
    );
    assert_eq!(
        token_amount(account_by_key(
            &migrate_result.resulting_accounts,
            &fixture.user_new_qx
        )),
        new_before + MIGRATION_AMOUNT
    );
    assert_eq!(
        token_amount(account_by_key(
            &migrate_result.resulting_accounts,
            &fixture.vault_new_qx
        )),
        reserve_before - MIGRATION_AMOUNT
    );
}

#[test]
fn mollusk_real_spl_and_ata_bootstrap_then_migrate_exact() {
    let program_id = Pubkey::new_unique();
    let Some(mollusk) = setup_mollusk(&program_id) else {
        return;
    };

    let fixture = base_accounts_for_real_spl_bootstrap(program_id);
    let token_program = Pubkey::new_from_array(TOKEN_PROGRAM_ID);

    let mut accounts = fixture.accounts.clone();

    accounts = process_instruction(
        &mollusk,
        &initialize_mint2(
            &token_program,
            &fixture.old_qx_mint,
            &fixture.initializer,
            None,
            9,
        )
        .expect("initialize old mint instruction"),
        &accounts,
        &[Check::success()],
    );
    accounts = process_instruction(
        &mollusk,
        &initialize_mint2(
            &token_program,
            &fixture.new_qx_mint,
            &fixture.initializer,
            None,
            9,
        )
        .expect("initialize new mint instruction"),
        &accounts,
        &[Check::success()],
    );
    accounts = process_instruction(
        &mollusk,
        &initialize_account3(
            &token_program,
            &fixture.funding_new_qx,
            &fixture.new_qx_mint,
            &fixture.funding_authority,
        )
        .expect("initialize funding account instruction"),
        &accounts,
        &[Check::success()],
    );
    accounts = process_instruction(
        &mollusk,
        &initialize_account3(
            &token_program,
            &fixture.vault_new_qx,
            &fixture.new_qx_mint,
            &fixture.vault_authority_pda,
        )
        .expect("initialize reserve vault instruction"),
        &accounts,
        &[Check::success()],
    );
    accounts = process_instruction(
        &mollusk,
        &initialize_account3(
            &token_program,
            &fixture.user_old_qx,
            &fixture.old_qx_mint,
            &fixture.user,
        )
        .expect("initialize user old account instruction"),
        &accounts,
        &[Check::success()],
    );
    accounts = process_instruction(
        &mollusk,
        &create_associated_token_account_instruction(
            &fixture.initializer,
            &fixture.user,
            &fixture.new_qx_mint,
            &token_program,
        ),
        &accounts,
        &[Check::success()],
    );
    accounts = process_instruction(
        &mollusk,
        &mint_to(
            &token_program,
            &fixture.old_qx_mint,
            &fixture.user_old_qx,
            &fixture.initializer,
            &[],
            INITIAL_USER_OLD_BALANCE,
        )
        .expect("mint old qx instruction"),
        &accounts,
        &[Check::success()],
    );
    accounts = process_instruction(
        &mollusk,
        &mint_to(
            &token_program,
            &fixture.new_qx_mint,
            &fixture.funding_new_qx,
            &fixture.initializer,
            &[],
            INITIAL_RESERVE,
        )
        .expect("mint new qx reserve instruction"),
        &accounts,
        &[Check::success()],
    );
    accounts = process_instruction(
        &mollusk,
        &set_authority(
            &token_program,
            &fixture.old_qx_mint,
            None,
            AuthorityType::MintTokens,
            &fixture.initializer,
            &[],
        )
        .expect("clear old mint authority instruction"),
        &accounts,
        &[Check::success()],
    );
    accounts = process_instruction(
        &mollusk,
        &set_authority(
            &token_program,
            &fixture.new_qx_mint,
            None,
            AuthorityType::MintTokens,
            &fixture.initializer,
            &[],
        )
        .expect("clear new mint authority instruction"),
        &accounts,
        &[Check::success()],
    );

    let init_result = mollusk.process_and_validate_instruction(
        &fixture.initialize_config_ix(0, i64::MAX, MIGRATION_CAP),
        &accounts,
        &[Check::success()],
    );
    let migrate_result = mollusk.process_and_validate_instruction(
        &fixture.migrate_exact_ix(MIGRATION_AMOUNT),
        &init_result.resulting_accounts,
        &[Check::success()],
    );

    let config = migration_config_from_bytes(
        account_by_key(&migrate_result.resulting_accounts, &fixture.config_pda).data(),
    );
    assert_eq!(config.total_migrated, MIGRATION_AMOUNT);
    assert_eq!(config.migration_cap(), MIGRATION_CAP);

    let old_balance_after = token_amount(account_by_key(
        &migrate_result.resulting_accounts,
        &fixture.user_old_qx,
    ));
    let new_balance_after = token_amount(account_by_key(
        &migrate_result.resulting_accounts,
        &fixture.user_new_qx,
    ));
    let reserve_balance_after = token_amount(account_by_key(
        &migrate_result.resulting_accounts,
        &fixture.vault_new_qx,
    ));

    assert_eq!(
        old_balance_after,
        INITIAL_USER_OLD_BALANCE - MIGRATION_AMOUNT
    );
    assert_eq!(new_balance_after, MIGRATION_AMOUNT);
    assert_eq!(reserve_balance_after, MIGRATION_CAP - MIGRATION_AMOUNT);
}

#[test]
fn mollusk_withdraw_unclaimed_executes_closeout_transfer_and_sets_flag() {
    let program_id = Pubkey::new_unique();
    let Some(mollusk) = setup_mollusk(&program_id) else {
        return;
    };

    let fixture = base_accounts(program_id);
    let init_accounts = process_instruction(
        &mollusk,
        &fixture.initialize_config_ix(0, 10, MIGRATION_CAP),
        &fixture.accounts,
        &[Check::success()],
    );
    let migrate_accounts = process_instruction(
        &mollusk,
        &fixture.migrate_exact_ix(MIGRATION_AMOUNT),
        &init_accounts,
        &[Check::success()],
    );

    let mut expired_accounts = migrate_accounts;
    set_config_window_in_accounts(&mut expired_accounts, &fixture.config_pda, -1, -1);

    let reserve_before = token_amount(account_by_key(&expired_accounts, &fixture.vault_new_qx));
    let refund_before = token_amount(account_by_key(
        &expired_accounts,
        &fixture.refund_recipient_new_qx,
    ));
    let unclaimed_amount = MIGRATION_CAP - MIGRATION_AMOUNT;

    let closeout_accounts = process_instruction(
        &mollusk,
        &fixture.withdraw_unclaimed_ix(),
        &expired_accounts,
        &[Check::success()],
    );
    assert_eq!(
        token_amount(account_by_key(&closeout_accounts, &fixture.vault_new_qx)),
        reserve_before - unclaimed_amount
    );
    assert_eq!(
        token_amount(account_by_key(
            &closeout_accounts,
            &fixture.refund_recipient_new_qx
        )),
        refund_before + unclaimed_amount
    );
    let config =
        migration_config_from_bytes(account_by_key(&closeout_accounts, &fixture.config_pda).data());
    assert_eq!(config.total_migrated, MIGRATION_AMOUNT);
    assert!(config.unclaimed_withdrawn());
}

#[test]
fn mollusk_withdraw_unclaimed_rejects_at_deadline_without_mutation() {
    let program_id = Pubkey::new_unique();
    let Some(mollusk) = setup_mollusk(&program_id) else {
        return;
    };

    let fixture = base_accounts(program_id);
    let init_accounts = process_instruction(
        &mollusk,
        &fixture.initialize_config_ix(-1, 0, MIGRATION_CAP),
        &fixture.accounts,
        &[Check::success()],
    );

    let reserve_before = token_amount(account_by_key(&init_accounts, &fixture.vault_new_qx));
    let refund_before = token_amount(account_by_key(
        &init_accounts,
        &fixture.refund_recipient_new_qx,
    ));

    let closeout_accounts = process_instruction(
        &mollusk,
        &fixture.withdraw_unclaimed_ix(),
        &init_accounts,
        &[Check::err(migration_error(
            MigrationError::MigrationStillOpen,
        ))],
    );

    assert_eq!(
        token_amount(account_by_key(&closeout_accounts, &fixture.vault_new_qx)),
        reserve_before
    );
    assert_eq!(
        token_amount(account_by_key(
            &closeout_accounts,
            &fixture.refund_recipient_new_qx
        )),
        refund_before
    );
    let config =
        migration_config_from_bytes(account_by_key(&closeout_accounts, &fixture.config_pda).data());
    assert_eq!(config.total_migrated, 0);
    assert!(!config.unclaimed_withdrawn());
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

use pinocchio::{
    cpi::{Seed, Signer},
    error::ProgramError,
    AccountView, Address, ProgramResult,
};
use pinocchio_token::instructions::Transfer;

use crate::{
    errors::MigrationError,
    state::{
        token_amount, validate_custody_token_account, validate_migration_window,
        validate_new_mint_account, validate_old_mint_account, validate_token_program,
        MigrationConfig,
    },
    MIGRATION_CONFIG_SEED,
};

use super::{
    assert_config_pda, assert_program_upgrade_authority, assert_vault_authority_pda,
    create_pda_account_idempotent, parse_initialize_config_data_exact,
};

// Accounts:
// 0. [signer, writable] initializer authority (must match program upgrade authority; payer)
// 1. [signer] ops admin
// 2. [signer] funding authority (immutable refund recipient for unclaimed closeout)
// 3. [writable] funding new-token account
// 4. [writable] config PDA
// 5. [] vault authority PDA
// 6. [writable] vault new-token account
// 7. [] old-token mint
// 8. [] new-token mint
// 9. [] token program
// 10. [] system program (unused, kept for explicit client contract)
// 11. [] program_data (Upgradeable Loader ProgramData PDA)
// Data: start_ts(i64), end_ts(i64), migration_cap(u64)
pub fn process(program_id: &Address, accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let [initializer_authority, ops_admin, funding_authority, funding_new_token_account, config_account, vault_authority, vault_new_token_account, old_token_mint, new_token_mint, token_program, _system_program, program_data, ..] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    if !ops_admin.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if !funding_authority.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let (start_ts, end_ts, migration_cap) = parse_initialize_config_data_exact(data)?;
    validate_migration_window(start_ts, end_ts)?;
    if migration_cap == 0 {
        return Err(MigrationError::InvalidConfig.into());
    }

    assert_program_upgrade_authority(initializer_authority, program_data, program_id)?;
    validate_token_program(token_program)?;

    let config_bump = assert_config_pda(config_account, program_id)?;
    let vault_authority_bump = assert_vault_authority_pda(vault_authority, program_id)?;

    let old_mint_key = *old_token_mint.address().as_array();
    let new_mint_key = *new_token_mint.address().as_array();
    if old_mint_key == new_mint_key {
        return Err(MigrationError::InvalidConfig.into());
    }
    if initializer_authority.address() == &Address::default() {
        return Err(MigrationError::InvalidConfig.into());
    }

    let old_decimals = validate_old_mint_account(old_token_mint, &old_mint_key)?;
    let new_decimals = validate_new_mint_account(new_token_mint, &new_mint_key)?;
    if old_decimals != new_decimals {
        return Err(MigrationError::InvalidConfig.into());
    }

    unsafe {
        validate_custody_token_account(
            funding_new_token_account,
            &new_mint_key,
            funding_authority.address().as_array(),
        )?;
        validate_custody_token_account(
            vault_new_token_account,
            &new_mint_key,
            vault_authority.address().as_array(),
        )?;
        if token_amount(vault_new_token_account)? != 0 {
            return Err(MigrationError::InvalidConfig.into());
        }
        if token_amount(funding_new_token_account)? < migration_cap {
            return Err(MigrationError::InsufficientVaultLiquidity.into());
        }
    }

    let bump_seed = [config_bump];
    let cfg_seeds = [
        Seed::from(MIGRATION_CONFIG_SEED),
        Seed::from(&bump_seed as &[u8]),
    ];
    let cfg_signer = Signer::from(&cfg_seeds);

    create_pda_account_idempotent(
        initializer_authority,
        config_account,
        MigrationConfig::SIZE,
        program_id,
        cfg_signer,
    )?;

    Transfer {
        from: funding_new_token_account,
        to: vault_new_token_account,
        authority: funding_authority,
        amount: migration_cap,
    }
    .invoke()?;

    let mut config = unsafe { MigrationConfig::init(config_account)? };
    config.bump = config_bump;
    config.vault_authority_bump = vault_authority_bump;
    config.paused = 0;
    config.admin.copy_from_slice(ops_admin.address().as_ref());
    config.source_mint.copy_from_slice(&old_mint_key);
    config.destination_mint.copy_from_slice(&new_mint_key);
    config
        .token_program_id
        .copy_from_slice(token_program.address().as_ref());
    config
        .vault_authority
        .copy_from_slice(vault_authority.address().as_ref());
    config
        .reserve_vault
        .copy_from_slice(vault_new_token_account.address().as_ref());
    config.total_migrated = 0;
    config.start_ts = start_ts;
    config.end_ts = end_ts;
    config.reserved = [0u8; 64];
    config.set_migration_cap(migration_cap);
    config.set_refund_recipient(funding_authority.address().as_array());
    unsafe { config.store(config_account, program_id)? };

    pinocchio_log::log!("MigrationConfigInitialized");

    Ok(())
}

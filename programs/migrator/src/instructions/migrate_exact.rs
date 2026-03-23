use pinocchio::{
    cpi::{Seed, Signer},
    error::ProgramError,
    AccountView, Address, ProgramResult,
};
use pinocchio_token::instructions::{Burn, Transfer};

use crate::{
    errors::MigrationError,
    state::{
        checked_total_migrated_after, token_amount, validate_custody_token_account,
        validate_destination_token_account, validate_migration_cap, validate_new_mint_account,
        validate_old_mint_account, validate_token_account, validate_token_program, MigrationConfig,
    },
    VAULT_AUTHORITY_SEED,
};

use super::{assert_config_pda, assert_vault_authority_pda, now_ts, parse_u64_exact};

// Accounts:
// 0. [signer] user
// 1. [writable] config PDA
// 2. [] vault authority PDA
// 3. [writable] vault destination token token account
// 4. [writable] user source token token account
// 5. [writable] user destination token token account
// 6. [writable] source token mint
// 7. [] destination token mint
// 8. [] token program
// Data: amount_in(u64)
pub fn process(program_id: &Address, accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let amount_in = parse_u64_exact(data)?;
    if amount_in == 0 {
        return Err(MigrationError::ZeroAmount.into());
    }

    let [user, config_account, vault_authority, reserve_vault, user_source_tokens, user_destination_tokens, source_mint, destination_mint, token_program, ..] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    if !user.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    assert_config_pda(config_account, program_id)?;
    assert_vault_authority_pda(vault_authority, program_id)?;

    let now = now_ts()?;
    let vault_authority_bump;
    let total_migrated_after;
    {
        let config = unsafe { MigrationConfig::from_account_info(config_account, program_id)? };
        super::evaluate_migration_gate(config.paused != 0, config.start_ts, config.end_ts, now)
            .map_err(ProgramError::from)?;
        if config.token_program_id != *token_program.address().as_array() {
            return Err(MigrationError::InvalidTokenProgram.into());
        }
        validate_token_program(token_program)?;

        if config.vault_authority != *vault_authority.address().as_array() {
            return Err(MigrationError::InvalidVaultAuthority.into());
        }
        if config.reserve_vault != *reserve_vault.address().as_array() {
            return Err(MigrationError::InvalidVault.into());
        }
        if config.source_mint != *source_mint.address().as_array() {
            return Err(MigrationError::InvalidOldMint.into());
        }
        if config.destination_mint != *destination_mint.address().as_array() {
            return Err(MigrationError::InvalidNewMint.into());
        }

        let _ = validate_old_mint_account(source_mint, &config.source_mint)?;
        let _ = validate_new_mint_account(destination_mint, &config.destination_mint)?;
        validate_migration_cap(config.total_migrated, amount_in, config.migration_cap())?;
        total_migrated_after = checked_total_migrated_after(config.total_migrated, amount_in)?;

        unsafe {
            validate_custody_token_account(
                reserve_vault,
                &config.destination_mint,
                &config.vault_authority,
            )?;
            validate_token_account(user_source_tokens, &config.source_mint, user.address().as_array())?;
            validate_destination_token_account(user_destination_tokens, user.address(), &config.destination_mint)?;
            if token_amount(reserve_vault)? < amount_in {
                return Err(MigrationError::InsufficientVaultLiquidity.into());
            }
        }

        vault_authority_bump = config.vault_authority_bump;
    }

    Burn {
        account: user_source_tokens,
        mint: source_mint,
        authority: user,
        amount: amount_in,
    }
    .invoke()?;

    let vault_bump_seed = [vault_authority_bump];
    let vault_seeds = [
        Seed::from(VAULT_AUTHORITY_SEED),
        Seed::from(&vault_bump_seed as &[u8]),
    ];
    let vault_signer = Signer::from(&vault_seeds);

    Transfer {
        from: reserve_vault,
        to: user_destination_tokens,
        authority: vault_authority,
        amount: amount_in,
    }
    .invoke_signed(core::slice::from_ref(&vault_signer))?;

    let mut config = unsafe { MigrationConfig::from_account_info(config_account, program_id)? };
    config.total_migrated = total_migrated_after;
    unsafe { config.store(config_account, program_id)? };

    pinocchio_log::log!("Migrated");

    Ok(())
}

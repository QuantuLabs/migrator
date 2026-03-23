use pinocchio::{
    cpi::{Seed, Signer},
    error::ProgramError,
    AccountView, Address, ProgramResult,
};
use pinocchio_token::instructions::Transfer;

use crate::{
    errors::MigrationError,
    state::{
        token_amount, validate_custody_token_account, validate_destination_token_account,
        validate_new_mint_account, validate_token_program, MigrationConfig,
    },
    VAULT_AUTHORITY_SEED,
};

use super::{
    assert_config_pda, assert_vault_authority_pda, evaluate_unclaimed_withdrawal_gate, now_ts,
};

// Accounts:
// 0. [writable] config PDA
// 1. [] vault authority PDA
// 2. [writable] vault new QX token account
// 3. [writable] refund recipient new QX ATA
// 4. [] new QX mint
// 5. [] token program
// Data: none
pub fn process(program_id: &Address, accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    if !data.is_empty() {
        return Err(ProgramError::InvalidInstructionData);
    }

    let [config_account, vault_authority, vault_new_qx, refund_recipient_new_qx, new_qx_mint, token_program, ..] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    assert_config_pda(config_account, program_id)?;
    assert_vault_authority_pda(vault_authority, program_id)?;

    let config = unsafe { MigrationConfig::from_account_info(config_account, program_id)? };
    evaluate_unclaimed_withdrawal_gate(config.end_ts, now_ts()?).map_err(ProgramError::from)?;
    if config.unclaimed_withdrawn() {
        return Err(MigrationError::UnclaimedAlreadyWithdrawn.into());
    }

    if config.token_program_id != *token_program.address().as_array() {
        return Err(MigrationError::InvalidTokenProgram.into());
    }
    if config.vault_authority != *vault_authority.address().as_array() {
        return Err(MigrationError::InvalidVaultAuthority.into());
    }
    if config.vault_new_qx != *vault_new_qx.address().as_array() {
        return Err(MigrationError::InvalidVault.into());
    }
    if config.new_qx_mint != *new_qx_mint.address().as_array() {
        return Err(MigrationError::InvalidNewMint.into());
    }

    validate_token_program(token_program)?;
    let _ = validate_new_mint_account(new_qx_mint, &config.new_qx_mint)?;

    let refund_recipient = Address::new_from_array(config.refund_recipient());
    let unclaimed_amount = config
        .migration_cap()
        .checked_sub(config.total_migrated)
        .ok_or(MigrationError::MigrationCapExceeded)?;
    if unclaimed_amount == 0 {
        return Err(MigrationError::InsufficientVaultLiquidity.into());
    }

    let vault_balance = unsafe {
        validate_custody_token_account(vault_new_qx, &config.new_qx_mint, &config.vault_authority)?;
        validate_destination_token_account(
            refund_recipient_new_qx,
            &refund_recipient,
            &config.new_qx_mint,
        )?;
        token_amount(vault_new_qx)?
    };
    if vault_balance < unclaimed_amount {
        return Err(MigrationError::InsufficientVaultLiquidity.into());
    }

    let vault_bump_seed = [config.vault_authority_bump];
    let vault_seeds = [
        Seed::from(VAULT_AUTHORITY_SEED),
        Seed::from(&vault_bump_seed as &[u8]),
    ];
    let vault_signer = Signer::from(&vault_seeds);

    Transfer {
        from: vault_new_qx,
        to: refund_recipient_new_qx,
        authority: vault_authority,
        amount: unclaimed_amount,
    }
    .invoke_signed(core::slice::from_ref(&vault_signer))?;

    let mut updated_config = config;
    updated_config.set_unclaimed_withdrawn(true);
    unsafe { updated_config.store(config_account, program_id)? };

    pinocchio_log::log!("UnclaimedWithdrawn");

    Ok(())
}

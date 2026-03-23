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
// 2. [writable] vault destination token token account
// 3. [writable] refund recipient destination token ATA
// 4. [] destination token mint
// 5. [] token program
// Data: none
pub fn process(program_id: &Address, accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    if !data.is_empty() {
        return Err(ProgramError::InvalidInstructionData);
    }

    let [config_account, vault_authority, reserve_vault, refund_recipient_token_account, destination_mint, token_program, ..] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    assert_config_pda(config_account, program_id)?;
    assert_vault_authority_pda(vault_authority, program_id)?;

    let config = unsafe { MigrationConfig::from_account_info(config_account, program_id)? };
    if config.paused != 0 {
        return Err(MigrationError::ProtocolPaused.into());
    }
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
    if config.reserve_vault != *reserve_vault.address().as_array() {
        return Err(MigrationError::InvalidVault.into());
    }
    if config.destination_mint != *destination_mint.address().as_array() {
        return Err(MigrationError::InvalidNewMint.into());
    }

    validate_token_program(token_program)?;
    let _ = validate_new_mint_account(destination_mint, &config.destination_mint)?;

    let refund_recipient = Address::new_from_array(config.refund_recipient());

    let closeout_amount = unsafe {
        validate_custody_token_account(reserve_vault, &config.destination_mint, &config.vault_authority)?;
        validate_destination_token_account(
            refund_recipient_token_account,
            &refund_recipient,
            &config.destination_mint,
        )?;
        token_amount(reserve_vault)?
    };
    if closeout_amount == 0 {
        return Err(MigrationError::InsufficientVaultLiquidity.into());
    }

    let vault_bump_seed = [config.vault_authority_bump];
    let vault_seeds = [
        Seed::from(VAULT_AUTHORITY_SEED),
        Seed::from(&vault_bump_seed as &[u8]),
    ];
    let vault_signer = Signer::from(&vault_seeds);

    Transfer {
        from: reserve_vault,
        to: refund_recipient_token_account,
        authority: vault_authority,
        amount: closeout_amount,
    }
    .invoke_signed(core::slice::from_ref(&vault_signer))?;

    let mut updated_config = config;
    updated_config.set_unclaimed_withdrawn(true);
    unsafe { updated_config.store(config_account, program_id)? };

    pinocchio_log::log!("UnclaimedWithdrawn");

    Ok(())
}

use pinocchio::{error::ProgramError, AccountView, Address, ProgramResult};

use crate::{errors::MigrationError, state::MigrationConfig};

use super::{assert_config_pda, parse_bool_exact};

// Accounts:
// 0. [signer] admin
// 1. [writable] config PDA
// Data: paused(u8)
pub fn process(program_id: &Address, accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let [admin, config_account, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    if !admin.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let paused = parse_bool_exact(data)?;

    assert_config_pda(config_account, program_id)?;

    let config = unsafe { MigrationConfig::from_account_info_mut(config_account, program_id)? };
    if config.admin != *admin.address().as_array() {
        return Err(MigrationError::Unauthorized.into());
    }
    config.paused = if paused { 1 } else { 0 };

    pinocchio_log::log!("PauseUpdated");

    Ok(())
}

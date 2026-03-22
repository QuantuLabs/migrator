pub mod initialize_config;
pub mod migrate_exact;
pub mod set_pause;

use pinocchio::{
    cpi::Signer,
    error::ProgramError,
    sysvars::{clock::Clock, Sysvar},
    AccountView, Address,
};
use pinocchio_system::instructions::{Assign, CreateAccount, Transfer};

use crate::{
    errors::MigrationError, MIGRATION_CONFIG_SEED, UPGRADEABLE_LOADER_PROGRAM_ID,
    VAULT_AUTHORITY_SEED,
};

const UPGRADEABLE_LOADER_PROGRAMDATA_DISCRIMINATOR: u32 = 3;
const UPGRADEABLE_LOADER_PROGRAMDATA_AUTHORITY_OFFSET: usize = 13;
const UPGRADEABLE_LOADER_PROGRAMDATA_METADATA_LEN: usize = 45;

#[inline(always)]
pub fn now_ts() -> Result<i64, ProgramError> {
    Ok(Clock::get()?.unix_timestamp)
}

#[inline(always)]
pub fn assert_config_pda(config: &AccountView, program_id: &Address) -> Result<u8, ProgramError> {
    let (expected, bump) = Address::find_program_address(&[MIGRATION_CONFIG_SEED], program_id);
    if config.address() != &expected {
        return Err(MigrationError::InvalidPdaSeeds.into());
    }
    Ok(bump)
}

#[inline(always)]
pub fn assert_vault_authority_pda(
    vault_authority: &AccountView,
    program_id: &Address,
) -> Result<u8, ProgramError> {
    let (expected, bump) = Address::find_program_address(&[VAULT_AUTHORITY_SEED], program_id);
    if vault_authority.address() != &expected {
        return Err(MigrationError::InvalidVaultAuthority.into());
    }
    Ok(bump)
}

#[inline(always)]
pub fn parse_bool_exact(data: &[u8]) -> Result<bool, ProgramError> {
    if data.len() != 1 {
        return Err(ProgramError::InvalidInstructionData);
    }
    match data[0] {
        0 => Ok(false),
        1 => Ok(true),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

#[inline(always)]
pub fn parse_u64_exact(data: &[u8]) -> Result<u64, ProgramError> {
    if data.len() != 8 {
        return Err(ProgramError::InvalidInstructionData);
    }
    Ok(u64::from_le_bytes(data.try_into().unwrap()))
}

#[inline(always)]
pub fn parse_window_exact(data: &[u8]) -> Result<(i64, i64), ProgramError> {
    if data.len() != 16 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let start_ts = i64::from_le_bytes(data[0..8].try_into().unwrap());
    let end_ts = i64::from_le_bytes(data[8..16].try_into().unwrap());
    Ok((start_ts, end_ts))
}

#[inline(always)]
pub fn assert_program_upgrade_authority(
    authority_signer: &AccountView,
    program_data: &AccountView,
    program_id: &Address,
) -> Result<(), ProgramError> {
    if !authority_signer.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let loader = Address::new_from_array(UPGRADEABLE_LOADER_PROGRAM_ID);
    let (expected_program_data, _) = Address::find_program_address(&[program_id.as_ref()], &loader);
    if program_data.address() != &expected_program_data {
        return Err(MigrationError::InvalidPdaSeeds.into());
    }
    if unsafe { program_data.owner() } != &loader {
        return Err(ProgramError::IllegalOwner);
    }
    if program_data.data_len() < UPGRADEABLE_LOADER_PROGRAMDATA_METADATA_LEN {
        return Err(ProgramError::InvalidAccountData);
    }

    let data = unsafe { program_data.borrow_unchecked() };
    let state_discriminator = u32::from_le_bytes(data[0..4].try_into().unwrap());
    if state_discriminator != UPGRADEABLE_LOADER_PROGRAMDATA_DISCRIMINATOR {
        return Err(ProgramError::InvalidAccountData);
    }

    let authority_option = data[12];
    if authority_option != 1 {
        return Err(MigrationError::Unauthorized.into());
    }

    let authority_bytes: &[u8; 32] = data[UPGRADEABLE_LOADER_PROGRAMDATA_AUTHORITY_OFFSET
        ..UPGRADEABLE_LOADER_PROGRAMDATA_AUTHORITY_OFFSET + 32]
        .try_into()
        .unwrap();
    if authority_bytes != authority_signer.address().as_array() {
        return Err(MigrationError::Unauthorized.into());
    }

    Ok(())
}

#[inline(always)]
pub fn create_pda_account_idempotent(
    payer: &AccountView,
    pda_account: &AccountView,
    space: usize,
    owner: &Address,
    signer: Signer,
) -> Result<(), ProgramError> {
    let system_program = Address::new_from_array([0u8; 32]);
    if unsafe { pda_account.owner() } != &system_program {
        return Err(ProgramError::IllegalOwner);
    }

    let create =
        CreateAccount::with_minimum_balance(payer, pda_account, space as u64, owner, None)?;
    let required_lamports = create.lamports.saturating_sub(pda_account.lamports());
    if required_lamports > 0 {
        Transfer {
            from: payer,
            to: pda_account,
            lamports: required_lamports,
        }
        .invoke_signed(core::slice::from_ref(&signer))?;
    }

    Assign {
        account: pda_account,
        owner,
    }
    .invoke_signed(core::slice::from_ref(&signer))?;

    unsafe { pda_account.resize_unchecked(space)? };
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{parse_bool_exact, parse_u64_exact, parse_window_exact};
    use pinocchio::error::ProgramError;

    #[test]
    fn parse_u64_exact_accepts_only_8_bytes() {
        assert_eq!(parse_u64_exact(&1u64.to_le_bytes()).unwrap(), 1);
        assert_eq!(
            parse_u64_exact(&[1, 0, 0, 0, 0, 0, 0]).unwrap_err(),
            ProgramError::InvalidInstructionData
        );
        assert_eq!(
            parse_u64_exact(&[1, 0, 0, 0, 0, 0, 0, 0, 0]).unwrap_err(),
            ProgramError::InvalidInstructionData
        );
    }

    #[test]
    fn parse_bool_exact_accepts_only_single_byte_0_or_1() {
        assert!(!parse_bool_exact(&[0]).unwrap());
        assert!(parse_bool_exact(&[1]).unwrap());
        assert_eq!(
            parse_bool_exact(&[2]).unwrap_err(),
            ProgramError::InvalidInstructionData
        );
        assert_eq!(
            parse_bool_exact(&[]).unwrap_err(),
            ProgramError::InvalidInstructionData
        );
    }

    #[test]
    fn parse_window_exact_accepts_only_16_bytes() {
        let mut bytes = [0u8; 16];
        bytes[0..8].copy_from_slice(&10i64.to_le_bytes());
        bytes[8..16].copy_from_slice(&20i64.to_le_bytes());
        assert_eq!(parse_window_exact(&bytes).unwrap(), (10, 20));
        assert_eq!(
            parse_window_exact(&bytes[..15]).unwrap_err(),
            ProgramError::InvalidInstructionData
        );
    }
}

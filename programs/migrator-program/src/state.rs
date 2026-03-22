#![allow(clippy::missing_safety_doc)]
#![allow(clippy::mut_from_ref)]
#![allow(clippy::needless_lifetimes)]

use core::mem::size_of;

use pinocchio::{error::ProgramError, AccountView, Address};

use crate::{errors::MigrationError, TOKEN_PROGRAM_ID};

#[repr(C)]
pub struct MigrationConfig {
    pub discriminator: [u8; 8],
    pub version: u8,
    pub bump: u8,
    pub vault_authority_bump: u8,
    pub paused: u8,
    pub admin: [u8; 32],
    pub old_qx_mint: [u8; 32],
    pub new_qx_mint: [u8; 32],
    pub token_program_id: [u8; 32],
    pub vault_authority: [u8; 32],
    pub vault_new_qx: [u8; 32],
    pub total_migrated: u64,
    pub start_ts: i64,
    pub end_ts: i64,
    pub reserved: [u8; 64],
}

impl MigrationConfig {
    pub const DISCRIMINATOR: [u8; 8] = *b"qxmigr01";
    pub const SIZE: usize = size_of::<Self>();

    #[inline(always)]
    pub unsafe fn from_account_info<'a>(
        account: &'a AccountView,
        program_id: &Address,
    ) -> Result<&'a Self, ProgramError> {
        if account.owner() != program_id {
            return Err(ProgramError::IllegalOwner);
        }
        if account.data_len() < Self::SIZE {
            return Err(ProgramError::InvalidAccountData);
        }

        let config = &*(account.borrow_unchecked().as_ptr() as *const Self);
        if config.discriminator != Self::DISCRIMINATOR {
            return Err(MigrationError::AccountNotInitialized.into());
        }
        Ok(config)
    }

    #[inline(always)]
    pub unsafe fn from_account_info_mut<'a>(
        account: &'a AccountView,
        program_id: &Address,
    ) -> Result<&'a mut Self, ProgramError> {
        if account.owner() != program_id {
            return Err(ProgramError::IllegalOwner);
        }
        if account.data_len() < Self::SIZE {
            return Err(ProgramError::InvalidAccountData);
        }

        let config = &mut *(account.borrow_unchecked_mut().as_mut_ptr() as *mut Self);
        if config.discriminator != Self::DISCRIMINATOR {
            return Err(MigrationError::AccountNotInitialized.into());
        }
        Ok(config)
    }

    #[inline(always)]
    pub unsafe fn init<'a>(account: &'a AccountView) -> Result<&'a mut Self, ProgramError> {
        if account.data_len() < Self::SIZE {
            return Err(ProgramError::InvalidAccountData);
        }

        let config = &mut *(account.borrow_unchecked_mut().as_mut_ptr() as *mut Self);
        if config.discriminator != [0u8; 8] {
            return Err(MigrationError::AlreadyInitialized.into());
        }
        *config = core::mem::zeroed();
        config.discriminator = Self::DISCRIMINATOR;
        Ok(config)
    }
}

#[inline(always)]
pub fn validate_token_program(token_program: &AccountView) -> Result<(), ProgramError> {
    if token_program.address().as_ref() != TOKEN_PROGRAM_ID.as_slice() {
        return Err(MigrationError::InvalidTokenProgram.into());
    }
    Ok(())
}

#[inline(always)]
pub fn validate_old_mint_account(
    mint: &AccountView,
    expected_mint: &[u8; 32],
) -> Result<(), ProgramError> {
    validate_strict_mint_account(mint, expected_mint, MigrationError::InvalidOldMint)
}

#[inline(always)]
pub fn validate_new_mint_account(
    mint: &AccountView,
    expected_mint: &[u8; 32],
) -> Result<(), ProgramError> {
    validate_strict_mint_account(mint, expected_mint, MigrationError::InvalidNewMint)
}

#[inline(always)]
fn validate_strict_mint_account(
    mint: &AccountView,
    expected_mint: &[u8; 32],
    err: MigrationError,
) -> Result<(), ProgramError> {
    let token_program = Address::new_from_array(TOKEN_PROGRAM_ID);
    if unsafe { mint.owner() } != &token_program {
        return Err(err.into());
    }
    if mint.address().as_ref() != expected_mint {
        return Err(err.into());
    }
    if mint.data_len() < 82 {
        return Err(ProgramError::InvalidAccountData);
    }

    let data = unsafe { mint.borrow_unchecked() };
    let mint_authority_option = u32::from_le_bytes(data[0..4].try_into().unwrap());
    if mint_authority_option != 0 {
        return Err(err.into());
    }
    if data[45] != 1 {
        return Err(err.into());
    }
    let freeze_option = u32::from_le_bytes(data[46..50].try_into().unwrap());
    if freeze_option != 0 {
        return Err(err.into());
    }

    Ok(())
}

#[inline(always)]
pub unsafe fn validate_token_account(
    token_account: &AccountView,
    expected_mint: &[u8; 32],
    expected_owner: &[u8; 32],
) -> Result<(), ProgramError> {
    let token_program = Address::new_from_array(TOKEN_PROGRAM_ID);
    if token_account.owner() != &token_program {
        return Err(MigrationError::InvalidTokenProgram.into());
    }
    if token_account.data_len() < 109 {
        return Err(ProgramError::InvalidAccountData);
    }

    let data = token_account.borrow_unchecked();
    let mint: &[u8; 32] = data[0..32].try_into().unwrap();
    let owner: &[u8; 32] = data[32..64].try_into().unwrap();
    let state = data[108];

    if mint != expected_mint {
        return Err(MigrationError::InvalidConfig.into());
    }
    if owner != expected_owner {
        return Err(MigrationError::Unauthorized.into());
    }
    if state != 1 {
        return Err(MigrationError::AccountNotInitialized.into());
    }

    Ok(())
}

#[inline(always)]
pub unsafe fn validate_custody_token_account(
    token_account: &AccountView,
    expected_mint: &[u8; 32],
    expected_owner: &[u8; 32],
) -> Result<(), ProgramError> {
    validate_token_account(token_account, expected_mint, expected_owner)?;
    if token_account.data_len() < 165 {
        return Err(ProgramError::InvalidAccountData);
    }

    let data = token_account.borrow_unchecked();
    let delegate_option = u32::from_le_bytes(data[72..76].try_into().unwrap());
    let delegated_amount = u64::from_le_bytes(data[121..129].try_into().unwrap());
    let close_authority_option = u32::from_le_bytes(data[129..133].try_into().unwrap());
    if delegate_option != 0 || delegated_amount != 0 || close_authority_option != 0 {
        return Err(MigrationError::InvalidTokenAccountControls.into());
    }

    Ok(())
}

#[inline(always)]
pub unsafe fn token_amount(token_account: &AccountView) -> Result<u64, ProgramError> {
    if token_account.data_len() < 72 {
        return Err(ProgramError::InvalidAccountData);
    }
    let data = token_account.borrow_unchecked();
    Ok(u64::from_le_bytes(data[64..72].try_into().unwrap()))
}

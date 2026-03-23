#![allow(clippy::missing_safety_doc)]
#![allow(clippy::needless_lifetimes)]

use core::{
    mem::size_of,
    ptr::{read_unaligned, write_unaligned},
};

use pinocchio::{error::ProgramError, AccountView, Address};

use crate::{errors::MigrationError, ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID};

const MINT_LEN: usize = 82;
const TOKEN_ACCOUNT_STATE_OFFSET: usize = 108;
const TOKEN_ACCOUNT_LEN_FULL: usize = 165;
const NATIVE_MINT_ID: [u8; 32] = [
    6, 155, 136, 87, 254, 171, 129, 132, 251, 104, 127, 99, 70, 24, 192, 53, 218, 196, 57, 220, 26,
    235, 59, 85, 152, 160, 240, 0, 0, 0, 0, 1,
];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(C)]
pub struct MigrationConfig {
    pub discriminator: [u8; 8],
    pub version: u8,
    pub bump: u8,
    pub vault_authority_bump: u8,
    pub paused: u8,
    pub admin: [u8; 32],
    pub source_mint: [u8; 32],
    pub destination_mint: [u8; 32],
    pub token_program_id: [u8; 32],
    pub vault_authority: [u8; 32],
    pub reserve_vault: [u8; 32],
    pub total_migrated: u64,
    pub start_ts: i64,
    pub end_ts: i64,
    pub reserved: [u8; 64],
}

impl MigrationConfig {
    pub const DISCRIMINATOR: [u8; 8] = *b"migrtr01";
    pub const VERSION: u8 = 2;
    pub const SIZE: usize = size_of::<Self>();
    const MIGRATION_CAP_OFFSET: usize = 0;
    const REFUND_RECIPIENT_OFFSET: usize = 8;
    const UNCLAIMED_WITHDRAWN_OFFSET: usize = 40;

    #[inline(always)]
    fn assert_storage_account(
        account: &AccountView,
        program_id: &Address,
    ) -> Result<(), ProgramError> {
        if unsafe { account.owner() } != program_id {
            return Err(ProgramError::IllegalOwner);
        }
        if account.data_len() != Self::SIZE {
            return Err(ProgramError::InvalidAccountData);
        }
        Ok(())
    }

    #[inline(always)]
    pub unsafe fn from_account_info(
        account: &AccountView,
        program_id: &Address,
    ) -> Result<Self, ProgramError> {
        Self::assert_storage_account(account, program_id)?;

        let data = account.borrow_unchecked();
        let config = read_unaligned(data.as_ptr() as *const Self);
        if config.discriminator != Self::DISCRIMINATOR {
            return Err(MigrationError::AccountNotInitialized.into());
        }
        if config.version != Self::VERSION {
            return Err(MigrationError::InvalidConfig.into());
        }
        Ok(config)
    }

    #[inline(always)]
    pub unsafe fn store(
        &self,
        account: &AccountView,
        program_id: &Address,
    ) -> Result<(), ProgramError> {
        Self::assert_storage_account(account, program_id)?;

        let data = account.borrow_unchecked_mut();
        write_unaligned(data.as_mut_ptr() as *mut Self, *self);
        Ok(())
    }

    #[inline(always)]
    pub unsafe fn init(account: &AccountView) -> Result<Self, ProgramError> {
        if account.data_len() != Self::SIZE {
            return Err(ProgramError::InvalidAccountData);
        }

        let data = account.borrow_unchecked();
        let discriminator: &[u8; 8] = data[0..8].try_into().unwrap();
        if *discriminator != [0u8; 8] {
            return Err(MigrationError::AlreadyInitialized.into());
        }

        let mut config: Self = core::mem::zeroed();
        config.discriminator = Self::DISCRIMINATOR;
        config.version = Self::VERSION;
        Ok(config)
    }

    #[inline(always)]
    pub fn migration_cap(&self) -> u64 {
        u64::from_le_bytes(
            self.reserved[Self::MIGRATION_CAP_OFFSET..Self::MIGRATION_CAP_OFFSET + 8]
                .try_into()
                .unwrap(),
        )
    }

    #[inline(always)]
    pub fn set_migration_cap(&mut self, migration_cap: u64) {
        self.reserved[Self::MIGRATION_CAP_OFFSET..Self::MIGRATION_CAP_OFFSET + 8]
            .copy_from_slice(&migration_cap.to_le_bytes());
    }

    #[inline(always)]
    pub fn refund_recipient(&self) -> [u8; 32] {
        self.reserved[Self::REFUND_RECIPIENT_OFFSET..Self::REFUND_RECIPIENT_OFFSET + 32]
            .try_into()
            .unwrap()
    }

    #[inline(always)]
    pub fn set_refund_recipient(&mut self, refund_recipient: &[u8; 32]) {
        self.reserved[Self::REFUND_RECIPIENT_OFFSET..Self::REFUND_RECIPIENT_OFFSET + 32]
            .copy_from_slice(refund_recipient);
    }

    #[inline(always)]
    pub fn unclaimed_withdrawn(&self) -> bool {
        self.reserved[Self::UNCLAIMED_WITHDRAWN_OFFSET] != 0
    }

    #[inline(always)]
    pub fn set_unclaimed_withdrawn(&mut self, withdrawn: bool) {
        self.reserved[Self::UNCLAIMED_WITHDRAWN_OFFSET] = withdrawn as u8;
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
) -> Result<u8, ProgramError> {
    if expected_mint == &NATIVE_MINT_ID {
        return Err(MigrationError::InvalidOldMint.into());
    }
    validate_strict_mint_account(mint, expected_mint, MigrationError::InvalidOldMint)
}

#[inline(always)]
pub fn validate_new_mint_account(
    mint: &AccountView,
    expected_mint: &[u8; 32],
) -> Result<u8, ProgramError> {
    if expected_mint == &NATIVE_MINT_ID {
        return Err(MigrationError::InvalidNewMint.into());
    }
    validate_strict_mint_account(mint, expected_mint, MigrationError::InvalidNewMint)
}

#[inline(always)]
fn validate_strict_mint_account(
    mint: &AccountView,
    expected_mint: &[u8; 32],
    err: MigrationError,
) -> Result<u8, ProgramError> {
    let token_program = Address::new_from_array(TOKEN_PROGRAM_ID);
    if unsafe { mint.owner() } != &token_program {
        return Err(err.into());
    }
    if mint.address().as_ref() != expected_mint {
        return Err(err.into());
    }

    match validate_strict_mint_bytes(unsafe { mint.borrow_unchecked() }) {
        Ok(decimals) => Ok(decimals),
        Err(ProgramError::InvalidAccountData) => Err(ProgramError::InvalidAccountData),
        Err(_) => Err(err.into()),
    }
}

#[inline(always)]
pub fn validate_strict_mint_bytes(data: &[u8]) -> Result<u8, ProgramError> {
    if data.len() != MINT_LEN {
        return Err(ProgramError::InvalidAccountData);
    }

    let mint_authority_option = u32::from_le_bytes(data[0..4].try_into().unwrap());
    if mint_authority_option != 0 {
        return Err(MigrationError::InvalidConfig.into());
    }
    if data[45] != 1 {
        return Err(MigrationError::InvalidConfig.into());
    }
    let freeze_option = u32::from_le_bytes(data[46..50].try_into().unwrap());
    if freeze_option != 0 {
        return Err(MigrationError::InvalidConfig.into());
    }

    Ok(data[44])
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

    validate_token_account_bytes(
        token_account.borrow_unchecked(),
        expected_mint,
        expected_owner,
    )
}

#[inline(always)]
pub fn validate_token_account_bytes(
    data: &[u8],
    expected_mint: &[u8; 32],
    expected_owner: &[u8; 32],
) -> Result<(), ProgramError> {
    if data.len() != TOKEN_ACCOUNT_LEN_FULL {
        return Err(ProgramError::InvalidAccountData);
    }

    let mint: &[u8; 32] = data[0..32].try_into().unwrap();
    let owner: &[u8; 32] = data[32..64].try_into().unwrap();
    let state = data[TOKEN_ACCOUNT_STATE_OFFSET];
    let is_native_option = u32::from_le_bytes(data[109..113].try_into().unwrap());

    if mint != expected_mint {
        return Err(MigrationError::InvalidConfig.into());
    }
    if owner != expected_owner {
        return Err(MigrationError::Unauthorized.into());
    }
    if state != 1 {
        return Err(MigrationError::AccountNotInitialized.into());
    }
    if is_native_option != 0 {
        return Err(MigrationError::InvalidTokenAccountControls.into());
    }

    Ok(())
}

#[inline(always)]
pub unsafe fn validate_custody_token_account(
    token_account: &AccountView,
    expected_mint: &[u8; 32],
    expected_owner: &[u8; 32],
) -> Result<(), ProgramError> {
    let token_program = Address::new_from_array(TOKEN_PROGRAM_ID);
    if token_account.owner() != &token_program {
        return Err(MigrationError::InvalidTokenProgram.into());
    }

    validate_custody_token_account_bytes(
        token_account.borrow_unchecked(),
        expected_mint,
        expected_owner,
    )
}

#[inline(always)]
pub fn validate_custody_token_account_bytes(
    data: &[u8],
    expected_mint: &[u8; 32],
    expected_owner: &[u8; 32],
) -> Result<(), ProgramError> {
    validate_token_account_bytes(data, expected_mint, expected_owner)?;

    let delegate_option = u32::from_le_bytes(data[72..76].try_into().unwrap());
    let delegated_amount = u64::from_le_bytes(data[121..129].try_into().unwrap());
    let close_authority_option = u32::from_le_bytes(data[129..133].try_into().unwrap());
    if delegate_option != 0 || delegated_amount != 0 || close_authority_option != 0 {
        return Err(MigrationError::InvalidTokenAccountControls.into());
    }

    Ok(())
}

#[inline(always)]
pub fn associated_token_address(owner: &Address, mint: &Address) -> Address {
    let associated_token_program = Address::new_from_array(ASSOCIATED_TOKEN_PROGRAM_ID);
    Address::find_program_address(
        &[owner.as_ref(), TOKEN_PROGRAM_ID.as_slice(), mint.as_ref()],
        &associated_token_program,
    )
    .0
}

#[inline(always)]
pub unsafe fn validate_destination_token_account(
    token_account: &AccountView,
    expected_owner: &Address,
    expected_mint: &[u8; 32],
) -> Result<(), ProgramError> {
    validate_custody_token_account(token_account, expected_mint, expected_owner.as_array())?;

    let expected_ata =
        associated_token_address(expected_owner, &Address::new_from_array(*expected_mint));
    if token_account.address() != &expected_ata {
        return Err(MigrationError::InvalidDestinationTokenAccount.into());
    }

    Ok(())
}

#[inline(always)]
pub unsafe fn token_amount(token_account: &AccountView) -> Result<u64, ProgramError> {
    token_amount_bytes(token_account.borrow_unchecked())
}

#[inline(always)]
pub fn token_amount_bytes(data: &[u8]) -> Result<u64, ProgramError> {
    if data.len() < 72 {
        return Err(ProgramError::InvalidAccountData);
    }
    Ok(u64::from_le_bytes(data[64..72].try_into().unwrap()))
}

#[inline(always)]
pub fn validate_migration_window(start_ts: i64, end_ts: i64) -> Result<(), ProgramError> {
    if start_ts > end_ts {
        return Err(MigrationError::InvalidTimestamp.into());
    }
    Ok(())
}

#[inline(always)]
pub fn checked_total_migrated_after(current: u64, amount: u64) -> Result<u64, ProgramError> {
    current
        .checked_add(amount)
        .ok_or(MigrationError::MathOverflow.into())
}

#[inline(always)]
pub fn encode_migration_config_bytes(config: &MigrationConfig) -> [u8; MigrationConfig::SIZE] {
    let mut bytes = [0u8; MigrationConfig::SIZE];
    unsafe {
        write_unaligned(bytes.as_mut_ptr() as *mut MigrationConfig, *config);
    }
    bytes
}

#[inline(always)]
pub fn validate_migration_cap(
    current: u64,
    amount: u64,
    migration_cap: u64,
) -> Result<(), ProgramError> {
    if current > migration_cap {
        return Err(MigrationError::MigrationCapExceeded.into());
    }

    let remaining = migration_cap
        .checked_sub(current)
        .ok_or(MigrationError::MigrationCapExceeded)?;
    if amount > remaining {
        return Err(MigrationError::MigrationCapExceeded.into());
    }

    Ok(())
}

#[cfg(kani)]
mod verification {
    use core::ptr::read_unaligned;

    use super::{
        checked_total_migrated_after, encode_migration_config_bytes,
        validate_custody_token_account_bytes, validate_migration_cap, validate_migration_window,
        validate_strict_mint_bytes, validate_token_account_bytes, MigrationConfig,
    };
    use crate::errors::MigrationError;
    use pinocchio::error::ProgramError;

    fn any_migration_config() -> MigrationConfig {
        MigrationConfig {
            discriminator: kani::any(),
            version: kani::any(),
            bump: kani::any(),
            vault_authority_bump: kani::any(),
            paused: kani::any(),
            admin: kani::any(),
            source_mint: kani::any(),
            destination_mint: kani::any(),
            token_program_id: kani::any(),
            vault_authority: kani::any(),
            reserve_vault: kani::any(),
            total_migrated: kani::any(),
            start_ts: kani::any(),
            end_ts: kani::any(),
            reserved: kani::any(),
        }
    }

    #[kani::proof]
    fn migration_config_layout_is_stable() {
        assert_eq!(MigrationConfig::SIZE, 296);
        assert_eq!(MigrationConfig::DISCRIMINATOR, *b"migrtr01");
        assert_eq!(MigrationConfig::VERSION, 2);
        assert_eq!(core::mem::offset_of!(MigrationConfig, admin), 12);
        assert_eq!(core::mem::offset_of!(MigrationConfig, source_mint), 44);
        assert_eq!(core::mem::offset_of!(MigrationConfig, destination_mint), 76);
        assert_eq!(
            core::mem::offset_of!(MigrationConfig, token_program_id),
            108
        );
        assert_eq!(core::mem::offset_of!(MigrationConfig, vault_authority), 140);
        assert_eq!(core::mem::offset_of!(MigrationConfig, reserve_vault), 172);
        assert_eq!(core::mem::offset_of!(MigrationConfig, total_migrated), 208);
        assert_eq!(core::mem::offset_of!(MigrationConfig, start_ts), 216);
        assert_eq!(core::mem::offset_of!(MigrationConfig, end_ts), 224);
        assert_eq!(core::mem::offset_of!(MigrationConfig, reserved), 232);
    }

    #[kani::proof]
    fn migration_config_refund_recipient_roundtrips_through_reserved_bytes() {
        let refund_recipient: [u8; 32] = kani::any();
        let mut config = any_migration_config();
        config.set_refund_recipient(&refund_recipient);
        assert_eq!(config.refund_recipient(), refund_recipient);
    }

    #[kani::proof]
    fn migration_config_unclaimed_withdrawn_flag_roundtrips() {
        let withdrawn: bool = kani::any();
        let mut config = any_migration_config();
        config.set_unclaimed_withdrawn(withdrawn);
        assert_eq!(config.unclaimed_withdrawn(), withdrawn);
    }

    #[kani::proof]
    fn strict_mint_bytes_accepts_initialized_mint_without_authorities() {
        let decimals: u8 = kani::any();
        let mut data = [0u8; 82];
        data[44] = decimals;
        data[45] = 1;

        assert_eq!(validate_strict_mint_bytes(&data), Ok(decimals));
    }

    #[kani::proof]
    fn strict_mint_bytes_rejects_nonzero_authority_flags() {
        let mut with_mint_authority = [0u8; 82];
        with_mint_authority[0..4].copy_from_slice(&1u32.to_le_bytes());
        with_mint_authority[45] = 1;
        assert!(validate_strict_mint_bytes(&with_mint_authority).is_err());

        let mut with_freeze_authority = [0u8; 82];
        with_freeze_authority[45] = 1;
        with_freeze_authority[46..50].copy_from_slice(&1u32.to_le_bytes());
        assert!(validate_strict_mint_bytes(&with_freeze_authority).is_err());
    }

    #[kani::proof]
    fn token_account_bytes_rejects_wrong_owner_or_uninitialized_state() {
        let expected_mint: [u8; 32] = kani::any();
        let expected_owner: [u8; 32] = kani::any();

        let mut wrong_owner = [0u8; 165];
        wrong_owner[0..32].copy_from_slice(&expected_mint);
        wrong_owner[32..64].copy_from_slice(&expected_owner);
        wrong_owner[32] ^= 1;
        wrong_owner[108] = 1;
        assert_eq!(
            validate_token_account_bytes(&wrong_owner, &expected_mint, &expected_owner),
            Err(MigrationError::Unauthorized.into())
        );

        let mut uninitialized = [0u8; 165];
        uninitialized[0..32].copy_from_slice(&expected_mint);
        uninitialized[32..64].copy_from_slice(&expected_owner);
        uninitialized[108] = 0;
        assert_eq!(
            validate_token_account_bytes(&uninitialized, &expected_mint, &expected_owner),
            Err(MigrationError::AccountNotInitialized.into())
        );
    }

    #[kani::proof]
    fn custody_token_bytes_rejects_delegate_and_close_controls() {
        let expected_mint: [u8; 32] = kani::any();
        let expected_owner: [u8; 32] = kani::any();

        let mut delegated = [0u8; 165];
        delegated[0..32].copy_from_slice(&expected_mint);
        delegated[32..64].copy_from_slice(&expected_owner);
        delegated[108] = 1;
        delegated[72..76].copy_from_slice(&1u32.to_le_bytes());
        assert_eq!(
            validate_custody_token_account_bytes(&delegated, &expected_mint, &expected_owner),
            Err(MigrationError::InvalidTokenAccountControls.into())
        );

        let mut close_authority = [0u8; 165];
        close_authority[0..32].copy_from_slice(&expected_mint);
        close_authority[32..64].copy_from_slice(&expected_owner);
        close_authority[108] = 1;
        close_authority[129..133].copy_from_slice(&1u32.to_le_bytes());
        assert_eq!(
            validate_custody_token_account_bytes(&close_authority, &expected_mint, &expected_owner,),
            Err(MigrationError::InvalidTokenAccountControls.into())
        );
    }

    #[kani::proof]
    fn custody_token_bytes_accepts_clean_account() {
        let expected_mint: [u8; 32] = kani::any();
        let expected_owner: [u8; 32] = kani::any();
        let mut data = [0u8; 165];
        data[0..32].copy_from_slice(&expected_mint);
        data[32..64].copy_from_slice(&expected_owner);
        data[108] = 1;

        assert_eq!(
            validate_custody_token_account_bytes(&data, &expected_mint, &expected_owner),
            Ok(())
        );
    }

    #[kani::proof]
    fn strict_mint_short_buffer_is_rejected() {
        let data: [u8; 81] = kani::any();
        assert_eq!(
            validate_strict_mint_bytes(&data),
            Err(ProgramError::InvalidAccountData)
        );
    }

    #[kani::proof]
    fn checked_total_migrated_after_matches_checked_add() {
        let current: u64 = kani::any();
        let amount: u64 = kani::any();
        let expected = current.checked_add(amount);

        match expected {
            Some(sum) => assert_eq!(checked_total_migrated_after(current, amount), Ok(sum)),
            None => assert_eq!(
                checked_total_migrated_after(current, amount),
                Err(MigrationError::MathOverflow.into())
            ),
        }
    }

    #[kani::proof]
    fn validate_migration_window_rejects_only_inverted_bounds() {
        let start_ts: i64 = kani::any();
        let end_ts: i64 = kani::any();
        let result = validate_migration_window(start_ts, end_ts);

        if start_ts > end_ts {
            assert_eq!(result, Err(MigrationError::InvalidTimestamp.into()));
        } else {
            assert_eq!(result, Ok(()));
        }
    }

    #[kani::proof]
    fn migration_config_roundtrip_via_unaligned_io_preserves_value() {
        let config = any_migration_config();
        let bytes = encode_migration_config_bytes(&config);
        let decoded = unsafe { read_unaligned(bytes.as_ptr() as *const MigrationConfig) };
        assert_eq!(decoded, config);
    }

    #[kani::proof]
    fn migration_cap_helpers_roundtrip_and_reject_over_cap() {
        let migration_cap: u64 = kani::any();
        let current: u64 = kani::any();
        let amount: u64 = kani::any();

        let mut config = any_migration_config();
        config.set_migration_cap(migration_cap);
        assert_eq!(config.migration_cap(), migration_cap);

        let result = validate_migration_cap(current, amount, migration_cap);
        if current > migration_cap {
            assert_eq!(result, Err(MigrationError::MigrationCapExceeded.into()));
        } else if amount > migration_cap - current {
            assert_eq!(result, Err(MigrationError::MigrationCapExceeded.into()));
        } else {
            assert_eq!(result, Ok(()));
        }
    }
}

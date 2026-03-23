use pinocchio::error::ProgramError;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum MigrationError {
    Unauthorized = 0,
    AlreadyInitialized = 1,
    InvalidTokenProgram = 2,
    InvalidOldMint = 3,
    InvalidNewMint = 4,
    InvalidVault = 5,
    InvalidVaultAuthority = 6,
    ZeroAmount = 7,
    MathOverflow = 8,
    InvalidTimestamp = 9,
    ProtocolPaused = 10,
    InvalidPdaSeeds = 11,
    AccountNotInitialized = 12,
    InvalidConfig = 13,
    InsufficientVaultLiquidity = 14,
    InvalidTokenAccountControls = 15,
    MigrationClosed = 16,
    MigrationNotStarted = 17,
    MigrationCapExceeded = 18,
    InvalidDestinationTokenAccount = 19,
    MigrationStillOpen = 20,
    UnclaimedAlreadyWithdrawn = 21,
}

impl From<MigrationError> for ProgramError {
    fn from(value: MigrationError) -> Self {
        ProgramError::Custom(value as u32)
    }
}

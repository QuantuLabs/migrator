#![cfg_attr(not(test), no_std)]
#![allow(unexpected_cfgs)]

pub mod errors;
pub mod instructions;
pub mod state;

use pinocchio::{error::ProgramError, AccountView, Address, ProgramResult};

// TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA
pub const TOKEN_PROGRAM_ID: [u8; 32] = [
    0x06, 0xDD, 0xF6, 0xE1, 0xD7, 0x65, 0xA1, 0x93, 0xD9, 0xCB, 0xE1, 0x46, 0xCE, 0xEB, 0x79, 0xAC,
    0x1C, 0xB4, 0x85, 0xED, 0x5F, 0x5B, 0x37, 0x91, 0x3A, 0x8C, 0xF5, 0x85, 0x7E, 0xFF, 0x00, 0xA9,
];

// BPFLoaderUpgradeab1e11111111111111111111111
pub const UPGRADEABLE_LOADER_PROGRAM_ID: [u8; 32] = [
    0x02, 0xA8, 0xF6, 0x91, 0x4E, 0x88, 0xA1, 0xB0, 0xE2, 0x10, 0x15, 0x3E, 0xF7, 0x63, 0xAE, 0x2B,
    0x00, 0xC2, 0xB9, 0x3D, 0x16, 0xC1, 0x24, 0xD2, 0xC0, 0x53, 0x7A, 0x10, 0x04, 0x80, 0x00, 0x00,
];

pub const MIGRATION_CONFIG_SEED: &[u8] = b"migration-config";
pub const VAULT_AUTHORITY_SEED: &[u8] = b"vault-authority";

#[cfg(not(feature = "no-entrypoint"))]
pinocchio::program_entrypoint!(process_instruction);
#[cfg(not(feature = "no-entrypoint"))]
pinocchio::default_allocator!();
pinocchio::nostd_panic_handler!();

pub fn process_instruction(
    program_id: &Address,
    accounts: &[AccountView],
    data: &[u8],
) -> ProgramResult {
    if data.is_empty() {
        return Err(ProgramError::InvalidInstructionData);
    }

    match data[0] {
        0 => instructions::initialize_config::process(program_id, accounts, &data[1..]),
        1 => instructions::set_pause::process(program_id, accounts, &data[1..]),
        2 => instructions::migrate_exact::process(program_id, accounts, &data[1..]),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

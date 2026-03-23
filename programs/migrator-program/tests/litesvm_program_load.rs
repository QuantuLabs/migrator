use std::{env, path::PathBuf};

use litesvm::LiteSVM;
use solana_account::Account;
use solana_address::Address;
use solana_instruction::{error::InstructionError, AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_message::{Message, VersionedMessage};
use solana_program as _;
use solana_signer::Signer;
use solana_transaction::versioned::VersionedTransaction;
use solana_transaction_error::TransactionError;

fn resolve_program_path() -> Option<PathBuf> {
    if let Ok(path) = env::var("MIGRATOR_PROGRAM_SBF_PATH") {
        let p = PathBuf::from(path);
        if p.exists() {
            return Some(p);
        }
        eprintln!(
            "[litesvm_program_load] MIGRATOR_PROGRAM_SBF_PATH set but file missing: {}",
            p.display()
        );
    }

    let fallback = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../target/deploy/migrator_program.so")
        .canonicalize()
        .unwrap_or_else(|_| {
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../../target/deploy/migrator_program.so")
        });

    if fallback.exists() {
        Some(fallback)
    } else {
        None
    }
}

fn setup_svm() -> Option<(LiteSVM, Address, Keypair)> {
    let require_artifact = env::var_os("MIGRATOR_REQUIRE_ARTIFACT").is_some();
    let Some(program_path) = resolve_program_path() else {
        if require_artifact {
            panic!(
                "[litesvm_program_load] required SBF artifact missing. Set MIGRATOR_PROGRAM_SBF_PATH or build target/deploy/migrator_program.so"
            );
        }
        eprintln!(
            "[litesvm_program_load] skip: no program artifact found. Set MIGRATOR_PROGRAM_SBF_PATH or build target/deploy/migrator_program.so"
        );
        return None;
    };

    let mut svm = LiteSVM::new();
    let program_id = Address::new_unique();

    svm.add_program_from_file(program_id, program_path.to_string_lossy().as_ref())
        .expect("program should load from .so when file exists");

    let payer = Keypair::new();
    svm.airdrop(&payer.pubkey(), 1_000_000_000)
        .expect("airdrop should succeed");

    Some((svm, program_id, payer))
}

fn set_placeholder_system_account(svm: &mut LiteSVM, address: Address) {
    svm.set_account(
        address,
        Account {
            lamports: 1_000_000,
            data: vec![],
            owner: Address::default(),
            executable: false,
            rent_epoch: 0,
        },
    )
    .expect("placeholder account should be created");
}

fn send_ix_result(
    svm: &mut LiteSVM,
    payer: &Keypair,
    extra_signers: &[&Keypair],
    ix: Instruction,
) -> TransactionError {
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&payer.pubkey()), &blockhash);
    let mut signers = Vec::with_capacity(1 + extra_signers.len());
    signers.push(payer);
    signers.extend_from_slice(extra_signers);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &signers)
        .expect("signed tx should be created");

    let sim = svm.simulate_transaction(tx.clone());
    assert!(
        sim.is_err(),
        "simulate should fail because instruction is invalid"
    );

    let send = svm
        .send_transaction(tx)
        .expect_err("send should fail because instruction is invalid");
    send.err
}

fn assert_invalid_ix_error(data: Vec<u8>, expected: TransactionError) {
    let Some((mut svm, program_id, payer)) = setup_svm() else {
        return;
    };

    let ix = Instruction {
        program_id,
        accounts: vec![],
        data,
    };

    let err = send_ix_result(&mut svm, &payer, &[], ix);
    assert_eq!(err, expected);
}

#[test]
#[allow(deprecated)]
fn load_program_and_reject_invalid_instruction_call_with_exact_error() {
    let mut data = vec![2u8];
    data.extend_from_slice(&1u64.to_le_bytes());
    assert_invalid_ix_error(
        data,
        TransactionError::InstructionError(0, InstructionError::NotEnoughAccountKeys),
    );
}

#[test]
fn load_program_and_reject_empty_instruction_data() {
    assert_invalid_ix_error(
        vec![],
        TransactionError::InstructionError(0, InstructionError::InvalidInstructionData),
    );
}

#[test]
fn load_program_and_reject_unknown_discriminator() {
    assert_invalid_ix_error(
        vec![255u8],
        TransactionError::InstructionError(0, InstructionError::InvalidInstructionData),
    );
}

#[test]
fn load_program_and_reject_migrate_with_short_amount_payload() {
    assert_invalid_ix_error(
        vec![2u8, 1, 0, 0, 0, 0, 0, 0],
        TransactionError::InstructionError(0, InstructionError::InvalidInstructionData),
    );
}

#[test]
fn load_program_and_reject_migrate_with_trailing_amount_payload() {
    let mut data = vec![2u8];
    data.extend_from_slice(&1u64.to_le_bytes());
    data.push(0u8);
    assert_invalid_ix_error(
        data,
        TransactionError::InstructionError(0, InstructionError::InvalidInstructionData),
    );
}

#[test]
fn load_program_and_reject_set_pause_with_invalid_bool_payload() {
    let Some((mut svm, program_id, payer)) = setup_svm() else {
        return;
    };

    let config = Address::new_unique();
    set_placeholder_system_account(&mut svm, config);

    let ix = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new_readonly(payer.pubkey(), true),
            AccountMeta::new(config, false),
        ],
        data: vec![1u8, 2u8],
    };

    let err = send_ix_result(&mut svm, &payer, &[], ix);
    assert_eq!(
        err,
        TransactionError::InstructionError(0, InstructionError::InvalidInstructionData)
    );
}

#[test]
fn load_program_and_reject_set_pause_with_trailing_bool_payload() {
    let Some((mut svm, program_id, payer)) = setup_svm() else {
        return;
    };

    let config = Address::new_unique();
    set_placeholder_system_account(&mut svm, config);

    let ix = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new_readonly(payer.pubkey(), true),
            AccountMeta::new(config, false),
        ],
        data: vec![1u8, 1u8, 0u8],
    };

    let err = send_ix_result(&mut svm, &payer, &[], ix);
    assert_eq!(
        err,
        TransactionError::InstructionError(0, InstructionError::InvalidInstructionData)
    );
}

#[test]
fn load_program_and_reject_initialize_with_short_window_payload() {
    let Some((mut svm, program_id, payer)) = setup_svm() else {
        return;
    };

    let ops_admin = Keypair::new();
    set_placeholder_system_account(&mut svm, ops_admin.pubkey());

    let config = Address::new_unique();
    let vault_authority = Address::new_unique();
    let vault_new_qx = Address::new_unique();
    let old_qx_mint = Address::new_unique();
    let new_qx_mint = Address::new_unique();
    let token_program = Address::new_unique();
    let system_program = Address::new_unique();
    let program_data = Address::new_unique();

    for address in [
        config,
        vault_authority,
        vault_new_qx,
        old_qx_mint,
        new_qx_mint,
        token_program,
        system_program,
        program_data,
    ] {
        set_placeholder_system_account(&mut svm, address);
    }

    let ix = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new_readonly(payer.pubkey(), true),
            AccountMeta::new_readonly(ops_admin.pubkey(), true),
            AccountMeta::new(config, false),
            AccountMeta::new_readonly(vault_authority, false),
            AccountMeta::new(vault_new_qx, false),
            AccountMeta::new_readonly(old_qx_mint, false),
            AccountMeta::new_readonly(new_qx_mint, false),
            AccountMeta::new_readonly(token_program, false),
            AccountMeta::new_readonly(system_program, false),
            AccountMeta::new_readonly(program_data, false),
        ],
        data: vec![0u8, 1, 2, 3],
    };

    let err = send_ix_result(&mut svm, &payer, &[&ops_admin], ix);
    assert_eq!(
        err,
        TransactionError::InstructionError(0, InstructionError::InvalidInstructionData)
    );
}

#[test]
fn load_program_and_reject_initialize_with_trailing_window_payload() {
    let Some((mut svm, program_id, payer)) = setup_svm() else {
        return;
    };

    let ops_admin = Keypair::new();
    set_placeholder_system_account(&mut svm, ops_admin.pubkey());

    let config = Address::new_unique();
    let vault_authority = Address::new_unique();
    let vault_new_qx = Address::new_unique();
    let old_qx_mint = Address::new_unique();
    let new_qx_mint = Address::new_unique();
    let token_program = Address::new_unique();
    let system_program = Address::new_unique();
    let program_data = Address::new_unique();

    for address in [
        config,
        vault_authority,
        vault_new_qx,
        old_qx_mint,
        new_qx_mint,
        token_program,
        system_program,
        program_data,
    ] {
        set_placeholder_system_account(&mut svm, address);
    }

    let mut data = vec![0u8];
    data.extend_from_slice(&1i64.to_le_bytes());
    data.extend_from_slice(&2i64.to_le_bytes());
    data.extend_from_slice(&3u64.to_le_bytes());
    data.push(0u8);

    let ix = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new_readonly(payer.pubkey(), true),
            AccountMeta::new_readonly(ops_admin.pubkey(), true),
            AccountMeta::new(config, false),
            AccountMeta::new_readonly(vault_authority, false),
            AccountMeta::new(vault_new_qx, false),
            AccountMeta::new_readonly(old_qx_mint, false),
            AccountMeta::new_readonly(new_qx_mint, false),
            AccountMeta::new_readonly(token_program, false),
            AccountMeta::new_readonly(system_program, false),
            AccountMeta::new_readonly(program_data, false),
        ],
        data,
    };

    let err = send_ix_result(&mut svm, &payer, &[&ops_admin], ix);
    assert_eq!(
        err,
        TransactionError::InstructionError(0, InstructionError::InvalidInstructionData)
    );
}

#[test]
fn load_program_and_reject_withdraw_unclaimed_with_trailing_payload() {
    let Some((mut svm, program_id, payer)) = setup_svm() else {
        return;
    };

    let config = Address::new_unique();
    let vault_authority = Address::new_unique();
    let vault_new_qx = Address::new_unique();
    let refund_recipient_new_qx = Address::new_unique();
    let new_qx_mint = Address::new_unique();
    let token_program = Address::new_unique();

    for address in [
        config,
        vault_authority,
        vault_new_qx,
        refund_recipient_new_qx,
        new_qx_mint,
        token_program,
    ] {
        set_placeholder_system_account(&mut svm, address);
    }

    let ix = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new_readonly(config, false),
            AccountMeta::new_readonly(vault_authority, false),
            AccountMeta::new(vault_new_qx, false),
            AccountMeta::new(refund_recipient_new_qx, false),
            AccountMeta::new_readonly(new_qx_mint, false),
            AccountMeta::new_readonly(token_program, false),
        ],
        data: vec![3u8, 0u8],
    };

    let err = send_ix_result(&mut svm, &payer, &[], ix);
    assert_eq!(
        err,
        TransactionError::InstructionError(0, InstructionError::InvalidInstructionData)
    );
}

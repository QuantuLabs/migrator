use std::{env, path::PathBuf};

use litesvm::LiteSVM;
use solana_address::Address;
use solana_instruction::Instruction;
use solana_keypair::Keypair;
use solana_message::{Message, VersionedMessage};
use solana_signer::Signer;
use solana_transaction::versioned::VersionedTransaction;

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

#[test]
fn load_program_and_reject_invalid_instruction_call() {
    let Some(program_path) = resolve_program_path() else {
        eprintln!(
            "[litesvm_program_load] skip: no program artifact found. Set MIGRATOR_PROGRAM_SBF_PATH or build target/deploy/migrator_program.so"
        );
        return;
    };

    let mut svm = LiteSVM::new();
    let program_id = Address::new_unique();

    svm.add_program_from_file(program_id, program_path.to_string_lossy().as_ref())
        .expect("program should load from .so when file exists");

    let payer = Keypair::new();
    svm.airdrop(&payer.pubkey(), 1_000_000_000)
        .expect("airdrop should succeed");

    // discriminator=2 (migrate_exact), amount=1, but with zero accounts to force NotEnoughAccountKeys
    let ix = Instruction {
        program_id,
        accounts: vec![],
        data: {
            let mut d = vec![2u8];
            d.extend_from_slice(&1u64.to_le_bytes());
            d
        },
    };

    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&payer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&payer])
        .expect("signed tx should be created");

    let sim = svm.simulate_transaction(tx.clone());
    assert!(
        sim.is_err(),
        "simulate should fail because instruction account list is invalid"
    );

    let send = svm.send_transaction(tx);
    assert!(
        send.is_err(),
        "send should fail because instruction account list is invalid"
    );
}

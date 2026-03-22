# Mollusk Lane

## Why This Lane Exists

This repository now ships a dedicated `Mollusk` regression and fuzz-fixture lane.

It is the best fit for the current project because:

- the program is written in `Pinocchio`, not `Anchor`
- the instruction surface is intentionally small
- we already have strong deterministic `LiteSVM` coverage
- `Mollusk` adds fast SVM-native regression coverage plus fixture generation without forcing an Anchor-centric workflow

`Trident` remains a good option later if the project grows into a larger stateful fuzzing target, but for this repo `Mollusk` is the lower-friction and more maintainable first lane.

## What It Covers Today

Current `Mollusk` tests live in:

- `programs/migrator-program/tests/mollusk_fuzz_lane.rs`

The lane currently covers:

- successful `initialize_config`
- rejected `initialize_config` when `migration_cap > reserve`
- `set_pause(true)` followed by `migrate_exact`, proving the paused path stops before any token CPI
- fixture roundtrip replay for both successful and failing `initialize_config`

This is intentionally complementary to `LiteSVM`:

- `LiteSVM` remains the main transaction-behavior suite
- `Mollusk` adds a fast regression lane and fixture ejection path

## How To Run

From the repo root:

```bash
./scripts/run-mollusk-lane.sh
```

This will:

1. build the program ELF with `cargo build-sbf`
2. export `SBF_OUT_DIR`
3. export `MOLLUSK_REQUIRE_ARTIFACT=1`
4. run the `mollusk_fuzz_lane` test suite

This script is the canonical way to run the lane. A plain `cargo test` may still compile the suite without executing the SBF-backed cases if no program artifact is available locally.

## Fixture Ejection

To write reusable fixtures while running the lane:

```bash
MOLLUSK_FIXTURE_DIR=./target/mollusk-fixtures ./scripts/run-mollusk-lane.sh
```

To also request JSON fixture output:

```bash
MOLLUSK_FIXTURE_DIR=./target/mollusk-fixtures MOLLUSK_FIXTURE_JSON=1 ./scripts/run-mollusk-lane.sh
```

`Mollusk` will then emit fixtures for every invocation executed by the lane. These fixtures can be replayed later and also serve as useful regression artifacts when changing program internals.

## Limits

This lane does not replace:

- `LiteSVM` end-to-end transaction coverage
- `Kani` proofs over pure helpers and layout invariants
- verified-build publication
- devnet/mainnet dry runs

It is one more security layer, not the only one.

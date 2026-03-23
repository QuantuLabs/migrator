# Migrator

Built by **Quantu Labs**. Licensed under **MIT**.

Migrator is a standalone Solana migration engine for strict `1:1` classic SPL
(`Tokenkeg`) token migrations.

It is designed for high-assurance migrations with a deliberately small surface:

- `initialize_config`
- `set_pause`
- `migrate_exact`
- `withdraw_unclaimed`

## What V1 Does

- atomic `burn -> transfer` migration flow
- init-time reserve funding from a dedicated funding wallet
- immutable on-chain migration cap
- canonical ATA-only destination routing
- pause control
- permissionless post-deadline reserve closeout to a fixed refund wallet
- manifest-driven release validation and deterministic-build checks

Out of scope for V1:

- Token-2022 support
- holder fee sharing
- on-chain buyback logic
- rescue automation for LP, vesting, or custody edge cases
- per-wallet allowlists or Merkle claims

## Tech Stack

- Rust `2021`
- `Pinocchio`
- `pinocchio-token`
- classic SPL Token / `Tokenkeg` only
- TypeScript SDK with `@solana/web3.js`
- `LiteSVM`
- `Mollusk`
- `Kani`
- `solana-verify`

## Repository Layout

- `programs/migrator/` — on-chain program crate
- `sdk/` — manual TypeScript SDK and release validators
- `docs/handoff/` — frontend and integrator contract
- `docs/internal/` — internal audit notes, plans, and checklists
- `docs/runbooks/` — launch, release, and emergency procedures
- `release/` — reviewed manifests and release-record templates
- `scripts/` — local assurance, deterministic build, and dry-run wrappers

Start here:

- `docs/handoff/PROGRAM_SPEC.md`
- `docs/internal/AUDIT.md`
- `docs/internal/SECURITY_BASELINE.md`
- `docs/runbooks/MAINNET_PRELAUNCH.md`
- `docs/runbooks/MAINNET_DRY_RUN.md`
- `docs/runbooks/VERIFIED_BUILD.md`

## Current Verification

- `cargo test`
- `cargo clippy --all-targets --all-features -- -D warnings`
- `npm --prefix sdk test`
- `npm --prefix sdk run typecheck`
- `./scripts/run-sbf-assurance-lane.sh`
- `./scripts/run-mollusk-lane.sh`
- `./scripts/run-kani-lane.sh`
- `./scripts/run-verified-build.sh`
- `./scripts/run-local-assurance-lane.sh`
- `./scripts/run-mainnet-dry-run.sh <filled-inputs.json>`
- `./scripts/run-mainnet-dry-run-quorum.sh <filled-inputs.json>`

Current coverage notes:

- `LiteSVM` migration-flow suite covers `67` end-to-end cases
- `Mollusk` lane covers `11` SBF-backed regression and fixture-replay cases
- `Kani` lane covers `16` proof harnesses
- SDK test suite covers `29` release and validator checks
- `run-local-assurance-lane.sh` requires a clean worktree by default; verified-build is part of the release-grade path

Important toolchain note:

- use `./scripts/run-kani-lane.sh` as the release gate
- direct `cargo kani -p migrator --features no-entrypoint` can still hit a
  late toolchain failure on the pinned environment even when all harnesses pass

## Core Policies

Mint policy:

- V1 accepts only mints owned by
  `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`

Destination policy:

- `migrate_exact` requires the canonical ATA for `(user, destination mint)`
- destination accounts with delegate, close-authority, or wrapped-native
  controls are rejected

Closeout policy:

- `withdraw_unclaimed` is available only once `now > end_ts`
- it sweeps the full reserve ATA balance
- it stays blocked if `paused` is still set

Eligibility policy:

- V1 does **not** enforce wallet-by-wallet eligibility on-chain
- the only hard on-chain limiter is the immutable global `migration_cap`
- excluded source-token balances must be prevented operationally before launch

Old-market policy:

- any controlled legacy liquidity path must be retired before or at open
- official routing, bots, docs, and analytics must flip to the new mint at
  launch

## Release Discipline

Before mainnet launch, follow:

- `docs/runbooks/MAINNET_PRELAUNCH.md`
- `docs/runbooks/MAINNET_DRY_RUN.md`
- `docs/runbooks/VERIFIED_BUILD.md`
- `docs/runbooks/UPGRADE_AUTHORITY_POLICY.md`
- `docs/runbooks/OLD_MARKET_DEPRECATION.md`
- `docs/runbooks/OLD_LP_RETIREMENT.md`
- `docs/runbooks/OLD_MARKET_MONITORING.md`
- `docs/runbooks/DEPRECATION_EVIDENCE.md`

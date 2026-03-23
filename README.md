# Migrator Program

Standalone repo for the on-chain migration program and its interface contract.

## Framework Decision

Recommendation: use `Pinocchio` for the on-chain migration program.

Why this is the right default for `QX -> new QX on Bags`:

- The program surface is intentionally small: `initialize_config`, `set_pause`, `migrate_exact`.
- The migration path is simple and atomic: `burn old QX -> transfer new QX`.
- The workspace already contains real `Pinocchio` programs and patterns:
  - `qx-staking-v1`
  - `percolator-8004`
- A smaller dependency surface and explicit account validation are a good fit for a high-trust migration path.
- We do not need Anchor IDL as a hard dependency if we freeze the client contract early and ship a tiny manual SDK.

Why not default to `Anchor` here:

- The main benefit would be IDL/client ergonomics.
- For a 9-day migration MVP, the extra framework layer is not required if the program stays minimal.
- Frontend integration can be handled with a fixed TypeScript builder layer instead of generated clients.

When to switch back to `Anchor`:

- If the program scope grows beyond a minimal migrator.
- If we add many admin instructions, claim variants, or Token-2022 support.
- If multiple external integrators need IDL-driven clients immediately.

## Scope

In scope for V1:

- `1:1` migration from `old QX` to `new QX`
- `Tokenkeg` only (`spl-token` classic, not `Token-2022`)
- pre-funded reserve vault for `new QX`
- immutable on-chain migration cap tied to approved eligible supply
- atomic burn + transfer
- pause switch
- public config/state readable off-chain

Out of scope for V1:

- DividendsBot
- holder fee sharing
- buyback logic on-chain
- LP/custody rescue automation
- Token-2022
- late-claim penalty

## Repo Layout

- `programs/migrator-program/` — Pinocchio program crate
- `docs/README.md` — docs index
- `docs/handoff/PROGRAM_SPEC.md` — instruction contract for frontend/integrations
- `docs/internal/PLAN_9_DAYS.md` — execution plan to hit the hackathon window
- `docs/internal/AUDIT.md` — security and anti-drama audit
- `docs/internal/checklists/TOKENKEG_ONLY_CHECKLIST.md` — pre-launch verification checklist for the final Bags mint
- `docs/runbooks/` — ops runbooks for launch and emergency handling
- `release/` — reviewed launch manifests and verified-build metadata templates
- `docs/runbooks/KANI_LANE.md` — authoritative per-harness formal-proof lane
- `docs/runbooks/MOLLUSK_LANE.md` — SVM-native fuzz-fixture lane
- `docs/runbooks/VERIFIED_BUILD.md` — deterministic build and hash publication flow
- `docs/runbooks/UPGRADE_AUTHORITY_POLICY.md` — authority policy across pre-init and post-init phases
- `docs/runbooks/MAINNET_DRY_RUN.md` — exact manifest-driven launch validation
- `sdk/README.md` — expected TypeScript SDK surface

## Current Verification

- `cargo test` passes for the workspace
- `cargo clippy --all-targets --all-features -- -D warnings` passes
- `sdk/` passes `npm test`
- `sdk/` passes `npx tsc --noEmit`
- `LiteSVM` smoke and program-load tests are in place
- `LiteSVM` transaction coverage asserts exact `TransactionError` outcomes for the main business-control failures
- `LiteSVM` migration-flow suite currently covers `36` end-to-end cases
- `./scripts/run-sbf-assurance-lane.sh` passes and is the canonical non-skippable LiteSVM SBF gate
- `./scripts/run-mollusk-lane.sh` passes and is the canonical `Mollusk` entrypoint for `initialize_config`, paused pre-CPI `migrate_exact`, and fixture roundtrip replay
- `./scripts/run-kani-lane.sh` passes for all `13` current proof harnesses
- `./scripts/run-verified-build.sh` is the canonical deterministic-build lane
- `.github/workflows/verified-build.yml` runs the deterministic-build lane on `push`, `pull_request`, and `workflow_dispatch`
- `./scripts/run-mainnet-dry-run.sh <filled-inputs.json>` is the canonical release-input validator

Current toolchain note:

- `cargo kani -p migrator-program --features no-entrypoint` can hit a late `goto-instrument` failure on this pinned environment even when the individual harnesses all verify successfully
- use `./scripts/run-kani-lane.sh` as the release gate instead

Verified-build lane policy:

- the root `Cargo.toml` exposes the verifier toolchain via `[workspace.metadata.cli]`
- `./scripts/run-verified-build.sh` requires a fully clean git worktree by default
- the script uses an absolute mount path to avoid the `solana-verify 0.4.11` `.` mount-path bug for workspace subcrates

## Mint Policy

V1 only accepts mints owned by:

- `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`

For the final `new QX` Bags mint, run the pre-launch checklist in:

- `docs/internal/checklists/TOKENKEG_ONLY_CHECKLIST.md`

For mainnet launch controls, follow:

- `docs/runbooks/MAINNET_PRELAUNCH.md`
- `docs/runbooks/MAINNET_DRY_RUN.md`
- `docs/runbooks/VERIFIED_BUILD.md`
- `docs/runbooks/UPGRADE_AUTHORITY_POLICY.md`

## Destination Policy

`migrate_exact` now treats `user_new_qx` as the canonical associated token account for
`(user, new QX mint)`.

That means:

- the destination must be the expected ATA address
- the destination cannot carry delegate, close-authority, or wrapped-native controls
- frontend and ops flows must create the ATA before attempting migration

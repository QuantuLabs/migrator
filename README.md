# Migrator Program

Standalone repo for the on-chain migration program and its interface contract.

## Framework Decision

Recommendation: use `Pinocchio` for the on-chain migration program.

Why this is the right default for `QX -> new QX on Bags`:

- The program surface is intentionally small: `initialize_config`, `set_pause`, `migrate_exact`.
 - The closeout surface stays small even after expiry handling: `initialize_config`, `set_pause`, `migrate_exact`, `withdraw_unclaimed`.
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
- immutable on-chain migration cap tied to the approved migration total
- atomic burn + transfer
- pause switch
- post-deadline reclaim of the unclaimed migration reserve back to a fixed refund wallet
- public config/state readable off-chain
- canonical ATA-only destination for `new QX`
- open live-holder migration path unless excluded balances are operationally locked before launch

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
- `docs/runbooks/OLD_MARKET_DEPRECATION.md` — anti-ghost-market launch and comms playbook
- `docs/runbooks/OLD_LP_RETIREMENT.md` — mandatory retirement flow for controlled legacy liquidity
- `docs/runbooks/OLD_MARKET_MONITORING.md` — post-open monitoring and escalation thresholds
- `docs/runbooks/DEPRECATION_EVIDENCE.md` — release record for deprecation proofs, tx hashes, and sign-off
- `scripts/run-local-assurance-lane.sh` — single-command local assurance sequence across Rust, SDK, SBF, Mollusk, and Kani
- `sdk/README.md` — expected TypeScript SDK surface

## Current Verification

- `cargo test` passes for the workspace
- `cargo clippy --all-targets --all-features -- -D warnings` passes
- `sdk/` passes `npm test`
- `sdk/` passes `npx tsc --noEmit`
- `LiteSVM` smoke and program-load tests are in place
- `LiteSVM` transaction coverage asserts exact `TransactionError` outcomes for the main business-control failures
- `LiteSVM` migration-flow suite currently covers `56` end-to-end cases
- `./scripts/run-sbf-assurance-lane.sh` passes and is the canonical non-skippable LiteSVM SBF gate
- `./scripts/run-mollusk-lane.sh` passes and is the canonical `Mollusk` entrypoint for `initialize_config`, paused pre-CPI `migrate_exact`, fixture roundtrip replay, and a real `SPL + ATA` bootstrap into `migrate_exact`
- direct `cargo test --test mollusk_fuzz_lane` is not a release-authoritative substitute because it can reuse an already-built `target/deploy` artifact instead of rebuilding the SBF binary first
- `./scripts/run-kani-lane.sh` passes for all `13` current proof harnesses
- `./scripts/run-verified-build.sh` is the canonical deterministic-build lane
- `./scripts/run-local-assurance-lane.sh` is the canonical local pre-release sequence; it runs verified-build only when the git worktree is clean unless `ASSURANCE_REQUIRE_VERIFIED_BUILD=1`
- `.github/workflows/verified-build.yml` runs the deterministic-build lane on `push`, `pull_request`, and `workflow_dispatch`
- `./scripts/run-mainnet-dry-run.sh <filled-inputs.json>` is the canonical release-input validator
- `sdk/` release-report tests cover `validateMainnetInputs`, `verifyProgramAuthority`, `verifyConfig`, `verifyReserveVault`, `verifyMint`, and `generateReserveProof` builders
- `sdk/` regression tests pin the official associated-token and `Tokenkeg` program IDs and verify ATA derivation against those literals
- the real `SPL + ATA` lane caught and closed an incorrect associated-token-program constant regression before release

Current toolchain note:

- `cargo kani -p migrator-program --features no-entrypoint` can hit a late `goto-instrument` failure on this pinned environment even when the individual harnesses all verify successfully
- use `./scripts/run-kani-lane.sh` as the release gate instead

Verified-build lane policy:

- the root `Cargo.toml` exposes the verifier toolchain via `[workspace.metadata.cli]`
- `./scripts/run-verified-build.sh` requires a fully clean git worktree by default
- the script records repo-relative `programSoPath` metadata so reviewed build artifacts stay reproducible across reviewer machines

## Mint Policy

V1 only accepts mints owned by:

- `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`

For the final `new QX` Bags mint, run the pre-launch checklist in:

- `docs/internal/checklists/TOKENKEG_ONLY_CHECKLIST.md`

For mainnet launch controls, follow:

- `docs/runbooks/MAINNET_PRELAUNCH.md`
- `docs/runbooks/MAINNET_DRY_RUN.md`
- `docs/runbooks/OLD_MARKET_DEPRECATION.md`
- `docs/runbooks/OLD_LP_RETIREMENT.md`
- `docs/runbooks/OLD_MARKET_MONITORING.md`
- `docs/runbooks/DEPRECATION_EVIDENCE.md`
- `docs/runbooks/VERIFIED_BUILD.md`
- `docs/runbooks/UPGRADE_AUTHORITY_POLICY.md`

## Destination Policy

`migrate_exact` now treats `user_new_qx` as the canonical associated token account for
`(user, new QX mint)`.

That means:

- the destination must be the expected ATA address
- the destination cannot carry delegate, close-authority, or wrapped-native controls
- frontend and ops flows must create the ATA before attempting migration

## Closeout Policy

`withdraw_unclaimed` becomes available only once the migration window has fully ended
(`now > end_ts`).

That means:

- it transfers only the unclaimed approved migration amount: `migration_cap - total_migrated`
- it does not sweep arbitrary overfunding that may still sit in the reserve ATA
- it is permissionless to trigger once the window is over
- it marks the closeout as one-shot on-chain
- it sends the reclaimed amount to the canonical ATA for the configured refund wallet
- in V1, `initialize_config` binds that refund wallet to `initializer_authority`

## Eligibility Policy

V1 does **not** enforce wallet-by-wallet eligibility on-chain.

That means:

- `migrate_exact` is open to any current holder that can burn valid `old QX`
- the only hard on-chain limiter is the immutable global `migration_cap`
- if some old balances are meant to stay excluded, they must be locked, burned, or otherwise operationally prevented from reaching live wallets before launch
- any team-controlled old LP or market-making path left live at open is effectively an ingress into the migration reserve and must be treated as a launch blocker

## Old Market Policy

For V1, `old QX` is assumed to become non-canonical when migration opens.

That means:

- any team-controlled legacy LP must be retired before or at migration open
- official routing, bots, docs, and analytics links must flip to the new mint at open
- legacy price action must be treated as non-canonical immediately after deprecation
- proof of the deprecation actions belongs in `docs/runbooks/DEPRECATION_EVIDENCE.md`

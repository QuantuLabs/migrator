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
- `sdk/README.md` — expected TypeScript SDK surface

## Current Verification

- `cargo test` passes for the workspace
- `sdk/` passes `npx tsc --noEmit`
- `LiteSVM` smoke and program-load tests are in place
- `cargo kani -p migrator-program --harness migration_gate_matches_control_policy --harness migration_gate_accepts_boundary_timestamps` passes

## Mint Policy

V1 only accepts mints owned by:

- `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`

For the final `new QX` Bags mint, run the pre-launch checklist in:

- `docs/internal/checklists/TOKENKEG_ONLY_CHECKLIST.md`

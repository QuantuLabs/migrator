# Deep Audit

## Bottom Line

The migration program can be safely implemented in `Pinocchio` if it remains intentionally small.

The biggest risks are not exotic Solana bugs. They are:

1. reserve shortfall
2. wrong account validation
3. mutable migration rules after announcement
4. phishing and dual-market confusion

## Current Code Status

Current implementation status:

- `initialize_config` implemented
- `set_pause` implemented
- `migrate_exact` implemented
- manual TypeScript SDK implemented
- operational verification scripts implemented for mint, reserve vault, config, program authority, and reserve-proof checks
- `Tokenkeg only` policy documented explicitly
- `cargo test` passes
- `cargo clippy --all-targets --all-features -- -D warnings` passes
- `cargo kani -p migrator-program --features no-entrypoint` passes
- SDK typecheck passes with `npx tsc --noEmit`

Current verification coverage:

- parser unit tests
- `LiteSVM` boot smoke test
- `LiteSVM` program-load smoke test
- `LiteSVM` initialize_config happy path
- `LiteSVM` initialize_config upgrade-authority mismatch rejection
- `LiteSVM` initialize_config re-initialization rejection
- `LiteSVM` initialize_config same-mint rejection
- `LiteSVM` initialize_config invalid token-program rejection
- `LiteSVM` initialize_config reserve-vault control rejection
- `LiteSVM` migrate_exact happy path with real SPL mint/token account layouts
- `LiteSVM` paused migration rejection
- `LiteSVM` insufficient reserve rejection
- `LiteSVM` closed-window rejection
- `LiteSVM` not-started-window rejection
- `LiteSVM` wrong old mint rejection
- `LiteSVM` wrong new mint rejection
- `LiteSVM` wrong vault rejection
- `LiteSVM` reserve vault delegate-control rejection
- `LiteSVM` reserve vault close-authority rejection
- `LiteSVM` zero-amount rejection
- `LiteSVM` wrong user destination owner rejection
- `LiteSVM` uninitialized user destination rejection
- `LiteSVM` wrong user destination mint rejection
- `LiteSVM` invalid init window rejection
- `LiteSVM` unauthorized pause rejection
- negative transaction tests assert the exact `TransactionError` / custom error code, not just `.is_err()`
- transaction-level malformed entrypoint payload tests cover empty data, bad discriminator, short migrate payload, short initialize payload, and invalid set-pause payload
- `Kani` proof: migration gate matches the control policy for all symbolic timestamps
- `Kani` proof: migration window boundaries are inclusive
- `Kani` proofs: config layout stability, strict mint policy, token-account parsing, custody-account control checks
- `Kani` proof: migration-cap helpers roundtrip and reject over-cap states
- `Kani` proof: `checked_total_migrated_after` matches `checked_add`
- `Kani` proof: unaligned config write/read roundtrip preserves the value

What is still missing before mainnet confidence:

- devnet dry-run with published addresses
- final Bags mint verification against the `Tokenkeg` checklist
- final reserve vault verification against the PDA checklist
- recorded reserve-proof artifact with reviewer sign-off
- explicit upgrade-authority lock/freeze/transfer execution before public launch
- finalized publication flow using the config/program-authority verification scripts
- verified-build publication and public source linkage
- fuzzing lane with `Mollusk` or `Trident`

## Critical Risks

### C1. Reserve shortfall

Risk:

- `1:1` is socially dead if the reserve cannot cover the effective eligible supply.

Mitigation:

- compute eligible old supply before public commitment
- bind that approved raw-unit total into `migration_cap` during `initialize_config`
- require reserve vault balance to cover `migration_cap` at initialization time
- publish reserve vault address before launch
- keep `new QX` reserve segregated from all other treasury balances
- do not announce universal `1:1` without proof

### C2. Wrong mint acceptance

Risk:

- accepting the wrong old or new mint breaks the migration permanently.

Mitigation:

- bind both mint addresses in config at initialization
- reject any account whose mint does not match config
- never allow mint replacement after init

### C3. Wrong reserve authority or destination

Risk:

- a malicious caller can redirect `new QX` if authority/destination checks are weak.

Mitigation:

- derive vault authority PDA on-chain every call
- verify reserve token account owner equals vault PDA
- verify user destination owner equals signer
- reject reserve vaults with delegate or close-authority controls
- never accept unchecked destination authority fields in instruction data

### C4. Rule mutation after launch

Risk:

- changing ratio, window, or claim conditions mid-flight creates maximum drama.

Mitigation:

- V1 keeps only `pause`
- no admin path for ratio changes
- no admin path for mint swaps
- no late-claim penalty logic in MVP

## High Risks

### H1. Token account validation bugs

Risk:

- manual validation is the tradeoff of `Pinocchio`.

Mitigation:

- validate owner, mint, token program, and initialization status on every token account
- copy proven validation patterns from `qx-staking-v1`
- add negative tests for every invalid account permutation
- keep formal proofs limited to pure control helpers; use transaction tests for `AccountView`-driven logic

### H2. Window logic bugs

Risk:

- users blocked too early or too late because of bad timestamp handling.

Mitigation:

- use explicit `start_ts` and `end_ts`
- define inclusivity precisely in tests
- reject if `now < start_ts || now > end_ts`

### H3. ATA assumption mismatch

Risk:

- `migrate_exact` fails if `user_new_qx` ATA is missing.

Mitigation:

- frontend auto-creates ATA before migrate
- docs state this clearly
- add UX copy for wallet state preparation

### H5. Strict new mint validation may be too strong for final Bags mint configuration

Risk:

- V1 currently enforces `mint_authority == None` and `freeze_authority == None` on both old and new mints.

Why this matters:

- this is desirable for trust minimization
- but if the final Bags-side mint setup differs, `initialize_config` and `migrate_exact` will reject it

Mitigation:

- confirm final Bags mint configuration before mainnet
- only relax this check deliberately and document the change publicly if absolutely necessary

Current decision:

- keep V1 `Tokenkeg only`
- do not add `Token-2022` support unless the final Bags mint forces that change

### H4. Old market remains active

Risk:

- even a perfect migrator does not kill the old market by itself.
- if legacy liquidity remains while circulating old supply gets burned away, the old market can become thinner and easier to manipulate
- that can create a misleading legacy price increase and a fake market-cap signal during migration

Mitigation:

- deprecate the old token publicly
- remove any controlled old liquidity if applicable
- stop routing any official UI, bot, or docs toward the old pool once migration opens
- communicate that legacy price action is non-canonical after launch
- make the official site and docs point to the new mint only

## Medium Risks

### M1. No per-user migration record

Impact:

- on-chain state remains smaller and simpler, but analytics are off-chain.

Why this is acceptable:

- the burn itself is the anti-replay mechanism
- wallet counts can be derived from logs and token transfers

### M2. Upgrade authority trust

Impact:

- users must trust that the upgrade authority is not abused.

Mitigation:

- use multisig for upgrade authority before mainnet launch if possible
- publish upgrade authority policy
- record the exact authority state and transition signature in the prelaunch runbook
- keep the instruction surface minimal
- if possible, freeze or clear upgrade authority immediately after successful init and verify it with the authority script

### M3. Log observability

Impact:

- simple logs are less indexer-friendly than structured events.

Mitigation:

- emit stable marker logs
- derive precise amounts from token transfer and burn instructions

## Pinocchio-Specific Review

`Pinocchio` is acceptable here because:

- the instruction set is tiny
- account flows are explicit
- local team patterns already exist

`Pinocchio` requires discipline here:

- manual seed checks
- manual token account parsing
- manual binary layouts
- manual TypeScript SDK

That is a reasonable tradeoff for this migration program, but not for a large evolving product surface.

See also `SECURITY_BASELINE.md` for the official-practice mapping and external tooling shortlist.

## Formal Verification Notes

Current `Kani` scope is intentionally narrow and useful:

- it proves the migration gate returns the expected control outcome for any symbolic `paused/start/end/now` combination where `start <= end`
- it proves `start_ts` and `end_ts` are inclusive migration boundaries
- it proves strict mint parsing rejects authority flags
- it proves token-account parsing rejects wrong owners and uninitialized accounts
- it proves custody-account parsing rejects delegate and close-authority controls
- it proves migration-cap helpers reject any state that would exceed the bound
- it proves the config layout constants remain stable

Current `Kani` scope does not cover:

- raw `AccountView` memory parsing
- PDA account plumbing
- token CPI behavior
- runtime Solana account ownership semantics

Why this split is acceptable:

- pure control policy is best handled with proofs
- Solana account and CPI behavior is better covered here with `LiteSVM` transaction tests

Observed `Kani` caveat:

- current proofs emit unsupported-construct warnings from crate-level Solana/Pinocchio paths, but the verified harnesses stay within the pure control helper and completed successfully

## Pre-Launch Checklist

- config PDA verified on explorer
- vault PDA verified on explorer
- reserve vault funded and public
- old/new mints published
- pause instruction tested
- wrong-mint and wrong-vault tests green
- mainnet dry-run checklist signed off

## Recommendation

Ship V1 as a narrow `Pinocchio` program with three instructions only.

Do not add:

- fee sharing
- reward logic
- rescue automation
- treasury withdrawal logic

Those can be handled off-program or in a later audited phase.

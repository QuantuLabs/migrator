# Deep Audit

## Bottom Line

Current program scope fits a narrow `Pinocchio` implementation.

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
- `withdraw_unclaimed` implemented
- `initialize_config` now funds the reserve atomically from a dedicated `funding_authority`
- manual TypeScript SDK implemented
- operational verification scripts implemented for mint, reserve vault, config, program authority, and reserve-proof checks
- `Tokenkeg only` policy documented explicitly
- `cargo test` passes
- `cargo clippy --all-targets --all-features -- -D warnings` passes
- `./scripts/run-kani-lane.sh` passes for all current `Kani` harnesses
- `npm test` passes for the SDK and release-report tests
- SDK typecheck passes with `npx tsc --noEmit`
- `./scripts/run-mollusk-lane.sh` passes and forces a real SBF-backed `Mollusk` run
- GitHub Actions now includes a dedicated `verified-build` workflow that runs the deterministic-build lane and uploads the reviewed artifact metadata

Current verification coverage:

- parser unit tests
- `LiteSVM` boot smoke test
- `LiteSVM` program-load smoke test
- `LiteSVM` initialize_config happy path
- `LiteSVM` initialize_config upgrade-authority mismatch rejection
- `LiteSVM` initialize_config ProgramData wrong-owner rejection
- `LiteSVM` initialize_config ProgramData wrong-discriminator rejection
- `LiteSVM` initialize_config re-initialization rejection
- `LiteSVM` initialize_config same-mint rejection
- `LiteSVM` initialize_config invalid token-program rejection
- `LiteSVM` initialize_config reserve-vault control rejection
- `LiteSVM` initialize_config reserve-vault close-authority rejection
- `LiteSVM` initialize_config reserve-vault wrong-program-owner rejection
- `LiteSVM` initialize_config prefunded-reserve-vault rejection
- `LiteSVM` initialize_config funding-source owner mismatch rejection
- `LiteSVM` initialize_config funding-source delegate-control rejection
- `LiteSVM` initialize_config zero migration-cap rejection
- `LiteSVM` initialize_config migration-cap-above-funding-balance rejection
- `LiteSVM` initialize_config old-mint wrong-program-owner rejection
- `LiteSVM` initialize_config old-mint authority-flag rejection
- `LiteSVM` initialize_config new-mint freeze-authority rejection
- `LiteSVM` initialize_config first-deploy path using an uninitialized system-owned config PDA placeholder
- `LiteSVM` migrate_exact happy path with strict SPL-compatible mint/token account layouts
- `LiteSVM` paused migration rejection
- `LiteSVM` insufficient reserve rejection
- `LiteSVM` migration-cap exceeded rejection
- `LiteSVM` cumulative migration-cap progression up to the exact cap boundary, then rejection of the next unit
- `LiteSVM` closed-window rejection
- `LiteSVM` not-started-window rejection
- `LiteSVM` wrong old mint rejection
- `LiteSVM` wrong new mint rejection
- `LiteSVM` wrong vault rejection
- `LiteSVM` wrong vault-authority account rejection
- `LiteSVM` wrong token-program account rejection on `migrate_exact`
- `LiteSVM` reserve vault delegate-control rejection
- `LiteSVM` reserve vault close-authority rejection
- `LiteSVM` zero-amount rejection
- `LiteSVM` wrong user source owner rejection
- `LiteSVM` wrong user destination owner rejection
- `LiteSVM` uninitialized user destination rejection
- `LiteSVM` user destination wrong-program-owner rejection
- `LiteSVM` wrong user destination mint rejection
- `LiteSVM` user destination delegate-control rejection
- `LiteSVM` user destination wrapped-native rejection
- `LiteSVM` non-ATA destination rejection
- `LiteSVM` reserve-vault alias rejection on destination account
- `LiteSVM` rollback when burn CPI fails
- `LiteSVM` rollback when source balance is insufficient
- `LiteSVM` rollback when post-burn transfer signing fails
- `LiteSVM` invalid init window rejection
- `LiteSVM` unauthorized pause rejection
- `LiteSVM` withdraw_unclaimed happy path for full-vault sweep after expiry
- `LiteSVM` withdraw_unclaimed before-deadline rejection
- `LiteSVM` withdraw_unclaimed exact-boundary rejection with rollback invariants
- `LiteSVM` withdraw_unclaimed wrong-destination rejection
- `LiteSVM` withdraw_unclaimed wrong-vault rejection
- `LiteSVM` withdraw_unclaimed sweep with extra surplus present in the vault
- `LiteSVM` withdraw_unclaimed sweep of the remaining vault balance even when the vault is underfunded vs. `migration_cap - total_migrated`
- `LiteSVM` withdraw_unclaimed paused rejection after expiry
- `LiteSVM` withdraw_unclaimed permissionless third-party caller success path
- `LiteSVM` withdraw_unclaimed one-shot rejection after the closeout flag is set
- `Mollusk` withdraw_unclaimed happy path, strict-deadline rejection, and paused-after-expiry rejection
- release validators now gate `refundRecipient` and `unclaimedWithdrawn`
- `Mollusk` successful `initialize_config` with inner-instruction tracking
- `Mollusk` rejected `initialize_config` when `migration_cap > reserve`
- `Mollusk` paused `migrate_exact` rejection before any token CPI
- `Mollusk` real `SPL + ATA` bootstrap that initializes both mints, reserve vault, user source account, creates the canonical destination ATA through the associated-token program, then executes successful `migrate_exact`
- `Mollusk` fixture roundtrip replay for successful and failing `initialize_config`
- `Mollusk` canonical lane requires a built SBF artifact and cannot silently skip in script mode
- the real `SPL + ATA` lane exposed and closed an incorrect associated-token-program constant regression before release
- negative transaction tests assert the exact `TransactionError` / custom error code, not just `.is_err()`
- transaction-level malformed entrypoint payload tests cover empty data, bad discriminator, short migrate payload, short initialize payload, and invalid set-pause payload
- SDK release-report tests cover program authority, reserve vault, config, manifest parsing, and mainnet-input parsing helpers
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
- second-provider replay of the reviewed mainnet dry-run manifest before release sign-off
- a broader transaction lane that also creates the surrounding system-owned and upgradeable-loader state through real instructions instead of keeping `ProgramData`, PDAs, and some placeholders synthetic inside the harness
- broader stateful fuzzing beyond the current `Mollusk` lane if the program surface grows
- upstream `Kani` batch-run stability should be rechecked before restoring the single-command release gate

## Critical Risks

### C1. Reserve shortfall

Risk:

- `1:1` is socially dead if the approved migration total is wrong or if the reserve cannot cover that approved total.
- the program now binds an immutable on-chain `migration_cap` and rejects initialization unless a reviewed funding wallet transfers that exact amount into an empty reserve vault during `initialize_config`.
- the remaining trust surface is the off-chain selection of the approved migration total and any excluded balances, not an unbounded on-chain drain past that cap.

Mitigation:

- compute eligible old supply before public commitment
- either treat the migration as openly available to any live holder, or operationally lock excluded balances before launch
- bind that approved raw-unit total into `migration_cap` during `initialize_config`
- require a reviewed funding wallet and funding token account
- require the reserve vault to start empty at initialization time
- transfer exactly `migration_cap` into the reserve vault during `initialize_config`
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
- verify user destination equals the canonical ATA for `(user, new QX mint)`
- reject destination accounts with delegate, close-authority, or wrapped-native controls
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
- V1 now enforces the canonical ATA itself, so a wrong but otherwise well-formed token account is rejected on-chain.

Mitigation:

- frontend auto-creates ATA before migrate
- the program now verifies the destination address matches the canonical ATA for `(user, new QX mint)`
- transaction tests cover non-ATA destination, delegate controls, and wrapped-native rejection
- docs state this clearly
- add UX copy for wallet state preparation

### H5. Strict new mint validation may be too strong for final Bags mint configuration

Risk:

- V1 currently enforces `mint_authority == None` and `freeze_authority == None` on both old and new mints.

Operational impact:

- this is desirable for trust minimization
- but if the final Bags-side mint setup differs, `initialize_config` and `migrate_exact` will reject it

Mitigation:

- confirm final Bags mint configuration before mainnet
- only relax this check deliberately and document the change publicly if absolutely necessary

Current decision:

- keep V1 `Tokenkeg only`
- do not add `Token-2022` support unless the final Bags mint forces that change
- reject native-mint / wrapped-SOL paths on both old and new sides in V1

### H4. Old market remains active

Risk:

- even a perfect migrator does not kill the old market by itself.
- if legacy liquidity remains while circulating old supply gets burned away, the old market can become thinner and easier to manipulate
- that can create a misleading legacy price increase and a fake market-cap signal during migration
- if a team-controlled old LP remains live, that LP becomes an economic ingress into the V1 reserve; any freshly acquired `old QX` can still be burned `1:1`

Mitigation:

- deprecate the old token publicly
- retire every controlled old LP before or at open
- treat any team-controlled old LP that stays live as a go/no-go blocker
- stop routing any official UI, bot, or docs toward the old pool once migration opens
- communicate that legacy price action is non-canonical after launch
- make the official site and docs point to the new mint only
- maintain an evidence pack with tx hashes, owners, and sign-off for the deprecation sequence

## Medium Risks

### M1. No per-user migration record

Impact:

- on-chain state remains smaller and simpler, but analytics are off-chain.

Current basis:

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

Current `Pinocchio` fit:

- the instruction set is tiny
- account flows are explicit
- local team patterns already exist

`Pinocchio` control points:

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

Coverage split:

- pure control policy is best handled with proofs
- Solana account and CPI behavior is better covered here with `LiteSVM` transaction tests

Observed `Kani` caveat:

- current proofs emit unsupported-construct warnings from crate-level Solana/Pinocchio paths, but the verified harnesses stay within the pure control helper and completed successfully

Observed `Mollusk` caveat:

- release confidence should come from `./scripts/run-mollusk-lane.sh`, not a bare `cargo test --test mollusk_fuzz_lane`; the script rebuilds the SBF artifact first and avoids stale `target/deploy` binaries masking or reintroducing regressions

## Pre-Launch Checklist

- config PDA verified on explorer
- vault PDA verified on explorer
- reserve vault funded and public
- old/new mints published
- pause instruction tested
- wrong-mint and wrong-vault tests green
- mainnet dry-run checklist signed off

## Recommendation

Ship V1 as a narrow `Pinocchio` program with four instructions only.

Do not add:

- fee sharing
- reward logic
- rescue automation
- treasury withdrawal logic

Those can be handled off-program or in a later audited phase.

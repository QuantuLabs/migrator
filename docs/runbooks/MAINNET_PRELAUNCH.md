# Mainnet Prelaunch Runbook

## Preconditions

Do not initialize mainnet config until all of the following are true:

- final `new QX` mint exists
- final `old QX` mint address is frozen and reviewed
- final `new QX` mint passes the `Tokenkeg` checklist
- final `new QX` mint is confirmed not to be the native mint / wrapped-SOL mint
- funding wallet and funding token account are funded
- reserve vault exists and is empty
- program id is fixed
- admin signer policy is fixed
- upgrade authority policy is fixed
- frontend addresses are frozen

Important ordering:

- `initialize_config` requires the current upgrade authority to still exist and sign
- in V1, `funding_authority` becomes the immutable refund recipient for `withdraw_unclaimed`
- do not use a temporary wallet as `funding_authority`; use the reviewed refund wallet directly
- do not freeze or clear upgrade authority before `initialize_config` succeeds
- if policy requires transfer or freeze, do it after init and then verify the resulting `ProgramData` state

## Address Freeze Set

Verify and publish these exact addresses:

- program id
- config PDA
- vault authority PDA
- reserve vault token account
- funding wallet
- funding token account
- refund recipient wallet
- refund recipient ATA for `new QX`
- old QX mint
- new QX mint
- admin / ops signer policy
- current upgrade authority or the signature proving it was transferred/frozen

## Technical Checks

- `cargo test` passes on the pinned repo state
- `npm run typecheck` passes in `sdk/`
- `./scripts/run-sbf-assurance-lane.sh` passes on the pinned repo state
- `./scripts/run-kani-lane.sh` passes on the pinned repo state
- `./scripts/run-mollusk-lane.sh` passes on the pinned repo state
- final mint verification script passes
- old mint verification script passes
- deployed config verification script passes
- program authority verification script passes
- reserve proof script passes with the approved migration-cap input
- dry-run validator proves the derived config PDA is absent before init
- approved migration-cap input exactly matches the `migration_cap` that will be initialized on-chain
- reviewed dry-run manifest is re-run via the quorum lane against the reviewed `2` or `3` provider set before sign-off
- config PDA and vault PDA re-derive correctly from the chosen program id
- reserve vault owner is the vault PDA
- reserve vault starts empty before the init transaction
- reserve vault mint is the final `new QX` mint
- reserve vault delegate and close-authority controls are cleared
- funding token account owner is the reviewed funding wallet
- funding token account mint is the final `new QX` mint
- funding token account delegate and close-authority controls are cleared
- init funding is exact; V1 closeout sweeps the full reserve-vault balance after expiry, including any accidental surplus
- deployed binary hash or exact build artifact path is recorded
- verified-build metadata artifact is recorded
- verified-build lane was run from a clean tracked git state
- dry-run quorum artifact directory is recorded
- post-init replay sequencing is fixed before any user claim traffic is allowed

## Product Checks

- migration ratio is publicly stated as `1:1`
- no holder fee sharing is announced
- official frontend domain is fixed
- official docs list exact addresses and explorer links
- emergency pause instructions are prepared
- reserve-proof artifact is completed and reviewed
- planned `migration_cap` equals the reviewed eligible raw-unit total
- the team explicitly accepts that V1 is an open live-holder migrator, or excluded balances are operationally locked before launch
- published config state matches the runbook address set exactly
- published config state includes the fixed refund recipient and refund ATA, both tied to the reviewed funding wallet
- old-token deprecation notice is ready
- any controlled old-token liquidity removal or disablement plan is ready
- official routing, bots, and docs stop pointing users to the old pool when migration opens
- `OLD_MARKET_DEPRECATION.md` is filled and assigned to concrete owners
- `OLD_LP_RETIREMENT.md` is filled with the exact controlled-wallet inventory and expected tx hashes
- `OLD_MARKET_MONITORING.md` is filled with concrete thresholds and owners
- `DEPRECATION_EVIDENCE.md` has placeholders prepared for same-day publication and sign-off
- every team-controlled old LP is either already retired or has a same-window retirement transaction plan owned by a named operator
- no treasury or market-making wallet is expected to leave live old-QX inventory reachable at open

## Governance Checks

- upgrade authority state matches the published policy for the current phase
- the exact current upgrade authority address is recorded
- the wallet allowed to call `initialize_config` is recorded
- the recorded funding wallet matches the reviewed refund recipient
- ops admin recorded in config matches the intended pause authority
- reviewed dry-run manifest returns exit `0`
- the quorum artifact records the exact provider set used for sign-off
- if post-init replay is required, it is scheduled before unpausing claims

## Final Go/No-Go

Go only if:

- reserve sufficiency is proven
- all published addresses match the final deployment inputs
- frontend and docs point to the same addresses
- pause authority is verified
- upgrade authority state matches the published policy
- reserve-proof artifact includes raw units, decimals, funding wallet, and reviewer sign-off
- old-market deprecation and controlled-liquidity disablement are ready to execute at opening
- every controlled old LP is retired or has an assigned same-window retirement step with proof capture
- `DEPRECATION_EVIDENCE.md` has named owners for liquidity, frontend, comms, and monitoring sign-off
- verified-build artifact hash and reviewed dry-run manifest are attached to the release record
- dry-run quorum artifact directory is attached to the release record

If any of these fail, stop and keep migration closed.

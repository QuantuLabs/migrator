# Mainnet Prelaunch Runbook

## Preconditions

Do not initialize mainnet config until all of the following are true:

- final `new QX` mint exists
- final `new QX` mint passes the `Tokenkeg` checklist
- reserve vault is funded
- program id is fixed
- admin signer policy is fixed
- upgrade authority policy is fixed
- frontend addresses are frozen

Important ordering:

- `initialize_config` requires the current upgrade authority to still exist and sign
- do not freeze or clear upgrade authority before `initialize_config` succeeds
- if policy requires transfer or freeze, do it after init and then verify the resulting `ProgramData` state

## Address Freeze Set

Verify and publish these exact addresses:

- program id
- config PDA
- vault authority PDA
- reserve vault token account
- old QX mint
- new QX mint
- admin / ops signer policy
- current upgrade authority or the signature proving it was transferred/frozen

## Technical Checks

- `cargo test` passes on the pinned repo state
- `npm run typecheck` passes in `sdk/`
- `cargo kani -p migrator-program --features no-entrypoint` passes on the pinned repo state
- final mint verification script passes
- deployed config verification script passes
- program authority verification script passes
- reserve proof script passes with the approved eligible-supply input
- config PDA and vault PDA re-derive correctly from the chosen program id
- reserve vault owner is the vault PDA
- reserve vault mint is the final `new QX` mint
- reserve vault delegate and close-authority controls are cleared
- deployed binary hash or exact build artifact path is recorded

## Product Checks

- migration ratio is publicly stated as `1:1`
- no holder fee sharing is announced
- official frontend domain is fixed
- official docs list exact addresses and explorer links
- emergency pause instructions are prepared
- reserve-proof artifact is completed and reviewed
- published config state matches the runbook address set exactly

## Governance Checks

- upgrade authority state matches the published policy for the current phase
- the exact current upgrade authority address is recorded
- the wallet allowed to call `initialize_config` is recorded
- ops admin recorded in config matches the intended pause authority

## Final Go/No-Go

Go only if:

- reserve sufficiency is proven
- all published addresses match the final deployment inputs
- frontend and docs point to the same addresses
- pause authority is verified
- upgrade authority state matches the published policy
- reserve-proof artifact includes raw units, decimals, funding signature, and reviewer sign-off

If any of these fail, stop and keep migration closed.

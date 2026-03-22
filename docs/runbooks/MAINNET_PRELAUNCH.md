# Mainnet Prelaunch Runbook

## Preconditions

Do not initialize mainnet config until all of the following are true:

- final `new QX` mint exists
- final `new QX` mint passes the `Tokenkeg` checklist
- reserve vault is funded
- program id is fixed
- admin signer policy is fixed
- frontend addresses are frozen

## Address Freeze Set

Verify and publish these exact addresses:

- program id
- config PDA
- vault authority PDA
- reserve vault token account
- old QX mint
- new QX mint
- admin / ops signer policy

## Technical Checks

- `cargo test` passes on the pinned repo state
- `npm run typecheck` passes in `sdk/`
- final mint verification script passes
- config PDA and vault PDA re-derive correctly from the chosen program id
- reserve vault owner is the vault PDA
- reserve vault mint is the final `new QX` mint

## Product Checks

- migration ratio is publicly stated as `1:1`
- no holder fee sharing is announced
- official frontend domain is fixed
- official docs list exact addresses and explorer links
- emergency pause instructions are prepared

## Final Go/No-Go

Go only if:

- reserve sufficiency is proven
- all published addresses match the final deployment inputs
- frontend and docs point to the same addresses
- pause authority is verified

If any of these fail, stop and keep migration closed.

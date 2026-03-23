# Mainnet Dry-Run Inputs

## Goal

Validate the exact launch-time address set and authority policy before any
mainnet initialization transaction is sent.

## Input Manifest

Use:

- `release/mainnet-inputs.template.json`

Copy it to a local filled file, for example:

```bash
cp release/mainnet-inputs.template.json release/mainnet-inputs.local.json
```

Fill the real values for:

- program id
- old mint
- new mint
- reserve vault
- ops admin
- initializer authority
- expected upgrade authority
- migration cap raw units
- eligible raw units
- migration window
- expected `paused` and `totalMigrated` values for the reviewed post-init state
- verified-build metadata

## Validation Command

Run:

```bash
./scripts/run-mainnet-dry-run.sh release/mainnet-inputs.local.json
```

This validates:

- migration window ordering
- program account ownership, executability, and linkage to the derived `ProgramData` PDA
- migration cap equals reviewed eligible raw units
- derived config PDA
- derived vault authority PDA
- derived `ProgramData` PDA
- old mint policy
- current on-chain upgrade authority
- final mint policy
- local verified executable hash against the reviewed manifest
- reserve vault policy
- reserve sufficiency
- config PDA absence before init
- exact post-init config state if `expectConfigInitialized=true`, including `startTs`, `endTs`, `paused`, and `totalMigrated`
- optional funding signature success/finalization plus reserve-vault/mint touch when one is recorded in the manifest

## Phase Usage

Pre-init:

- set `expectConfigInitialized` to `false`
- require `initializerAuthority == expectedUpgradeAuthority`
- require the derived config PDA to still be absent

Post-init:

- set `expectConfigInitialized` to `true`
- the validator will also fetch and compare the exact config PDA contents

## Release Rule

Do not send the mainnet init transaction unless the dry-run validator returns
exit `0` on the exact reviewed manifest.

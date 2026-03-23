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
- at least one secondary RPC URL for quorum replay in the manifest itself
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

For release sign-off, replay the same reviewed manifest across at least two
independent RPCs:

```bash
./scripts/run-mainnet-dry-run-quorum.sh release/mainnet-inputs.local.json
```

Optional override:

```bash
DRY_RUN_RPC_URLS="https://rpc-2.example,https://rpc-3.example" \
./scripts/run-mainnet-dry-run-quorum.sh release/mainnet-inputs.local.json
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
- reviewed `build-info` record against the reviewed manifest and local artifact
- RPC identity against the canonical `mainnet-beta` genesis hash
- reserve vault policy
- reserve sufficiency
- config PDA absence before init
- exact post-init config state if `expectConfigInitialized=true`, including `startTs`, `endTs`, `paused`, and `totalMigrated`
- optional funding signature success/finalization plus reserve-vault/mint touch when one is recorded in the manifest

## Quorum Replay

For release sign-off, rerun the same reviewed manifest against at least one
second independent mainnet RPC:

```bash
DRY_RUN_RPC_URLS="https://rpc-2.example,https://rpc-3.example" \
./scripts/run-mainnet-dry-run-quorum.sh release/mainnet-inputs.local.json
```

Rules:

- the manifest `rpcUrl` is always used as the first provider
- the manifest `secondaryRpcUrls` list is part of the reviewed release record
- `DRY_RUN_RPC_URLS` is an optional override/addition for independent replay
- release sign-off requires all providers to return exit `0`

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

For final approval:

- require `run-mainnet-dry-run.sh` to pass on the primary reviewed RPC
- require `run-mainnet-dry-run-quorum.sh` to pass across at least two independent RPC providers
- treat any report mismatch as a release blocker until resolved

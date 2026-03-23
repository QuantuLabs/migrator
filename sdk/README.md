# SDK Surface

SDK and release-validation layer for **Migrator**, built by **Quantu Labs**.

Policy:

- no Anchor dependency in the frontend
- `Tokenkeg` only for V1
- the final destination mint must pass the pre-launch verification checklist

Provide a small manual TypeScript SDK with:

- PDA derivation helpers
- instruction builders
- config decoding
- release validators and proof generators

Implemented in:

- `sdk/src/index.ts`
- `sdk/src/verifyMint.ts`
- `sdk/src/verifyReserveVault.ts`
- `sdk/src/verifyConfig.ts`
- `sdk/src/verifyProgramAuthority.ts`
- `sdk/src/generateReserveProof.ts`
- `sdk/src/validateMainnetInputs.ts`
- `sdk/src/validateMainnetInputsQuorum.ts`

Expected functions:

```ts
findMigrationConfigPda(programId: PublicKey): [PublicKey, number]
findVaultAuthorityPda(programId: PublicKey): [PublicKey, number]
buildInitializeConfigIx(args, accounts): TransactionInstruction
buildSetPauseIx(args, accounts): TransactionInstruction
buildMigrateExactIx(args, accounts): TransactionInstruction
buildWithdrawUnclaimedIx(args, accounts): TransactionInstruction
decodeMigrationConfig(data: Buffer): MigrationConfig
```

`buildInitializeConfigIx` V1 specifics:

- `initializer` is the upgrade-authority signer and payer
- `fundingAuthority` is the dedicated reserve-funding signer
- `fundingNewTokenAccount` is the source SPL account that funds the reserve during init

The frontend should handle:

- ATA existence checks
- ATA creation
- transaction assembly
- explorer links
- verification UI

`withdraw_unclaimed` notes:

- it is permissionless to trigger after `end_ts`, unless `paused` is still set
- it always pays out to the canonical destination ATA for the configured refund recipient
- in V1 the refund recipient is set to `fundingAuthority` during `initialize_config`
- it sweeps the full reserve-vault balance after expiry, including any later surplus

Operational verification commands:

```bash
npm run verify-mint -- <DESTINATION_MINT> <EXPECTED_DECIMALS>
npm run verify-vault -- <PROGRAM_ID> <DESTINATION_MINT> <RESERVE_VAULT>
npm run verify-config -- <PROGRAM_ID> <SOURCE_MINT> <DESTINATION_MINT> <RESERVE_VAULT> <OPS_ADMIN> <MIGRATION_CAP_RAW> <START_TS> <END_TS> <PAUSED:true|false> <TOTAL_MIGRATED_RAW> <REFUND_RECIPIENT> <UNCLAIMED_WITHDRAWN:true|false>
npm run verify-program-authority -- <PROGRAM_ID> <EXPECTED_AUTHORITY|none>
npm run reserve-proof -- <PROGRAM_ID> <DESTINATION_MINT> <RESERVE_VAULT> <ELIGIBLE_RAW_UNITS> <EXPECTED_DECIMALS> [FUNDING_SIGNATURE]
npm run validate-mainnet-inputs -- <PATH_TO_MAINNET_INPUTS_JSON>
npm run validate-mainnet-inputs-quorum -- <PATH_TO_MAINNET_INPUTS_JSON>
```

All verification commands are hard gates:

- exit `0` only if every check passes
- exit nonzero on any mismatch so they can be used directly in CI and prelaunch checklists
- default to `SOLANA_COMMITMENT=finalized`
- include `rpcUrl`, `commitment`, and `slot` in their JSON output for reproducible audit artifacts

`validate-mainnet-inputs` also verifies:

- program-account ownership, executability, and linkage to the derived `ProgramData` PDA
- source-mint and destination-mint policy
- verified executable hash against the local `solana-verify` artifact path recorded in the manifest
- config PDA absence before init and exact config field matches after init, including `startTs`, `endTs`, `paused`, `totalMigrated`, `refundRecipient`, and `unclaimedWithdrawn`
- reserve sufficiency against the reviewed eligible raw-unit total
- optional funding-signature success/finalization plus proof that the signature touched the reviewed reserve vault and mint when one is recorded in the manifest

`validate-mainnet-inputs-quorum` is intended for the multi-RPC release lane:

- replay the same reviewed manifest across the full reviewed provider set
- take the primary RPC from the manifest and the remaining providers from `secondaryRpcUrls`, with optional `DRY_RUN_RPC_URLS` overrides in the wrapper or `SOLANA_RPC_URLS` when invoking the CLI directly
- accept only distinct normalized HTTPS providers
- require every resolved provider report to return `ok=true`
- require exact consensus across the full resolved provider set after stripping provider-local noise
- ignore provider-specific fields like `rpcUrl`, `slot`, and `generatedAt`
- persist `quorum-report.json` under `artifacts/dry-run/quorum-<timestamp>/` unless `DRY_RUN_REPORT_DIR` is set
- exit nonzero on any mismatch

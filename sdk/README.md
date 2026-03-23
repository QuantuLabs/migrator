# SDK Surface

The frontend should not depend on Anchor.

Policy:

- this SDK targets `Tokenkeg` only for V1
- it assumes the final `new QX` mint has already passed the pre-launch verification checklist

Provide a tiny manual TypeScript SDK with:

- PDA derivation helpers
- instruction builders
- config decoder

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
decodeMigrationConfig(data: Buffer): MigrationConfig
```

The frontend can then handle:

- ATA existence checks
- ATA creation
- transaction assembly
- explorer links
- verification UI

Operational verification commands:

```bash
npm run verify-mint -- <NEW_QX_MINT> <EXPECTED_DECIMALS>
npm run verify-vault -- <PROGRAM_ID> <NEW_QX_MINT> <RESERVE_VAULT>
npm run verify-config -- <PROGRAM_ID> <OLD_QX_MINT> <NEW_QX_MINT> <RESERVE_VAULT> <OPS_ADMIN> <MIGRATION_CAP_RAW> <START_TS> <END_TS> <PAUSED:true|false> <TOTAL_MIGRATED_RAW>
npm run verify-program-authority -- <PROGRAM_ID> <EXPECTED_AUTHORITY|none>
npm run reserve-proof -- <PROGRAM_ID> <NEW_QX_MINT> <RESERVE_VAULT> <ELIGIBLE_RAW_UNITS> <EXPECTED_DECIMALS> [FUNDING_SIGNATURE]
npm run validate-mainnet-inputs -- <PATH_TO_MAINNET_INPUTS_JSON>
npm run validate-mainnet-inputs-quorum -- <PATH_TO_MAINNET_INPUTS_JSON>
```

All verification commands are hard gates:

- exit `0` only if every check passes
- exit nonzero on any mismatch so they can be used directly in prelaunch checklists and CI
- default to `SOLANA_COMMITMENT=finalized`
- include `rpcUrl`, `commitment`, and `slot` in their JSON output for reproducible audit artifacts

`validate-mainnet-inputs` also verifies:

- program-account ownership, executability, and linkage to the derived `ProgramData` PDA
- old-mint policy as well as new-mint policy
- verified executable hash against the local `solana-verify` artifact path recorded in the manifest
- config PDA absence before init and exact config field matches after init, including `startTs`, `endTs`, `paused`, and `totalMigrated`
- reserve sufficiency against the reviewed eligible raw-unit total
- optional funding-signature success/finalization plus proof that the signature touched the reviewed reserve vault and mint when one is recorded in the manifest

`validate-mainnet-inputs-quorum` is intended for the multi-RPC quorum lane:

- replay the same reviewed manifest across the reviewed `2` or `3` provider set
- take the primary RPC from the manifest and the remaining providers from `secondaryRpcUrls`, with optional `DRY_RUN_RPC_URLS` overrides
- accept only distinct normalized HTTPS providers
- enforce `2-of-2 exact-match` or `2-of-3 exact-match with the primary provider included`
- enforce `DRY_RUN_MAX_SLOT_DRIFT` across the winning set, default `32`
- ignore provider-specific fields like `rpcUrl`, `slot`, and `generatedAt`
- persist `quorum.json`, `mismatches.json`, and per-provider reports under `artifacts/dry-run/<run-id>/` unless `DRY_RUN_REPORT_DIR` is set
- exit nonzero on any mismatch

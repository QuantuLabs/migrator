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
npm run verify-mint -- <NEW_QX_MINT> [EXPECTED_DECIMALS]
npm run verify-vault -- <PROGRAM_ID> <NEW_QX_MINT> <RESERVE_VAULT>
npm run verify-config -- <PROGRAM_ID> <OLD_QX_MINT> <NEW_QX_MINT> <RESERVE_VAULT> <OPS_ADMIN> <MIGRATION_CAP_RAW>
npm run verify-program-authority -- <PROGRAM_ID> [EXPECTED_AUTHORITY|none]
npm run reserve-proof -- <PROGRAM_ID> <NEW_QX_MINT> <RESERVE_VAULT> <ELIGIBLE_RAW_UNITS> <EXPECTED_DECIMALS> [FUNDING_SIGNATURE]
```

All verification commands are hard gates:

- exit `0` only if every check passes
- exit nonzero on any mismatch so they can be used directly in prelaunch checklists and CI
- default to `SOLANA_COMMITMENT=finalized`
- include `rpcUrl`, `commitment`, and `slot` in their JSON output for reproducible audit artifacts

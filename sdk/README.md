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

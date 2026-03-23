import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";

export const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);
export const BPF_LOADER_UPGRADEABLE_PROGRAM_ID = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111",
);

export const MIGRATION_CONFIG_SEED = Buffer.from("migration-config");
export const VAULT_AUTHORITY_SEED = Buffer.from("vault-authority");

export const MIGRATION_CONFIG_DISCRIMINATOR = Buffer.from("migrtr01", "ascii");
export const MIGRATION_CONFIG_SIZE = 296;
export const MIGRATION_CONFIG_VERSION = 2;

export type MigrationConfig = {
  version: number;
  bump: number;
  vaultAuthorityBump: number;
  paused: boolean;
  admin: PublicKey;
  sourceMint: PublicKey;
  destinationMint: PublicKey;
  tokenProgramId: PublicKey;
  vaultAuthority: PublicKey;
  reserveVault: PublicKey;
  totalMigrated: bigint;
  migrationCap: bigint;
  refundRecipient: PublicKey;
  unclaimedWithdrawn: boolean;
  startTs: bigint;
  endTs: bigint;
};

export function findMigrationConfigPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([MIGRATION_CONFIG_SEED], programId);
}

export function findVaultAuthorityPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([VAULT_AUTHORITY_SEED], programId);
}

export function findAssociatedTokenAddress(
  owner: PublicKey,
  mint: PublicKey,
  tokenProgramId: PublicKey = TOKEN_PROGRAM_ID,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), tokenProgramId.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0];
}

export function findProgramDataPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([programId.toBuffer()], BPF_LOADER_UPGRADEABLE_PROGRAM_ID);
}

export function encodeInitializeConfigData(
  startTs: bigint,
  endTs: bigint,
  migrationCap: bigint,
): Buffer {
  const data = Buffer.alloc(1 + 8 + 8 + 8);
  data[0] = 0;
  data.writeBigInt64LE(startTs, 1);
  data.writeBigInt64LE(endTs, 9);
  data.writeBigUInt64LE(migrationCap, 17);
  return data;
}

export function encodeSetPauseData(paused: boolean): Buffer {
  return Buffer.from([1, paused ? 1 : 0]);
}

export function encodeMigrateExactData(amountIn: bigint): Buffer {
  const data = Buffer.alloc(1 + 8);
  data[0] = 2;
  data.writeBigUInt64LE(amountIn, 1);
  return data;
}

export function encodeWithdrawUnclaimedData(): Buffer {
  return Buffer.from([3]);
}

export function buildInitializeConfigIx(params: {
  programId: PublicKey;
  initializer: PublicKey;
  opsAdmin: PublicKey;
  fundingAuthority: PublicKey;
  fundingNewTokenAccount: PublicKey;
  config: PublicKey;
  vaultAuthority: PublicKey;
  reserveVault: PublicKey;
  sourceMint: PublicKey;
  destinationMint: PublicKey;
  programData: PublicKey;
  startTs: bigint;
  endTs: bigint;
  migrationCap: bigint;
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: params.programId,
    keys: [
      { pubkey: params.initializer, isSigner: true, isWritable: true },
      { pubkey: params.opsAdmin, isSigner: true, isWritable: false },
      { pubkey: params.fundingAuthority, isSigner: true, isWritable: false },
      { pubkey: params.fundingNewTokenAccount, isSigner: false, isWritable: true },
      { pubkey: params.config, isSigner: false, isWritable: true },
      { pubkey: params.vaultAuthority, isSigner: false, isWritable: false },
      { pubkey: params.reserveVault, isSigner: false, isWritable: true },
      { pubkey: params.sourceMint, isSigner: false, isWritable: false },
      { pubkey: params.destinationMint, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: params.programData, isSigner: false, isWritable: false },
    ],
    data: encodeInitializeConfigData(params.startTs, params.endTs, params.migrationCap),
  });
}

export function buildSetPauseIx(params: {
  programId: PublicKey;
  admin: PublicKey;
  config: PublicKey;
  paused: boolean;
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: params.programId,
    keys: [
      { pubkey: params.admin, isSigner: true, isWritable: false },
      { pubkey: params.config, isSigner: false, isWritable: true },
    ],
    data: encodeSetPauseData(params.paused),
  });
}

export function buildMigrateExactIx(params: {
  programId: PublicKey;
  user: PublicKey;
  config: PublicKey;
  vaultAuthority: PublicKey;
  reserveVault: PublicKey;
  userOldQx: PublicKey;
  userNewQx: PublicKey;
  sourceMint: PublicKey;
  destinationMint: PublicKey;
  amountIn: bigint;
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: params.programId,
    keys: [
      { pubkey: params.user, isSigner: true, isWritable: false },
      { pubkey: params.config, isSigner: false, isWritable: true },
      { pubkey: params.vaultAuthority, isSigner: false, isWritable: false },
      { pubkey: params.reserveVault, isSigner: false, isWritable: true },
      { pubkey: params.userOldQx, isSigner: false, isWritable: true },
      { pubkey: params.userNewQx, isSigner: false, isWritable: true },
      { pubkey: params.sourceMint, isSigner: false, isWritable: true },
      { pubkey: params.destinationMint, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: encodeMigrateExactData(params.amountIn),
  });
}

export function buildWithdrawUnclaimedIx(params: {
  programId: PublicKey;
  config: PublicKey;
  vaultAuthority: PublicKey;
  reserveVault: PublicKey;
  refundRecipientNewQx: PublicKey;
  destinationMint: PublicKey;
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: params.programId,
    keys: [
      { pubkey: params.config, isSigner: false, isWritable: true },
      { pubkey: params.vaultAuthority, isSigner: false, isWritable: false },
      { pubkey: params.reserveVault, isSigner: false, isWritable: true },
      { pubkey: params.refundRecipientNewQx, isSigner: false, isWritable: true },
      { pubkey: params.destinationMint, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: encodeWithdrawUnclaimedData(),
  });
}

export function decodeMigrationConfig(data: Buffer): MigrationConfig {
  if (data.length !== MIGRATION_CONFIG_SIZE) {
    throw new Error(`MigrationConfig must be exactly ${MIGRATION_CONFIG_SIZE} bytes, got ${data.length}`);
  }
  if (!data.subarray(0, 8).equals(MIGRATION_CONFIG_DISCRIMINATOR)) {
    throw new Error("Invalid MigrationConfig discriminator");
  }
  if (data[8] !== MIGRATION_CONFIG_VERSION) {
    throw new Error(`Unsupported MigrationConfig version: expected ${MIGRATION_CONFIG_VERSION}, got ${data[8]}`);
  }

  return {
    version: data[8],
    bump: data[9],
    vaultAuthorityBump: data[10],
    paused: data[11] !== 0,
    admin: new PublicKey(data.subarray(12, 44)),
    sourceMint: new PublicKey(data.subarray(44, 76)),
    destinationMint: new PublicKey(data.subarray(76, 108)),
    tokenProgramId: new PublicKey(data.subarray(108, 140)),
    vaultAuthority: new PublicKey(data.subarray(140, 172)),
    reserveVault: new PublicKey(data.subarray(172, 204)),
    totalMigrated: data.readBigUInt64LE(208),
    migrationCap: data.readBigUInt64LE(232),
    refundRecipient: new PublicKey(data.subarray(240, 272)),
    unclaimedWithdrawn: data[272] !== 0,
    startTs: data.readBigInt64LE(216),
    endTs: data.readBigInt64LE(224),
  };
}

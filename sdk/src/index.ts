import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";

export const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const BPF_LOADER_UPGRADEABLE_PROGRAM_ID = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111",
);

export const MIGRATION_CONFIG_SEED = Buffer.from("migration-config");
export const VAULT_AUTHORITY_SEED = Buffer.from("vault-authority");

export const MIGRATION_CONFIG_DISCRIMINATOR = Buffer.from("qxmigr01", "ascii");
export const MIGRATION_CONFIG_SIZE = 296;
export const MIGRATION_CONFIG_VERSION = 1;

export type MigrationConfig = {
  version: number;
  bump: number;
  vaultAuthorityBump: number;
  paused: boolean;
  admin: PublicKey;
  oldQxMint: PublicKey;
  newQxMint: PublicKey;
  tokenProgramId: PublicKey;
  vaultAuthority: PublicKey;
  vaultNewQx: PublicKey;
  totalMigrated: bigint;
  startTs: bigint;
  endTs: bigint;
};

export function findMigrationConfigPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([MIGRATION_CONFIG_SEED], programId);
}

export function findVaultAuthorityPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([VAULT_AUTHORITY_SEED], programId);
}

export function findProgramDataPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([programId.toBuffer()], BPF_LOADER_UPGRADEABLE_PROGRAM_ID);
}

export function encodeInitializeConfigData(startTs: bigint, endTs: bigint): Buffer {
  const data = Buffer.alloc(1 + 8 + 8);
  data[0] = 0;
  data.writeBigInt64LE(startTs, 1);
  data.writeBigInt64LE(endTs, 9);
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

export function buildInitializeConfigIx(params: {
  programId: PublicKey;
  initializer: PublicKey;
  opsAdmin: PublicKey;
  config: PublicKey;
  vaultAuthority: PublicKey;
  vaultNewQx: PublicKey;
  oldQxMint: PublicKey;
  newQxMint: PublicKey;
  programData: PublicKey;
  startTs: bigint;
  endTs: bigint;
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: params.programId,
    keys: [
      { pubkey: params.initializer, isSigner: true, isWritable: true },
      { pubkey: params.opsAdmin, isSigner: true, isWritable: false },
      { pubkey: params.config, isSigner: false, isWritable: true },
      { pubkey: params.vaultAuthority, isSigner: false, isWritable: false },
      { pubkey: params.vaultNewQx, isSigner: false, isWritable: false },
      { pubkey: params.oldQxMint, isSigner: false, isWritable: false },
      { pubkey: params.newQxMint, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: params.programData, isSigner: false, isWritable: false },
    ],
    data: encodeInitializeConfigData(params.startTs, params.endTs),
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
  vaultNewQx: PublicKey;
  userOldQx: PublicKey;
  userNewQx: PublicKey;
  oldQxMint: PublicKey;
  newQxMint: PublicKey;
  amountIn: bigint;
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: params.programId,
    keys: [
      { pubkey: params.user, isSigner: true, isWritable: false },
      { pubkey: params.config, isSigner: false, isWritable: true },
      { pubkey: params.vaultAuthority, isSigner: false, isWritable: false },
      { pubkey: params.vaultNewQx, isSigner: false, isWritable: true },
      { pubkey: params.userOldQx, isSigner: false, isWritable: true },
      { pubkey: params.userNewQx, isSigner: false, isWritable: true },
      { pubkey: params.oldQxMint, isSigner: false, isWritable: true },
      { pubkey: params.newQxMint, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: encodeMigrateExactData(params.amountIn),
  });
}

export function decodeMigrationConfig(data: Buffer): MigrationConfig {
  if (data.length < MIGRATION_CONFIG_SIZE) {
    throw new Error(`MigrationConfig too small: expected at least ${MIGRATION_CONFIG_SIZE} bytes`);
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
    oldQxMint: new PublicKey(data.subarray(44, 76)),
    newQxMint: new PublicKey(data.subarray(76, 108)),
    tokenProgramId: new PublicKey(data.subarray(108, 140)),
    vaultAuthority: new PublicKey(data.subarray(140, 172)),
    vaultNewQx: new PublicKey(data.subarray(172, 204)),
    totalMigrated: data.readBigUInt64LE(208),
    startTs: data.readBigInt64LE(216),
    endTs: data.readBigInt64LE(224),
  };
}

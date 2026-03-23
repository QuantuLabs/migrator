import type { AccountInfo, Commitment } from "@solana/web3.js";
import { Connection, PublicKey } from "@solana/web3.js";

import {
  MIGRATION_CONFIG_SIZE,
  TOKEN_PROGRAM_ID,
  decodeMigrationConfig,
  findMigrationConfigPda,
  findVaultAuthorityPda,
} from "./index.ts";
import { resolveCommitment, runCliMain } from "./releaseUtils.ts";

export type ConfigReport = {
  rpcUrl: string;
  commitment: Commitment;
  slot: number;
  programId: string;
  configPda: string;
  expectedVaultAuthority: string;
  expectedOldMint: string;
  expectedNewMint: string;
  expectedReserveVault: string;
  expectedOpsAdmin: string;
  expectedMigrationCap: string;
  expectedStartTs: string;
  expectedEndTs: string;
  expectedPaused: boolean;
  expectedTotalMigrated: string;
  config: {
    version: number;
    bump: number;
    vaultAuthorityBump: number;
    paused: boolean;
    admin: string;
    oldQxMint: string;
    newQxMint: string;
    tokenProgramId: string;
    vaultAuthority: string;
    vaultNewQx: string;
    totalMigrated: string;
    migrationCap: string;
    startTs: string;
    endTs: string;
  };
  checks: {
    configOwnedByProgram: boolean;
    oldMintMatches: boolean;
    newMintMatches: boolean;
    tokenProgramMatches: boolean;
    adminMatches: boolean;
    vaultAuthorityMatches: boolean;
    reserveVaultMatches: boolean;
    configBumpMatches: boolean;
    vaultAuthorityBumpMatches: boolean;
    migrationCapMatches: boolean;
    startTsMatches: boolean;
    endTsMatches: boolean;
    pausedMatches: boolean;
    totalMigratedMatches: boolean;
  };
  ok: boolean;
};

function parsePausedArg(pausedArg: string): boolean {
  if (pausedArg === "true") {
    return true;
  }
  if (pausedArg === "false") {
    return false;
  }
  throw new Error(`Invalid paused flag: ${pausedArg}`);
}

export function buildConfigReport(params: {
  rpcUrl: string;
  commitment: Commitment;
  slot: number;
  programId: PublicKey;
  configPda: PublicKey;
  vaultAuthority: PublicKey;
  configBump: number;
  vaultAuthorityBump: number;
  oldMint: PublicKey;
  newMint: PublicKey;
  reserveVault: PublicKey;
  opsAdmin: PublicKey;
  migrationCap: bigint;
  startTs: bigint;
  endTs: bigint;
  paused: boolean;
  totalMigrated: bigint;
  info: AccountInfo<Buffer>;
}): ConfigReport {
  if (params.info.data.length !== MIGRATION_CONFIG_SIZE) {
    throw new Error(
      `Invalid config account length: expected ${MIGRATION_CONFIG_SIZE}, got ${params.info.data.length}`,
    );
  }

  const config = decodeMigrationConfig(params.info.data);
  const checks = {
    configOwnedByProgram: params.info.owner.equals(params.programId),
    oldMintMatches: config.oldQxMint.equals(params.oldMint),
    newMintMatches: config.newQxMint.equals(params.newMint),
    tokenProgramMatches: config.tokenProgramId.equals(TOKEN_PROGRAM_ID),
    adminMatches: config.admin.equals(params.opsAdmin),
    vaultAuthorityMatches: config.vaultAuthority.equals(params.vaultAuthority),
    reserveVaultMatches: config.vaultNewQx.equals(params.reserveVault),
    configBumpMatches: config.bump === params.configBump,
    vaultAuthorityBumpMatches: config.vaultAuthorityBump === params.vaultAuthorityBump,
    migrationCapMatches: config.migrationCap === params.migrationCap,
    startTsMatches: config.startTs === params.startTs,
    endTsMatches: config.endTs === params.endTs,
    pausedMatches: config.paused === params.paused,
    totalMigratedMatches: config.totalMigrated === params.totalMigrated,
  };
  const ok = Object.values(checks).every(Boolean);

  return {
    rpcUrl: params.rpcUrl,
    commitment: params.commitment,
    slot: params.slot,
    programId: params.programId.toBase58(),
    configPda: params.configPda.toBase58(),
    expectedVaultAuthority: params.vaultAuthority.toBase58(),
    expectedOldMint: params.oldMint.toBase58(),
    expectedNewMint: params.newMint.toBase58(),
    expectedReserveVault: params.reserveVault.toBase58(),
    expectedOpsAdmin: params.opsAdmin.toBase58(),
    expectedMigrationCap: params.migrationCap.toString(),
    expectedStartTs: params.startTs.toString(),
    expectedEndTs: params.endTs.toString(),
    expectedPaused: params.paused,
    expectedTotalMigrated: params.totalMigrated.toString(),
    config: {
      version: config.version,
      bump: config.bump,
      vaultAuthorityBump: config.vaultAuthorityBump,
      paused: config.paused,
      admin: config.admin.toBase58(),
      oldQxMint: config.oldQxMint.toBase58(),
      newQxMint: config.newQxMint.toBase58(),
      tokenProgramId: config.tokenProgramId.toBase58(),
      vaultAuthority: config.vaultAuthority.toBase58(),
      vaultNewQx: config.vaultNewQx.toBase58(),
      totalMigrated: config.totalMigrated.toString(),
      migrationCap: config.migrationCap.toString(),
      startTs: config.startTs.toString(),
      endTs: config.endTs.toString(),
    },
    checks,
    ok,
  };
}

export async function verifyConfig(params: {
  connection: Connection;
  commitment: Commitment;
  programId: PublicKey;
  oldMint: PublicKey;
  newMint: PublicKey;
  reserveVault: PublicKey;
  opsAdmin: PublicKey;
  migrationCap: bigint;
  startTs: bigint;
  endTs: bigint;
  paused: boolean;
  totalMigrated: bigint;
}): Promise<ConfigReport> {
  const [configPda, configBump] = findMigrationConfigPda(params.programId);
  const [vaultAuthority, vaultAuthorityBump] = findVaultAuthorityPda(params.programId);
  const { context, value: info } = await params.connection.getAccountInfoAndContext(
    configPda,
    params.commitment,
  );
  if (!info) {
    throw new Error(`Migration config not found at derived PDA: ${configPda.toBase58()}`);
  }

  return buildConfigReport({
    rpcUrl: params.connection.rpcEndpoint,
    commitment: params.commitment,
    slot: context.slot,
    programId: params.programId,
    configPda,
    vaultAuthority,
    configBump,
    vaultAuthorityBump,
    oldMint: params.oldMint,
    newMint: params.newMint,
    reserveVault: params.reserveVault,
    opsAdmin: params.opsAdmin,
    migrationCap: params.migrationCap,
    startTs: params.startTs,
    endTs: params.endTs,
    paused: params.paused,
    totalMigrated: params.totalMigrated,
    info,
  });
}

export async function main() {
  const programIdArg = process.argv[2];
  const oldMintArg = process.argv[3];
  const newMintArg = process.argv[4];
  const reserveVaultArg = process.argv[5];
  const opsAdminArg = process.argv[6];
  const migrationCapArg = process.argv[7];
  const startTsArg = process.argv[8];
  const endTsArg = process.argv[9];
  const pausedArg = process.argv[10];
  const totalMigratedArg = process.argv[11];
  const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
  const commitment = resolveCommitment();

  if (
    !programIdArg ||
    !oldMintArg ||
    !newMintArg ||
    !reserveVaultArg ||
    !opsAdminArg ||
    !migrationCapArg ||
    startTsArg === undefined ||
    endTsArg === undefined ||
    pausedArg === undefined ||
    totalMigratedArg === undefined
  ) {
    throw new Error(
      "Usage: node src/verifyConfig.ts <PROGRAM_ID> <OLD_QX_MINT> <NEW_QX_MINT> <RESERVE_VAULT> <OPS_ADMIN> <MIGRATION_CAP_RAW> <START_TS> <END_TS> <PAUSED:true|false> <TOTAL_MIGRATED_RAW>",
    );
  }

  const report = await verifyConfig({
    connection: new Connection(rpcUrl, commitment),
    commitment,
    programId: new PublicKey(programIdArg),
    oldMint: new PublicKey(oldMintArg),
    newMint: new PublicKey(newMintArg),
    reserveVault: new PublicKey(reserveVaultArg),
    opsAdmin: new PublicKey(opsAdminArg),
    migrationCap: BigInt(migrationCapArg),
    startTs: BigInt(startTsArg),
    endTs: BigInt(endTsArg),
    paused: parsePausedArg(pausedArg),
    totalMigrated: BigInt(totalMigratedArg),
  });

  console.log(JSON.stringify(report, null, 2));

  if (!report.ok) {
    process.exit(1);
  }
}

void runCliMain(import.meta.url, main);

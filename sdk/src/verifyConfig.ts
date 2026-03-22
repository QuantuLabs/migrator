import { Commitment, Connection, PublicKey } from "@solana/web3.js";

import {
  MIGRATION_CONFIG_SIZE,
  TOKEN_PROGRAM_ID,
  decodeMigrationConfig,
  findMigrationConfigPda,
  findVaultAuthorityPda,
} from "./index.ts";

function resolveCommitment(): Commitment {
  const commitment = (process.env.SOLANA_COMMITMENT || "finalized") as Commitment;
  if (!["processed", "confirmed", "finalized"].includes(commitment)) {
    throw new Error(`Invalid SOLANA_COMMITMENT: ${commitment}`);
  }
  return commitment;
}

async function main() {
  const programIdArg = process.argv[2];
  const oldMintArg = process.argv[3];
  const newMintArg = process.argv[4];
  const reserveVaultArg = process.argv[5];
  const opsAdminArg = process.argv[6];
  const migrationCapArg = process.argv[7];
  const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
  const commitment = resolveCommitment();

  if (!programIdArg || !oldMintArg || !newMintArg || !reserveVaultArg || !opsAdminArg || !migrationCapArg) {
    throw new Error(
      "Usage: node src/verifyConfig.ts <PROGRAM_ID> <OLD_QX_MINT> <NEW_QX_MINT> <RESERVE_VAULT> <OPS_ADMIN> <MIGRATION_CAP_RAW>",
    );
  }

  const connection = new Connection(rpcUrl, commitment);
  const programId = new PublicKey(programIdArg);
  const oldMint = new PublicKey(oldMintArg);
  const newMint = new PublicKey(newMintArg);
  const reserveVault = new PublicKey(reserveVaultArg);
  const opsAdmin = new PublicKey(opsAdminArg);
  const migrationCap = BigInt(migrationCapArg);
  const [configPda, configBump] = findMigrationConfigPda(programId);
  const [vaultAuthority, vaultAuthorityBump] = findVaultAuthorityPda(programId);

  const slot = await connection.getSlot(commitment);
  const info = await connection.getAccountInfo(configPda, commitment);
  if (!info) {
    throw new Error(`Migration config not found at derived PDA: ${configPda.toBase58()}`);
  }

  if (info.data.length !== MIGRATION_CONFIG_SIZE) {
    throw new Error(
      `Invalid config account length: expected ${MIGRATION_CONFIG_SIZE}, got ${info.data.length}`,
    );
  }

  const config = decodeMigrationConfig(info.data);
  const checks = {
    configOwnedByProgram: info.owner.equals(programId),
    oldMintMatches: config.oldQxMint.equals(oldMint),
    newMintMatches: config.newQxMint.equals(newMint),
    tokenProgramMatches: config.tokenProgramId.equals(TOKEN_PROGRAM_ID),
    adminMatches: config.admin.equals(opsAdmin),
    vaultAuthorityMatches: config.vaultAuthority.equals(vaultAuthority),
    reserveVaultMatches: config.vaultNewQx.equals(reserveVault),
    configBumpMatches: config.bump === configBump,
    vaultAuthorityBumpMatches: config.vaultAuthorityBump === vaultAuthorityBump,
    migrationCapMatches: config.migrationCap === migrationCap,
  };
  const ok = Object.values(checks).every(Boolean);

  console.log(
    JSON.stringify(
      {
        rpcUrl,
        commitment,
        slot,
        programId: programId.toBase58(),
        configPda: configPda.toBase58(),
        expectedVaultAuthority: vaultAuthority.toBase58(),
        expectedOldMint: oldMint.toBase58(),
        expectedNewMint: newMint.toBase58(),
        expectedReserveVault: reserveVault.toBase58(),
        expectedOpsAdmin: opsAdmin.toBase58(),
        expectedMigrationCap: migrationCap.toString(),
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
      },
      null,
      2,
    ),
  );

  if (!ok) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

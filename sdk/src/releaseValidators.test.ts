import assert from "node:assert/strict";
import test from "node:test";

import type { AccountInfo } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";

import {
  BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
  MIGRATION_CONFIG_DISCRIMINATOR,
  MIGRATION_CONFIG_SIZE,
  TOKEN_PROGRAM_ID,
} from "./index.ts";
import { buildConfigReport } from "./verifyConfig.ts";
import { buildProgramAuthorityReport } from "./verifyProgramAuthority.ts";
import { buildReserveVaultReport } from "./verifyReserveVault.ts";

function pk(fill: number): PublicKey {
  return new PublicKey(new Uint8Array(32).fill(fill));
}

function makeProgramData(authority: PublicKey | null): Buffer {
  const data = Buffer.alloc(45);
  data.writeUInt32LE(3, 0);
  data[12] = authority ? 1 : 0;
  if (authority) {
    authority.toBuffer().copy(data, 13);
  }
  return data;
}

function makeProgramAccount(programDataAddress: PublicKey): Buffer {
  const data = Buffer.alloc(36);
  data.writeUInt32LE(2, 0);
  programDataAddress.toBuffer().copy(data, 4);
  return data;
}

function makeTokenAccountData(mint: PublicKey, owner: PublicKey, amount: bigint): Buffer {
  const data = Buffer.alloc(165);
  mint.toBuffer().copy(data, 0);
  owner.toBuffer().copy(data, 32);
  data.writeBigUInt64LE(amount, 64);
  data.writeUInt32LE(0, 72);
  data[108] = 1;
  data.writeBigUInt64LE(0n, 121);
  data.writeUInt32LE(0, 129);
  return data;
}

function makeConfigData(params: {
  bump: number;
  vaultAuthorityBump: number;
  paused: boolean;
  admin: PublicKey;
  oldMint: PublicKey;
  newMint: PublicKey;
  vaultAuthority: PublicKey;
  reserveVault: PublicKey;
  totalMigrated: bigint;
  migrationCap: bigint;
  startTs: bigint;
  endTs: bigint;
}): Buffer {
  const data = Buffer.alloc(MIGRATION_CONFIG_SIZE);
  MIGRATION_CONFIG_DISCRIMINATOR.copy(data, 0);
  data[8] = 1;
  data[9] = params.bump;
  data[10] = params.vaultAuthorityBump;
  data[11] = params.paused ? 1 : 0;
  params.admin.toBuffer().copy(data, 12);
  params.oldMint.toBuffer().copy(data, 44);
  params.newMint.toBuffer().copy(data, 76);
  TOKEN_PROGRAM_ID.toBuffer().copy(data, 108);
  params.vaultAuthority.toBuffer().copy(data, 140);
  params.reserveVault.toBuffer().copy(data, 172);
  data.writeBigUInt64LE(params.totalMigrated, 208);
  data.writeBigInt64LE(params.startTs, 216);
  data.writeBigInt64LE(params.endTs, 224);
  data.writeBigUInt64LE(params.migrationCap, 232);
  return data;
}

function makeInfo(owner: PublicKey, data: Buffer, executable = false): AccountInfo<Buffer> {
  return {
    data,
    executable,
    lamports: 1_000_000,
    owner,
    rentEpoch: 0,
  };
}

test("buildProgramAuthorityReport rejects mismatched expected authority", () => {
  const programId = pk(1);
  const programDataPda = pk(2);
  const actualAuthority = pk(3);
  const expectedAuthority = pk(4);

  const report = buildProgramAuthorityReport({
    rpcUrl: "https://example.invalid",
    commitment: "finalized",
    slot: 123,
    programId,
    programDataPda,
    programInfo: makeInfo(
      BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
      makeProgramAccount(programDataPda),
      true,
    ),
    programDataInfo: makeInfo(
      BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
      makeProgramData(actualAuthority),
    ),
    expectedAuthority: expectedAuthority.toBase58(),
  });

  assert.equal(report.ok, false);
  assert.equal(report.checks.expectedAuthorityMatches, false);
  assert.equal(report.checks.ownedByUpgradeableLoader, true);
  assert.equal(report.checks.programProgramDataMatchesDerived, true);
});

test("buildReserveVaultReport rejects vaults owned by the wrong authority", () => {
  const programId = pk(5);
  const newMint = pk(6);
  const reserveVault = pk(7);
  const expectedVaultAuthority = pk(8);
  const wrongVaultAuthority = pk(9);

  const report = buildReserveVaultReport({
    rpcUrl: "https://example.invalid",
    commitment: "finalized",
    slot: 456,
    programId,
    newMint,
    reserveVault,
    vaultAuthority: expectedVaultAuthority,
    info: makeInfo(TOKEN_PROGRAM_ID, makeTokenAccountData(newMint, wrongVaultAuthority, 500n)),
  });

  assert.equal(report.ok, false);
  assert.equal(report.checks.reserveVaultOwnerMatchesPda, false);
  assert.equal(report.checks.reserveVaultMintMatches, true);
});

test("buildConfigReport accepts an exact config match", () => {
  const programId = pk(10);
  const configPda = pk(11);
  const oldMint = pk(12);
  const newMint = pk(13);
  const reserveVault = pk(14);
  const opsAdmin = pk(15);
  const vaultAuthority = pk(16);

  const report = buildConfigReport({
    rpcUrl: "https://example.invalid",
    commitment: "finalized",
    slot: 789,
    programId,
    configPda,
    vaultAuthority,
    configBump: 254,
    vaultAuthorityBump: 253,
    oldMint,
    newMint,
    reserveVault,
    opsAdmin,
    migrationCap: 1_000n,
    startTs: 100n,
    endTs: 200n,
    paused: false,
    totalMigrated: 25n,
    info: makeInfo(
      programId,
      makeConfigData({
        bump: 254,
        vaultAuthorityBump: 253,
        paused: false,
        admin: opsAdmin,
        oldMint,
        newMint,
        vaultAuthority,
        reserveVault,
        totalMigrated: 25n,
        migrationCap: 1_000n,
        startTs: 100n,
        endTs: 200n,
      }),
    ),
  });

  assert.equal(report.ok, true);
  assert.equal(report.checks.configOwnedByProgram, true);
  assert.equal(report.checks.migrationCapMatches, true);
});

test("buildConfigReport rejects mismatched reserve vault", () => {
  const programId = pk(17);
  const configPda = pk(18);
  const oldMint = pk(19);
  const newMint = pk(20);
  const reserveVault = pk(21);
  const wrongReserveVault = pk(22);
  const opsAdmin = pk(23);
  const vaultAuthority = pk(24);

  const report = buildConfigReport({
    rpcUrl: "https://example.invalid",
    commitment: "finalized",
    slot: 790,
    programId,
    configPda,
    vaultAuthority,
    configBump: 1,
    vaultAuthorityBump: 2,
    oldMint,
    newMint,
    reserveVault,
    opsAdmin,
    migrationCap: 500n,
    startTs: 10n,
    endTs: 20n,
    paused: true,
    totalMigrated: 3n,
    info: makeInfo(
      programId,
      makeConfigData({
        bump: 1,
        vaultAuthorityBump: 2,
        paused: true,
        admin: opsAdmin,
        oldMint,
        newMint,
        vaultAuthority,
        reserveVault: wrongReserveVault,
        totalMigrated: 3n,
        migrationCap: 500n,
        startTs: 10n,
        endTs: 20n,
      }),
    ),
  });

  assert.equal(report.ok, false);
  assert.equal(report.checks.reserveVaultMatches, false);
});

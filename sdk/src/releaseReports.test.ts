import assert from "node:assert/strict";
import test from "node:test";

import type { AccountInfo } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";

import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
  MIGRATION_CONFIG_DISCRIMINATOR,
  MIGRATION_CONFIG_SIZE,
  MIGRATION_CONFIG_VERSION,
  TOKEN_PROGRAM_ID,
  findAssociatedTokenAddress,
  findProgramDataPda,
  findVaultAuthorityPda,
} from "./index.ts";
import { buildReserveProofReport } from "./generateReserveProof.ts";
import {
  MAINNET_BETA_GENESIS_HASH,
  MINT_LEN,
  NATIVE_MINT_BASE58,
  PROGRAMDATA_DISCRIMINATOR,
  TOKEN_ACCOUNT_LEN,
} from "./releaseUtils.ts";
import { buildMintReport } from "./verifyMint.ts";
import { buildProgramAuthorityReport } from "./verifyProgramAuthority.ts";
import { buildReserveVaultReport } from "./verifyReserveVault.ts";
import { buildMainnetChecks } from "./validateMainnetInputs.ts";
import { buildConfigReport } from "./verifyConfig.ts";

function key(fill: number): PublicKey {
  return new PublicKey(new Uint8Array(32).fill(fill));
}

function accountInfo(data: Buffer, owner: PublicKey, executable = false): AccountInfo<Buffer> {
  return {
    data,
    owner,
    executable,
    lamports: 1_000_000,
    rentEpoch: 0,
  };
}

function mintData(params: {
  supply?: bigint;
  decimals?: number;
  mintAuthorityOption?: number;
  freezeAuthorityOption?: number;
  initialized?: boolean;
} = {}): Buffer {
  const data = Buffer.alloc(MINT_LEN);
  data.writeUInt32LE(params.mintAuthorityOption ?? 0, 0);
  data.writeBigUInt64LE(params.supply ?? 0n, 36);
  data[44] = params.decimals ?? 9;
  data[45] = params.initialized === false ? 0 : 1;
  data.writeUInt32LE(params.freezeAuthorityOption ?? 0, 46);
  return data;
}

function tokenAccountData(params: {
  mint: PublicKey;
  owner: PublicKey;
  amount?: bigint;
  delegateOption?: number;
  state?: number;
  isNativeOption?: number;
  delegatedAmount?: bigint;
  closeAuthorityOption?: number;
}): Buffer {
  const data = Buffer.alloc(TOKEN_ACCOUNT_LEN);
  params.mint.toBuffer().copy(data, 0);
  params.owner.toBuffer().copy(data, 32);
  data.writeBigUInt64LE(params.amount ?? 0n, 64);
  data.writeUInt32LE(params.delegateOption ?? 0, 72);
  data[108] = params.state ?? 1;
  data.writeUInt32LE(params.isNativeOption ?? 0, 109);
  data.writeBigUInt64LE(params.delegatedAmount ?? 0n, 121);
  data.writeUInt32LE(params.closeAuthorityOption ?? 0, 129);
  return data;
}

function programAccountData(programDataAddress: PublicKey, discriminator = 2): Buffer {
  const data = Buffer.alloc(36);
  data.writeUInt32LE(discriminator, 0);
  programDataAddress.toBuffer().copy(data, 4);
  return data;
}

function programData(authority: PublicKey | null): Buffer {
  const data = Buffer.alloc(45);
  data.writeUInt32LE(PROGRAMDATA_DISCRIMINATOR, 0);
  data[12] = authority === null ? 0 : 1;
  if (authority) {
    authority.toBuffer().copy(data, 13);
  }
  return data;
}

function migrationConfigData(params: {
  bump: number;
  vaultAuthorityBump: number;
  admin: PublicKey;
  oldMint: PublicKey;
  newMint: PublicKey;
  vaultAuthority: PublicKey;
  reserveVault: PublicKey;
  totalMigrated?: bigint;
  migrationCap?: bigint;
  startTs?: bigint;
  endTs?: bigint;
  paused?: boolean;
  refundRecipient?: PublicKey;
  unclaimedWithdrawn?: boolean;
}): Buffer {
  const data = Buffer.alloc(MIGRATION_CONFIG_SIZE);
  MIGRATION_CONFIG_DISCRIMINATOR.copy(data, 0);
  data[8] = MIGRATION_CONFIG_VERSION;
  data[9] = params.bump;
  data[10] = params.vaultAuthorityBump;
  data[11] = params.paused ? 1 : 0;
  params.admin.toBuffer().copy(data, 12);
  params.oldMint.toBuffer().copy(data, 44);
  params.newMint.toBuffer().copy(data, 76);
  TOKEN_PROGRAM_ID.toBuffer().copy(data, 108);
  params.vaultAuthority.toBuffer().copy(data, 140);
  params.reserveVault.toBuffer().copy(data, 172);
  data.writeBigUInt64LE(params.totalMigrated ?? 0n, 208);
  data.writeBigInt64LE(params.startTs ?? 0n, 216);
  data.writeBigInt64LE(params.endTs ?? 10n, 224);
  data.writeBigUInt64LE(params.migrationCap ?? 100n, 232);
  (params.refundRecipient ?? params.admin).toBuffer().copy(data, 240);
  data[272] = params.unclaimedWithdrawn ? 1 : 0;
  return data;
}

test("buildMintReport rejects the native mint", () => {
  const nativeMint = new PublicKey(NATIVE_MINT_BASE58);
  const report = buildMintReport({
    rpcUrl: "https://rpc.example",
    commitment: "finalized",
    slot: 12,
    mint: nativeMint,
    expectedDecimals: 9,
    info: accountInfo(mintData({ supply: 1_000_000_000n }), TOKEN_PROGRAM_ID),
  });

  assert.equal(report.checks.mintIsNotNativeMint, false);
  assert.equal(report.ok, false);
});

test("buildProgramAuthorityReport rejects programdata pointer drift", () => {
  const programId = key(11);
  const [programDataPda] = findProgramDataPda(programId);
  const wrongProgramData = key(12);
  const authority = key(13);

  const report = buildProgramAuthorityReport({
    rpcUrl: "https://rpc.example",
    commitment: "finalized",
    slot: 99,
    programId,
    programDataPda,
    programInfo: accountInfo(
      programAccountData(wrongProgramData),
      BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
      true,
    ),
    programDataInfo: accountInfo(programData(authority), BPF_LOADER_UPGRADEABLE_PROGRAM_ID),
    expectedAuthority: authority.toBase58(),
  });

  assert.equal(report.checks.programProgramDataMatchesDerived, false);
  assert.equal(report.ok, false);
});

test("buildReserveVaultReport rejects delegated reserve vault", () => {
  const programId = key(21);
  const newMint = key(22);
  const reserveVault = key(23);
  const [vaultAuthority] = findVaultAuthorityPda(programId);

  const report = buildReserveVaultReport({
    rpcUrl: "https://rpc.example",
    commitment: "finalized",
    slot: 4,
    programId,
    newMint,
    reserveVault,
    vaultAuthority,
    info: accountInfo(
      tokenAccountData({
        mint: newMint,
        owner: vaultAuthority,
        amount: 1_000n,
        delegateOption: 1,
        delegatedAmount: 1n,
      }),
      TOKEN_PROGRAM_ID,
    ),
  });

  assert.equal(report.checks.delegateCleared, false);
  assert.equal(report.ok, false);
});

test("buildConfigReport accepts an exact-size matching config", () => {
  const programId = key(31);
  const configPda = key(32);
  const oldMint = key(33);
  const newMint = key(34);
  const reserveVault = key(35);
  const opsAdmin = key(36);
  const vaultAuthority = key(37);
  const refundRecipient = key(38);
  const migrationCap = 500n;
  const startTs = 100n;
  const endTs = 200n;
  const totalMigrated = 75n;

  const report = buildConfigReport({
    rpcUrl: "https://rpc.example",
    commitment: "finalized",
    slot: 7,
    programId,
    configPda,
    vaultAuthority,
    configBump: 250,
    vaultAuthorityBump: 251,
    oldMint,
    newMint,
    reserveVault,
    opsAdmin,
    migrationCap,
    startTs,
    endTs,
    paused: false,
    totalMigrated,
    refundRecipient,
    unclaimedWithdrawn: false,
    info: accountInfo(
      migrationConfigData({
        bump: 250,
        vaultAuthorityBump: 251,
        admin: opsAdmin,
        oldMint,
        newMint,
        vaultAuthority,
        reserveVault,
        totalMigrated,
        migrationCap,
        startTs,
        endTs,
        paused: false,
        refundRecipient,
        unclaimedWithdrawn: false,
      }),
      programId,
    ),
  });

  assert.equal(report.ok, true);
  assert.equal(report.config.migrationCap, migrationCap.toString());
  assert.equal(report.checks.refundRecipientMatches, true);
  assert.equal(report.checks.unclaimedWithdrawnMatches, true);
});

test("buildReserveProofReport rejects native new mint and reserve shortfall", () => {
  const programId = key(41);
  const newMint = new PublicKey(NATIVE_MINT_BASE58);
  const reserveVault = key(42);
  const [vaultAuthority] = findVaultAuthorityPda(programId);

  const report = buildReserveProofReport({
    rpcUrl: "https://rpc.example",
    commitment: "finalized",
    slot: 8,
    programId,
    newMint,
    reserveVault,
    vaultAuthority,
    expectedDecimals: 9,
    eligibleRawUnits: 1_000n,
    fundingSignature: null,
    fundingCheck: null,
    mintInfo: accountInfo(mintData({ supply: 500n }), TOKEN_PROGRAM_ID),
    reserveInfo: accountInfo(
      tokenAccountData({ mint: newMint, owner: vaultAuthority, amount: 500n }),
      TOKEN_PROGRAM_ID,
    ),
  });

  assert.equal(report.checks.mintIsNotNativeMint, false);
  assert.equal(report.checks.reserveCoversEligibleSupply, false);
  assert.equal(report.ok, false);
});

test("buildMainnetChecks flags native new mint and accepts relative build path manifest", () => {
  const programId = key(51);
  const [programDataPda] = findProgramDataPda(programId);
  const [vaultAuthorityPda, vaultAuthorityBump] = findVaultAuthorityPda(programId);
  const oldMint = key(52);
  const newMint = new PublicKey(NATIVE_MINT_BASE58);
  const reserveVault = key(53);
  const opsAdmin = key(54);
  const initializerAuthority = key(55);
  const reviewedBuildInfo = {
    generatedAt: "2026-03-23T00:00:00Z",
    gitCommit: "0123456789abcdef0123456789abcdef01234567",
    libraryName: "migrator_program",
    arch: "v0",
    mountBaseDir: "/tmp",
    mountPath: "./svbmount",
    dockerPlatform: "linux/amd64",
    programSoPath: "target/deploy/migrator_program.so",
    executableHash: "a".repeat(64),
    programId: null,
    onChainHash: null,
    matchesOnChain: null,
    solanaVerifyVersion: "solana-verify 0.4.12",
    solanaCliVersion: "solana-cli 2.3.10",
  };

  const checks = buildMainnetChecks({
    inputs: {
      cluster: "mainnet-beta",
      rpcUrl: "https://rpc.example",
      expectConfigInitialized: false,
      programId: programId.toBase58(),
      oldQxMint: oldMint.toBase58(),
      newQxMint: newMint.toBase58(),
      reserveVault: reserveVault.toBase58(),
      opsAdmin: opsAdmin.toBase58(),
      initializerAuthority: initializerAuthority.toBase58(),
      expectedUpgradeAuthority: null,
      migrationCapRaw: "1000",
      eligibleRawUnits: "1000",
      expectedDecimals: 9,
      startTs: "1",
      endTs: "2",
      expectedPaused: false,
      expectedTotalMigratedRaw: "0",
      expectedRefundRecipient: initializerAuthority.toBase58(),
      expectedUnclaimedWithdrawn: false,
      fundingSignature: null,
      verifiedBuild: {
        libraryName: "migrator_program",
        mountPath: ".",
        arch: "v0",
        programSoPath: "target/deploy/migrator_program.so",
        expectedExecutableHash: "a".repeat(64),
        repoUrl: null,
        commitHash: "0123456789abcdef0123456789abcdef01234567",
      },
    },
    programId,
    observedGenesisHash: MAINNET_BETA_GENESIS_HASH,
    expectedUpgradeAuthority: null,
    migrationCapRaw: 1_000n,
    eligibleRawUnits: 1_000n,
    startTs: 1n,
    endTs: 2n,
    expectedTotalMigratedRaw: 0n,
    configPda: key(56),
    vaultAuthorityPda,
    programDataPda,
    configBump: 200,
    vaultAuthorityBump,
    programInfo: { owner: BPF_LOADER_UPGRADEABLE_PROGRAM_ID, executable: true },
    programDataInfo: { owner: BPF_LOADER_UPGRADEABLE_PROGRAM_ID },
    oldMintInfo: { owner: TOKEN_PROGRAM_ID },
    mintInfo: { owner: TOKEN_PROGRAM_ID },
    reserveInfo: { owner: TOKEN_PROGRAM_ID },
    configInfo: null,
    parsedProgram: {
      stateDiscriminator: 2,
      programDataAddress: programDataPda.toBase58(),
    },
    parsedProgramData: {
      stateDiscriminator: PROGRAMDATA_DISCRIMINATOR,
      authorityOption: 0,
      authority: null,
    },
    parsedOldMint: {
      mintAuthorityOption: 0,
      supply: 10n,
      decimals: 9,
      isInitialized: true,
      freezeAuthorityOption: 0,
    },
    parsedMint: {
      mintAuthorityOption: 0,
      supply: 500n,
      decimals: 9,
      isInitialized: true,
      freezeAuthorityOption: 0,
    },
    parsedReserve: {
      mint: newMint.toBase58(),
      owner: vaultAuthorityPda.toBase58(),
      amount: 1_000n,
      delegateOption: 0,
      state: 1,
      delegatedAmount: 0n,
      closeAuthorityOption: 0,
    },
    parsedConfig: null,
    fundingStatus: null,
    fundingObservation: null,
    executableHash: "a".repeat(64),
    reviewedBuildInfo,
    resolvedProgramSoPath: "/tmp/migrator-program/target/deploy/migrator_program.so",
    oldQxMint: oldMint,
    newQxMint: newMint,
    reserveVault,
    opsAdmin,
    initializerAuthority,
  });

  assert.equal(checks.reviewedBuildInfoProgramSoPathMatchesManifest, true);
  assert.equal(checks.newMintIsNotNativeMint, false);
});

test("findAssociatedTokenAddress derives the canonical ATA", () => {
  const owner = key(61);
  const mint = key(62);
  const ata = findAssociatedTokenAddress(owner, mint);
  const officialAtaProgram = new PublicKey(
    "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  );
  const officialTokenProgram = new PublicKey(
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  );
  const expectedAta = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), officialTokenProgram.toBuffer(), mint.toBuffer()],
    officialAtaProgram,
  )[0];

  assert.equal(ata instanceof PublicKey, true);
  assert.equal(
    ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
    officialAtaProgram.toBase58(),
  );
  assert.equal(TOKEN_PROGRAM_ID.toBase58(), officialTokenProgram.toBase58());
  assert.notEqual(ata.toBase58(), owner.toBase58());
  assert.notEqual(ata.toBase58(), mint.toBase58());
  assert.equal(ata.toBase58(), expectedAta.toBase58());
});

test("ASSOCIATED_TOKEN_PROGRAM_ID matches the official Solana ATA program id", () => {
  assert.equal(
    ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
    "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  );
});

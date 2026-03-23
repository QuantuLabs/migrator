import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

import type { Commitment } from "@solana/web3.js";
import { Connection, PublicKey } from "@solana/web3.js";

import {
    BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    MIGRATION_CONFIG_SIZE,
    TOKEN_PROGRAM_ID,
    decodeMigrationConfig,
  findMigrationConfigPda,
  findProgramDataPda,
  findVaultAuthorityPda,
} from "./index.ts";
import {
    computeExecutableHash,
    isMainnetBetaGenesisHash,
    NATIVE_MINT_BASE58,
    parseMintData,
    parseProgramData,
    parseTokenAccountData,
    PROGRAMDATA_DISCRIMINATOR,
    readReviewedBuildInfo,
    resolveLocalPath,
    resolveCommitment,
    resolveRepoRoot,
    runCliMain,
    verifyFundingSignature,
} from "./releaseUtils.ts";

const PROGRAM_ACCOUNT_METADATA_LEN = 36;
const PROGRAM_DISCRIMINATOR = 2;

export type VerifiedBuildInputs = {
  libraryName: string;
  mountPath: string;
  arch: string;
  programSoPath: string;
  buildInfoPath?: string;
  expectedExecutableHash: string;
  repoUrl: string | null;
  commitHash: string;
};

export type MainnetInputs = {
  cluster: string;
  rpcUrl: string;
  expectConfigInitialized: boolean;
  programId: string;
  oldQxMint: string;
  newQxMint: string;
  reserveVault: string;
  opsAdmin: string;
  initializerAuthority: string;
  expectedUpgradeAuthority: string | null;
  migrationCapRaw: string;
  eligibleRawUnits: string;
  expectedDecimals: number;
  startTs: string;
  endTs: string;
  expectedPaused: boolean;
  expectedTotalMigratedRaw: string;
  fundingSignature: string | null;
  verifiedBuild: VerifiedBuildInputs;
};

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function asOptionalString(value: unknown, label: string): string | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string or null`);
  }
  return value;
}

function asBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean`);
  }
  return value;
}

function asInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`${label} must be an integer`);
  }
  return value;
}

export function parseInputs(raw: unknown): MainnetInputs {
  const record = asRecord(raw, "mainnet inputs");
  const verifiedBuild = asRecord(record.verifiedBuild, "verifiedBuild");

  return {
    cluster: asString(record.cluster, "cluster"),
    rpcUrl: asString(record.rpcUrl, "rpcUrl"),
    expectConfigInitialized: asBoolean(
      record.expectConfigInitialized,
      "expectConfigInitialized",
    ),
    programId: asString(record.programId, "programId"),
    oldQxMint: asString(record.oldQxMint, "oldQxMint"),
    newQxMint: asString(record.newQxMint, "newQxMint"),
    reserveVault: asString(record.reserveVault, "reserveVault"),
    opsAdmin: asString(record.opsAdmin, "opsAdmin"),
    initializerAuthority: asString(record.initializerAuthority, "initializerAuthority"),
    expectedUpgradeAuthority: asOptionalString(
      record.expectedUpgradeAuthority,
      "expectedUpgradeAuthority",
    ),
    migrationCapRaw: asString(record.migrationCapRaw, "migrationCapRaw"),
    eligibleRawUnits: asString(record.eligibleRawUnits, "eligibleRawUnits"),
    expectedDecimals: asInteger(record.expectedDecimals, "expectedDecimals"),
    startTs: asString(record.startTs, "startTs"),
    endTs: asString(record.endTs, "endTs"),
    expectedPaused: asBoolean(record.expectedPaused, "expectedPaused"),
    expectedTotalMigratedRaw: asString(
      record.expectedTotalMigratedRaw,
      "expectedTotalMigratedRaw",
    ),
    fundingSignature: asOptionalString(record.fundingSignature, "fundingSignature"),
    verifiedBuild: {
      libraryName: asString(verifiedBuild.libraryName, "verifiedBuild.libraryName"),
      mountPath: asString(verifiedBuild.mountPath, "verifiedBuild.mountPath"),
      arch: asString(verifiedBuild.arch, "verifiedBuild.arch"),
      programSoPath: asString(verifiedBuild.programSoPath, "verifiedBuild.programSoPath"),
      buildInfoPath:
        verifiedBuild.buildInfoPath === undefined
          ? undefined
          : asString(verifiedBuild.buildInfoPath, "verifiedBuild.buildInfoPath"),
      expectedExecutableHash: asString(
        verifiedBuild.expectedExecutableHash,
        "verifiedBuild.expectedExecutableHash",
      ),
      repoUrl: asOptionalString(verifiedBuild.repoUrl, "verifiedBuild.repoUrl"),
      commitHash: asString(verifiedBuild.commitHash, "verifiedBuild.commitHash"),
    },
  };
}

export function parseProgramAccount(data: Buffer) {
  if (data.length < PROGRAM_ACCOUNT_METADATA_LEN) {
    throw new Error(
      `Program account too short: expected at least ${PROGRAM_ACCOUNT_METADATA_LEN}, got ${data.length}`,
    );
  }

  return {
    stateDiscriminator: data.readUInt32LE(0),
    programDataAddress: new PublicKey(data.subarray(4, 36)).toBase58(),
  };
}

type MainnetChecksContext = {
  inputs: MainnetInputs;
  programId: PublicKey;
  observedGenesisHash: string;
  expectedUpgradeAuthority: string | null;
  migrationCapRaw: bigint;
  eligibleRawUnits: bigint;
  startTs: bigint;
  endTs: bigint;
  expectedTotalMigratedRaw: bigint;
  configPda: PublicKey;
  vaultAuthorityPda: PublicKey;
  programDataPda: PublicKey;
  configBump: number;
  vaultAuthorityBump: number;
  programInfo: { owner: PublicKey; executable: boolean };
  programDataInfo: { owner: PublicKey };
  oldMintInfo: { owner: PublicKey };
  mintInfo: { owner: PublicKey };
  reserveInfo: { owner: PublicKey };
  configInfo: { owner: PublicKey; dataLength: number } | null;
  parsedProgram: ReturnType<typeof parseProgramAccount>;
  parsedProgramData: ReturnType<typeof parseProgramData>;
  parsedOldMint: ReturnType<typeof parseMintData>;
  parsedMint: ReturnType<typeof parseMintData>;
  parsedReserve: ReturnType<typeof parseTokenAccountData>;
  parsedConfig: ReturnType<typeof decodeMigrationConfig> | null;
  fundingStatus: { err: unknown; confirmationStatus?: string | null } | null;
  fundingObservation: {
    reserveVaultSeen: boolean;
    mintMatchesExpected: boolean;
    reserveDeltaRaw: string | null;
  } | null;
  executableHash: string;
  reviewedBuildInfo: ReturnType<typeof readReviewedBuildInfo>;
  resolvedProgramSoPath: string;
  oldQxMint: PublicKey;
  newQxMint: PublicKey;
  reserveVault: PublicKey;
  opsAdmin: PublicKey;
  initializerAuthority: PublicKey;
};

export function buildMainnetChecks(ctx: MainnetChecksContext) {
  return {
    clusterManifestRequestsMainnetBeta: ctx.inputs.cluster === "mainnet-beta",
    clusterGenesisHashMatchesMainnetBeta: isMainnetBetaGenesisHash(ctx.observedGenesisHash),
    migrationWindowIsValid: ctx.startTs <= ctx.endTs,
    migrationCapEqualsEligibleRawUnits: ctx.migrationCapRaw === ctx.eligibleRawUnits,
    initializerMatchesExpectedUpgradeAuthority:
      ctx.expectedUpgradeAuthority === null
        ? ctx.inputs.expectConfigInitialized
        : ctx.initializerAuthority.toBase58() === ctx.expectedUpgradeAuthority,
    verifiedBuildLibraryNameMatches: ctx.inputs.verifiedBuild.libraryName === "migrator_program",
    verifiedBuildMountPathPresent: ctx.inputs.verifiedBuild.mountPath.length > 0,
    verifiedBuildProgramSoPathPresent: ctx.inputs.verifiedBuild.programSoPath.length > 0,
    verifiedBuildExecutableHashMatches:
      ctx.executableHash.toLowerCase() ===
      ctx.inputs.verifiedBuild.expectedExecutableHash.toLowerCase(),
    reviewedBuildInfoCommitMatchesManifest:
      ctx.reviewedBuildInfo.gitCommit.toLowerCase() ===
      ctx.inputs.verifiedBuild.commitHash.toLowerCase(),
    reviewedBuildInfoLibraryNameMatchesManifest:
      ctx.reviewedBuildInfo.libraryName === ctx.inputs.verifiedBuild.libraryName,
    reviewedBuildInfoArchMatchesManifest:
      ctx.reviewedBuildInfo.arch === ctx.inputs.verifiedBuild.arch,
    reviewedBuildInfoProgramSoPathMatchesManifest:
      ctx.reviewedBuildInfo.programSoPath === ctx.inputs.verifiedBuild.programSoPath,
    reviewedBuildInfoExecutableHashMatchesManifest:
      ctx.reviewedBuildInfo.executableHash.toLowerCase() ===
      ctx.inputs.verifiedBuild.expectedExecutableHash.toLowerCase(),
    reviewedBuildInfoExecutableHashMatchesLocal:
      ctx.reviewedBuildInfo.executableHash.toLowerCase() === ctx.executableHash.toLowerCase(),
    programOwnedByUpgradeableLoader:
      ctx.programInfo.owner.equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID),
    programExecutable: ctx.programInfo.executable,
    programStateDiscriminatorMatches:
      ctx.parsedProgram.stateDiscriminator === PROGRAM_DISCRIMINATOR,
    programProgramDataMatchesDerived:
      ctx.parsedProgram.programDataAddress === ctx.programDataPda.toBase58(),
    programDataOwnedByUpgradeableLoader:
      ctx.programDataInfo.owner.equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID),
    programDataStateDiscriminatorMatches:
      ctx.parsedProgramData.stateDiscriminator === PROGRAMDATA_DISCRIMINATOR,
    expectedUpgradeAuthorityMatchesProgramData:
      ctx.expectedUpgradeAuthority === null
        ? ctx.parsedProgramData.authority === null
        : ctx.parsedProgramData.authority === ctx.expectedUpgradeAuthority,
    mintOwnedByTokenkeg: ctx.mintInfo.owner.equals(TOKEN_PROGRAM_ID),
    mintInitialized: ctx.parsedMint.isInitialized,
    mintAuthorityDisabled: ctx.parsedMint.mintAuthorityOption === 0,
    freezeAuthorityDisabled: ctx.parsedMint.freezeAuthorityOption === 0,
    decimalsMatchExpected: ctx.parsedMint.decimals === ctx.inputs.expectedDecimals,
    oldMintOwnedByTokenkeg: ctx.oldMintInfo.owner.equals(TOKEN_PROGRAM_ID),
    oldMintInitialized: ctx.parsedOldMint.isInitialized,
    oldMintAuthorityDisabled: ctx.parsedOldMint.mintAuthorityOption === 0,
    oldFreezeAuthorityDisabled: ctx.parsedOldMint.freezeAuthorityOption === 0,
    oldMintDecimalsMatchExpected: ctx.parsedOldMint.decimals === ctx.inputs.expectedDecimals,
    oldMintIsNotNativeMint: ctx.oldQxMint.toBase58() !== NATIVE_MINT_BASE58,
    oldMintDiffersFromNewMint: ctx.oldQxMint.toBase58() !== ctx.newQxMint.toBase58(),
    newMintIsNotNativeMint: ctx.newQxMint.toBase58() !== NATIVE_MINT_BASE58,
    reserveOwnedByTokenkeg: ctx.reserveInfo.owner.equals(TOKEN_PROGRAM_ID),
    reserveMintMatchesNewMint: ctx.parsedReserve.mint === ctx.newQxMint.toBase58(),
    reserveOwnerMatchesVaultAuthority:
      ctx.parsedReserve.owner === ctx.vaultAuthorityPda.toBase58(),
    reserveInitialized: ctx.parsedReserve.state === 1,
    reserveDelegateCleared: ctx.parsedReserve.delegateOption === 0,
    reserveDelegatedAmountCleared: ctx.parsedReserve.delegatedAmount === 0n,
    reserveCloseAuthorityCleared: ctx.parsedReserve.closeAuthorityOption === 0,
    reserveCoversEligibleRawUnits: ctx.parsedReserve.amount >= ctx.eligibleRawUnits,
    fundingSignatureSucceeded:
      ctx.inputs.fundingSignature === null
        ? null
        : ctx.fundingStatus !== null && ctx.fundingStatus.err === null,
    fundingSignatureFinalized:
      ctx.inputs.fundingSignature === null
        ? null
        : ctx.fundingStatus !== null && ctx.fundingStatus.confirmationStatus === "finalized",
    fundingSignatureTouchesReserveVault:
      ctx.inputs.fundingSignature === null
        ? null
        : ctx.fundingObservation?.reserveVaultSeen === true,
    fundingSignatureMintMatchesNewMint:
      ctx.inputs.fundingSignature === null
        ? null
        : ctx.fundingObservation?.mintMatchesExpected === true,
    fundingSignatureDeltaPositive:
      ctx.inputs.fundingSignature === null
        ? null
        : BigInt(ctx.fundingObservation?.reserveDeltaRaw ?? "0") > 0n,
    configPresentWhenExpected: ctx.inputs.expectConfigInitialized ? ctx.configInfo !== null : null,
    configAbsentBeforeInit: ctx.inputs.expectConfigInitialized ? null : ctx.configInfo === null,
    configOwnedByProgram:
      ctx.inputs.expectConfigInitialized && ctx.configInfo
        ? ctx.configInfo.owner.equals(ctx.programId)
        : null,
    configLengthMatches:
      ctx.inputs.expectConfigInitialized && ctx.configInfo
        ? ctx.configInfo.dataLength === MIGRATION_CONFIG_SIZE
        : null,
    configOldMintMatches:
      ctx.inputs.expectConfigInitialized && ctx.parsedConfig
        ? ctx.parsedConfig.oldQxMint.equals(ctx.oldQxMint)
        : null,
    configNewMintMatches:
      ctx.inputs.expectConfigInitialized && ctx.parsedConfig
        ? ctx.parsedConfig.newQxMint.equals(ctx.newQxMint)
        : null,
    configReserveVaultMatches:
      ctx.inputs.expectConfigInitialized && ctx.parsedConfig
        ? ctx.parsedConfig.vaultNewQx.equals(ctx.reserveVault)
        : null,
    configAdminMatches:
      ctx.inputs.expectConfigInitialized && ctx.parsedConfig
        ? ctx.parsedConfig.admin.equals(ctx.opsAdmin)
        : null,
    configTokenProgramMatches:
      ctx.inputs.expectConfigInitialized && ctx.parsedConfig
        ? ctx.parsedConfig.tokenProgramId.equals(TOKEN_PROGRAM_ID)
        : null,
    configVaultAuthorityMatches:
      ctx.inputs.expectConfigInitialized && ctx.parsedConfig
        ? ctx.parsedConfig.vaultAuthority.equals(ctx.vaultAuthorityPda)
        : null,
    configBumpMatches:
      ctx.inputs.expectConfigInitialized && ctx.parsedConfig
        ? ctx.parsedConfig.bump === ctx.configBump
        : null,
    configVaultAuthorityBumpMatches:
      ctx.inputs.expectConfigInitialized && ctx.parsedConfig
        ? ctx.parsedConfig.vaultAuthorityBump === ctx.vaultAuthorityBump
        : null,
    configMigrationCapMatches:
      ctx.inputs.expectConfigInitialized && ctx.parsedConfig
        ? ctx.parsedConfig.migrationCap === ctx.migrationCapRaw
        : null,
    configStartTsMatches:
      ctx.inputs.expectConfigInitialized && ctx.parsedConfig
        ? ctx.parsedConfig.startTs === ctx.startTs
        : null,
    configEndTsMatches:
      ctx.inputs.expectConfigInitialized && ctx.parsedConfig
        ? ctx.parsedConfig.endTs === ctx.endTs
        : null,
    configPausedMatches:
      ctx.inputs.expectConfigInitialized && ctx.parsedConfig
        ? ctx.parsedConfig.paused === ctx.inputs.expectedPaused
        : null,
    configTotalMigratedMatches:
      ctx.inputs.expectConfigInitialized && ctx.parsedConfig
        ? ctx.parsedConfig.totalMigrated === ctx.expectedTotalMigratedRaw
        : null,
  };
}

export async function main() {
  const inputsPathArg = process.argv[2];
  if (!inputsPathArg) {
    throw new Error(
      "Usage: node src/validateMainnetInputs.ts <PATH_TO_MAINNET_INPUTS_JSON>",
    );
  }

  const inputsPath = resolvePath(inputsPathArg);
  const inputs = parseInputs(JSON.parse(readFileSync(inputsPath, "utf8")) as unknown);
  const commitment = resolveCommitment();
  const connection = new Connection(process.env.SOLANA_RPC_URL || inputs.rpcUrl, commitment);

  const programId = new PublicKey(inputs.programId);
  const oldQxMint = new PublicKey(inputs.oldQxMint);
  const newQxMint = new PublicKey(inputs.newQxMint);
  const reserveVault = new PublicKey(inputs.reserveVault);
  const opsAdmin = new PublicKey(inputs.opsAdmin);
  const initializerAuthority = new PublicKey(inputs.initializerAuthority);
  const expectedUpgradeAuthority = inputs.expectedUpgradeAuthority
    ? new PublicKey(inputs.expectedUpgradeAuthority).toBase58()
    : null;
  const migrationCapRaw = BigInt(inputs.migrationCapRaw);
  const eligibleRawUnits = BigInt(inputs.eligibleRawUnits);
  const startTs = BigInt(inputs.startTs);
  const endTs = BigInt(inputs.endTs);
  const expectedTotalMigratedRaw = BigInt(inputs.expectedTotalMigratedRaw);
  const repoRoot = resolveRepoRoot(import.meta.url);
  const resolvedMountPath = resolveLocalPath(repoRoot, inputs.verifiedBuild.mountPath);
  const resolvedProgramSoPath = resolveLocalPath(
    resolvedMountPath,
    inputs.verifiedBuild.programSoPath,
  );
  const resolvedBuildInfoPath = resolveLocalPath(
    repoRoot,
    inputs.verifiedBuild.buildInfoPath ??
      `artifacts/verified-build/${inputs.verifiedBuild.libraryName}.build-info.json`,
  );
  const reviewedBuildInfo = readReviewedBuildInfo(resolvedBuildInfoPath);

  if (!["v0", "v1", "v2", "v3"].includes(inputs.verifiedBuild.arch)) {
    throw new Error(`Invalid verifiedBuild.arch: ${inputs.verifiedBuild.arch}`);
  }
  if (!/^[0-9a-f]{40}$/i.test(inputs.verifiedBuild.commitHash)) {
    throw new Error("verifiedBuild.commitHash must be a full 40-character git hash");
  }
  if (!/^[0-9a-f]{64}$/i.test(inputs.verifiedBuild.expectedExecutableHash)) {
    throw new Error(
      "verifiedBuild.expectedExecutableHash must be a 64-character hex string",
    );
  }
  if (inputs.verifiedBuild.repoUrl && !/^https:\/\//.test(inputs.verifiedBuild.repoUrl)) {
    throw new Error("verifiedBuild.repoUrl must be an https URL when provided");
  }

  const [configPda, configBump] = findMigrationConfigPda(programId);
  const [vaultAuthorityPda, vaultAuthorityBump] = findVaultAuthorityPda(programId);
  const [programDataPda] = findProgramDataPda(programId);

  const [observedGenesisHash, accountSnapshot, fundingStatuses, fundingObservation] =
    await Promise.all([
      connection.getGenesisHash(),
      connection.getMultipleAccountsInfoAndContext(
        [programId, programDataPda, oldQxMint, newQxMint, reserveVault, configPda],
        commitment,
      ),
      inputs.fundingSignature
        ? connection.getSignatureStatuses([inputs.fundingSignature], {
            searchTransactionHistory: true,
          })
        : Promise.resolve(null),
      inputs.fundingSignature
        ? verifyFundingSignature(
            connection,
            inputs.fundingSignature,
            reserveVault,
            newQxMint,
            commitment,
          )
        : Promise.resolve(null),
    ]);
  const slot = accountSnapshot.context.slot;
  const [programInfo, programDataInfo, oldMintInfo, mintInfo, reserveInfo, configInfo] =
    accountSnapshot.value;

  if (!programInfo) {
    throw new Error(`Program account not found: ${programId.toBase58()}`);
  }
  if (!programDataInfo) {
    throw new Error(`ProgramData account not found: ${programDataPda.toBase58()}`);
  }
  if (!oldMintInfo) {
    throw new Error(`Old mint account not found: ${oldQxMint.toBase58()}`);
  }
  if (!mintInfo) {
    throw new Error(`Mint account not found: ${newQxMint.toBase58()}`);
  }
  if (!reserveInfo) {
    throw new Error(`Reserve vault not found: ${reserveVault.toBase58()}`);
  }
  if (inputs.expectConfigInitialized && !configInfo) {
    throw new Error(
      `Config PDA missing while expectConfigInitialized=true: ${configPda.toBase58()}`,
    );
  }

  const parsedProgram = parseProgramAccount(programInfo.data);
  const parsedProgramData = parseProgramData(programDataInfo.data);
  const parsedOldMint = parseMintData(oldMintInfo.data);
  const parsedMint = parseMintData(mintInfo.data);
  const parsedReserve = parseTokenAccountData(reserveInfo.data);
  const parsedConfig =
    configInfo && configInfo.data.length === MIGRATION_CONFIG_SIZE
      ? decodeMigrationConfig(configInfo.data)
      : null;
  const fundingStatus = inputs.fundingSignature ? fundingStatuses?.value[0] ?? null : null;
  const executableHash = computeExecutableHash(resolvedProgramSoPath);

  const checks = buildMainnetChecks({
    inputs,
    programId,
    observedGenesisHash,
    expectedUpgradeAuthority,
    migrationCapRaw,
    eligibleRawUnits,
    startTs,
    endTs,
    expectedTotalMigratedRaw,
    configPda,
    vaultAuthorityPda,
    programDataPda,
    configBump,
    vaultAuthorityBump,
    programInfo: {
      owner: programInfo.owner,
      executable: programInfo.executable,
    },
    programDataInfo: {
      owner: programDataInfo.owner,
    },
    oldMintInfo: {
      owner: oldMintInfo.owner,
    },
    mintInfo: {
      owner: mintInfo.owner,
    },
    reserveInfo: {
      owner: reserveInfo.owner,
    },
    configInfo:
      configInfo === null
        ? null
        : {
            owner: configInfo.owner,
            dataLength: configInfo.data.length,
          },
    parsedProgram,
    parsedProgramData,
    parsedOldMint,
    parsedMint,
    parsedReserve,
    parsedConfig,
    fundingStatus,
    fundingObservation,
    executableHash,
    reviewedBuildInfo,
    resolvedProgramSoPath,
    oldQxMint,
    newQxMint,
    reserveVault,
    opsAdmin,
    initializerAuthority,
  });
  const ok = Object.values(checks).every((value) => value !== false);

  console.log(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        inputsPath,
        rpcUrl: connection.rpcEndpoint,
        commitment,
        slot,
        accountSnapshotSlot: slot,
        phase: inputs.expectConfigInitialized ? "post-init" : "pre-init",
        inputs: {
          cluster: inputs.cluster,
          programId: programId.toBase58(),
          oldQxMint: oldQxMint.toBase58(),
          newQxMint: newQxMint.toBase58(),
          reserveVault: reserveVault.toBase58(),
          opsAdmin: opsAdmin.toBase58(),
          initializerAuthority: initializerAuthority.toBase58(),
          expectedUpgradeAuthority,
          migrationCapRaw: migrationCapRaw.toString(),
          eligibleRawUnits: eligibleRawUnits.toString(),
          expectedDecimals: inputs.expectedDecimals,
          startTs: startTs.toString(),
          endTs: endTs.toString(),
          expectedPaused: inputs.expectedPaused,
          expectedTotalMigratedRaw: expectedTotalMigratedRaw.toString(),
          fundingSignature: inputs.fundingSignature,
          verifiedBuild: inputs.verifiedBuild,
        },
        derived: {
          configPda: configPda.toBase58(),
          vaultAuthorityPda: vaultAuthorityPda.toBase58(),
          programDataPda: programDataPda.toBase58(),
          configBump,
          vaultAuthorityBump,
        },
        observed: {
          genesisHash: observedGenesisHash,
          programDataAddressFromProgram: parsedProgram.programDataAddress,
          oldMintSupplyRaw: parsedOldMint.supply.toString(),
          oldMintDecimals: parsedOldMint.decimals,
          programDataAuthority: parsedProgramData.authority,
          verifiedBuildExecutableHash: executableHash,
          reviewedBuildInfoPath: resolvedBuildInfoPath,
          reviewedBuildInfo,
          verifiedBuildResolvedMountPath: resolvedMountPath,
          verifiedBuildResolvedProgramSoPath: resolvedProgramSoPath,
          mintSupplyRaw: parsedMint.supply.toString(),
          mintDecimals: parsedMint.decimals,
          reserveRawUnits: parsedReserve.amount.toString(),
          reserveShortfallRawUnits:
            parsedReserve.amount >= eligibleRawUnits
              ? "0"
              : (eligibleRawUnits - parsedReserve.amount).toString(),
          fundingSignatureStatus: fundingStatus,
          fundingSignatureObservation: fundingObservation,
          config:
            parsedConfig === null
              ? null
              : {
                  admin: parsedConfig.admin.toBase58(),
                  oldQxMint: parsedConfig.oldQxMint.toBase58(),
                  newQxMint: parsedConfig.newQxMint.toBase58(),
                  tokenProgramId: parsedConfig.tokenProgramId.toBase58(),
                  vaultAuthority: parsedConfig.vaultAuthority.toBase58(),
                  vaultNewQx: parsedConfig.vaultNewQx.toBase58(),
                  totalMigrated: parsedConfig.totalMigrated.toString(),
                  migrationCap: parsedConfig.migrationCap.toString(),
                  startTs: parsedConfig.startTs.toString(),
                  endTs: parsedConfig.endTs.toString(),
                },
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

void runCliMain(import.meta.url, main);

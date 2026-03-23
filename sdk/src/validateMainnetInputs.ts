import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

import { Commitment, Connection, PublicKey } from "@solana/web3.js";

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
  resolveLocalPath,
  resolveRepoRoot,
  verifyFundingSignature,
} from "./releaseUtils.ts";

const MINT_LEN = 82;
const TOKEN_ACCOUNT_LEN = 165;
const PROGRAM_ACCOUNT_METADATA_LEN = 36;
const PROGRAM_DISCRIMINATOR = 2;
const PROGRAMDATA_METADATA_LEN = 45;
const PROGRAMDATA_DISCRIMINATOR = 3;

type VerifiedBuildInputs = {
  libraryName: string;
  mountPath: string;
  arch: string;
  programSoPath: string;
  expectedExecutableHash: string;
  repoUrl: string | null;
  commitHash: string;
};

type MainnetInputs = {
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

function parseInputs(raw: unknown): MainnetInputs {
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
      expectedExecutableHash: asString(
        verifiedBuild.expectedExecutableHash,
        "verifiedBuild.expectedExecutableHash",
      ),
      repoUrl: asOptionalString(verifiedBuild.repoUrl, "verifiedBuild.repoUrl"),
      commitHash: asString(verifiedBuild.commitHash, "verifiedBuild.commitHash"),
    },
  };
}

function resolveCommitment(): Commitment {
  const commitment = (process.env.SOLANA_COMMITMENT || "finalized") as Commitment;
  if (!["processed", "confirmed", "finalized"].includes(commitment)) {
    throw new Error(`Invalid SOLANA_COMMITMENT: ${commitment}`);
  }
  return commitment;
}

function parseMintData(data: Buffer) {
  if (data.length !== MINT_LEN) {
    throw new Error(`Mint data must be ${MINT_LEN} bytes, got ${data.length}`);
  }

  return {
    mintAuthorityOption: data.readUInt32LE(0),
    supply: data.readBigUInt64LE(36),
    decimals: data[44],
    isInitialized: data[45] === 1,
    freezeAuthorityOption: data.readUInt32LE(46),
  };
}

function parseTokenAccountData(data: Buffer) {
  if (data.length !== TOKEN_ACCOUNT_LEN) {
    throw new Error(`Token account data must be ${TOKEN_ACCOUNT_LEN} bytes, got ${data.length}`);
  }

  return {
    mint: new PublicKey(data.subarray(0, 32)).toBase58(),
    owner: new PublicKey(data.subarray(32, 64)).toBase58(),
    amount: data.readBigUInt64LE(64),
    delegateOption: data.readUInt32LE(72),
    state: data[108],
    delegatedAmount: data.readBigUInt64LE(121),
    closeAuthorityOption: data.readUInt32LE(129),
  };
}

function parseProgramData(data: Buffer) {
  if (data.length < PROGRAMDATA_METADATA_LEN) {
    throw new Error(
      `ProgramData account too short: expected at least ${PROGRAMDATA_METADATA_LEN}, got ${data.length}`,
    );
  }

  const stateDiscriminator = data.readUInt32LE(0);
  const authorityOption = data[12];
  const authority =
    authorityOption === 1 ? new PublicKey(data.subarray(13, 45)).toBase58() : null;

  return { stateDiscriminator, authorityOption, authority };
}

function parseProgramAccount(data: Buffer) {
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

async function main() {
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

  const slot = await connection.getSlot(commitment);
  const [programInfo, programDataInfo, oldMintInfo, mintInfo, reserveInfo, configInfo, fundingStatuses, fundingObservation] =
    await Promise.all([
      connection.getAccountInfo(programId, commitment),
      connection.getAccountInfo(programDataPda, commitment),
      connection.getAccountInfo(oldQxMint, commitment),
      connection.getAccountInfo(newQxMint, commitment),
      connection.getAccountInfo(reserveVault, commitment),
      connection.getAccountInfo(configPda, commitment),
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

  const checks = {
    clusterIsMainnetBeta: inputs.cluster === "mainnet-beta",
    migrationWindowIsValid: startTs <= endTs,
    migrationCapEqualsEligibleRawUnits: migrationCapRaw === eligibleRawUnits,
    initializerMatchesExpectedUpgradeAuthority:
      expectedUpgradeAuthority === null
        ? inputs.expectConfigInitialized
        : initializerAuthority.toBase58() === expectedUpgradeAuthority,
    verifiedBuildLibraryNameMatches: inputs.verifiedBuild.libraryName === "migrator_program",
    verifiedBuildMountPathPresent: inputs.verifiedBuild.mountPath.length > 0,
    verifiedBuildProgramSoPathPresent: inputs.verifiedBuild.programSoPath.length > 0,
    verifiedBuildExecutableHashMatches:
      executableHash.toLowerCase() === inputs.verifiedBuild.expectedExecutableHash.toLowerCase(),
    programOwnedByUpgradeableLoader: programInfo.owner.equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID),
    programExecutable: programInfo.executable,
    programStateDiscriminatorMatches: parsedProgram.stateDiscriminator === PROGRAM_DISCRIMINATOR,
    programProgramDataMatchesDerived:
      parsedProgram.programDataAddress === programDataPda.toBase58(),
    programDataOwnedByUpgradeableLoader: programDataInfo.owner.equals(
      BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    ),
    programDataStateDiscriminatorMatches:
      parsedProgramData.stateDiscriminator === PROGRAMDATA_DISCRIMINATOR,
    expectedUpgradeAuthorityMatchesProgramData:
      expectedUpgradeAuthority === null
        ? parsedProgramData.authority === null
        : parsedProgramData.authority === expectedUpgradeAuthority,
    mintOwnedByTokenkeg: mintInfo.owner.equals(TOKEN_PROGRAM_ID),
    mintInitialized: parsedMint.isInitialized,
    mintAuthorityDisabled: parsedMint.mintAuthorityOption === 0,
    freezeAuthorityDisabled: parsedMint.freezeAuthorityOption === 0,
    decimalsMatchExpected: parsedMint.decimals === inputs.expectedDecimals,
    oldMintOwnedByTokenkeg: oldMintInfo.owner.equals(TOKEN_PROGRAM_ID),
    oldMintInitialized: parsedOldMint.isInitialized,
    oldMintAuthorityDisabled: parsedOldMint.mintAuthorityOption === 0,
    oldFreezeAuthorityDisabled: parsedOldMint.freezeAuthorityOption === 0,
    oldMintDecimalsMatchExpected: parsedOldMint.decimals === inputs.expectedDecimals,
    oldMintDiffersFromNewMint: oldQxMint.toBase58() !== newQxMint.toBase58(),
    reserveOwnedByTokenkeg: reserveInfo.owner.equals(TOKEN_PROGRAM_ID),
    reserveMintMatchesNewMint: parsedReserve.mint === newQxMint.toBase58(),
    reserveOwnerMatchesVaultAuthority: parsedReserve.owner === vaultAuthorityPda.toBase58(),
    reserveInitialized: parsedReserve.state === 1,
    reserveDelegateCleared: parsedReserve.delegateOption === 0,
    reserveDelegatedAmountCleared: parsedReserve.delegatedAmount === 0n,
    reserveCloseAuthorityCleared: parsedReserve.closeAuthorityOption === 0,
    reserveCoversEligibleRawUnits: parsedReserve.amount >= eligibleRawUnits,
    fundingSignatureSucceeded:
      inputs.fundingSignature === null ? null : fundingStatus !== null && fundingStatus.err === null,
    fundingSignatureFinalized:
      inputs.fundingSignature === null
        ? null
        : fundingStatus !== null && fundingStatus.confirmationStatus === "finalized",
    fundingSignatureTouchesReserveVault:
      inputs.fundingSignature === null ? null : fundingObservation?.reserveVaultSeen === true,
    fundingSignatureMintMatchesNewMint:
      inputs.fundingSignature === null ? null : fundingObservation?.mintMatchesExpected === true,
    fundingSignatureDeltaPositive:
      inputs.fundingSignature === null
        ? null
        : BigInt(fundingObservation?.reserveDeltaRaw ?? "0") > 0n,
    configPresentWhenExpected: inputs.expectConfigInitialized ? configInfo !== null : null,
    configAbsentBeforeInit: inputs.expectConfigInitialized ? null : configInfo === null,
    configOwnedByProgram:
      inputs.expectConfigInitialized && configInfo ? configInfo.owner.equals(programId) : null,
    configLengthMatches:
      inputs.expectConfigInitialized && configInfo
        ? configInfo.data.length === MIGRATION_CONFIG_SIZE
        : null,
    configOldMintMatches:
      inputs.expectConfigInitialized && parsedConfig
        ? parsedConfig.oldQxMint.equals(oldQxMint)
        : null,
    configNewMintMatches:
      inputs.expectConfigInitialized && parsedConfig
        ? parsedConfig.newQxMint.equals(newQxMint)
        : null,
    configReserveVaultMatches:
      inputs.expectConfigInitialized && parsedConfig
        ? parsedConfig.vaultNewQx.equals(reserveVault)
        : null,
    configAdminMatches:
      inputs.expectConfigInitialized && parsedConfig ? parsedConfig.admin.equals(opsAdmin) : null,
    configTokenProgramMatches:
      inputs.expectConfigInitialized && parsedConfig
        ? parsedConfig.tokenProgramId.equals(TOKEN_PROGRAM_ID)
        : null,
    configVaultAuthorityMatches:
      inputs.expectConfigInitialized && parsedConfig
        ? parsedConfig.vaultAuthority.equals(vaultAuthorityPda)
        : null,
    configBumpMatches:
      inputs.expectConfigInitialized && parsedConfig ? parsedConfig.bump === configBump : null,
    configVaultAuthorityBumpMatches:
      inputs.expectConfigInitialized && parsedConfig
        ? parsedConfig.vaultAuthorityBump === vaultAuthorityBump
        : null,
    configMigrationCapMatches:
      inputs.expectConfigInitialized && parsedConfig
        ? parsedConfig.migrationCap === migrationCapRaw
        : null,
    configStartTsMatches:
      inputs.expectConfigInitialized && parsedConfig ? parsedConfig.startTs === startTs : null,
    configEndTsMatches:
      inputs.expectConfigInitialized && parsedConfig ? parsedConfig.endTs === endTs : null,
    configPausedMatches:
      inputs.expectConfigInitialized && parsedConfig
        ? parsedConfig.paused === inputs.expectedPaused
        : null,
    configTotalMigratedMatches:
      inputs.expectConfigInitialized && parsedConfig
        ? parsedConfig.totalMigrated === expectedTotalMigratedRaw
        : null,
  };
  const ok = Object.values(checks).every((value) => value !== false);

  console.log(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        inputsPath,
        rpcUrl: connection.rpcEndpoint,
        commitment,
        slot,
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
          programDataAddressFromProgram: parsedProgram.programDataAddress,
          oldMintSupplyRaw: parsedOldMint.supply.toString(),
          oldMintDecimals: parsedOldMint.decimals,
          programDataAuthority: parsedProgramData.authority,
          verifiedBuildExecutableHash: executableHash,
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

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

import { existsSync, readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve as resolvePath } from "node:path";

import { Connection, PublicKey } from "@solana/web3.js";
import type { Commitment, Finality } from "@solana/web3.js";

export const MINT_LEN = 82;
export const TOKEN_ACCOUNT_LEN = 165;
export const PROGRAMDATA_METADATA_LEN = 45;
export const PROGRAMDATA_DISCRIMINATOR = 3;
export const MAINNET_BETA_GENESIS_HASH = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
export const NATIVE_MINT_BASE58 = "So11111111111111111111111111111111111111112";

export type ReviewedBuildInfo = {
  generatedAt: string;
  gitCommit: string;
  libraryName: string;
  arch: string;
  mountBaseDir: string;
  mountPath: string;
  dockerPlatform: string;
  programSoPath: string;
  executableHash: string;
  programId: string | null;
  onChainHash: string | null;
  matchesOnChain: boolean | null;
  solanaVerifyVersion: string;
  solanaCliVersion: string;
};

type ParsedAccountKey = PublicKey | string | { pubkey: PublicKey | string };

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
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string or null`);
  }
  return value;
}

function asOptionalBoolean(value: unknown, label: string): boolean | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean or null`);
  }
  return value;
}

function parsedAccountKeyToBase58(accountKey: ParsedAccountKey): string {
  if (accountKey instanceof PublicKey) {
    return accountKey.toBase58();
  }
  if (typeof accountKey === "string") {
    return accountKey;
  }

  const pubkey = accountKey.pubkey;
  return pubkey instanceof PublicKey ? pubkey.toBase58() : pubkey;
}

export function resolveCommitment(): Commitment {
  const commitment = (process.env.SOLANA_COMMITMENT || "finalized") as Commitment;
  if (!["processed", "confirmed", "finalized"].includes(commitment)) {
    throw new Error(`Invalid SOLANA_COMMITMENT: ${commitment}`);
  }
  return commitment;
}

function resolveFinality(commitment: Commitment): Finality {
  return commitment === "finalized" ? "finalized" : "confirmed";
}

export function resolveRepoRoot(metaUrl: string): string {
  return fileURLToPath(new URL("../..", metaUrl));
}

export function resolveLocalPath(basePath: string, targetPath: string): string {
  return resolvePath(basePath, targetPath);
}

export function isDirectCliInvocation(metaUrl: string, argv: readonly string[] = process.argv): boolean {
  const entrypoint = argv[1];
  if (!entrypoint) {
    return false;
  }

  return resolvePath(entrypoint) === fileURLToPath(metaUrl);
}

export async function runCliMain(
  metaUrl: string,
  main: () => Promise<void>,
): Promise<void> {
  if (!isDirectCliInvocation(metaUrl)) {
    return;
  }

  try {
    await main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

export function readReviewedBuildInfo(buildInfoPath: string): ReviewedBuildInfo {
  if (!existsSync(buildInfoPath)) {
    throw new Error(`Reviewed build info not found: ${buildInfoPath}`);
  }
  if (!statSync(buildInfoPath).isFile()) {
    throw new Error(`Reviewed build info is not a file: ${buildInfoPath}`);
  }

  const record = asRecord(JSON.parse(readFileSync(buildInfoPath, "utf8")) as unknown, "build info");
  const reviewedBuildInfo: ReviewedBuildInfo = {
    generatedAt: asString(record.generatedAt, "buildInfo.generatedAt"),
    gitCommit: asString(record.gitCommit, "buildInfo.gitCommit"),
    libraryName: asString(record.libraryName, "buildInfo.libraryName"),
    arch: asString(record.arch, "buildInfo.arch"),
    mountBaseDir: asString(record.mountBaseDir, "buildInfo.mountBaseDir"),
    mountPath: asString(record.mountPath, "buildInfo.mountPath"),
    dockerPlatform: asString(record.dockerPlatform, "buildInfo.dockerPlatform"),
    programSoPath: asString(record.programSoPath, "buildInfo.programSoPath"),
    executableHash: asString(record.executableHash, "buildInfo.executableHash"),
    programId: asOptionalString(record.programId, "buildInfo.programId"),
    onChainHash: asOptionalString(record.onChainHash, "buildInfo.onChainHash"),
    matchesOnChain: asOptionalBoolean(record.matchesOnChain, "buildInfo.matchesOnChain"),
    solanaVerifyVersion: asString(record.solanaVerifyVersion, "buildInfo.solanaVerifyVersion"),
    solanaCliVersion: asString(record.solanaCliVersion, "buildInfo.solanaCliVersion"),
  };

  if (!/^[0-9a-f]{40}$/i.test(reviewedBuildInfo.gitCommit)) {
    throw new Error("buildInfo.gitCommit must be a full 40-character git hash");
  }
  if (!/^[0-9a-f]{64}$/i.test(reviewedBuildInfo.executableHash)) {
    throw new Error("buildInfo.executableHash must be a 64-character hex string");
  }

  return reviewedBuildInfo;
}

export function isMainnetBetaGenesisHash(genesisHash: string): boolean {
  return genesisHash === MAINNET_BETA_GENESIS_HASH;
}

export function parseMintData(data: Buffer) {
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

export function parseTokenAccountData(data: Buffer) {
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

export function parseProgramData(data: Buffer) {
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

export function computeExecutableHash(programSoPath: string) {
  if (!existsSync(programSoPath)) {
    throw new Error(`Verified build artifact not found: ${programSoPath}`);
  }
  if (!statSync(programSoPath).isFile()) {
    throw new Error(`Verified build artifact is not a file: ${programSoPath}`);
  }

  const result = spawnSync("solana-verify", ["get-executable-hash", programSoPath], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    const stderr = result.stderr.trim();
    throw new Error(stderr.length > 0 ? stderr : "solana-verify get-executable-hash failed");
  }

  const hash = result.stdout.trim();
  if (!/^[0-9a-f]{64}$/i.test(hash)) {
    throw new Error(`Unexpected executable hash format: ${hash}`);
  }

  return hash;
}

export async function verifyFundingSignature(
  connection: Connection,
  signature: string,
  reserveVault: PublicKey,
  expectedMint: PublicKey,
  commitment: Commitment,
) {
  const transaction = await connection.getParsedTransaction(signature, {
    commitment: resolveFinality(commitment),
    maxSupportedTransactionVersion: 0,
  });
  if (!transaction || !transaction.meta) {
    return {
      signature,
      transactionFound: false,
      reserveVaultSeen: false,
      mintMatchesExpected: false,
      reserveDeltaRaw: null,
      slot: null,
    };
  }

  const accountKeys = transaction.transaction.message.accountKeys;
  const reserveVaultBase58 = reserveVault.toBase58();
  const expectedMintBase58 = expectedMint.toBase58();
  let reserveVaultSeen = false;
  let mintMatchesExpected = false;
  let preAmount = 0n;
  let postAmount = 0n;

  for (const balance of transaction.meta.preTokenBalances ?? []) {
    const accountKey = accountKeys[balance.accountIndex];
    if (accountKey && parsedAccountKeyToBase58(accountKey as ParsedAccountKey) === reserveVaultBase58) {
      reserveVaultSeen = true;
      if (balance.mint === expectedMintBase58) {
        mintMatchesExpected = true;
        preAmount += BigInt(balance.uiTokenAmount.amount);
      }
    }
  }

  for (const balance of transaction.meta.postTokenBalances ?? []) {
    const accountKey = accountKeys[balance.accountIndex];
    if (accountKey && parsedAccountKeyToBase58(accountKey as ParsedAccountKey) === reserveVaultBase58) {
      reserveVaultSeen = true;
      if (balance.mint === expectedMintBase58) {
        mintMatchesExpected = true;
        postAmount += BigInt(balance.uiTokenAmount.amount);
      }
    }
  }

  return {
    signature,
    transactionFound: true,
    reserveVaultSeen,
    mintMatchesExpected,
    reserveDeltaRaw: (postAmount - preAmount).toString(),
    slot: transaction.slot,
  };
}

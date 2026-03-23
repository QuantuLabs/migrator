import { existsSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve as resolvePath } from "node:path";

import { Connection, PublicKey } from "@solana/web3.js";
import type { Commitment, Finality } from "@solana/web3.js";

export const MINT_LEN = 82;
export const TOKEN_ACCOUNT_LEN = 165;
export const PROGRAMDATA_METADATA_LEN = 45;
export const PROGRAMDATA_DISCRIMINATOR = 3;

type ParsedAccountKey = PublicKey | string | { pubkey: PublicKey | string };

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

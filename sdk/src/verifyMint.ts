import type { AccountInfo, Commitment } from "@solana/web3.js";
import { Connection, PublicKey } from "@solana/web3.js";

import { TOKEN_PROGRAM_ID } from "./index.ts";
import {
  MINT_LEN,
  NATIVE_MINT_BASE58,
  parseMintData,
  resolveCommitment,
  runCliMain,
} from "./releaseUtils.ts";

export type MintReport = {
  mint: string;
  rpcUrl: string;
  commitment: Commitment;
  slot: number;
  owner: string;
  lamports: number;
  executable: boolean;
  decimals: number;
  supply: string;
  checks: {
    tokenkegOwner: boolean;
    accountLength82: boolean;
    isInitialized: boolean;
    mintAuthorityDisabled: boolean;
    freezeAuthorityDisabled: boolean;
    decimalsMatchExpected: boolean;
    mintIsNotNativeMint: boolean;
  };
  ok: boolean;
};

export function buildMintReport(params: {
  rpcUrl: string;
  commitment: Commitment;
  slot: number;
  mint: PublicKey;
  expectedDecimals: number;
  info: AccountInfo<Buffer>;
}): MintReport {
  const parsed = parseMintData(params.info.data);
  const checks = {
    tokenkegOwner: params.info.owner.equals(TOKEN_PROGRAM_ID),
    accountLength82: params.info.data.length === MINT_LEN,
    isInitialized: parsed.isInitialized,
    mintAuthorityDisabled: parsed.mintAuthorityOption === 0,
    freezeAuthorityDisabled: parsed.freezeAuthorityOption === 0,
    decimalsMatchExpected: parsed.decimals === params.expectedDecimals,
    mintIsNotNativeMint: params.mint.toBase58() !== NATIVE_MINT_BASE58,
  };
  const ok = Object.values(checks).every((value) => value !== false);

  return {
    mint: params.mint.toBase58(),
    rpcUrl: params.rpcUrl,
    commitment: params.commitment,
    slot: params.slot,
    owner: params.info.owner.toBase58(),
    lamports: params.info.lamports,
    executable: params.info.executable,
    decimals: parsed.decimals,
    supply: parsed.supply.toString(),
    checks,
    ok,
  };
}

export async function main() {
  const mintArg = process.argv[2];
  const expectedDecimalsArg = process.argv[3];
  const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
  const commitment = resolveCommitment();

  if (!mintArg || expectedDecimalsArg === undefined) {
    throw new Error("Usage: node src/verifyMint.ts <MINT_ADDRESS> <EXPECTED_DECIMALS>");
  }

  const expectedDecimals = Number.parseInt(expectedDecimalsArg, 10);
  if (Number.isNaN(expectedDecimals)) {
    throw new Error(`Invalid expected decimals: ${expectedDecimalsArg}`);
  }

  const connection = new Connection(rpcUrl, commitment);
  const mint = new PublicKey(mintArg);
  const { context, value: info } = await connection.getAccountInfoAndContext(mint, commitment);

  if (!info) {
    throw new Error(`Mint not found: ${mint.toBase58()}`);
  }

  const report = buildMintReport({
    rpcUrl,
    commitment,
    slot: context.slot,
    mint,
    expectedDecimals,
    info,
  });

  console.log(JSON.stringify(report, null, 2));

  if (!report.ok) {
    process.exit(1);
  }
}

void runCliMain(import.meta.url, main);

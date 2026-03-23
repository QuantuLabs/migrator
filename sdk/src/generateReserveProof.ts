import type { AccountInfo, Commitment } from "@solana/web3.js";
import { Connection, PublicKey } from "@solana/web3.js";

import { TOKEN_PROGRAM_ID, findVaultAuthorityPda } from "./index.ts";
import {
  NATIVE_MINT_BASE58,
  parseMintData,
  parseTokenAccountData,
  resolveCommitment,
  runCliMain,
  verifyFundingSignature,
} from "./releaseUtils.ts";

export type ReserveProofReport = {
  generatedAt: string;
  rpcUrl: string;
  commitment: Commitment;
  slot: number;
  fundingSignature: string | null;
  fundingSignatureObservation: Awaited<ReturnType<typeof verifyFundingSignature>> | null;
  programId: string;
  newMint: string;
  reserveVault: string;
  expectedVaultAuthority: string;
  expectedDecimals: number;
  eligibleRawUnits: string;
  reserveRawUnits: string;
  reserveShortfallRawUnits: string;
  mintSupplyRawUnits: string;
  checks: {
    mintOwnedByTokenkeg: boolean;
    mintInitialized: boolean;
    mintAuthorityDisabled: boolean;
    freezeAuthorityDisabled: boolean;
    decimalsMatchExpected: boolean;
    mintIsNotNativeMint: boolean;
    reserveOwnedByTokenkeg: boolean;
    reserveMintMatches: boolean;
    reserveOwnerMatchesPda: boolean;
    reserveInitialized: boolean;
    reserveDelegateCleared: boolean;
    reserveDelegatedAmountCleared: boolean;
    reserveCloseAuthorityCleared: boolean;
    reserveCoversEligibleSupply: boolean;
    fundingSignatureExists: boolean | null;
    fundingSignatureTouchesReserveVault: boolean | null;
    fundingSignatureMintMatchesNewMint: boolean | null;
    fundingSignatureDeltaPositive: boolean | null;
  };
  ok: boolean;
};

export function buildReserveProofReport(params: {
  rpcUrl: string;
  commitment: Commitment;
  slot: number;
  programId: PublicKey;
  newMint: PublicKey;
  reserveVault: PublicKey;
  vaultAuthority: PublicKey;
  expectedDecimals: number;
  eligibleRawUnits: bigint;
  fundingSignature: string | null;
  fundingCheck: Awaited<ReturnType<typeof verifyFundingSignature>> | null;
  mintInfo: AccountInfo<Buffer>;
  reserveInfo: AccountInfo<Buffer>;
}): ReserveProofReport {
  const mint = parseMintData(params.mintInfo.data);
  const reserve = parseTokenAccountData(params.reserveInfo.data);
  const reserveGteEligible = reserve.amount >= params.eligibleRawUnits;
  const checks = {
    mintOwnedByTokenkeg: params.mintInfo.owner.equals(TOKEN_PROGRAM_ID),
    mintInitialized: mint.isInitialized,
    mintAuthorityDisabled: mint.mintAuthorityOption === 0,
    freezeAuthorityDisabled: mint.freezeAuthorityOption === 0,
    decimalsMatchExpected: mint.decimals === params.expectedDecimals,
    mintIsNotNativeMint: params.newMint.toBase58() !== NATIVE_MINT_BASE58,
    reserveOwnedByTokenkeg: params.reserveInfo.owner.equals(TOKEN_PROGRAM_ID),
    reserveMintMatches: reserve.mint === params.newMint.toBase58(),
    reserveOwnerMatchesPda: reserve.owner === params.vaultAuthority.toBase58(),
    reserveInitialized: reserve.state === 1,
    reserveDelegateCleared: reserve.delegateOption === 0,
    reserveDelegatedAmountCleared: reserve.delegatedAmount === 0n,
    reserveCloseAuthorityCleared: reserve.closeAuthorityOption === 0,
    reserveCoversEligibleSupply: reserveGteEligible,
    fundingSignatureExists: params.fundingCheck === null ? null : params.fundingCheck.transactionFound,
    fundingSignatureTouchesReserveVault:
      params.fundingCheck === null ? null : params.fundingCheck.reserveVaultSeen,
    fundingSignatureMintMatchesNewMint:
      params.fundingCheck === null ? null : params.fundingCheck.mintMatchesExpected,
    fundingSignatureDeltaPositive:
      params.fundingCheck === null
        ? null
        : BigInt(params.fundingCheck.reserveDeltaRaw ?? "0") > 0n,
  };
  const ok = Object.values(checks).every((value) => value !== false);

  return {
    generatedAt: new Date().toISOString(),
    rpcUrl: params.rpcUrl,
    commitment: params.commitment,
    slot: params.slot,
    fundingSignature: params.fundingSignature,
    fundingSignatureObservation: params.fundingCheck,
    programId: params.programId.toBase58(),
    newMint: params.newMint.toBase58(),
    reserveVault: params.reserveVault.toBase58(),
    expectedVaultAuthority: params.vaultAuthority.toBase58(),
    expectedDecimals: params.expectedDecimals,
    eligibleRawUnits: params.eligibleRawUnits.toString(),
    reserveRawUnits: reserve.amount.toString(),
    reserveShortfallRawUnits:
      reserve.amount >= params.eligibleRawUnits
        ? "0"
        : (params.eligibleRawUnits - reserve.amount).toString(),
    mintSupplyRawUnits: mint.supply.toString(),
    checks,
    ok,
  };
}

export async function main() {
  const programIdArg = process.argv[2];
  const newMintArg = process.argv[3];
  const reserveVaultArg = process.argv[4];
  const eligibleRawUnitsArg = process.argv[5];
  const expectedDecimalsArg = process.argv[6];
  const fundingSignature = process.argv[7] || null;
  const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
  const commitment = resolveCommitment();

  if (!programIdArg || !newMintArg || !reserveVaultArg || !eligibleRawUnitsArg || !expectedDecimalsArg) {
    throw new Error(
      "Usage: node src/generateReserveProof.ts <PROGRAM_ID> <DESTINATION_MINT> <RESERVE_VAULT> <ELIGIBLE_RAW_UNITS> <EXPECTED_DECIMALS> [FUNDING_SIGNATURE]",
    );
  }

  const eligibleRawUnits = BigInt(eligibleRawUnitsArg);
  const expectedDecimals = Number.parseInt(expectedDecimalsArg, 10);
  if (expectedDecimals < 0 || Number.isNaN(expectedDecimals)) {
    throw new Error(`Invalid expected decimals: ${expectedDecimalsArg}`);
  }

  const connection = new Connection(rpcUrl, commitment);
  const programId = new PublicKey(programIdArg);
  const newMint = new PublicKey(newMintArg);
  const reserveVault = new PublicKey(reserveVaultArg);
  const [vaultAuthority] = findVaultAuthorityPda(programId);
  const { context, value } = await connection.getMultipleAccountsInfoAndContext(
    [newMint, reserveVault],
    commitment,
  );
  const [mintInfo, reserveInfo] = value;

  if (!mintInfo) {
    throw new Error(`Mint not found: ${newMint.toBase58()}`);
  }
  if (!reserveInfo) {
    throw new Error(`Reserve vault not found: ${reserveVault.toBase58()}`);
  }

  const fundingCheck =
    fundingSignature === null
      ? null
      : await verifyFundingSignature(
          connection,
          fundingSignature,
          reserveVault,
          newMint,
          commitment,
        );

  const report = buildReserveProofReport({
    rpcUrl,
    commitment,
    slot: context.slot,
    programId,
    newMint,
    reserveVault,
    vaultAuthority,
    expectedDecimals,
    eligibleRawUnits,
    fundingSignature,
    fundingCheck,
    mintInfo,
    reserveInfo,
  });

  console.log(JSON.stringify(report, null, 2));

  if (!report.ok) {
    process.exit(1);
  }
}

void runCliMain(import.meta.url, main);

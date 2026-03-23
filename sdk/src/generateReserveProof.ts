import { Connection, PublicKey } from "@solana/web3.js";

import {
  TOKEN_PROGRAM_ID,
  findVaultAuthorityPda,
} from "./index.ts";
import {
  parseMintData,
  parseTokenAccountData,
  resolveCommitment,
  verifyFundingSignature,
} from "./releaseUtils.ts";

async function main() {
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
      "Usage: node src/generateReserveProof.ts <PROGRAM_ID> <NEW_QX_MINT> <RESERVE_VAULT> <ELIGIBLE_RAW_UNITS> <EXPECTED_DECIMALS> [FUNDING_SIGNATURE]",
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
  const slot = await connection.getSlot(commitment);
  const mintInfo = await connection.getAccountInfo(newMint, commitment);
  const reserveInfo = await connection.getAccountInfo(reserveVault, commitment);

  if (!mintInfo) {
    throw new Error(`Mint not found: ${newMint.toBase58()}`);
  }
  if (!reserveInfo) {
    throw new Error(`Reserve vault not found: ${reserveVault.toBase58()}`);
  }

  const mint = parseMintData(mintInfo.data);
  const reserve = parseTokenAccountData(reserveInfo.data);
  const reserveGteEligible = reserve.amount >= eligibleRawUnits;
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

  const checks = {
    mintOwnedByTokenkeg: mintInfo.owner.equals(TOKEN_PROGRAM_ID),
    mintInitialized: mint.isInitialized,
    mintAuthorityDisabled: mint.mintAuthorityOption === 0,
    freezeAuthorityDisabled: mint.freezeAuthorityOption === 0,
    decimalsMatchExpected: mint.decimals === expectedDecimals,
    reserveOwnedByTokenkeg: reserveInfo.owner.equals(TOKEN_PROGRAM_ID),
    reserveMintMatches: reserve.mint === newMint.toBase58(),
    reserveOwnerMatchesPda: reserve.owner === vaultAuthority.toBase58(),
    reserveInitialized: reserve.state === 1,
    reserveDelegateCleared: reserve.delegateOption === 0,
    reserveDelegatedAmountCleared: reserve.delegatedAmount === 0n,
    reserveCloseAuthorityCleared: reserve.closeAuthorityOption === 0,
    reserveCoversEligibleSupply: reserveGteEligible,
    fundingSignatureExists: fundingCheck === null ? null : fundingCheck.transactionFound,
    fundingSignatureTouchesReserveVault:
      fundingCheck === null ? null : fundingCheck.reserveVaultSeen,
    fundingSignatureMintMatchesNewMint:
      fundingCheck === null ? null : fundingCheck.mintMatchesExpected,
    fundingSignatureDeltaPositive:
      fundingCheck === null ? null : BigInt(fundingCheck.reserveDeltaRaw ?? "0") > 0n,
  };
  const ok = Object.values(checks).every((value) => value !== false);

  console.log(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        rpcUrl,
        commitment,
        slot,
        fundingSignature,
        fundingSignatureObservation: fundingCheck,
        programId: programId.toBase58(),
        newMint: newMint.toBase58(),
        reserveVault: reserveVault.toBase58(),
        expectedVaultAuthority: vaultAuthority.toBase58(),
        expectedDecimals,
        eligibleRawUnits: eligibleRawUnits.toString(),
        reserveRawUnits: reserve.amount.toString(),
        reserveShortfallRawUnits:
          reserve.amount >= eligibleRawUnits ? "0" : (eligibleRawUnits - reserve.amount).toString(),
        mintSupplyRawUnits: mint.supply.toString(),
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

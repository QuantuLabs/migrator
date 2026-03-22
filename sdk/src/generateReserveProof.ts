import { Commitment, Connection, PublicKey } from "@solana/web3.js";

import {
  TOKEN_PROGRAM_ID,
  findVaultAuthorityPda,
} from "./index.ts";

const MINT_LEN = 82;
const TOKEN_ACCOUNT_LEN = 165;

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
  };
  const ok = Object.values(checks).every(Boolean);

  console.log(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        rpcUrl,
        commitment,
        slot,
        fundingSignature,
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

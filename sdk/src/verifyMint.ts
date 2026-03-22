import { Commitment, Connection, PublicKey } from "@solana/web3.js";

export const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const MINT_LEN = 82;

function parseMintData(data: Buffer) {
  if (data.length < MINT_LEN) {
    throw new Error(`Mint data too short: expected at least ${MINT_LEN}, got ${data.length}`);
  }

  return {
    mintAuthorityOption: data.readUInt32LE(0),
    supply: data.readBigUInt64LE(36),
    decimals: data[44],
    isInitialized: data[45] === 1,
    freezeAuthorityOption: data.readUInt32LE(46),
  };
}

async function main() {
  const mintArg = process.argv[2];
  const expectedDecimalsArg = process.argv[3];
  const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
  const commitment = (process.env.SOLANA_COMMITMENT || "finalized") as Commitment;

  if (!mintArg) {
    throw new Error("Usage: node src/verifyMint.ts <MINT_ADDRESS> [EXPECTED_DECIMALS]");
  }
  if (!["processed", "confirmed", "finalized"].includes(commitment)) {
    throw new Error(`Invalid SOLANA_COMMITMENT: ${commitment}`);
  }

  const expectedDecimals =
    expectedDecimalsArg === undefined ? null : Number.parseInt(expectedDecimalsArg, 10);
  if (expectedDecimalsArg !== undefined && Number.isNaN(expectedDecimals)) {
    throw new Error(`Invalid expected decimals: ${expectedDecimalsArg}`);
  }

  const connection = new Connection(rpcUrl, commitment);
  const mint = new PublicKey(mintArg);
  const slot = await connection.getSlot(commitment);
  const info = await connection.getAccountInfo(mint, commitment);

  if (!info) {
    throw new Error(`Mint not found: ${mint.toBase58()}`);
  }

  const parsed = parseMintData(info.data);
  const checks = {
    tokenkegOwner: info.owner.equals(TOKEN_PROGRAM_ID),
    accountLength82: info.data.length === MINT_LEN,
    isInitialized: parsed.isInitialized,
    mintAuthorityDisabled: parsed.mintAuthorityOption === 0,
    freezeAuthorityDisabled: parsed.freezeAuthorityOption === 0,
    decimalsMatchExpected: expectedDecimals === null ? null : parsed.decimals === expectedDecimals,
  };
  const ok = Object.values(checks).every((value) => value !== false);

  console.log(
    JSON.stringify(
      {
        mint: mint.toBase58(),
        rpcUrl,
        commitment,
        slot,
        owner: info.owner.toBase58(),
        lamports: info.lamports,
        executable: info.executable,
        decimals: parsed.decimals,
        supply: parsed.supply.toString(),
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

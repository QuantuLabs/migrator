import { Connection, PublicKey } from "@solana/web3.js";

import { MINT_LEN, parseMintData, resolveCommitment } from "./releaseUtils.ts";

async function main() {
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
  const slot = await connection.getSlot(commitment);
  const info = await connection.getAccountInfo(mint, commitment);

  if (!info) {
    throw new Error(`Mint not found: ${mint.toBase58()}`);
  }

  const parsed = parseMintData(info.data);
  const checks = {
    tokenkegOwner: info.owner.equals(new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")),
    accountLength82: info.data.length === MINT_LEN,
    isInitialized: parsed.isInitialized,
    mintAuthorityDisabled: parsed.mintAuthorityOption === 0,
    freezeAuthorityDisabled: parsed.freezeAuthorityOption === 0,
    decimalsMatchExpected: parsed.decimals === expectedDecimals,
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

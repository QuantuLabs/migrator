import { Connection, PublicKey } from "@solana/web3.js";

export const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

async function main() {
  const mintArg = process.argv[2];
  const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";

  if (!mintArg) {
    throw new Error("Usage: node src/verifyMint.ts <MINT_ADDRESS>");
  }

  const connection = new Connection(rpcUrl, "confirmed");
  const mint = new PublicKey(mintArg);
  const info = await connection.getParsedAccountInfo(mint, "confirmed");
  const value = info.value;

  if (!value) {
    throw new Error(`Mint not found: ${mint.toBase58()}`);
  }

  const parsed = "parsed" in value.data ? value.data.parsed : null;
  const program = "program" in value.data ? value.data.program : null;
  const space = "space" in value.data ? value.data.space : null;

  const result = {
    mint: mint.toBase58(),
    owner: value.owner.toBase58(),
    executable: value.executable,
    lamports: value.lamports,
    program,
    space,
    tokenkeg: value.owner.equals(TOKEN_PROGRAM_ID),
    parsed,
  };

  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

import { Connection, PublicKey } from "@solana/web3.js";

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const VAULT_AUTHORITY_SEED = Buffer.from("vault-authority");

async function main() {
  const programIdArg = process.argv[2];
  const newMintArg = process.argv[3];
  const reserveVaultArg = process.argv[4];
  const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";

  if (!programIdArg || !newMintArg || !reserveVaultArg) {
    throw new Error(
      "Usage: node src/verifyReserveVault.ts <PROGRAM_ID> <NEW_QX_MINT> <RESERVE_VAULT>",
    );
  }

  const connection = new Connection(rpcUrl, "confirmed");
  const programId = new PublicKey(programIdArg);
  const newMint = new PublicKey(newMintArg);
  const reserveVault = new PublicKey(reserveVaultArg);
  const [vaultAuthority] = PublicKey.findProgramAddressSync([VAULT_AUTHORITY_SEED], programId);

  const info = await connection.getParsedAccountInfo(reserveVault, "confirmed");
  const value = info.value;

  if (!value) {
    throw new Error(`Reserve vault not found: ${reserveVault.toBase58()}`);
  }

  const parsed = "parsed" in value.data ? value.data.parsed : null;
  const program = "program" in value.data ? value.data.program : null;
  const space = "space" in value.data ? value.data.space : null;
  const parsedInfo =
    parsed && typeof parsed === "object" && "info" in parsed ? (parsed.info as Record<string, unknown>) : null;

  const mint = typeof parsedInfo?.mint === "string" ? parsedInfo.mint : null;
  const owner = typeof parsedInfo?.owner === "string" ? parsedInfo.owner : null;
  const state = typeof parsedInfo?.state === "string" ? parsedInfo.state : null;
  const tokenAmount =
    parsedInfo &&
    typeof parsedInfo === "object" &&
    "tokenAmount" in parsedInfo &&
    parsedInfo.tokenAmount &&
    typeof parsedInfo.tokenAmount === "object"
      ? parsedInfo.tokenAmount
      : null;

  const result = {
    reserveVault: reserveVault.toBase58(),
    programId: programId.toBase58(),
    expectedVaultAuthority: vaultAuthority.toBase58(),
    expectedNewMint: newMint.toBase58(),
    ownerProgram: value.owner.toBase58(),
    executable: value.executable,
    lamports: value.lamports,
    program,
    space,
    tokenkeg: value.owner.equals(TOKEN_PROGRAM_ID),
    parsed,
    checks: {
      reserveVaultMintMatches: mint === newMint.toBase58(),
      reserveVaultOwnerMatchesPda: owner === vaultAuthority.toBase58(),
      initialized: state === "initialized",
    },
    tokenAmount,
  };

  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

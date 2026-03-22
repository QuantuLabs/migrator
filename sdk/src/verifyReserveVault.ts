import { Commitment, Connection, PublicKey } from "@solana/web3.js";

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const VAULT_AUTHORITY_SEED = Buffer.from("vault-authority");
const TOKEN_ACCOUNT_LEN = 165;

function parseTokenAccountData(data: Buffer) {
  if (data.length < TOKEN_ACCOUNT_LEN) {
    throw new Error(
      `Token account data too short: expected at least ${TOKEN_ACCOUNT_LEN}, got ${data.length}`,
    );
  }

  return {
    mint: new PublicKey(data.subarray(0, 32)).toBase58(),
    owner: new PublicKey(data.subarray(32, 64)).toBase58(),
    amount: data.readBigUInt64LE(64).toString(),
    delegateOption: data.readUInt32LE(72),
    state: data[108],
    delegatedAmount: data.readBigUInt64LE(121).toString(),
    closeAuthorityOption: data.readUInt32LE(129),
  };
}

async function main() {
  const programIdArg = process.argv[2];
  const newMintArg = process.argv[3];
  const reserveVaultArg = process.argv[4];
  const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
  const commitment = (process.env.SOLANA_COMMITMENT || "finalized") as Commitment;

  if (!programIdArg || !newMintArg || !reserveVaultArg) {
    throw new Error(
      "Usage: node src/verifyReserveVault.ts <PROGRAM_ID> <NEW_QX_MINT> <RESERVE_VAULT>",
    );
  }
  if (!["processed", "confirmed", "finalized"].includes(commitment)) {
    throw new Error(`Invalid SOLANA_COMMITMENT: ${commitment}`);
  }

  const connection = new Connection(rpcUrl, commitment);
  const programId = new PublicKey(programIdArg);
  const newMint = new PublicKey(newMintArg);
  const reserveVault = new PublicKey(reserveVaultArg);
  const [vaultAuthority] = PublicKey.findProgramAddressSync([VAULT_AUTHORITY_SEED], programId);
  const slot = await connection.getSlot(commitment);

  const info = await connection.getAccountInfo(reserveVault, commitment);
  if (!info) {
    throw new Error(`Reserve vault not found: ${reserveVault.toBase58()}`);
  }

  const parsed = parseTokenAccountData(info.data);
  const checks = {
    tokenkegOwner: info.owner.equals(TOKEN_PROGRAM_ID),
    accountLength165: info.data.length === TOKEN_ACCOUNT_LEN,
    reserveVaultMintMatches: parsed.mint === newMint.toBase58(),
    reserveVaultOwnerMatchesPda: parsed.owner === vaultAuthority.toBase58(),
    initialized: parsed.state === 1,
    delegateCleared: parsed.delegateOption === 0,
    delegatedAmountCleared: parsed.delegatedAmount === "0",
    closeAuthorityCleared: parsed.closeAuthorityOption === 0,
  };
  const ok = Object.values(checks).every(Boolean);

  console.log(
    JSON.stringify(
      {
        reserveVault: reserveVault.toBase58(),
        rpcUrl,
        commitment,
        slot,
        programId: programId.toBase58(),
        expectedVaultAuthority: vaultAuthority.toBase58(),
        expectedNewMint: newMint.toBase58(),
        ownerProgram: info.owner.toBase58(),
        lamports: info.lamports,
        executable: info.executable,
        parsed,
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

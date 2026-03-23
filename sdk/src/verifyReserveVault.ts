import type { AccountInfo, Commitment } from "@solana/web3.js";
import { Connection, PublicKey } from "@solana/web3.js";

import { TOKEN_PROGRAM_ID, findVaultAuthorityPda } from "./index.ts";
import {
  parseTokenAccountData,
  resolveCommitment,
  runCliMain,
} from "./releaseUtils.ts";

export type ReserveVaultReport = {
  reserveVault: string;
  rpcUrl: string;
  commitment: Commitment;
  slot: number;
  programId: string;
  expectedVaultAuthority: string;
  expectedNewMint: string;
  ownerProgram: string;
  lamports: number;
  executable: boolean;
  parsed: {
    mint: string;
    owner: string;
    amount: string;
    delegateOption: number;
    state: number;
    delegatedAmount: string;
    closeAuthorityOption: number;
  };
  checks: {
    tokenkegOwner: boolean;
    accountLength165: boolean;
    reserveVaultMintMatches: boolean;
    reserveVaultOwnerMatchesPda: boolean;
    initialized: boolean;
    delegateCleared: boolean;
    delegatedAmountCleared: boolean;
    closeAuthorityCleared: boolean;
  };
  ok: boolean;
};

export function buildReserveVaultReport(params: {
  rpcUrl: string;
  commitment: Commitment;
  slot: number;
  programId: PublicKey;
  newMint: PublicKey;
  reserveVault: PublicKey;
  vaultAuthority: PublicKey;
  info: AccountInfo<Buffer>;
}): ReserveVaultReport {
  const parsed = parseTokenAccountData(params.info.data);
  const checks = {
    tokenkegOwner: params.info.owner.equals(TOKEN_PROGRAM_ID),
    accountLength165: params.info.data.length === 165,
    reserveVaultMintMatches: parsed.mint === params.newMint.toBase58(),
    reserveVaultOwnerMatchesPda: parsed.owner === params.vaultAuthority.toBase58(),
    initialized: parsed.state === 1,
    delegateCleared: parsed.delegateOption === 0,
    delegatedAmountCleared: parsed.delegatedAmount === 0n,
    closeAuthorityCleared: parsed.closeAuthorityOption === 0,
  };
  const ok = Object.values(checks).every(Boolean);

  return {
    reserveVault: params.reserveVault.toBase58(),
    rpcUrl: params.rpcUrl,
    commitment: params.commitment,
    slot: params.slot,
    programId: params.programId.toBase58(),
    expectedVaultAuthority: params.vaultAuthority.toBase58(),
    expectedNewMint: params.newMint.toBase58(),
    ownerProgram: params.info.owner.toBase58(),
    lamports: params.info.lamports,
    executable: params.info.executable,
    parsed: {
      mint: parsed.mint,
      owner: parsed.owner,
      amount: parsed.amount.toString(),
      delegateOption: parsed.delegateOption,
      state: parsed.state,
      delegatedAmount: parsed.delegatedAmount.toString(),
      closeAuthorityOption: parsed.closeAuthorityOption,
    },
    checks,
    ok,
  };
}

export async function verifyReserveVault(params: {
  connection: Connection;
  commitment: Commitment;
  programId: PublicKey;
  newMint: PublicKey;
  reserveVault: PublicKey;
}): Promise<ReserveVaultReport> {
  const [vaultAuthority] = findVaultAuthorityPda(params.programId);
  const { context, value: info } = await params.connection.getAccountInfoAndContext(
    params.reserveVault,
    params.commitment,
  );
  if (!info) {
    throw new Error(`Reserve vault not found: ${params.reserveVault.toBase58()}`);
  }

  return buildReserveVaultReport({
    rpcUrl: params.connection.rpcEndpoint,
    commitment: params.commitment,
    slot: context.slot,
    programId: params.programId,
    newMint: params.newMint,
    reserveVault: params.reserveVault,
    vaultAuthority,
    info,
  });
}

export async function main() {
  const programIdArg = process.argv[2];
  const newMintArg = process.argv[3];
  const reserveVaultArg = process.argv[4];
  const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
  const commitment = resolveCommitment();

  if (!programIdArg || !newMintArg || !reserveVaultArg) {
    throw new Error(
      "Usage: node src/verifyReserveVault.ts <PROGRAM_ID> <NEW_QX_MINT> <RESERVE_VAULT>",
    );
  }

  const report = await verifyReserveVault({
    connection: new Connection(rpcUrl, commitment),
    commitment,
    programId: new PublicKey(programIdArg),
    newMint: new PublicKey(newMintArg),
    reserveVault: new PublicKey(reserveVaultArg),
  });

  console.log(JSON.stringify(report, null, 2));

  if (!report.ok) {
    process.exit(1);
  }
}

void runCliMain(import.meta.url, main);

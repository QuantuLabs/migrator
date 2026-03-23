import type { AccountInfo, Commitment } from "@solana/web3.js";
import { Connection, PublicKey } from "@solana/web3.js";

import { BPF_LOADER_UPGRADEABLE_PROGRAM_ID, findProgramDataPda } from "./index.ts";
import {
  PROGRAMDATA_DISCRIMINATOR,
  parseProgramData,
  resolveCommitment,
  runCliMain,
} from "./releaseUtils.ts";

const PROGRAM_ACCOUNT_METADATA_LEN = 36;
const PROGRAM_DISCRIMINATOR = 2;

function parseProgramAccount(data: Buffer) {
  if (data.length < PROGRAM_ACCOUNT_METADATA_LEN) {
    throw new Error(
      `Program account too short: expected at least ${PROGRAM_ACCOUNT_METADATA_LEN}, got ${data.length}`,
    );
  }

  return {
    stateDiscriminator: data.readUInt32LE(0),
    programDataAddress: new PublicKey(data.subarray(4, 36)).toBase58(),
  };
}

export type ProgramAuthorityReport = {
  rpcUrl: string;
  commitment: Commitment;
  slot: number;
  programId: string;
  programDataPda: string;
  programOwner: string;
  ownerProgram: string;
  programExecutable: boolean;
  programParsed: ReturnType<typeof parseProgramAccount>;
  lamports: number;
  executable: boolean;
  parsed: ReturnType<typeof parseProgramData>;
  expectedAuthority: string | "none";
  checks: {
    programOwnedByUpgradeableLoader: boolean;
    programExecutable: boolean;
    programStateDiscriminatorMatches: boolean;
    programProgramDataMatchesDerived: boolean;
    ownedByUpgradeableLoader: boolean;
    stateDiscriminatorMatches: boolean;
    authorityOptionIsKnown: boolean;
    expectedAuthorityMatches: boolean;
  };
  ok: boolean;
};

function normalizeExpectedAuthority(expectedAuthorityArg: string): string | "none" {
  return expectedAuthorityArg === "none" || expectedAuthorityArg === "null"
    ? "none"
    : new PublicKey(expectedAuthorityArg).toBase58();
}

export function buildProgramAuthorityReport(params: {
  rpcUrl: string;
  commitment: Commitment;
  slot: number;
  programId: PublicKey;
  programDataPda: PublicKey;
  programInfo: AccountInfo<Buffer>;
  programDataInfo: AccountInfo<Buffer>;
  expectedAuthority: string | "none";
}): ProgramAuthorityReport {
  const programParsed = parseProgramAccount(params.programInfo.data);
  const parsed = parseProgramData(params.programDataInfo.data);
  const checks = {
    programOwnedByUpgradeableLoader: params.programInfo.owner.equals(
      BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    ),
    programExecutable: params.programInfo.executable,
    programStateDiscriminatorMatches:
      programParsed.stateDiscriminator === PROGRAM_DISCRIMINATOR,
    programProgramDataMatchesDerived:
      programParsed.programDataAddress === params.programDataPda.toBase58(),
    ownedByUpgradeableLoader: params.programDataInfo.owner.equals(
      BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    ),
    stateDiscriminatorMatches: parsed.stateDiscriminator === PROGRAMDATA_DISCRIMINATOR,
    authorityOptionIsKnown: parsed.authorityOption === 0 || parsed.authorityOption === 1,
    expectedAuthorityMatches:
      params.expectedAuthority === "none"
        ? parsed.authority === null
        : parsed.authority === params.expectedAuthority,
  };
  const ok = Object.values(checks).every((value) => value !== false);

  return {
    rpcUrl: params.rpcUrl,
    commitment: params.commitment,
    slot: params.slot,
    programId: params.programId.toBase58(),
    programDataPda: params.programDataPda.toBase58(),
    programOwner: params.programInfo.owner.toBase58(),
    ownerProgram: params.programDataInfo.owner.toBase58(),
    programExecutable: params.programInfo.executable,
    programParsed,
    lamports: params.programDataInfo.lamports,
    executable: params.programDataInfo.executable,
    parsed,
    expectedAuthority: params.expectedAuthority,
    checks,
    ok,
  };
}

export async function verifyProgramAuthority(params: {
  connection: Connection;
  commitment: Commitment;
  programId: PublicKey;
  expectedAuthorityArg: string;
}): Promise<ProgramAuthorityReport> {
  const [programDataPda] = findProgramDataPda(params.programId);
  const { context, value } = await params.connection.getMultipleAccountsInfoAndContext(
    [params.programId, programDataPda],
    params.commitment,
  );
  const [programInfo, programDataInfo] = value;
  if (!programInfo) {
    throw new Error(`Program account not found: ${params.programId.toBase58()}`);
  }
  if (!programDataInfo) {
    throw new Error(`ProgramData account not found: ${programDataPda.toBase58()}`);
  }

  return buildProgramAuthorityReport({
    rpcUrl: params.connection.rpcEndpoint,
    commitment: params.commitment,
    slot: context.slot,
    programId: params.programId,
    programDataPda,
    programInfo,
    programDataInfo,
    expectedAuthority: normalizeExpectedAuthority(params.expectedAuthorityArg),
  });
}

export async function main() {
  const programIdArg = process.argv[2];
  const expectedAuthorityArg = process.argv[3];
  const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
  const commitment = resolveCommitment();

  if (!programIdArg || expectedAuthorityArg === undefined) {
    throw new Error(
      "Usage: node src/verifyProgramAuthority.ts <PROGRAM_ID> <EXPECTED_AUTHORITY|none>",
    );
  }

  const report = await verifyProgramAuthority({
    connection: new Connection(rpcUrl, commitment),
    commitment,
    programId: new PublicKey(programIdArg),
    expectedAuthorityArg,
  });

  console.log(JSON.stringify(report, null, 2));

  if (!report.ok) {
    process.exit(1);
  }
}

void runCliMain(import.meta.url, main);

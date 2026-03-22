import { Commitment, Connection, PublicKey } from "@solana/web3.js";

import { BPF_LOADER_UPGRADEABLE_PROGRAM_ID, findProgramDataPda } from "./index.ts";

const PROGRAMDATA_METADATA_LEN = 45;
const PROGRAMDATA_DISCRIMINATOR = 3;

function resolveCommitment(): Commitment {
  const commitment = (process.env.SOLANA_COMMITMENT || "finalized") as Commitment;
  if (!["processed", "confirmed", "finalized"].includes(commitment)) {
    throw new Error(`Invalid SOLANA_COMMITMENT: ${commitment}`);
  }
  return commitment;
}

function parseProgramData(data: Buffer) {
  if (data.length < PROGRAMDATA_METADATA_LEN) {
    throw new Error(
      `ProgramData account too short: expected at least ${PROGRAMDATA_METADATA_LEN}, got ${data.length}`,
    );
  }

  const stateDiscriminator = data.readUInt32LE(0);
  const authorityOption = data[12];
  const authority =
    authorityOption === 1 ? new PublicKey(data.subarray(13, 45)).toBase58() : null;

  return { stateDiscriminator, authorityOption, authority };
}

async function main() {
  const programIdArg = process.argv[2];
  const expectedAuthorityArg = process.argv[3];
  const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
  const commitment = resolveCommitment();

  if (!programIdArg) {
    throw new Error(
      "Usage: node src/verifyProgramAuthority.ts <PROGRAM_ID> [EXPECTED_AUTHORITY|none]",
    );
  }

  const connection = new Connection(rpcUrl, commitment);
  const programId = new PublicKey(programIdArg);
  const [programDataPda] = findProgramDataPda(programId);
  const slot = await connection.getSlot(commitment);
  const info = await connection.getAccountInfo(programDataPda, commitment);
  if (!info) {
    throw new Error(`ProgramData account not found: ${programDataPda.toBase58()}`);
  }

  const parsed = parseProgramData(info.data);
  const expectedAuthority =
    expectedAuthorityArg === undefined
      ? null
      : expectedAuthorityArg === "none" || expectedAuthorityArg === "null"
        ? "none"
        : new PublicKey(expectedAuthorityArg).toBase58();

  const checks = {
    ownedByUpgradeableLoader: info.owner.equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID),
    stateDiscriminatorMatches: parsed.stateDiscriminator === PROGRAMDATA_DISCRIMINATOR,
    authorityOptionIsKnown: parsed.authorityOption === 0 || parsed.authorityOption === 1,
    expectedAuthorityMatches:
      expectedAuthority === null
        ? null
        : expectedAuthority === "none"
          ? parsed.authority === null
          : parsed.authority === expectedAuthority,
  };
  const ok = Object.values(checks).every((value) => value !== false);

  console.log(
    JSON.stringify(
      {
        rpcUrl,
        commitment,
        slot,
        programId: programId.toBase58(),
        programDataPda: programDataPda.toBase58(),
        ownerProgram: info.owner.toBase58(),
        lamports: info.lamports,
        executable: info.executable,
        parsed,
        expectedAuthority,
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

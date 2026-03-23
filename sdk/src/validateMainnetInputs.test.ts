import assert from "node:assert/strict";
import test from "node:test";

import { parseInputs, parseProgramAccount } from "./validateMainnetInputs.ts";

test("parseProgramAccount decodes program metadata and rejects short data", () => {
  const programDataAddress = Buffer.alloc(32, 0x44);
  const data = Buffer.alloc(36);
  data.writeUInt32LE(2, 0);
  programDataAddress.copy(data, 4);

  const parsed = parseProgramAccount(data);
  assert.equal(parsed.stateDiscriminator, 2);
  assert.match(parsed.programDataAddress, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  assert.throws(() => parseProgramAccount(Buffer.alloc(35)));
});

test("parseInputs accepts a complete manifest with null optional values", () => {
  const inputs = parseInputs({
    cluster: "mainnet-beta",
    rpcUrl: "https://api.mainnet-beta.solana.com",
    secondaryRpcUrls: ["https://rpc-2.mainnet-beta.solana.com"],
    expectConfigInitialized: true,
    programId: "11111111111111111111111111111111",
    oldQxMint: "So11111111111111111111111111111111111111112",
    newQxMint: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    reserveVault: "Vote111111111111111111111111111111111111111",
    opsAdmin: "Stake11111111111111111111111111111111111111",
    initializerAuthority: "Config1111111111111111111111111111111111111",
    expectedUpgradeAuthority: null,
    migrationCapRaw: "1000",
    eligibleRawUnits: "1000",
    expectedDecimals: 9,
    startTs: "1",
    endTs: "2",
    expectedPaused: false,
    expectedTotalMigratedRaw: "0",
    fundingSignature: null,
    verifiedBuild: {
      libraryName: "migrator_program",
      mountPath: "./svbmount",
      arch: "v0",
      programSoPath: "target/deploy/migrator_program.so",
      expectedExecutableHash:
        "089d580bc1a69f9fecbf466e18f5b7186b3818fee0a567f8ee4c46ace0d84e25",
      repoUrl: null,
      commitHash: "caa4ac26af86ed78773cdf9ed417013df011f82c",
    },
  });

  assert.equal(inputs.expectConfigInitialized, true);
  assert.deepEqual(inputs.secondaryRpcUrls, ["https://rpc-2.mainnet-beta.solana.com"]);
  assert.equal(inputs.expectedUpgradeAuthority, null);
  assert.equal(inputs.verifiedBuild.libraryName, "migrator_program");
});

test("parseInputs rejects malformed manifests", () => {
  assert.throws(() =>
    parseInputs({
      cluster: "mainnet-beta",
      rpcUrl: "https://api.mainnet-beta.solana.com",
      expectConfigInitialized: "yes",
      verifiedBuild: {},
    }),
  );

  assert.throws(() =>
    parseInputs({
      cluster: "mainnet-beta",
      rpcUrl: "https://api.mainnet-beta.solana.com",
      secondaryRpcUrls: ["https://rpc-2.mainnet-beta.solana.com", ""],
      expectConfigInitialized: true,
      programId: "11111111111111111111111111111111",
      oldQxMint: "So11111111111111111111111111111111111111112",
      newQxMint: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      reserveVault: "Vote111111111111111111111111111111111111111",
      opsAdmin: "Stake11111111111111111111111111111111111111",
      initializerAuthority: "Config1111111111111111111111111111111111111",
      expectedUpgradeAuthority: null,
      migrationCapRaw: "1000",
      eligibleRawUnits: "1000",
      expectedDecimals: 9,
      startTs: "1",
      endTs: "2",
      expectedPaused: false,
      expectedTotalMigratedRaw: "0",
      fundingSignature: null,
      verifiedBuild: {
        libraryName: "migrator_program",
        mountPath: "./svbmount",
        arch: "v0",
        programSoPath: "target/deploy/migrator_program.so",
        expectedExecutableHash:
          "089d580bc1a69f9fecbf466e18f5b7186b3818fee0a567f8ee4c46ace0d84e25",
        repoUrl: null,
        commitHash: "caa4ac26af86ed78773cdf9ed417013df011f82c",
      },
    }),
  );
});

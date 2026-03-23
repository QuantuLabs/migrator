import assert from "node:assert/strict";
import test from "node:test";

import type { validateMainnetInputsReport } from "./validateMainnetInputs.ts";
import {
  buildMainnetConsensusSnapshot,
  diffSnapshotPaths,
  normalizeQuorumRpcUrls,
  parseRpcUrlList,
} from "./validateMainnetInputsQuorum.ts";

test("parseRpcUrlList splits and trims comma-separated urls", () => {
  assert.deepEqual(parseRpcUrlList(" https://a.invalid , ,https://b.invalid "), [
    "https://a.invalid",
    "https://b.invalid",
  ]);
  assert.deepEqual(parseRpcUrlList(undefined), []);
});

test("normalizeQuorumRpcUrls deduplicates primary, manifest, and env urls", () => {
  const urls = normalizeQuorumRpcUrls({
    primaryRpcUrl: "https://primary.invalid",
    secondaryRpcUrls: ["https://secondary.invalid", "https://primary.invalid"],
    envRpcUrls: "https://third.invalid, https://secondary.invalid",
  });

  assert.deepEqual(urls, [
    "https://primary.invalid",
    "https://secondary.invalid",
    "https://third.invalid",
  ]);
});

test("diffSnapshotPaths reports nested mismatches", () => {
  const left = {
    observed: {
      reserveRawUnits: "100",
      config: {
        migrationCap: "100",
      },
    },
  };
  const right = {
    observed: {
      reserveRawUnits: "90",
      config: {
        migrationCap: "100",
      },
    },
  };

  assert.deepEqual(diffSnapshotPaths(left, right), ["observed.reserveRawUnits"]);
});

test("buildMainnetConsensusSnapshot strips local-path noise but keeps consensus state", () => {
  const snapshot = buildMainnetConsensusSnapshot({
    generatedAt: "2026-03-23T00:00:00Z",
    inputsPath: "/tmp/mainnet-inputs.json",
    rpcUrl: "https://primary.invalid",
    commitment: "finalized",
    slot: 123,
    accountSnapshotSlot: 123,
    phase: "pre-init",
    inputs: {
      cluster: "mainnet-beta",
      programId: "program",
      oldQxMint: "old",
      newQxMint: "new",
      reserveVault: "vault",
      opsAdmin: "admin",
      initializerAuthority: "init",
      expectedUpgradeAuthority: "upgrade",
      migrationCapRaw: "100",
      eligibleRawUnits: "100",
      expectedDecimals: 9,
      startTs: "1",
      endTs: "2",
      expectedPaused: false,
      expectedTotalMigratedRaw: "0",
      fundingSignature: null,
      verifiedBuild: {
        libraryName: "migrator_program",
        mountPath: ".",
        arch: "v0",
        programSoPath: "target/deploy/migrator_program.so",
        expectedExecutableHash: "a".repeat(64),
        repoUrl: null,
        commitHash: "b".repeat(40),
      },
    },
    derived: {
      configPda: "cfg",
      vaultAuthorityPda: "vault-auth",
      programDataPda: "program-data",
      configBump: 1,
      vaultAuthorityBump: 2,
    },
    observed: {
      genesisHash: "genesis",
      programDataAddressFromProgram: "program-data",
      oldMintSupplyRaw: "50",
      oldMintDecimals: 9,
      programDataAuthority: "upgrade",
      verifiedBuildExecutableHash: "a".repeat(64),
      reviewedBuildInfoPath: "/tmp/build-info.json",
      reviewedBuildInfo: {
        generatedAt: "2026-03-23T00:00:00Z",
        gitCommit: "b".repeat(40),
        libraryName: "migrator_program",
        arch: "v0",
        mountBaseDir: "/tmp",
        mountPath: "./svbmount",
        dockerPlatform: "linux/amd64",
        programSoPath: "target/deploy/migrator_program.so",
        executableHash: "a".repeat(64),
        programId: null,
        onChainHash: null,
        matchesOnChain: null,
        solanaVerifyVersion: "solana-verify 0.4.12",
        solanaCliVersion: "solana-cli 2.3.10",
      },
      verifiedBuildResolvedMountPath: "/tmp/repo",
      verifiedBuildResolvedProgramSoPath: "/tmp/repo/target/deploy/migrator_program.so",
      mintSupplyRaw: "100",
      mintDecimals: 9,
      reserveRawUnits: "100",
      reserveShortfallRawUnits: "0",
      fundingSignatureStatus: null,
      fundingSignatureObservation: null,
      config: null,
    },
    checks: {
      reserveCoversEligibleRawUnits: true,
      reviewedBuildInfoProgramSoPathMatchesManifest: true,
    },
    ok: true,
  } as Awaited<ReturnType<typeof validateMainnetInputsReport>>);

  assert.equal("reviewedBuildInfoPath" in snapshot.observed, false);
  assert.equal("verifiedBuildResolvedProgramSoPath" in snapshot.observed, false);
  assert.equal(snapshot.observed.reserveRawUnits, "100");
  assert.equal(snapshot.ok, true);
});

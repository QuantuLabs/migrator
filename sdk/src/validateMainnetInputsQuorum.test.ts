import assert from "node:assert/strict";
import test from "node:test";

import type { validateMainnetInputsReport } from "./validateMainnetInputs.ts";
import {
  buildMainnetConsensusSnapshot,
  diffSnapshotPaths,
  normalizeQuorumRpcUrls,
  parseRpcUrlList,
  summarizeQuorumProviderResults,
} from "./validateMainnetInputsQuorum.ts";

test("parseRpcUrlList splits, trims, and normalizes comma-separated urls", () => {
  assert.deepEqual(parseRpcUrlList(" https://a.invalid , ,https://b.invalid/ "), [
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
      sourceMint: "old",
      destinationMint: "new",
      reserveVault: "vault",
      opsAdmin: "admin",
      initializerAuthority: "init",
      fundingAuthority: "fund",
      expectedUpgradeAuthority: "upgrade",
      migrationCapRaw: "100",
      eligibleRawUnits: "100",
      expectedDecimals: 9,
      startTs: "1",
      endTs: "2",
      expectedPaused: false,
      expectedTotalMigratedRaw: "0",
      expectedRefundRecipient: "fund",
      expectedUnclaimedWithdrawn: false,
      fundingSignature: null,
      verifiedBuild: {
        libraryName: "migrator",
        mountPath: ".",
        arch: "v0",
        programSoPath: "target/deploy/migrator.so",
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
        libraryName: "migrator",
        arch: "v0",
        mountBaseDir: "/tmp",
        mountPath: "./svbmount",
        dockerPlatform: "linux/amd64",
        programSoPath: "target/deploy/migrator.so",
        executableHash: "a".repeat(64),
        programId: null,
        onChainHash: null,
        matchesOnChain: null,
        solanaVerifyVersion: "solana-verify 0.4.12",
        solanaCliVersion: "solana-cli 2.3.10",
      },
      verifiedBuildResolvedMountPath: "/tmp/repo",
      verifiedBuildResolvedProgramSoPath: "/tmp/repo/target/deploy/migrator.so",
      mintSupplyRaw: "100",
      mintDecimals: 9,
      reserveRawUnits: "100",
      reserveShortfallRawUnits: "0",
      fundingSignatureStatus: null,
      fundingSignatureObservation: null,
      config: {
        admin: "admin",
        sourceMint: "old",
        destinationMint: "new",
        tokenProgramId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
        vaultAuthority: "vault-auth",
        reserveVault: "vault",
        totalMigrated: "0",
        migrationCap: "100",
        startTs: "1",
        endTs: "2",
        refundRecipient: "fund",
        unclaimedWithdrawn: false,
      },
    },
    checks: {
      reserveCoversEligibleRawUnits: true,
      reviewedBuildInfoProgramSoPathMatchesManifest: true,
    },
    ok: true,
  } as unknown as Awaited<ReturnType<typeof validateMainnetInputsReport>>);

  assert.equal("reviewedBuildInfoPath" in snapshot.observed, false);
  assert.equal("verifiedBuildResolvedProgramSoPath" in snapshot.observed, false);
  assert.equal(snapshot.observed.reserveRawUnits, "100");
  assert.equal(snapshot.observed.config?.refundRecipient, "fund");
  assert.equal(snapshot.observed.config?.unclaimedWithdrawn, false);
  assert.equal(snapshot.ok, true);
});

test("summarizeQuorumProviderResults requires all providers to agree and pass", () => {
  const goodReport = {
    ok: true,
    slot: 100,
    phase: "pre-init",
  } as Awaited<ReturnType<typeof validateMainnetInputsReport>>;

  const result = summarizeQuorumProviderResults({
    inputsPath: "/tmp/mainnet-inputs.json",
    commitment: "finalized",
    rpcUrls: ["https://a.invalid", "https://b.invalid"],
    providerResults: [
      {
        rpcUrl: "https://a.invalid",
        report: goodReport,
        snapshot: {
          checks: { reserveCoversEligibleRawUnits: true },
          observed: { reserveRawUnits: "100" },
          ok: true,
        } as unknown as ReturnType<typeof buildMainnetConsensusSnapshot>,
        error: null,
      },
      {
        rpcUrl: "https://b.invalid",
        report: goodReport,
        snapshot: {
          checks: { reserveCoversEligibleRawUnits: true },
          observed: { reserveRawUnits: "100" },
          ok: true,
        } as unknown as ReturnType<typeof buildMainnetConsensusSnapshot>,
        error: null,
      },
    ],
  });

  assert.equal(result.ok, true);
  assert.equal(result.mismatches.length, 0);
  assert.equal(result.providers.every((provider) => provider.ok), true);
});

test("summarizeQuorumProviderResults rejects provider errors and snapshot mismatch", () => {
  const goodReport = {
    ok: true,
    slot: 100,
    phase: "post-init",
  } as Awaited<ReturnType<typeof validateMainnetInputsReport>>;

  const result = summarizeQuorumProviderResults({
    inputsPath: "/tmp/mainnet-inputs.json",
    commitment: "finalized",
    rpcUrls: ["https://a.invalid", "https://b.invalid", "https://c.invalid"],
    providerResults: [
      {
        rpcUrl: "https://a.invalid",
        report: goodReport,
        snapshot: {
          observed: { reserveRawUnits: "100" },
          ok: true,
        } as unknown as ReturnType<typeof buildMainnetConsensusSnapshot>,
        error: null,
      },
      {
        rpcUrl: "https://b.invalid",
        report: goodReport,
        snapshot: {
          observed: { reserveRawUnits: "90" },
          ok: true,
        } as unknown as ReturnType<typeof buildMainnetConsensusSnapshot>,
        error: null,
      },
      {
        rpcUrl: "https://c.invalid",
        report: null,
        snapshot: null,
        error: "rpc failed",
      },
    ],
  });

  assert.equal(result.ok, false);
  assert.equal(result.mismatches.length, 1);
  assert.equal(result.mismatches[0]?.rpcUrl, "https://b.invalid");
  assert.equal(result.providers[2]?.error, "rpc failed");
});

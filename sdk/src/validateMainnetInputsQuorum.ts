import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

import type { Commitment } from "@solana/web3.js";
import { Connection } from "@solana/web3.js";

import {
  parseInputs,
  validateMainnetInputsReport,
} from "./validateMainnetInputs.ts";
import { resolveCommitment, runCliMain } from "./releaseUtils.ts";

type MainnetValidationReport = Awaited<ReturnType<typeof validateMainnetInputsReport>>;

export function parseRpcUrlList(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }

  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function normalizeQuorumRpcUrls(params: {
  primaryRpcUrl: string;
  secondaryRpcUrls?: string[];
  envRpcUrls?: string;
}): string[] {
  const merged = [
    params.primaryRpcUrl,
    ...(params.secondaryRpcUrls ?? []),
    ...parseRpcUrlList(params.envRpcUrls),
  ];

  return [...new Set(merged)];
}

export function buildMainnetConsensusSnapshot(report: MainnetValidationReport) {
  return {
    phase: report.phase,
    inputs: report.inputs,
    derived: report.derived,
    observed: {
      genesisHash: report.observed.genesisHash,
      programDataAddressFromProgram: report.observed.programDataAddressFromProgram,
      oldMintSupplyRaw: report.observed.oldMintSupplyRaw,
      oldMintDecimals: report.observed.oldMintDecimals,
      programDataAuthority: report.observed.programDataAuthority,
      verifiedBuildExecutableHash: report.observed.verifiedBuildExecutableHash,
      reviewedBuildInfo: {
        gitCommit: report.observed.reviewedBuildInfo.gitCommit,
        libraryName: report.observed.reviewedBuildInfo.libraryName,
        arch: report.observed.reviewedBuildInfo.arch,
        programSoPath: report.observed.reviewedBuildInfo.programSoPath,
        executableHash: report.observed.reviewedBuildInfo.executableHash,
        programId: report.observed.reviewedBuildInfo.programId,
        onChainHash: report.observed.reviewedBuildInfo.onChainHash,
        matchesOnChain: report.observed.reviewedBuildInfo.matchesOnChain,
      },
      mintSupplyRaw: report.observed.mintSupplyRaw,
      mintDecimals: report.observed.mintDecimals,
      reserveRawUnits: report.observed.reserveRawUnits,
      reserveShortfallRawUnits: report.observed.reserveShortfallRawUnits,
      fundingSignatureObservation: report.observed.fundingSignatureObservation,
      config: report.observed.config,
    },
    checks: report.checks,
    ok: report.ok,
  };
}

export function diffSnapshotPaths(
  left: unknown,
  right: unknown,
  prefix = "",
): string[] {
  if (JSON.stringify(left) === JSON.stringify(right)) {
    return [];
  }

  if (
    left === null ||
    right === null ||
    typeof left !== "object" ||
    typeof right !== "object" ||
    Array.isArray(left) ||
    Array.isArray(right)
  ) {
    return [prefix || "<root>"];
  }

  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)])].sort();

  return keys.flatMap((key) =>
    diffSnapshotPaths(
      leftRecord[key],
      rightRecord[key],
      prefix.length > 0 ? `${prefix}.${key}` : key,
    ),
  );
}

export async function validateMainnetInputsQuorum(params: {
  inputsPath: string;
  commitment: Commitment;
  rpcUrls: string[];
}) {
  if (params.rpcUrls.length < 2) {
    throw new Error("Mainnet dry-run quorum requires at least 2 distinct RPC URLs");
  }

  const inputs = parseInputs(JSON.parse(readFileSync(params.inputsPath, "utf8")) as unknown);
  const providerResults = await Promise.all(
    params.rpcUrls.map(async (rpcUrl) => {
      try {
        const report = await validateMainnetInputsReport({
          inputsPath: params.inputsPath,
          inputs,
          commitment: params.commitment,
          connection: new Connection(rpcUrl, params.commitment),
        });
        return {
          rpcUrl,
          report,
          snapshot: buildMainnetConsensusSnapshot(report),
          error: null,
        };
      } catch (error) {
        return {
          rpcUrl,
          report: null,
          snapshot: null,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );

  const baseline = providerResults.find((result) => result.snapshot !== null);
  const mismatches =
    baseline === undefined
      ? []
      : providerResults
          .filter((result) => result.snapshot !== null)
          .map((result) => ({
            rpcUrl: result.rpcUrl,
            diffPaths: diffSnapshotPaths(baseline.snapshot, result.snapshot),
          }))
          .filter((result) => result.diffPaths.length > 0);

  const ok =
    providerResults.every((result) => result.error === null && result.report?.ok === true) &&
    mismatches.length === 0;

  return {
    generatedAt: new Date().toISOString(),
    inputsPath: params.inputsPath,
    commitment: params.commitment,
    rpcUrls: params.rpcUrls,
    providerCount: params.rpcUrls.length,
    ok,
    baselineRpcUrl: baseline?.rpcUrl ?? null,
    providers: providerResults.map((result) => ({
      rpcUrl: result.rpcUrl,
      ok: result.report?.ok ?? false,
      slot: result.report?.slot ?? null,
      phase: result.report?.phase ?? null,
      error: result.error,
    })),
    mismatches,
  };
}

export async function main() {
  const inputsPathArg = process.argv[2];
  if (!inputsPathArg) {
    throw new Error(
      "Usage: node src/validateMainnetInputsQuorum.ts <PATH_TO_MAINNET_INPUTS_JSON>",
    );
  }

  const inputsPath = resolvePath(inputsPathArg);
  const inputs = parseInputs(JSON.parse(readFileSync(inputsPath, "utf8")) as unknown);
  const commitment = resolveCommitment();
  const rpcUrls = normalizeQuorumRpcUrls({
    primaryRpcUrl: process.env.SOLANA_RPC_URL || inputs.rpcUrl,
    secondaryRpcUrls: inputs.secondaryRpcUrls,
    envRpcUrls: process.env.SOLANA_RPC_URLS,
  });
  const report = await validateMainnetInputsQuorum({
    inputsPath,
    commitment,
    rpcUrls,
  });

  console.log(JSON.stringify(report, null, 2));

  if (!report.ok) {
    process.exit(1);
  }
}

void runCliMain(import.meta.url, main);

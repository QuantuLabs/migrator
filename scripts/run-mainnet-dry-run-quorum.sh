#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
INPUT_PATH="${1:-$ROOT_DIR/release/mainnet-inputs.template.json}"
RPCS_ENV="${DRY_RUN_RPC_URLS:-}"

REPORT_DIR="$(mktemp -d)"
trap 'rm -rf "$REPORT_DIR"' EXIT

pushd "$ROOT_DIR/sdk" >/dev/null
if [[ -n "$RPCS_ENV" ]]; then
  echo "[dry-run-quorum] validating manifest with manifest RPCs plus DRY_RUN_RPC_URLS overrides"
else
  echo "[dry-run-quorum] validating manifest with primary + secondary RPCs from the reviewed manifest"
fi
SOLANA_RPC_URLS="$RPCS_ENV" node --experimental-strip-types src/validateMainnetInputsQuorum.ts "$INPUT_PATH" \
  > "$REPORT_DIR/quorum-report.json"
popd >/dev/null

echo "[dry-run-quorum] quorum validation passed"

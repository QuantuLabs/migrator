#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
INPUT_PATH="${1:-$ROOT_DIR/release/mainnet-inputs.template.json}"

pushd "$ROOT_DIR/sdk" >/dev/null
node --experimental-strip-types src/validateMainnetInputs.ts "$INPUT_PATH"
popd >/dev/null

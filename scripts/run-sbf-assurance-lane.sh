#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROGRAM_MANIFEST="$ROOT_DIR/programs/migrator/Cargo.toml"
SBF_OUT_DIR="${SBF_OUT_DIR:-$ROOT_DIR/target/deploy}"
PROGRAM_SO="$SBF_OUT_DIR/migrator.so"

echo "[sbf-assurance] building SBF artifact into $SBF_OUT_DIR"
cargo build-sbf \
  --manifest-path "$PROGRAM_MANIFEST" \
  --sbf-out-dir "$SBF_OUT_DIR"

if [[ ! -f "$PROGRAM_SO" ]]; then
  echo "[sbf-assurance] expected artifact missing: $PROGRAM_SO" >&2
  exit 1
fi

export MIGRATOR_SBF_PATH="$PROGRAM_SO"
export MIGRATOR_PROGRAM_SBF_PATH="$PROGRAM_SO"
export MIGRATOR_REQUIRE_ARTIFACT=1

echo "[sbf-assurance] running LiteSVM SBF-backed suites"
cargo test \
  --test litesvm_program_load \
  --test litesvm_migration_flow \
  -- --nocapture

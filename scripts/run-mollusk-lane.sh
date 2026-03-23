#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROGRAM_MANIFEST="$ROOT_DIR/programs/migrator-program/Cargo.toml"
SBF_OUT_DIR="${SBF_OUT_DIR:-$ROOT_DIR/target/deploy}"

echo "[mollusk] building SBF artifact into $SBF_OUT_DIR"
cargo build-sbf \
  --manifest-path "$PROGRAM_MANIFEST" \
  --sbf-out-dir "$SBF_OUT_DIR"

export SBF_OUT_DIR
export MOLLUSK_REQUIRE_ARTIFACT=1

if [[ -n "${MOLLUSK_FIXTURE_DIR:-}" ]]; then
  mkdir -p "$MOLLUSK_FIXTURE_DIR"
  export EJECT_FUZZ_FIXTURES="$MOLLUSK_FIXTURE_DIR"
  echo "[mollusk] ejecting fixtures into $MOLLUSK_FIXTURE_DIR"
fi

if [[ "${MOLLUSK_FIXTURE_JSON:-0}" == "1" ]]; then
  export EJECT_FUZZ_FIXTURES_JSON="${EJECT_FUZZ_FIXTURES_JSON:-1}"
  echo "[mollusk] JSON fixture output enabled"
fi

echo "[mollusk] running regression/fuzz-fixture lane"
cargo test --test mollusk_fuzz_lane -- --nocapture

#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
PROGRAM_DIR="$ROOT_DIR/programs/migrator"
SDK_DIR="$ROOT_DIR/sdk"
REQUIRE_VERIFIED_BUILD="${ASSURANCE_REQUIRE_VERIFIED_BUILD:-1}"

echo "[assurance] running Rust unit/integration tests"
pushd "$PROGRAM_DIR" >/dev/null
cargo test

echo "[assurance] running Rust clippy"
cargo clippy --all-targets --all-features -- -D warnings
popd >/dev/null

echo "[assurance] running SDK tests and typecheck"
pushd "$SDK_DIR" >/dev/null
npm test
npm run typecheck
popd >/dev/null

echo "[assurance] running SBF-backed LiteSVM lane"
"$ROOT_DIR/scripts/run-sbf-assurance-lane.sh"

echo "[assurance] running Mollusk lane"
"$ROOT_DIR/scripts/run-mollusk-lane.sh"

echo "[assurance] running Kani lane"
"$ROOT_DIR/scripts/run-kani-lane.sh"

if [[ -n "$(git -C "$ROOT_DIR" status --porcelain)" ]]; then
  echo "[assurance] verified-build skipped because the git worktree is not clean"
  echo "[assurance] commit or stash changes, then run ./scripts/run-verified-build.sh for release metadata"
  if [[ "$REQUIRE_VERIFIED_BUILD" == "1" ]]; then
    echo "[assurance] local assurance now requires verified-build by default" >&2
    echo "[assurance] set ASSURANCE_REQUIRE_VERIFIED_BUILD=0 only for non-release local debugging" >&2
    exit 1
  fi
else
  echo "[assurance] running verified-build lane on clean worktree"
  "$ROOT_DIR/scripts/run-verified-build.sh"
fi

echo "[assurance] local assurance lane completed"

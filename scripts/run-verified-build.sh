#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
MOUNT_BASE_DIR="$(dirname "$ROOT_DIR")"
LIBRARY_NAME="${LIBRARY_NAME:-migrator}"
ARCH="${SOLANA_VERIFY_ARCH:-v0}"
OUT_DIR="${VERIFIED_BUILD_OUT_DIR:-$ROOT_DIR/artifacts/verified-build}"
MOUNT_LINK_NAME="${VERIFIED_BUILD_MOUNT_LINK_NAME:-svbmount}"
MOUNT_DIR="${VERIFIED_BUILD_MOUNT_DIR:-./$MOUNT_LINK_NAME}"
DOCKER_PLATFORM="${DOCKER_DEFAULT_PLATFORM:-linux/amd64}"
SOLANA_VERIFY_MIN_VERSION="0.4.12"
SOLANA_VERIFY_BASE_IMAGE="${SOLANA_VERIFY_BASE_IMAGE:-}"
ALLOW_DIRTY_WORKTREE="${ALLOW_DIRTY_WORKTREE:-0}"
PROGRAM_ID="${1:-}"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[verified-build] missing required command: $1" >&2
    exit 1
  fi
}

version_ge() {
  [[ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -n 1)" == "$2" ]]
}

cleanup_temp_mount_link() {
  rm -f "$MOUNT_BASE_DIR/$MOUNT_LINK_NAME"
}

require_cmd git
require_cmd cargo
require_cmd docker
require_cmd solana
require_cmd solana-verify

SOLANA_VERIFY_VERSION_NUMBER="$(solana-verify --version | awk '{print $2}')"
if ! version_ge "$SOLANA_VERIFY_VERSION_NUMBER" "$SOLANA_VERIFY_MIN_VERSION"; then
  echo "[verified-build] solana-verify >= $SOLANA_VERIFY_MIN_VERSION is required; found $SOLANA_VERIFY_VERSION_NUMBER" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

pushd "$ROOT_DIR" >/dev/null

if [[ "$ALLOW_DIRTY_WORKTREE" != "1" ]]; then
  if [[ -n "$(git status --porcelain)" ]]; then
    echo "[verified-build] git worktree is not clean; commit, stash, or remove local changes before producing release metadata" >&2
    echo "[verified-build] set ALLOW_DIRTY_WORKTREE=1 only for local debugging, never for release artifacts" >&2
    exit 1
  fi
fi

trap cleanup_temp_mount_link EXIT
ln -sfn "$(basename "$ROOT_DIR")" "$MOUNT_BASE_DIR/$MOUNT_LINK_NAME"

echo "[verified-build] building deterministic artifact for $LIBRARY_NAME (arch=$ARCH)"
BUILD_ARGS=(build "$MOUNT_DIR" --library-name "$LIBRARY_NAME" --arch "$ARCH")
if [[ -n "$SOLANA_VERIFY_BASE_IMAGE" ]]; then
  BUILD_ARGS+=(--base-image "$SOLANA_VERIFY_BASE_IMAGE")
fi

# Work around solana-verify path handling bugs by mounting the repo through a
# temporary symlink from the repo parent. This avoids both "." path mangling
# and repeated-substring replacement in nested workspace crate paths.
pushd "$MOUNT_BASE_DIR" >/dev/null
DOCKER_DEFAULT_PLATFORM="$DOCKER_PLATFORM" solana-verify "${BUILD_ARGS[@]}"
popd >/dev/null

PROGRAM_SO="$ROOT_DIR/target/deploy/${LIBRARY_NAME}.so"
PROGRAM_SO_REL="target/deploy/${LIBRARY_NAME}.so"
if [[ ! -f "$PROGRAM_SO" ]]; then
  echo "[verified-build] expected artifact missing: $PROGRAM_SO" >&2
  exit 1
fi

EXECUTABLE_HASH="$(solana-verify get-executable-hash "$PROGRAM_SO" | tr -d '[:space:]')"
GIT_COMMIT="$(git rev-parse HEAD)"
SOLANA_VERIFY_VERSION="$(solana-verify --version | head -n 1)"
SOLANA_VERSION="$(solana --version | head -n 1)"
BUILD_INFO_PATH="$OUT_DIR/${LIBRARY_NAME}.build-info.json"
PROGRAM_ID_JSON="null"

ON_CHAIN_HASH="null"
MATCHES_ON_CHAIN="null"
if [[ -n "$PROGRAM_ID" ]]; then
  PROGRAM_ID_JSON="\"$PROGRAM_ID\""
  echo "[verified-build] comparing local verified artifact to on-chain program $PROGRAM_ID"
  PROGRAM_HASH="$(solana-verify get-program-hash "$PROGRAM_ID" | tr -d '[:space:]')"
  ON_CHAIN_HASH="\"$PROGRAM_HASH\""
  if [[ "$PROGRAM_HASH" == "$EXECUTABLE_HASH" ]]; then
    MATCHES_ON_CHAIN="true"
  else
    MATCHES_ON_CHAIN="false"
  fi
fi

cat > "$BUILD_INFO_PATH" <<EOF
{
  "generatedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "gitCommit": "$GIT_COMMIT",
  "libraryName": "$LIBRARY_NAME",
  "arch": "$ARCH",
  "mountBaseDir": "$MOUNT_BASE_DIR",
  "mountPath": "$MOUNT_DIR",
  "dockerPlatform": "$DOCKER_PLATFORM",
  "programSoPath": "$PROGRAM_SO_REL",
  "executableHash": "$EXECUTABLE_HASH",
  "programId": $PROGRAM_ID_JSON,
  "onChainHash": $ON_CHAIN_HASH,
  "matchesOnChain": $MATCHES_ON_CHAIN,
  "solanaVerifyVersion": "$SOLANA_VERIFY_VERSION",
  "solanaCliVersion": "$SOLANA_VERSION"
}
EOF

echo "[verified-build] executable hash: $EXECUTABLE_HASH"
echo "[verified-build] build metadata written to $BUILD_INFO_PATH"

if [[ "$MATCHES_ON_CHAIN" == "false" ]]; then
  echo "[verified-build] on-chain hash mismatch" >&2
  exit 1
fi

popd >/dev/null

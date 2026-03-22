#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROGRAM_MANIFEST="$ROOT_DIR/programs/migrator-program/Cargo.toml"

HARNESSES=(
  "instructions::verification::migration_gate_accepts_boundary_timestamps"
  "instructions::verification::migration_gate_matches_control_policy"
  "state::verification::checked_total_migrated_after_matches_checked_add"
  "state::verification::custody_token_bytes_accepts_clean_account"
  "state::verification::custody_token_bytes_rejects_delegate_and_close_controls"
  "state::verification::migration_cap_helpers_roundtrip_and_reject_over_cap"
  "state::verification::migration_config_layout_is_stable"
  "state::verification::migration_config_roundtrip_via_unaligned_io_preserves_value"
  "state::verification::strict_mint_bytes_accepts_initialized_mint_without_authorities"
  "state::verification::strict_mint_bytes_rejects_nonzero_authority_flags"
  "state::verification::strict_mint_short_buffer_is_rejected"
  "state::verification::token_account_bytes_rejects_wrong_owner_or_uninitialized_state"
  "state::verification::validate_migration_window_rejects_only_inverted_bounds"
)

echo "[kani] verifying ${#HARNESSES[@]} harnesses individually"
for harness in "${HARNESSES[@]}"; do
  echo "[kani] -> $harness"
  cargo kani \
    --manifest-path "$PROGRAM_MANIFEST" \
    --features no-entrypoint \
    --harness "$harness"
done

echo "[kani] all harnesses verified"

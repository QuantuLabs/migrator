# Kani Lane

## Why This Lane Exists

`Kani` is still the right formal-check layer for this repo, but the batch command is not the most reliable way to run it on the current toolchain.

The current pinned environment verifies every harness successfully when run one by one, but `cargo kani -p migrator-program --features no-entrypoint` can intermittently die late with a `goto-instrument` tooling error after already proving prior harnesses.

For this repository, the authoritative lane is therefore:

```bash
./scripts/run-kani-lane.sh
```

## What It Covers

The lane verifies the current `#[kani::proof]` harnesses individually:

- migration gate control policy
- migration gate boundary timestamps
- migration-cap arithmetic helpers
- strict mint parsing rules
- custody token-account hygiene rules
- token-account parsing rules
- config layout stability
- config unaligned read/write roundtrip
- migration-window validation

Because the harness list is explicit in the script, this lane is deterministic and easy to audit during release review.

## How To Run

From the repo root:

```bash
./scripts/run-kani-lane.sh
```

This will iterate the approved harness list and stop at the first failure.

## Why Not The Batch Command

The direct batch command is still useful for ad hoc local checks:

```bash
cargo kani -p migrator-program --features no-entrypoint
```

But it should not be treated as the release gate on the current pinned toolchain because of the late-stage `goto-instrument` instability described above.

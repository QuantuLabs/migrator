# Release Inputs

This folder is for deployment-time manifests and release artifacts that tie the
published addresses, verified build metadata, and migration policy together.

Files:

- `mainnet-inputs.template.json` — template for the final address and policy set

Recommended workflow:

1. Copy `mainnet-inputs.template.json` to a local file such as `mainnet-inputs.local.json`.
2. Fill the real addresses, migration cap, eligible raw units, authority policy, post-init expectations, and verified executable hash.
3. Run `./scripts/run-mainnet-dry-run.sh release/mainnet-inputs.local.json`.
4. Commit the reviewed release candidate or otherwise ensure tracked git state is clean.
5. Run `./scripts/run-verified-build.sh [PROGRAM_ID]`.
6. Treat `ALLOW_DIRTY_WORKTREE=1` as debug-only and never use its output as release evidence.
7. Publish the resulting reviewed inputs and build metadata alongside the launch announcement.

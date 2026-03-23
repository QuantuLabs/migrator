# Release Inputs

This folder is for deployment-time manifests and release artifacts that tie the
published addresses, verified build metadata, and migration policy together.

Files:

- `mainnet-inputs.template.json` — template for the final address and policy set
- `release-record.template.md` — single release record tying manifests, proofs, and sign-off together

Recommended workflow:

1. Copy `mainnet-inputs.template.json` to a local file such as `mainnet-inputs.local.json`.
2. Fill the real addresses, migration cap, eligible raw units, authority policy, post-init expectations, and verified executable hash.
3. Run `./scripts/run-mainnet-dry-run.sh release/mainnet-inputs.local.json`.
4. Run `./scripts/run-mainnet-dry-run-quorum.sh release/mainnet-inputs.local.json`.
5. Commit the reviewed release candidate or otherwise ensure tracked git state is clean.
6. Run `./scripts/run-verified-build.sh [PROGRAM_ID]`.
7. Generate and review the reserve proof.
8. Complete the old-market deprecation evidence pack and controlled-LP retirement proof.
9. Copy `release-record.template.md` to a filled release record and attach:
   - the reviewed mainnet-inputs file
   - the dry-run quorum report
   - the verified-build metadata
   - the reserve-proof artifact
   - the deprecation evidence record
10. Treat `ALLOW_DIRTY_WORKTREE=1` as debug-only and never use its output as release evidence.
11. Publish the resulting reviewed inputs and build metadata alongside the launch announcement.

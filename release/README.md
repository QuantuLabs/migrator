# Release Inputs

This folder stores the release manifests and evidence templates that tie
published addresses, verified-build metadata, and operator sign-off together.

Files:

- `mainnet-inputs.template.json` — reviewed launch manifest template
- `release-record.template.md` — final release record template

Recommended workflow:

1. Copy `mainnet-inputs.template.json` to a local reviewed file such as `mainnet-inputs.local.json`.
2. Fill the real addresses, migration cap, eligible raw units, authority policy, post-init expectations, and verified executable hash.
3. Run `./scripts/run-mainnet-dry-run.sh release/mainnet-inputs.local.json`.
4. Run `./scripts/run-mainnet-dry-run-quorum.sh release/mainnet-inputs.local.json`.
5. Ensure the reviewed repo state is clean and pinned.
6. Run `./scripts/run-verified-build.sh [PROGRAM_ID]`.
7. Generate and review the reserve proof.
8. Complete the old-market deprecation evidence pack and controlled-liquidity retirement proof.
9. Copy `release-record.template.md` to a filled release record and attach:
   - the reviewed mainnet-inputs file
   - the dry-run quorum artifact directory
   - the verified-build metadata
   - the reserve-proof artifact
   - the deprecation evidence record
10. Treat `ALLOW_DIRTY_WORKTREE=1` as local-debug only and never as release evidence.

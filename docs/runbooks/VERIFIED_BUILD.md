# Verified Build Runbook

## Goal

Produce a deterministic release artifact for `migrator_program`, record its
hash, and be ready to compare it against the deployed on-chain program.

This runbook is aligned with the official Solana verified-build flow:

- local deterministic build first
- hash the exact deployed artifact
- once a public repo URL exists, use `verify-from-repo` to publish the source linkage

## Preconditions

- `docker` installed and running
- `solana-verify >= 0.4.12` installed
- `solana` CLI installed
- clean pinned repo state
- release inputs reviewed

Recommended install until crates.io catches up with the current Docker image map:

```bash
cargo install \
  --git https://github.com/solana-foundation/solana-verifiable-build \
  --tag v0.4.12 \
  solana-verify \
  --force
```

## Local Deterministic Build

Run:

```bash
./scripts/run-verified-build.sh
```

What it does:

- runs `solana-verify build <ABSOLUTE_REPO_PATH> --library-name migrator_program`
- computes the verified executable hash with `solana-verify get-executable-hash`
- writes machine-readable metadata under `artifacts/verified-build/`
- records `programSoPath` as a repo-relative path so release manifests stay portable across reviewers and CI runners

Notes:

- the wrapper uses an absolute repo path; `solana-verify` can mis-handle some workspace-relative invocation forms
- by default it forces `DOCKER_DEFAULT_PLATFORM=linux/amd64` to match the published verifier images
- override the verifier image explicitly with `SOLANA_VERIFY_BASE_IMAGE=<image>` if the official image map lags behind a supported Solana release
- the wrapper refuses any dirty git worktree unless `ALLOW_DIRTY_WORKTREE=1` is set for local debugging
- the repo carries a `solana-program = 2.3.0` marker dependency so `solana-verify` can select an official Docker image even though the production program is written with Pinocchio

CI:

- `.github/workflows/verified-build.yml` runs the same lane on `push`, `pull_request`, and `workflow_dispatch`
- the workflow uploads both `migrator_program.build-info.json` and the verified `.so` artifact for reviewer diffing

Expected artifact:

- `artifacts/verified-build/migrator_program.build-info.json`

## Compare Against On-Chain Program

After deploy, compare the same verified artifact against the final program id:

```bash
./scripts/run-verified-build.sh <PROGRAM_ID>
```

This will fail if the on-chain hash does not match the verified local build.

## Public Source Verification

Once the repo has a public HTTPS remote, run the official repo verification flow:

```bash
solana-verify verify-from-repo \
  --current-dir \
  --program-id <PROGRAM_ID> \
  --commit-hash <GIT_COMMIT_HASH> \
  --library-name migrator_program \
  <HTTPS_REPO_URL>
```

If the program is controlled by a multisig, keep the local hash check as the hard
gate before exporting or publishing any verification PDA transaction.

## Release Rules

- never deploy an artifact that was not produced by the verified-build lane
- record the exact git commit, library name, arch, and executable hash
- if the hash changes, treat it as a new release candidate
- do not rely on `cargo build-sbf` output for public hash publication
- do not publish build metadata produced from a dirty tracked worktree

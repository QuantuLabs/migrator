# Security Baseline

This note maps the current `migrator-program` against current Solana-native security practices and the Pinocchio operating model.

## Official Baseline

These are the controls this repository should keep aligned with:

- owner checks on every non-program account the instruction trusts
- explicit program-ID validation for every CPI target
- canonical PDA derivation on-chain instead of trusting caller-provided seeds or bumps
- reinitialization resistance for state accounts
- strict token-account authority hygiene for custody accounts
- exact binary parsing for instruction data and account layouts
- verified builds and published source linkage before mainnet use
- minimized upgrade-authority trust and a documented lock or transfer plan

Primary references:

- Solana program security course: owner checks
- Solana program security course: arbitrary CPI
- Solana program security course: bump seed canonicalization
- Solana program security course: reinitialization attacks
- Solana verified builds guide
- solana-verifiable-build README guidance for Pinocchio/SDK-v3 projects using `[workspace.metadata.cli]`

## Pinocchio-Specific Notes

Pinocchio does not remove the need for the controls above. It mainly reduces framework surface area and keeps the program closer to native Solana.

That is a good fit here because the program has:

- 3 instructions
- a single persistent config account
- a single custody vault path
- no dynamic account graph or variable business logic

It is a poor fit for hidden assumptions. Manual parsing and account validation must stay small, exact, and heavily tested.

## External Audit and Testing Tooling

The most relevant current tooling I found:

- `Kani`: useful for narrow proofs over pure helpers and layout invariants
- `LiteSVM`: useful for deterministic transaction tests over real account layouts
- `Mollusk`: higher-fidelity Solana testing and fuzzing harnesses
- `Trident`: Solana fuzzing and invariant framework used in security training
- `Solana Auditors Bootcamp`: good training material and exercises, not a substitute for an audit
- Solana Foundation `solana-dev-skill`: useful local reference corpus for current Pinocchio, testing, and security patterns

Tools I would not treat as primary evidence:

- generic AI audit scripts
- unaudited "security bot" repos without strong Solana adoption

They can help with review, but they are not a replacement for transaction tests, formal checks, verified builds, or manual audit.

Local note:

- the Solana Foundation `solana-dev-skill` is installed at `~/.codex/skills/solana-dev`
- Codex must be restarted before it becomes a first-class skill in the toolchain
- OpenAI curated skills currently expose generic security helpers like `security-best-practices`, `security-ownership-map`, and `security-threat-model`, but I did not find a Solana-specific audit skill in the curated list

## Current Project Match

Already aligned:

- strict owner/program-ID checks on config, mints, token accounts, and ProgramData
- canonical PDA validation for config and vault authority
- reinitialization guard on config
- exact instruction-data parsing
- exact `Tokenkeg` mint and token-account layout checks
- reserve-vault delegate and close-authority rejection
- formal checks for gate logic, layout stability, overflow behavior, and unaligned roundtrips
- negative-path transaction tests for wrong mint, wrong vault, bad destination owner, bad reserve controls, and malformed entrypoint data
- the canonical `Kani` lane is now `./scripts/run-kani-lane.sh` because the batch command is unstable on the pinned toolchain
- old-market deprecation is now treated as a release-control issue, not just a comms issue, because a live team-controlled old LP is an ingress path into the reserve

Still missing or intentionally off-chain:

- reserve sufficiency is now partially bound on-chain through `migration_cap` plus an init-time vault-balance check, but the eligible-supply input still requires operational review
- verified-build publication is a prelaunch step and now has a canonical script, but it still depends on the operator using the reviewed commit and publishing the resulting metadata
- `Mollusk` is now the active fuzz-fixture lane for this repo; `Trident` remains optional later if we ever need a heavier stateful fuzzing workflow
- some LiteSVM tests still skip if the SBF artifact is missing locally

## Recommendation

If the goal is "ultra secure" before mainnet:

1. keep the program surface frozen at `initialize_config`, `set_pause`, `migrate_exact`
2. complete verified-build publication before launch
3. keep the `Mollusk` lane live and add a broader `Trident` lane only if the program surface grows enough to justify it
4. keep reserve-proof sign-off as a hard launch gate
5. move upgrade authority to multisig or an explicit, published lock policy
6. treat controlled old-LP retirement, evidence capture, and post-open monitoring as hard release controls

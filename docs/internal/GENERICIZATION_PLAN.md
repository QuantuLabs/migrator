# Genericization Plan

## Goal

Make the migrator clearly reusable for any pair of classic SPL `Tokenkeg` mints,
without hard-coded `QX` naming in docs, SDK naming, or operator runbooks.

The important constraint is to avoid mixing a security patch with a broad breaking
rename. The safest path is staged.

## Current State

The program logic is already mostly generic:

- fixed `1:1` burn-to-claim
- source mint and destination mint are runtime inputs
- reserve funding is runtime-configured
- no tokenomics logic is hard-wired on-chain

What is still QX-specific today:

- Rust field names like `old_qx_mint`, `new_qx_mint`, `vault_new_qx`
- SDK names like `oldQxMint`, `newQxMint`, `vaultNewQx`
- docs and runbooks that describe the flow as `old QX -> new QX`
- the config discriminator `qxmigr01`

## Recommended Rollout

### Phase 1. Public-Surface Genericization

Do this first.

Scope:

- rewrite docs and runbooks to use `source token`, `destination token`, `reserve vault`
- add generic SDK aliases while keeping existing QX-named exports working
- rename release-manifest labels to generic terms where low-risk

Recommended naming:

- `oldQxMint` -> `sourceMint`
- `newQxMint` -> `destinationMint`
- `vaultNewQx` -> `reserveVault`
- `userOldQx` -> `userSourceToken`
- `userNewQx` -> `userDestinationToken`
- `refundRecipientNewQx` -> `refundRecipientDestinationAta`
- `fundingNewQx` -> `fundingSourceToken`

Why first:

- no on-chain behavior change
- no layout change
- minimal verified-build churn
- front-end teams can already integrate against generic terms

### Phase 2. Internal Rust Rename Without Layout Change

Do this only after Phase 1 lands cleanly.

Scope:

- rename Rust identifiers to generic terms
- keep struct field order and byte layout identical
- keep instruction discriminators unchanged
- keep PDA seeds unchanged
- keep account ordering unchanged

Important rule:

- `MigrationConfig` binary layout must remain byte-for-byte identical

That means:

- rename source fields only at the Rust identifier level
- do not reorder fields
- do not resize `reserved`
- do not change offsets

Safe internal target names:

- `old_qx_mint` -> `source_mint`
- `new_qx_mint` -> `destination_mint`
- `vault_new_qx` -> `reserve_vault`
- `funding_new_token_account` is already mostly generic and can become `funding_source_token_account`

### Phase 3. Optional Breaking Rebrand

Only do this if you explicitly want a new generic public program identity.

Breaking items:

- config discriminator `qxmigr01`
- crate/package names
- release artifact names
- verified-build identifiers
- explorer/log references

This phase should be treated as a new release train, not a cleanup.

## Compatibility Risks

### Binary Layout Risk

Highest risk.

If `MigrationConfig` field order or size changes:

- SDK decoding breaks
- config verification breaks
- release tooling breaks
- existing config accounts become unreadable

Mitigation:

- keep current layout exactly
- retain layout assertions in tests/Kani

### Verified-Build Risk

Any source rename can change the final binary hash even if behavior is identical.

Mitigation:

- treat rename-only on-chain changes like any other release
- regenerate and review build metadata
- rerun SBF, LiteSVM, Mollusk, Kani, and dry-run lanes

### SDK/Frontend Risk

Renaming API fields too aggressively can break the front-end handoff.

Mitigation:

- add generic aliases first
- keep QX-named aliases deprecated for one release cycle
- remove old aliases only after front-end cutover

### Ops/Manifest Risk

Runbooks and manifests can silently drift if naming changes are partial.

Mitigation:

- update `release/mainnet-inputs.template.json`
- update dry-run docs and config-verification docs in the same lot
- keep one canonical glossary

## Order of Operations

1. Freeze the current secure behavior and release it.
2. Genericize docs and operator vocabulary.
3. Add generic SDK aliases.
4. Cut front-end integration to generic names.
5. Rename internal Rust identifiers without touching layout.
6. Re-run full assurance lanes and verified build.
7. Optionally decide whether a true public rebrand warrants a new discriminator/program identity.

## Recommendation

For the current launch window:

- ship the security patch now
- keep the current on-chain identity stable
- do Phase 1 immediately after
- defer any breaking discriminator/package rebrand until after the migration has opened successfully

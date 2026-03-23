# Upgrade Authority Policy

## Goal

Minimize trust in the upgrade path while keeping `initialize_config` operable.

`initialize_config` requires the current upgrade authority signer to authorize
the config initialization. That means the upgrade authority cannot be cleared
or frozen before init completes.

## Recommended Policy

### Phase 1: Pre-init

- keep the upgrade authority on a controlled signer that can execute `initialize_config`
- publish the exact expected upgrade authority address
- publish the exact initializer address
- publish the exact funding authority address
- require `initializerAuthority == expectedUpgradeAuthority`

Preferred setup:

- a dedicated multisig or tightly controlled deployment signer

Avoid:

- an unpublished EOA
- changing the expected authority during launch week

### Phase 2: Post-init

Immediately after successful config initialization, choose one of:

- transfer upgrade authority to the final multisig
- clear upgrade authority to `none` if the code is final for this migration phase

Both are acceptable. The key requirement is that the resulting state is
published and re-verified on-chain.

### Phase 3: Stable Migration Window

- if future code changes are still possible, keep authority only on the published multisig
- if no upgrades are intended, clear authority and publish `none`

## Hard Checks

Before init:

```bash
cd sdk
npm run verify-program-authority -- <PROGRAM_ID> <EXPECTED_AUTHORITY>
```

After transfer or freeze:

```bash
cd sdk
npm run verify-program-authority -- <PROGRAM_ID> <EXPECTED_AUTHORITY|none>
```

The verifier now checks both:

- the executable program account ownership and `ProgramData` linkage
- the derived `ProgramData` authority state

## Publication Requirements

Publish all of:

- current upgrade authority state
- initializer authority
- ops admin
- program id
- the point in the timeline when authority will be transferred or cleared

If the authority state changes, update the public release inputs and rerun the
dry-run validator before launch, including the quorum replay.

## Launch Sequencing Constraint

Do not treat upgrade-authority operations as independent from migration-open
operations.

Minimum safe release record:

- reviewed manifest and dry-run quorum report
- successful `initialize_config`
- verified published config state
- old-market deprecation execution plan
- controlled old-LP retirement proof capture
- upgrade-authority transfer or freeze proof, if that step happens the same day

If authority transfer and old-market deprecation happen in the same launch
window, capture both in the same release record and publish the resulting state
once both are verified.

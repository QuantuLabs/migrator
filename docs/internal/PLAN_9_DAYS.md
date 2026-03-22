# 9-Day Plan

## Objective

Ship a credible migration MVP in time for the Bags hackathon:

- Bags launch for `new QX`
- public migration portal
- audited minimal on-chain program
- fixed frontend contract

## Day-by-Day

### Day 1

- freeze tokenomics:
  - no DividendsBot
  - Bags creator fee kept as-is
  - `15%` of creator fees allocated to buyback-and-burn off-program
- confirm reserve math and eligible old supply
- submit hackathon application
- freeze repo name and program scope

### Day 2

- create repo and program skeleton
- implement config layout and PDA helpers
- implement `initialize_config`
- implement `set_pause`

### Day 3

- implement `migrate_exact`
- add all mint, vault, owner, seed and window validations
- freeze the account order and instruction encoding for the frontend

### Day 4

- write unit tests for:
  - happy path migration
  - paused migration
  - wrong mint
  - wrong vault owner
  - insufficient reserve
  - zero amount
  - outside migration window

### Day 5

- build minimal TypeScript SDK helpers
- document PDA derivation
- write frontend integration notes
- define explorer links and verification page data

### Day 6

- deploy to devnet
- run full dry-run with test mints
- validate stats extraction from logs and token balances

### Day 7

- deep security pass
- finalize anti-scam docs
- publish reserve proof checklist
- prepare emergency pause runbook

### Day 8

- mainnet preflight:
  - reserve funded
  - program id fixed
  - config values verified
  - final Bags `new QX` mint verified as `Tokenkeg`
  - explorer links verified
  - frontend points to the correct addresses only

### Day 9

- public launch if all checks are green
- otherwise keep the Bags launch and hackathon submission live, and ship devnet/public MVP with mainnet migration gated behind reserve and final security sign-off

## Non-Negotiables

- do not change ratio after announcement
- do not add holder fee sharing during migration
- do not ship without publishing the reserve vault
- do not promise universal `1:1` until reserve sufficiency is proven
- do not initialize mainnet config until the final Bags mint passes the `Tokenkeg` checklist

## Frontend Dependency Freeze

The frontend team should be able to start as soon as Day 3 ends.

At that point the following must be frozen:

- program id strategy
- PDA seeds
- account order
- instruction discriminators
- config decoding format

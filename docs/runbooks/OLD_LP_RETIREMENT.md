# Old LP Retirement

## Goal

Retire every team-controlled old-QX liquidity path that could still act as a
live ingress into the V1 migrator.

## Hard Rule

If a team-controlled old LP cannot be retired before or at migration open, keep
migration closed or paused.

## Inventory

Fill this before launch:

- old mint:
- pool address:
- DEX / router:
- owner wallet:
- treasury wallet funding it:
- expected pre-open balance:
- target post-retirement balance:
- operator:
- backup operator:

Repeat for every controlled pool or routing venue.

## Retirement Order

1. Stop any bot or automation that can re-add liquidity.
2. Withdraw treasury-controlled LP positions.
3. Remove treasury-owned old-QX inventory from market-making wallets.
4. Verify official frontend routing no longer points to the old pool.
5. Verify dashboards and docs no longer advertise the old pool.
6. Record tx hashes and post-action balances in `DEPRECATION_EVIDENCE.md`.

## Acceptance Criteria

Treat retirement as complete only if:

- old-pool balance is zero, or a documented dust balance remains
- no controlled wallet is authorized to replenish the pool unnoticed
- no official route still points users to the pool

If a non-zero residual remains, record:

- exact raw units
- reason it cannot be removed immediately
- owner of the cleanup
- next review time

## Release Blockers

Stop launch if:

- any controlled pool balance is unexplained
- the owner of a live pool is unknown
- the retirement tx hash cannot be produced
- the old pool is still reachable through official surfaces after retirement

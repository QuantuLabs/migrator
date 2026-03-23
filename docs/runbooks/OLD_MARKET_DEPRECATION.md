# Old Market Deprecation

## Goal

Make `old QX` non-canonical at migration open and remove every controlled path
that could still feed the live-holder `1:1` migrator.

The migrator burns `old QX`, but it does not remove old liquidity or third-party
routing by itself. If a team-controlled old LP remains live, that LP is not just
social confusion. It is an economic ingress into the `new QX` reserve.

## Hard Rule

If any team-controlled old LP, market-making wallet, bot, or official surface is
still live at open, migration is not ready.

Do not call the old market deprecated until:

- official routing points to the new mint only
- team-controlled old LP inventory is retired or reduced to documented dust
- treasury and bot automation no longer quote or replenish the old market
- proof is recorded in `DEPRECATION_EVIDENCE.md`

## Required Positioning

Before launch, publish one unambiguous position:

- `old QX is deprecated at migration open`
- `old QX remains temporarily tradable, but is non-canonical and unsupported`

For V1, the intended position is the first one.

## Owners

Assign named owners before launch:

- release lead
- liquidity owner
- frontend owner
- comms owner
- monitoring owner

Record them in `DEPRECATION_EVIDENCE.md`.

## Controlled Surface Inventory

Inventory every controlled old-market surface before launch:

- LP positions
- market-making wallets
- treasury wallets holding live old-QX inventory
- frontend routing
- bots and alerting automations
- docs, dashboards, and analytics links
- pinned posts, support macros, and FAQ links

If any surface has no owner, the launch is not ready.

## Launch Window Sequence

### T-24h

- fill `OLD_LP_RETIREMENT.md`
- fill `OLD_MARKET_MONITORING.md`
- prepare `DEPRECATION_EVIDENCE.md`
- freeze the public copy for old-mint deprecation warnings

### T-1h

- confirm controlled-wallet balances and LP positions
- confirm bot and routing changes are ready to ship
- confirm the migration portal points only to the new mint

### T0

- execute the official migration-open transaction set
- retire controlled old LP according to `OLD_LP_RETIREMENT.md`
- flip frontend, bots, docs, and dashboards to the new mint only
- publish the deprecation notice with exact old/new mint addresses

### T+15m

- verify old LP balances, treasury balances, and routing state
- attach tx hashes and links to `DEPRECATION_EVIDENCE.md`
- hand monitoring to `OLD_MARKET_MONITORING.md`

## No-Go Conditions

Do not open migration if any of the following is true:

- a controlled old LP is still funded and tradable
- a treasury wallet can still replenish the old pool in the same launch window
- official UI, docs, or bots still route users to the old mint
- proof capture ownership is missing
- the team cannot explain how legacy price action should be interpreted after launch

## Response Rule

If deprecation is claimed publicly and later found incomplete:

- pause migration
- stop official traffic immediately
- retire the remaining controlled liquidity
- publish the corrected status with exact addresses and tx hashes

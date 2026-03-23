# Emergency Pause Runbook

## Trigger Conditions

Pause immediately if any of the following happens:

- wrong mint or wrong vault is detected in a production transaction path
- reserve shortfall is discovered
- the frontend points to wrong addresses
- phishing or spoofed migration UI is circulating and users are at risk
- unexpected failures occur in `migrate_exact` on the final mainnet configuration
- a team-controlled old LP is still live or gets re-funded after deprecation
- treasury, bots, or official automation are still routing users into the old market
- old-market activity indicates users can still economically ingress through controlled legacy liquidity

## Immediate Actions

1. Freeze public comms and stop directing users to migrate.
2. Call `set_pause(true)` from the authorized admin.
3. Verify on-chain that `config.paused == true`.
4. Halt any remaining official routing, bots, or treasury automation touching the old market.
5. Capture evidence: tx hashes, old-pool balances, current reserve-vault balance, affected links.
6. Publish the paused status, program id, and config address on official channels.
7. Tell users not to retry until a new status update is published.

## Verification Checklist

- confirm the transaction signer is the expected admin
- confirm the correct program id was targeted
- confirm the correct config PDA was targeted
- confirm the pause took effect on-chain
- confirm controlled old LP balances and treasury-owned old-QX balances have been re-checked
- confirm official frontend and bots no longer point to the old mint

## Recovery Conditions

Resume only after:

- root cause is understood
- affected addresses and config are re-verified
- reserve status is re-verified
- frontend config is re-verified
- old-market deprecation state is re-verified
- controlled old LP retirement proof is complete
- a public status note is ready

## Resume Procedure

1. Re-verify program id, config PDA, reserve vault, old mint, and new mint.
2. Re-run the internal checklist and refresh `DEPRECATION_EVIDENCE.md`.
3. Confirm `OLD_LP_RETIREMENT.md` and `OLD_MARKET_MONITORING.md` are satisfied.
4. Call `set_pause(false)` only after sign-off.
5. Publish a clear restart notice with exact addresses.

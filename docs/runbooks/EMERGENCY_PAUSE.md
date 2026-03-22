# Emergency Pause Runbook

## Trigger Conditions

Pause immediately if any of the following happens:

- wrong mint or wrong vault is detected in a production transaction path
- reserve shortfall is discovered
- the frontend points to wrong addresses
- phishing or spoofed migration UI is circulating and users are at risk
- unexpected failures occur in `migrate_exact` on the final mainnet configuration

## Immediate Actions

1. Freeze public comms and stop directing users to migrate.
2. Call `set_pause(true)` from the authorized admin.
3. Verify on-chain that `config.paused == true`.
4. Publish the paused status, program id, and config address on official channels.
5. Tell users not to retry until a new status update is published.

## Verification Checklist

- confirm the transaction signer is the expected admin
- confirm the correct program id was targeted
- confirm the correct config PDA was targeted
- confirm the pause took effect on-chain

## Recovery Conditions

Resume only after:

- root cause is understood
- affected addresses and config are re-verified
- reserve status is re-verified
- frontend config is re-verified
- a public status note is ready

## Resume Procedure

1. Re-verify program id, config PDA, reserve vault, old mint, and new mint.
2. Re-run the internal checklist.
3. Call `set_pause(false)` only after sign-off.
4. Publish a clear restart notice with exact addresses.

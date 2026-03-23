# Old Market Monitoring

## Goal

Detect whether `old QX` is still socially or economically active after
deprecation.

## Owners

Fill before launch:

- primary monitor:
- backup monitor:
- comms owner:
- ops owner:

## Signals To Track

Track at minimum:

- old-pool liquidity after deprecation
- old-pool volume after deprecation
- treasury-wallet activity touching old-QX venues
- official-site or bot traffic still linking the old mint
- user reports about price divergence or the old pool "pumping"
- migration bursts that follow visible old-pool buys

## Thresholds

Fill concrete thresholds before launch:

- maximum acceptable controlled old-pool liquidity:
- maximum acceptable unexplained old-pool volume per hour:
- maximum acceptable official old-link count:
- escalation channel:
- pause decision owner:

## Escalation Rules

Escalate immediately if:

- any controlled old LP reappears
- treasury or bot automation touches the old market unexpectedly
- official links to the old market remain live after deprecation
- old-market activity suggests users can still source meaningful old QX through controlled liquidity

Pause migration if:

- the team cannot quickly prove the old-market activity is fully third-party and unsupported
- there is any doubt that a controlled wallet remains in the old market

## Evidence

Every escalation must append:

- time observed
- wallet / pool / link involved
- explorer link or screenshot
- operator who reviewed it
- action taken

Store the running record in `DEPRECATION_EVIDENCE.md`.

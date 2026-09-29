---
'@pushchain/core': patch
---

Wait for the full confirmation depth on EVM origin-chain funds transfers.

`waitForEvmConfirmationsWithCountdown` ended its poll loop as soon as the
intermediate progress count reached the requested confirmations, which is one
block before the `currentBlock >= targetBlock` gate that actually defines
"confirmed". Since every chain in `CHAIN_INFO` is configured with
`confirmations: 1`, a funds transfer was reported confirmed and handed back to
the caller while its receipt block was still the chain head, so the next step
of the transfer could be submitted before the lock was safely buried.

The progress countdown is unchanged: `1/2 received`, then `2/2 received`, and
the wait now returns only once the chain head has reached the target block.

---
'@pushchain/core': patch
---

Fail a reverted origin-chain funds lock instead of reporting it as confirmed.
When the gateway `sendUniversalTx` on the origin chain reverts, its receipt is
still available, so the funds-bridge confirmation wait used to resolve
successfully and fire the "funds locked" progress hooks. The swap then polled
Push Chain for a universal transaction that could never exist until it timed
out. The wait now rejects as soon as the receipt reports a revert, which is
what the equivalent Solana path already did.

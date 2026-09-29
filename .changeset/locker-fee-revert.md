---
'@pushchain/core': patch
---

Fail a reverted EVM fee-lock transaction instead of reporting it as confirmed.

A universal transaction that locks fees on an EVM origin chain sends its lock
through the origin gateway, then waits for it before continuing. If that
transaction reverted, the lock never happened, but the wait treated the
receipt as a confirmation anyway: the send resolved, the `105-02` "fee
confirmed" progress event fired, and the follow-up status lookup then spent
its full 15-attempt retry budget (roughly ten minutes) querying for a
universal transaction that could never exist before finally surfacing a
generic timeout.

A reverted fee-lock now throws with the transaction hash, matching what the
Solana path already did for a failed signature, so a failed lock is reported
as a failure rather than as a ten-minute timeout. Successful fee-locks are
unaffected.

---
'@pushchain/core': patch
---

Enforce read query and callback constraints in TypeScript and infer results through
read, preparation, batch execution, and response wait/refresh. Preparation rejects
lifecycle options; result types preserve the existing runtime array/scalar shapes.

Revalidate every prepared read against current chain state before executing a batch,
without changing its query, pin, expiry, or payment. Emit observable preparation,
request, and batch progress, deduplicate shared hooks, and avoid reporting an
in-progress callback after fulfillment has already been observed.

Select overloaded ABI return types by the supplied arguments and export the new read
helper types from the package entrypoint. Check remaining escrow against declared
callback gas at the current base fee before broadcast.

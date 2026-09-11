---
'@pushchain/core': patch
---

Preserve partial read-batch recovery across the full native Push execution path,
including receipt, nonce-refresh, indexing and response-construction failures.
`ReadStateError.transactionHashes` lists successfully mined calls;
`pendingTransactionHash` identifies a broadcast transaction with an unknown outcome.
Check its receipt before resubmitting to avoid duplicate reads.

Confirm expiry refunds by scanning distinct execution-attempt heights newest first.
An unavailable block or unrelated malformed log no longer hides a refund recorded at
another attempt. Refund amounts remain unknown without matching EndBlock evidence.

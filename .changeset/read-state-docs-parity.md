---
'@pushchain/core': minor
---

Read state: API parity with the Universal Read docs.

- EVM contract-call reads accept any ABI function, including `nonpayable` and `payable`.
  Validators run the call as an `eth_call` simulation at the pinned block, so it returns
  data and never executes. Argument and return types are inferred for every mutability.
- `UniversalReadResponse.outcome` (`PushChain.CONSTANTS.READ.OUTCOME`) gives one answer to
  "did it work": `SUCCESS`, `SOURCE_ERROR`, `CALLBACK_FAILED`, `DECODE_FAILED`, `EXPIRED`,
  `FAILED`, `ABORTED`, `PENDING`, or `UNKNOWN` (FULFILLED, but the fulfil receipt could not be
  read, so delivery is unconfirmed). `status`, `raw.status`, `callbackDelivered` and
  `decodeError` are unchanged.
- `trackRead` emits `READ-TX-104-03` (Looking Up Request), `READ-TX-104-04` (Request Found,
  one per record) and `READ-TX-104-05` (Request Not Found, at the 30 s lookup timeout).
- `trackRead` on a terminal read no longer spends ~19 s on Donut. Fulfil and settle receipts
  are fetched in parallel, and a receipt pruned from the public RPC goes to the archive after
  one no-retry attempt instead of ~8 s of transport retries.
- `UniversalReadResponse.requestIdUint` (`bigint`): the request ID as the `uint256` contracts
  key results by, e.g. `registry.resultByRequestId(done.requestIdUint)`.
- `explorerUrl` (and Donut's viem `blockExplorers`) now use the live explorer
  `https://donut.push.network`; `explorer.donut.push.org` does not resolve.
- `callback.gasLimit` is optional for custom targets too and defaults to `500_000n`
  (`REGISTRY_CALLBACK_GAS`); unused callback budget is refunded.
- For an ABI not declared `as const`, `value` is typed `unknown` instead of `readonly unknown[]`
  (viem returns a single output unwrapped).
- Progress events: `READ-TX-199-01` now fires only when `outcome` is `SUCCESS`. A FULFILLED read
  that did not work ends on `READ-TX-199-02` with `status` set to its outcome
  (`SOURCE_ERROR`, `CALLBACK_FAILED`, `DECODE_FAILED`, `UNKNOWN`). Refund events
  `READ-TX-106-05/06` also fire for EXPIRED reads. `READ-TX-105-04` (Approaching Expiry) fires
  once during `wait()` when 30 or fewer Push blocks remain, and `READ-TX-102-04`
  (Preflight Stale) fires when `executeReads` revalidates a read prepared more than 60 s earlier.


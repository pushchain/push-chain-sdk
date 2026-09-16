---
'@pushchain/core': minor
---

Add cross-chain read state to the universal API.

A Push Chain app contract can ask for state on another chain (Ethereum, Solana) or an
https endpoint and receive it back through `UniversalCallback`. The SDK now computes
everything a developer cannot guess and tracks the request to completion:

```ts
// build a validated ReadSpec for your own UniversalReadClient contract
const prepared = await client.universal.prepareRead(user, {
  chain: CHAIN.ETHEREUM_SEPOLIA,                  // or { token }, { abi, functionName, args },
  callback: { target: myReadClient, gasLimit: 200_000n },  // { storageSlot }, web2 …
});
const { data, value } = toCallData(prepared, { abi: myAbi, functionName: 'requestBalance' });
const tx = await client.universal.sendTransaction({ to: myReadClient, data, value });

// resume by tx hash, wait for quorum, get the decoded value
const [read] = await client.universal.trackRead({ txHash: tx.hash });
const done = await read.wait();
done.status === PushChain.CONSTANTS.READ.STATUS.FULFILLED && done.callbackDelivered && done.value;
```

- `prepareRead` — preflight (oracle height, protocol fee, gas price), envelope encoding for
  EVM / SVM / web2, callback budget sizing, expiry math, every contract precondition
  checked client-side (`InvalidReadSpecError.violations`).
- `trackRead` / `wait()` / `refresh()` — node record + settlement logs; `callbackDelivered`
  distinguishes a delivered result from a reverted callback (both are `FULFILLED`);
  `fees` reports paid / burned / refunded.
- `READ-TX-*` progress events, `PushChain.CONSTANTS.READ`, typed errors, pure helpers
  (`encodeReadQuery`, `decodeReadResult`, `toCallData`, event parsers) exported.
- `read()` and `executeReads()` support existing app receivers via
  `callback: { target, gasLimit, abi, functionName, args? }`. The default
  request arguments are `(spec, callbackGasLimit)`. Each call must emit exactly one
  matching read. Prepared metadata retains the callback target and decoder;
  `executeReads()` returns a typed `BatchReadResponse` with `txHash`, `reads`, `count`,
  `atomic`, and `wait()`. Results preserve input order. Both methods require a signer and wait for terminal
  reads unless `waitForCompletion: false` is supplied. Wallets without EIP-7702 use
  sequential transactions; all hashes are retained for tracking. On Donut, omitting
  the target uses the canonical registry at `0x91b09DAd1774bAfDE679F9ebB5F9046AE2b928C8`,
  with 500,000 callback gas by default. Other networks require a custom receiver.

Registry calls include a stable SDK query key that excludes block/slot, payment and expiry.
`PreparedRead.queryKey` retains it as request metadata. Registry key/lookup helpers are
package-internal; direct storage queries use the exported contract ABI with viem.
Use tracking to verify consensus status, delivery and settlement.

Default polling uses remaining Push blocks at each wait/resume × 1,340 ms plus a
10-second observation margin, capped at 180 seconds. Explicit timeouts take precedence.

The public grammar uses `CHAIN.WEB2` for https reads while keeping Web2 out of transaction
chain types. SVM and Web2 pinning is selected internally rather than exposed as
`blockNumber` / `minConfirmations`. EVM ABI results follow viem semantics: a single output
is unwrapped and multiple outputs remain tuples. Web2 extraction results remain ordered arrays.

Read-state review fixes: reject mismatched preflight destinations, retain exact ABI
overloads, bound polling and RPC waits by one deadline, and serialize nested bigint
progress values. Expired reads confirm the refund from the EndBlock logs in the Cosmos
block results (recipients can reject payment, so it is never assumed). A non-atomic batch
that fails midway throws `READ_REQUEST_TX_FAILED` carrying the hashes already mined.
Solana token reads accept `tokenProgram: 'token-2022'`; the default remains `'spl-token'`.

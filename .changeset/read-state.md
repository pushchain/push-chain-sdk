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
- `simulateRead` — eth_call the request as your contract; decodes contract errors.
- `trackRead` / `wait()` / `refresh()` — node record + settlement logs; `callbackDelivered`
  distinguishes a delivered result from a reverted callback (both are `FULFILLED`);
  `fees` reports paid / burned / refunded.
- `READ-TX-*` progress events, `PushChain.CONSTANTS.READ`, typed errors, pure helpers
  (`encodeReadQuery`, `decodeReadResult`, `toCallData`, event parsers) exported.
- `read()` and `executeReads()` are declared and typed but throw
  `ReadRegistryUnavailableError` until the canonical `UniversalReadRegistry` is deployed.

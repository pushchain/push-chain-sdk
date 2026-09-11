# UniversalReadRegistry — Smart Contract Handoff

**Audience:** smart-contract developer · **Owner:** contracts team · **SDK package:** `@pushchain/core`

Related documents:

- [`read-state-sdk-spec.md`](./read-state-sdk-spec.md)
- [`read-state-blockers.md`](./read-state-blockers.md)
- [`read-state-tutorial.md`](./read-state-tutorial.md)

## Summary

The SDK is trying to make this one-shot API work without requiring every developer to deploy a callback contract:

```ts
const result = await client.universal.read(subject, {
  chain: CHAIN.ETHEREUM_SEPOLIA,
});
```

Universal Read results must be delivered to an on-chain callback contract. An EOA, backend, or frontend cannot receive that callback directly. `UniversalReadRegistry` is the missing shared application contract that will create the request, receive the callback, and store the result on behalf of the caller.

This is a new application contract and deployment. It does **not** require an upgrade to `UniversalCallback` or the node.

## What works today

The SDK already supports applications that have their own read client:

```ts
await client.universal.read(subject, {
  chain,
  callback: {
    target: myUniversalReadClient,
    gasLimit: 200_000n,
    request: {
      abi: myClientAbi,
      functionName: 'request',
    },
  },
});
```

The application contract calls `UniversalCallback.requestExternalReadSelf`, receives the eventual callback, and handles the result.

## What is blocked

When `callback` is omitted, the SDK has no contract that can safely:

1. create the read on behalf of the caller;
2. receive the asynchronous callback;
3. associate the callback with the original reader; and
4. store the result for later lookup.

The SDK therefore throws `ReadRegistryUnavailableError`. It cannot solve this off-chain because the callback must execute on Push Chain.

## Intended request flow

```text
EOA or UEA
  → SDK prepares ReadSpec and payment
  → UniversalReadRegistry.read{value: payment}(spec, gasLimit)
  → registry calls UniversalCallback.requestExternalReadSelf
  → ReadRequested(requestId) is emitted
  → validators read and vote
  → UniversalCallback calls the registry callback
  → registry stores the result for the original reader
  → SDK returns or tracks UniversalReadResponse
```

When this contract is deployed, the SDK will internally provide:

```ts
callback.target = UNIVERSAL_READ_REGISTRY_ADDRESS;
callback.gasLimit = REGISTRY_CALLBACK_GAS;
callback.request = canonicalRegistryRequestEntrypoint;
```

The user will no longer need to pass a callback for the standard one-shot flow.

## Required contract behavior

### 1. Public payable request entrypoint

The registry needs an EOA/UEA-callable function equivalent to:

```solidity
function read(
    ReadSpec calldata spec,
    uint64 callbackGasLimit
) external payable returns (uint256 requestId);
```

The final name and ABI must be provided to the SDK. The expected behavior is:

1. Copy or validate the supplied `ReadSpec`.
2. Set or require `spec.revertRecipient == msg.sender` for the canonical flow.
3. Forward the complete `msg.value` to `requestExternalReadSelf`.
4. Use the registry's callback selector.
5. Store `requestId → reader` and `requestId → queryKey`.
6. Emit a registry-level event that lets indexers associate the reader, query, and request ID.

Conceptually:

```solidity
function read(ReadSpec calldata input, uint64 gasLimit)
    external
    payable
    returns (uint256 requestId)
{
    ReadSpec memory spec = input;
    spec.revertRecipient = msg.sender;

    requestId = UNIVERSAL_CALLBACK.requestExternalReadSelf{value: msg.value}(
        spec,
        this.onUniversalData.selector,
        gasLimit
    );

    // Save reader and query identity for the later callback.
}
```

This is conceptual pseudocode, not a final ABI or implementation.

### 2. Receive and authenticate callbacks

The registry must expose the callback shape expected by `UniversalCallback`, currently represented by:

```solidity
function onUniversalData(uint256 requestId, bytes calldata resultData) external;
```

Requirements:

- Only the canonical `UniversalCallback` contract may call it.
- Unknown or already-finalized request IDs must be handled explicitly.
- The callback must not allow one reader to overwrite another reader's result.
- Callback processing must not perform unbounded loops.
- A callback failure must be observable through the existing `CallbackFailed` behavior.

Prefer inheriting the canonical `UniversalReadClient` implementation if it already supplies the callback authentication and selector plumbing.

### 3. Store results

The SDK needs two lookup forms:

```solidity
resultByRequestId(requestId)
latestResult(reader, queryKey)
```

The stored result should contain enough information to distinguish at least:

- whether a value exists;
- the request ID;
- the raw result bytes;
- the update block or timestamp; and
- the logical query key.

Suggested conceptual shape:

```solidity
struct StoredReadResult {
    uint256 requestId;
    bytes resultData;
    uint64 updatedAtBlock;
    bool exists;
}
```

The node remains the authoritative source for consensus status, error code, callback delivery, and fee accounting. The registry does not need to duplicate every node field.

### 4. Define `queryKey` exactly

The contract and SDK must share one canonical `queryKey` algorithm. It must identify the logical query without collisions.

A decision is required on whether the key represents:

- the logical query, allowing every new read to update one `latestResult`; or
- the fully pinned request, including `blockNumber`, which creates a different key for every snapshot.

The first form is usually more useful for `latestResult`. Whatever is selected must be specified as an exact ABI encoding and hash formula, with Solidity and TypeScript test vectors.

### 5. Refund handling

The deployed `ReadSpec` contains:

```solidity
address revertRecipient;
```

Although the registry becomes `originalFunder` when it forwards `msg.value`, normal settlement and expiry refunds can go directly to `revertRecipient`.

For the canonical flow, the registry should set or enforce:

```text
revertRecipient = msg.sender
```

Therefore the registry does not need the original draft's normal refund-forwarding mechanism. It should still have an explicit policy for accidentally received funds and failed transfers, with no unrestricted admin sweep of user-owned funds.

### 6. Support batching

The SDK may call the registry entrypoint multiple times in one multicall transaction. Every call must:

- create exactly one `ReadRequested` request;
- preserve its own `msg.value`;
- return and store its own request ID; and
- settle independently.

There must be no shared temporary state that lets one request overwrite another during a batch.

## `REGISTRY_CALLBACK_GAS`

The SDK calculates the callback budget from the registry callback gas limit:

```text
callbackBudget = REGISTRY_CALLBACK_GAS × Push gas price × SDK buffer
```

The contracts team must provide one tested gas value after the registry implementation is final.

The gas test must cover the most expensive supported callback, including:

- a new storage slot;
- updating an existing slot;
- the largest supported `resultData`;
- registry events; and
- request bookkeeping cleanup.

Result size is an important design constraint. Storing arbitrary dynamic `bytes` makes callback gas depend on response size. Before pinning one gas constant, the contract must either:

1. rely on and test a protocol-level maximum result size;
2. enforce a registry maximum result size; or
3. store a fixed-size commitment and use events or the node for the full bytes.

If callback gas is too low, validators may successfully reach consensus while the registry callback runs out of gas. The node can still report `FULFILLED`, but `callbackDelivered` will be false and the registry will not contain the result.

The selected value must stay below the deployed maximum callback limit of `1_000_000` gas.

## `UNIVERSAL_READ_REGISTRY_ADDRESS`

After deployment, provide the canonical address for every supported Push network:

```ts
UNIVERSAL_READ_REGISTRY_ADDRESS = {
  TESTNET_DONUT: '0x...',
  TESTNET: '0x...',
  MAINNET: '0x...',
};
```

The SDK will pin these addresses rather than discovering an arbitrary contract dynamically. The deployment handoff must include:

- network;
- deployed address;
- deployment transaction hash;
- source commit/tag;
- constructor or initializer arguments;
- proxy and implementation addresses, if upgradeable;
- verified ABI;
- callback selector;
- `REGISTRY_CALLBACK_GAS`; and
- deployed bytecode or implementation hash for drift checks.

## Suggested events

Exact names are open, but the SDK/indexer needs equivalent information:

```solidity
event RegistryReadRequested(
    uint256 indexed requestId,
    address indexed reader,
    bytes32 indexed queryKey
);

event RegistryReadStored(
    uint256 indexed requestId,
    address indexed reader,
    bytes32 indexed queryKey,
    bytes resultData
);
```

If full result bytes are too expensive to emit and store, agree on one authoritative representation before implementation.

## Security requirements

- Authenticate the callback sender.
- Protect the request entrypoint and callback from reentrancy where needed.
- Do not trust a user-supplied reader identity; derive it from `msg.sender`.
- Set or validate `revertRecipient` for the canonical flow.
- Forward exactly the intended `msg.value`.
- Prevent duplicate callback settlement from corrupting the latest result.
- Avoid unbounded storage growth where possible, or document the intended retention model.
- Avoid unbounded callback work based on attacker-controlled result bytes.
- Define upgrade/admin authority explicitly.
- Define how accidentally received native funds can be recovered without sweeping active user funds.

## Acceptance criteria

The contract is ready for SDK integration when all of the following pass:

1. An EOA can call `read` and create exactly one `ReadRequested` event.
2. A UEA can call the same entrypoint.
3. `msg.value` is forwarded and recorded correctly.
4. Refunds settle directly to the caller's enforced `revertRecipient`.
5. Only `UniversalCallback` can deliver a result.
6. A successful callback stores the result by request ID.
7. `latestResult(reader, queryKey)` returns the newest result for that reader and query.
8. Two readers cannot overwrite or read misattributed results.
9. Multiple registry calls in one multicall create independent requests.
10. Duplicate and unknown callbacks have deterministic behavior.
11. Worst-case callback execution fits inside `REGISTRY_CALLBACK_GAS` with measured headroom.
12. A live Donut read works through the registry without a user-supplied callback.

The final SDK acceptance test is:

```ts
const result = await client.universal.read(subject, {
  chain: CHAIN.ETHEREUM_SEPOLIA,
});
```

It must prepare, broadcast, recover the request ID, reach consensus, deliver the registry callback, store the result, decode it, settle the callback budget, and return the terminal response.

## SDK work after contract deployment

Once the contracts team supplies the deployment handoff, the SDK team will:

1. add the registry ABI;
2. pin `UNIVERSAL_READ_REGISTRY_ADDRESS` per network;
3. pin `REGISTRY_CALLBACK_GAS`;
4. use the registry as the default callback target and request entrypoint;
5. make the standard `callback` option optional at runtime;
6. add `latestResult` read helpers if they remain part of the final ABI;
7. add selector, address, bytecode, and gas drift tests; and
8. add unit, integration, and live E2E coverage for a read with no callback option.

## Non-goals

- No `UniversalCallback` upgrade.
- No node change for the basic registry flow.
- No change to validator consensus.
- No replacement for custom application receivers.
- No nested read from inside a callback in v1.

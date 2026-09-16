# Donut registry integration

The SDK defaults to the deployed `UniversalReadRegistry` when `callback.target` is omitted.

- Network: `PUSH_NETWORK.TESTNET_DONUT` only (chain ID 42101).
- Proxy: `0x91b09DAd1774bAfDE679F9ebB5F9046AE2b928C8`.
- Implementation observed at block 23216497: `0x67ff18c8972b088670656d448881a026314d900f`.
- Callback predeploy: `0x00000000000000000000000000000000000000c2`.
- Entrypoint: `read(ReadSpec spec, bytes32 queryKey, uint64 callbackGasLimit)`.
- Default gas: `500_000n`; override through `callback.gasLimit`, maximum `1_000_000n`.

Other network settings have no pinned registry. They require a custom receiver or throw `ReadRegistryUnavailableError`; the Donut address is never reused automatically on another network.

## Request and lookup

```ts
import { CHAIN, PushChain, UNIVERSAL_READ_REGISTRY_EVM } from '@pushchain/core';

// client is an initialized signing PushChain client connected to Donut.
const result = await client.universal.read(holder, {
  chain: CHAIN.ETHEREUM_SEPOLIA,
});

// Preparation is read-only; the key is available before sending.
const prepared = await client.universal.prepareRead(holder, {
  chain: CHAIN.ETHEREUM_SEPOLIA,
  callback: { gasLimit: 750_000n },
});
const batch = await client.universal.executeReads([prepared], { waitForCompletion: false });
const [done] = await batch.wait();

// This lookup is raw on-chain storage. donutPublicClient is a viem PublicClient.
const stored = await donutPublicClient.readContract({
  address: PushChain.CONSTANTS.READ.UNIVERSAL_READ_REGISTRY_ADDRESS.TESTNET_DONUT,
  abi: UNIVERSAL_READ_REGISTRY_EVM,
  functionName: 'latestResult',
  args: [client.universal.account, prepared.queryKey],
});
```

Registry key and lookup helpers are package-internal (V3 decision, 2026-09-16). For a specific stored result, use the same direct viem call with `functionName: 'resultByRequestId'` and `args: [BigInt(requestId)]`. Both contract views return `{ requestId, resultData, updatedAtBlock }`; absent entries contain zero-valued fields.

The four `client.universal` methods are the public read workflow. Registry storage alone does not report validator error codes, callback failures, settlement, or expiry. Verify consensus success and callback delivery through the tracked response before consuming a value.

## Exact query-key algorithm (v1)

The SDK hashes:

```text
keccak256(abi.encode(
  string("pushchain:universal-read:query:v1"),
  string(chainNamespace),
  string(chainId),
  bytes(svmOwnerBytesOrEmpty),
  bytes(normalizedEnvelope)
))
```

`normalizedEnvelope` uses the same canonical query encoders as the actual request, with EVM block number fixed to `1`, Solana minimum slot fixed to `0`, and Web2 HTTP timeout fixed to `5000`. These values are used only for hashing; actual requests retain their real references and requested timeout.

The key includes the destination, query kind, target/account, calldata or storage slot, and Web2 URL, method, canonicalized headers, body and extraction declarations. SPL identity includes the derived token account, so the mint, holder and token program affect the key. Equivalent ERC-20 shorthand and explicit `balanceOf` calls have the same key.

It excludes live block/slot references, confirmations, expiry, payment, callback gas and refund recipient. The EVM `ReadSpec.account.owner` is also excluded: the actual target is in the envelope, while the SDK's owner field can depend on refund configuration. Solana owner bytes are included because they identify the queried account.

Pinned example: Sepolia native balance of `0x1111111111111111111111111111111111111111` has key `0x962adcb6ecfd641636346646039316499a1990d5a6ab83b5169379d2d86c33e6`.

`PreparedRead.queryKey` retains the internally computed identifier. The registry receives the non-zero SDK key rather than using its zero-key fallback, which hashes height-bearing query bytes.

Keys are caller-supplied labels, not authenticated query commitments. A direct contract caller can use the same key for unrelated queries in their own reader namespace. Consumers relying on another reader's result must verify the associated request and its provenance. Latest ordering follows request submission order, not callback arrival order or greatest source-chain height.

## Refunds and callback gas

The deployed registry preserves a non-zero `spec.revertRecipient`; it only defaults a zero recipient to `msg.sender`. The SDK prepares a non-zero recipient, preserving exact spec matching and explicit `refundTo` overrides.

The 500,000-gas default is a starting point, not a guarantee for arbitrary result sizes. A callback that runs out of gas does not store a result. Settlement charges consumed callback gas and attempts to refund the remainder; the protocol fee is retained. To retry, submit a new paid request with a larger limit. Some results can exceed even the maximum.

## Validation scope

Unit tests cover default request encoding, logical-key stability and separation, custom receivers, gas overrides, network isolation, batching, and raw lookup helpers. Read-only Donut checks verify proxy configuration, lookup ABI behavior, and successful simulation of the SDK-prepared payable request using a temporary balance override.

The funded `read-canonical-registry` scenario passed on 2026-09-15 in 38.2 seconds. It submitted two reads at different EVM pins, both under query key `0xcb0d77c5a19c5babd4378c67e17fc3b47e1e4941e92a8d966cb1fa8006c2957f`. Requests `0x7441d60d…` (tx `0xd91e16e3…`) and `0x4b8ab3bb…` (tx `0x858d2db6…`) both fulfilled and delivered; per-request registry bytes matched node consensus bytes, `latestResult` selected the second request, explicit/default refund routing was correct, and callback budget burn plus refund equalled the deposited budget.

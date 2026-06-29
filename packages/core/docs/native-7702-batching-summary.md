# Native EIP-7702 Multicall — Summary

_Short version for sharing. Full details: [`native-7702-batching.md`](./native-7702-batching.md)._

## What changed

Native-Push EOA multicalls now run as **one atomic EIP-7702 transaction** instead
of N separate, non-atomic transactions. Same SDK API
(`universal.sendTransaction({ to, data: calls })`) — the upgrade is automatic on
the native-Push route.

- **Before:** 3 calls → 3 txs. If call 2 reverts, call 1 stays committed.
- **After:** 3 calls → 1 tx. All succeed or all revert.

How: the EOA delegates its code to a `PushBatchExecutor` contract via a type-4
(`SetCode`) tx and calls `execute(calls)` on itself in the same tx.

## Status: ✅ live on Testnet Donut

| | |
| --- | --- |
| Executor | `0x776d8031b9caA053d04325Bc2CAc47E5cb673776` (chain 42101) |
| Verified | e2e on testnet — 3 calls, 1 type-4 tx, counter +3 atomic |
| Mainnet | not live yet — nothing to deploy |

## Which multicalls use it?

Only the **native-Push EOA** route, on a chain with a deployed executor, with a
7702-capable wallet (local viem account / ethers v6). Everything else is unchanged:

| Scenario | Path |
| --- | --- |
| Native Push EOA · testnet · capable wallet | ✅ 7702 atomic tx |
| Native Push EOA · incapable wallet (injected/JSON-RPC) | ↩ legacy loop + warn |
| Bridged / cross-chain (Ethereum, Base, …) | UEA proxy `UEA_MULTICALL` (already atomic) |
| SVM / Solana | UEA `UEA_MULTICALL` (can't 7702) |
| Outbound CEA batches | custom multicall (unchanged) |

> The big bucket — bridged/cross-chain — was already atomic via the UEA proxy and
> is untouched. 7702 only fixed the one route that wasn't atomic.

## Fallback (safe by design)

If the wallet can't sign a 7702 authorization, the SDK falls back to the legacy
sequential loop (+ `console.warn`). The fallback only triggers **before any tx is
broadcast**, so it can never double-execute. Real reverts are surfaced, not hidden.

## Where the code lives

- Contract (canonical): `push-chain-core-contracts/src/executor/PushBatchExecutor.sol`
- Contract (vendored ref in SDK): `packages/core/src/lib/push-chain/helpers/PushBatchExecutor.sol`
- SDK builder: `EvmClient.sendBatch7702` (`vm-client/evm-client.ts`)
- Route branch: `sendPushTx` (`orchestrator/internals/push-chain-tx.ts`)
- Address config: `PUSH_BATCH_EXECUTOR_ADDRESS` (`constants/chain.ts`)

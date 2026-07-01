# Native EIP-7702 Batching for Push Chain Multicalls

> Status: **live on Push testnet (Donut).** `PushBatchExecutor` — a thin wrapper
> over OpenZeppelin's **ERC-7821** batch-executor implementation
> (`draft-ERC7821`) — is deployed at
> `0x0106BF2F9B02f32203A83a3bDaD79fE8818f3796` (chain 42101) and wired into the
> SDK; the native-Push multicall path now produces a single atomic type-4 tx.
> Verified end-to-end (see "Verification status"). Push mainnet isn't live yet,
> so there's no mainnet deployment.

## TL;DR

A native Push EOA that submits a "multicall" (an array of calls) used to get
**N separate, non-atomic transactions**. This change makes it **one atomic
EIP-7702 transaction**: the EOA delegates its code to a `PushBatchExecutor`
contract for the duration of the tx and runs all calls in a single, all-or-nothing
batch. If the wallet can't sign a 7702 authorization, the SDK falls back to the
old behaviour and warns.

Only the **native Push EOA** path changes. Bridged-EVM (via UEA proxy), outbound
CEA batches, and SVM continue using the existing `UEA_MULTICALL` mechanism.

---

## Why

### 1. The native multicall path was never atomic

When the universal signer is on Push Chain itself, batches went through
`sendPushTx` (`orchestrator/internals/push-chain-tx.ts`). For an array of calls
it **looped and sent one transaction per call**, awaiting each receipt:

```
client.universal.sendTransaction({ to, data: [call1, call2, call3] })
        │
        ▼  sendPushTx — Array.isArray(data) → loop
   ┌──────────────────────────────────────────────────────────────┐
   │  TX #1 (nonce n)   EOA ─► call1.to   wait receipt ─► ✅        │
   │  TX #2 (nonce n+1) EOA ─► call2.to   wait receipt ─► ❌ revert │
   │  TX #3 ............ never sent (loop threw on #2)              │
   └──────────────────────────────────────────────────────────────┘
        ▼
   ⚠️ call1 is already committed. No rollback. 3 sigs, 3 blocks.
```

Problems:

- **Not atomic** — a later call reverting leaves earlier calls permanently
  committed. There is no "all or nothing".
- **Slow** — N signatures and N block confirmations.
- **Inconsistent with the rest of the system** — bridged/SVM users already get
  atomic batches via the UEA contract's `UEA_MULTICALL`. The native EOA path was
  the outlier, because a plain EOA has no code to batch calls with.

### 2. EIP-7702 is now live on Push Chain

EIP-7702 (type-4 `SetCode` transactions) is enabled in the `pushchain/evm` fork:
the EVM module implements authorization application/validation
(`x/vm/keeper/state_transition.go`), the ante handler and mempool admit
`SetCodeTxType`, and the Prague fork is active from genesis
(`DefaultChainConfig` → `pragueTime = 0`). This lets an EOA temporarily adopt a
contract's code, which is exactly the primitive needed to batch from an EOA.

### 3. Goal

Give the native EOA path a **real, atomic multicall** using native 7702 — without
disturbing the UEA-proxy model that funds and represents bridged/SVM users.

---

## Scope decisions

| Question | Decision |
| --- | --- |
| Which accounts? | **EVM + native Push (secp256k1) only.** SVM (ed25519) cannot sign a 7702 authorization, so it is out of scope. |
| Account model | **Keep the UEA proxy as the funded account.** 7702 batching applies only where the executing signer *is* an EOA — the native-Push Route-1 path. |
| Which batches? | **Push-Chain-native execution only.** Bridged-EVM-via-proxy, outbound CEA (executes on contracts / external chains), and SVM keep `UEA_MULTICALL`. |
| Wallet without 7702 support | **Fall back to the legacy per-call loop + `console.warn`.** Capability-based: we only attempt 7702 when the signer exposes `signAuthorization`. |

Why SVM is excluded: EIP-7702 authorizations are secp256k1 signatures whose
recovered `authority` must equal the delegating account. An ed25519 (Solana) key
cannot produce such a signature, so native 7702 is physically impossible for SVM
accounts.

---

## Which multicalls use this path?

The 7702 path is wired into a single route — `sendPushTx`, the **native-Push
EOA** path (`isPushChain(signer.chain)` in `execute-standard.ts`). It engages
**automatically** there (no caller/API change — same
`sendTransaction({ to, data: calls })`), but **only** when all of these hold:

1. The signer's origin is **Push Chain itself** (native EOA).
2. An executor address is **configured for that chain** — currently **Testnet
   Donut only**.
3. The wallet can **actually sign a 7702 authorization** — a local viem account
   or a working ethers v6 signer (see capability gating above).

Everything else is unchanged and does **not** use 7702:

| Multicall scenario | Path |
| --- | --- |
| Native Push EOA · Testnet Donut · 7702-capable wallet | ✅ **new 7702 atomic tx** |
| Native Push EOA · 7702-incapable wallet (injected / JSON-RPC) | ↩ legacy per-call loop + warn |
| Native Push EOA · chain with no executor configured | ↩ legacy per-call loop |
| Bridged / cross-chain user (origin = Ethereum, Base, …) | UEA proxy `UEA_MULTICALL` (unchanged, already atomic) |
| SVM / Solana signer | UEA `UEA_MULTICALL` (cannot 7702) |
| Outbound CEA batches (execute on external chains) | custom multicall (unchanged) |

Notes:

- The large bucket — **bridged / cross-chain multicalls** — was already atomic
  via the UEA proxy and stays on that path. 7702 only replaced the one route that
  *wasn't* atomic: the native-Push EOA per-call loop.
- **Mainnet does not exist yet**, so there is no mainnet executor and nothing to
  configure there. When a Push mainnet launches, deploy the executor and set
  `PUSH_BATCH_EXECUTOR_ADDRESS[CHAIN.PUSH_MAINNET]`; until then any non-testnet
  native batch transparently uses the legacy loop.

---

## How it works now

```
client.universal.sendTransaction({ to, data: [call1, call2, call3] })
        │
        ▼  sendPushTx — executor configured? signer.signAuthorization present?
        │                         │ yes
        ▼                         ▼  EvmClient.sendBatch7702()
   ┌─────────────────────────────────────────────────────────────────┐
   │ 1. sign 7702 authorization (EOA key):                            │
   │      { chainId, address: EXECUTOR, nonce: n+1, r, s, yParity }    │
   │ 2. data = execute(batchMode, abi.encode([call1,call2,call3]))    │
   │ 3. serialize ONE type-4 (eip7702) tx:                            │
   │      to = EOA (self), nonce = n, authorizationList = [auth]       │
   └─────────────────────────────────────────────────────────────────┘
        │  one signed type-4 tx
        ▼
   ┌──────────────────── single transaction (atomic) ─────────────────┐
   │ ① node applies authorization: EOA.code ← 0xef0100 ‖ EXECUTOR      │
   │ ② tx calls EOA.execute(mode, executionData); msg.sender==self     │
   │      → executor's self-call check passes (no per-call sig)        │
   │      ├─ call1 ✅  ├─ call2 ❌ revert  → WHOLE TX REVERTS           │
   │      └─ call1 rolled back                                         │
   └───────────────────────────────────────────────────────────────────┘
        ▼
   ✅ all-or-nothing, 1 tx, 1 receipt
```

Two subtleties worth noting:

- **Authorization nonce is `n + 1`, not `n`.** In self-execution the transaction
  consumes the sender's nonce `n` first; EIP-7702 then validates the
  authorization against the already-incremented nonce. `sendBatch7702` sets
  `nonce: nonce + 1` accordingly.
- **Gas estimation uses a state override.** Before the tx, the EOA has no code,
  so estimating `execute(...)` against it would under-estimate. We override the
  account's code with the delegation designator (`0xef0100 ‖ executor`) so the
  estimate runs the executor, then add 20% headroom. If the node rejects
  overrides, the fallback ceiling scales with the batch size
  (`500_000 * calls.length + 100_000`) so large batches don't out-of-gas.

---

## What changed

### Contract — `push-chain-core-contracts`

**`src/executor/PushBatchExecutor.sol`** — the EIP-7702 delegation target, a thin
wrapper over OpenZeppelin's **ERC-7821** minimal batch-executor implementation
(OZ ships it as `draft-ERC7821`; ERC-7821 is still a draft EIP):

```solidity
contract PushBatchExecutor is ERC7821 {
    string public constant VERSION = "2.0.0";
    receive() external payable {} // accept plain PC transfers to the delegated EOA
}
```

- Authorization is inherited unchanged from `ERC7821`:
  `_erc7821AuthorizedExecutor` ⇒ `caller == address(this)` — exactly the EIP-7702
  self-call (the EOA submits its own type-4 tx). No custom auth code.
- Entry point: `execute(bytes32 mode, bytes executionData)`. Single batch mode
  only; `executionData = abi.encode(Execution[])`, `Execution = (address target,
  uint256 value, bytes callData)`.
- Sequential execution, **revert bubbling**, atomic at the tx level — all from
  the OZ base. Stateless (no nonce/reentrancy storage needed: the
  self-call gate already prevents external re-entry).
- Requires **`@openzeppelin/contracts >= 5.4`** (where ERC-7821 lands); the
  contracts repo's OZ submodule was bumped 5.3 → 5.4 (full repo still compiles).

**`test/tests_executor/PushBatchExecutor.t.sol`** — 6 Foundry tests using
`vm.signAndAttachDelegation` (real 7702 delegation): batch exec, self-call auth
rejection, value forwarding, receiving plain native value while delegated,
unsupported-mode rejection, and atomic revert + reason bubbling.

### SDK — `packages/core`

**1. `src/lib/universal/universal.types.ts`** — extend the signer abstraction.
- New `SignAuthorizationParams` and `SignedAuthorization` types.
- New **optional** `signAuthorization?(params)` on `UniversalSigner` and
  `UniversalSignerSkeleton`. Optional so non-EVM / non-7702 wallets are
  unaffected and trigger the fallback.

**2. `src/lib/universal/signer/signer.ts`** — implement it (two shared helpers,
`viemSignAuthorization` / `ethersSignAuthorization`, used by both the keypair and
`toUniversal` paths).
- viem (`LIBRARY.ETHEREUM_VIEM`): gated on the **account** —
  `account.signAuthorization` (present only on local accounts), since viem
  exposes the client action even for JSON-RPC accounts that can't sign offline.
- ethers v6 (`LIBRARY.ETHEREUM_ETHERSV6`): delegates to `signer.authorize()`,
  guarded by method presence and backed by the runtime fallback (see below),
  since `AbstractSigner.authorize`'s default throws.
- Wired through `createUniversalSigner`, the keypair signer object, AND the
  `toUniversal` skeleton generators (`generateSkeletonFromViem`,
  `generateSkeletonFromEthersV6`). SVM, ethers v5, and custom-skeleton paths
  leave it `undefined`.

**3. `src/lib/constants/chain.ts`** — config + lookup.
- `PUSH_BATCH_EXECUTOR_ADDRESS: Partial<Record<CHAIN, 0x...>>` — per-chain executor
  addresses. **Testnet Donut is set** to
  `0x0106BF2F9B02f32203A83a3bDaD79fE8818f3796`; mainnet is unset (a chain with no
  entry → `getBatchExecutorAddress()` returns `undefined` → SDK falls back).
- `getBatchExecutorAddress(chain)` helper.

**4. `src/lib/vm-client/evm-client.ts`** — the type-4 builder.
- `PUSH_BATCH_EXECUTOR_ABI` (ERC-7821 `execute(bytes32 mode, bytes executionData)`),
  the `ERC7821_BATCH_MODE` constant, and a `BatchCall` type.
- `sendBatch7702({ executor, calls, signer })`: encodes the ERC-7821 call
  (`executionData = abi.encode(Execution[])`, batch mode), signs the authorization
  (`nonce + 1`, self-delegation), serializes a `type: 'eip7702'` transaction with
  `authorizationList`, and sends it via the existing `signer.signAndSendTransaction`.
  Inherited by `PushClient extends EvmClient`.

**5. `src/lib/orchestrator/internals/push-chain-tx.ts`** — the branch point.
- In `sendPushTx`, when `data` is an array: if an executor is configured for the
  chain **and** the signer supports `signAuthorization`, route through
  `sendBatch7702` (single atomic tx). Otherwise `console.warn` and fall through to
  the existing per-call loop (unchanged).

---

## Fallback behaviour & wallet capability

The 7702 path is attempted only when **both** are true:

1. `getBatchExecutorAddress(chain)` returns an address (contract deployed +
   configured), and
2. `signer.signAuthorization` exists.

**Capability detection is conservative.** Method *presence* is not trusted as a
capability signal:

- **viem** exposes `signAuthorization` on every WalletClient (even JSON-RPC
  accounts that can't sign one). We therefore gate on the **account** — only
  local accounts (`account.signAuthorization`) get the capability; JSON-RPC
  accounts get `undefined` and fall back. (Covered by unit tests.)
- **ethers v6** has `authorize` on `AbstractSigner` whose default throws, so
  presence alone is unreliable.

To cover the cases capability-detection can't (a method that exists but throws),
`sendBatch7702` signs the authorization **before** building/broadcasting any
transaction; if that step throws it raises `EIP7702NotSupportedError`. The
orchestrator catches **only** that error and falls back to the sequential loop —
safe because nothing was broadcast. Any other error (a real revert, RPC failure
after broadcast) is surfaced, never silently downgraded.

When falling back (or when the wallet has no 7702 capability at all), a
`console.warn` notes the batch will run as separate, non-atomic transactions.

**ethers type-4 shape.** `toEthersTxRequest` converts viem-shaped
`authorizationList` entries (`r`/`s`/`yParity`) into ethers' nested `signature`
form and sets `type: 4`; without this ethers normalises them to a zero signature
and the delegation is silently dropped.

**Gas fallback.** If state-override gas estimation is unavailable, the fallback
ceiling scales with `calls.length` (`~500k`/call + overhead) rather than a flat
value, so large batches don't out-of-gas relative to the old per-call loop.

---

## The `atomic` field on the response

`UniversalTxResponse` carries an `atomic: boolean` (right after `type` /
`typeVerbose`) so callers can tell whether a batch ran all-or-nothing:

| Execution path | `atomic` |
| --- | --- |
| Single tx | `true` |
| EIP-7702 batch (native, this feature) | `true` |
| UEA `UEA_MULTICALL` (bridged / cross-chain / SVM) | `true` |
| Outbound / funds / fee-lock | `true` |
| **Native sequential fallback loop** | **`false`** |

Implementation is default-`true` in `transformToUniversalTxResponse`
(`response-builder.ts`), overridden to `false` only at the sequential-loop return
in `sendPushTx` (`push-chain-tx.ts`). Use it when atomicity is load-bearing —
e.g. treat `atomic === false` as "this batch may have partially applied."
(Historical `trackTransaction` lookups keep the `true` default, since past
execution mode isn't always recoverable.)

## Gas abstraction

Gas-abstracted (sponsor/relayer-pays) batch execution is **not a native-7702
feature** — it's provided by the **existing UEA path** and applies to
**external-origin** flows:

- An **external-origin** user's batch is executed on their **UEA** via a zero-fee
  Cosmos `MsgExecutePayload` that the node's `uexecutor` module runs
  (`UEA_MULTICALL`, atomic). Submission is chain-sponsored (Cosmos `feegrant`);
  the UEA funds EVM gas from its balance / cross-chain fee-lock. This path already
  reports `atomic: true`.
- A **native-Push EOA has no UEA**, so it cannot use this path — it executes
  self-paid via the EIP-7702 batch (or the sequential fallback). There is no
  `gasless` opt-in for native origins because there is nothing to route them
  through; true sponsor-pays-gas for a raw EOA would require new infra (a
  signature-authorized executor + relayer, or node-level type-4 fee sponsorship),
  which is out of scope.

Net: external-origin callers already get gasless + atomic batching automatically;
native callers get atomic (7702) but self-paid.

---

## Deployment

| Network | Address | Notes |
| --- | --- | --- |
| Push Testnet Donut (42101) | `0x0106BF2F9B02f32203A83a3bDaD79fE8818f3796` | OZ ERC-7821 + `receive()`; deploy tx `0xbbe4176a…`, block 18452893 |
| Push Mainnet | — | mainnet not live yet — nothing to deploy |

Deploy via `push-chain-core-contracts/scripts/executor/deployBatchExecutor.s.sol`
(or `forge create src/executor/PushBatchExecutor.sol:PushBatchExecutor`), then set
the address in `PUSH_BATCH_EXECUTOR_ADDRESS`.

### Contract source

- **Canonical (compiled/tested/deployed):**
  `push-chain-core-contracts/src/executor/PushBatchExecutor.sol` — `is ERC7821`
  (requires OZ ≥ 5.4).
- **Vendored reference in this SDK (not built):**
  `packages/core/src/lib/push-chain/helpers/PushBatchExecutor.sol` — the same
  OZ ERC-7821 wrapper, so the deployed source is visible from the SDK without
  checking out the contracts repo.
- **ABI used at runtime:** `PUSH_BATCH_EXECUTOR_ABI` (ERC-7821
  `execute(bytes32,bytes)`) in `vm-client/evm-client.ts`.

## What's not done yet

- **Mainnet:** not applicable yet — Push mainnet isn't live. Once it is, deploy
  the executor and set `PUSH_BATCH_EXECUTOR_ADDRESS[CHAIN.PUSH_MAINNET]`.
- Fold the standalone e2e (`__e2e__/scripts/e2e-7702-multicall.ts`) into the jest
  e2e suite (the existing `native.spec.ts` UTX-21 case now routes through 7702
  automatically).

## Verification status

- **Contract:** 6 Foundry tests pass under real 7702 delegation
  (`test/tests_executor/PushBatchExecutor.t.sol`); full contracts repo compiles
  clean under the OZ 5.4 bump.
- **SDK:** `tsc` clean; signer unit tests (16) pass, including 7702
  capability-gating cases (local account ⇒ capable, JSON-RPC ⇒ fall back).
- **End-to-end (live testnet, OZ ERC-7821 executor):**
  `__e2e__/scripts/e2e-7702-multicall.ts` — a 3-call multicall executed as a
  **single type-4 tx** (`0xcb1124e0…`); counter advanced by exactly 3 atomically
  (1174 → 1177); EOA carries the delegation designator `0xef0100‖executor`. A
  plain value transfer to the delegated EOA also succeeds (verifies `receive()`).

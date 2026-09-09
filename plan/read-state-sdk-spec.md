# Universal Read — SDK API Reference (v2)

**Status:** Draft for team review · **Package:** `@pushchain/core` · **Date:** 2026-09-09
**Ground truth:** `push-chain-core-contracts@feat-read-state` `f8d1a0c` — **the contract deployed on Donut** (`UniversalCallback` impl `0xa481f5b0…`)
**Supersedes:** the v1 builder-style reference (`read-state-sdk-api-reference.md`) and the team's v2 draft pinned to `read-state-fixes-v1`

The cross-chain read surface, mirroring the shipped `universal.*` transaction family. Four methods,
one options bag, no builders, no estimators. Design and method family are the team's v2 draft;
the contract surface underneath it is corrected to what is actually deployed.

---

> ## ⚠ Ground-truth correction — read this first
>
> The team's v2 draft pins to `push-chain-core-contracts@read-state-fixes-v1` and describes:
> a 6-field `ReadSpec` with **no `revertRecipient`**, a 3-arg `estimateFee(ns, chainId, callbackGasLimit)`
> that quotes read + callback together, and a `FeeRefunded` event pushing refunds to `originalFunder`.
>
> **That branch is stale.** It is an ancestor of `feat-read-state`, 18 commits behind. Commit
> `e990ea9 "final fixes"` (2026-08-14) rewrote `UniversalCallback` (338 lines), replaced the
> interface (86 removed / 135 added), and added the `RequestStatus` lifecycle. Every claim above
> is from before that rewrite.
>
> **What is deployed on Donut** (verified by selector probe against the live bytecode):
>
> | | draft says | deployed |
> |---|---|---|
> | `ReadSpec` | 6 fields | **7 fields — `revertRecipient` is required and non-zero** |
> | `requestExternalReadSelf` selector | 6-field spec `0xd37c1add` | **7-field spec `0x72767171`** (6-field selector absent from bytecode) |
> | `estimateFee` | `(string,string,uint64)` → one quote | **`(string,string)` → protocol fee only**; 3-arg selector reverts |
> | fee model | single upfront quote | **`msg.value = protocolFee + callbackBudget`**; excess above the fee is the budget |
> | refund target | `originalFunder` | **`revertRecipient`**, pushed |
> | refund events | `FeeRefunded` | **`RefundSent` / `RefundFailed` / `RequestExpired(id, revertRecipient, refunded)` / `CallbackGasReported`** |
> | lifecycle | — | **`PENDING → EXECUTED → SETTLED / EXPIRED`**, settled by `reportCallbackGas` |
>
> The draft's "known drift" (node decoder still carries `revertRecipient`) is **backwards**: the node
> matches the deployed contract. An SDK built to the draft would ABI-encode a 6-field struct and
> every request would revert on selector mismatch.
>
> Everything below is written to the deployed surface. Method names, option names and the event
> grammar are unchanged from the draft.

---

## Verified live — 2026-09-09

The first three reads ever made on Donut (`_requestNonce` 0 → 3; seven in total by end of day), fired against the deployed
contract with the account in `packages/core/.env`. All settled within **12–23 seconds** of the
request tx, callback executed, escrow returned to zero, refund landed at `refundTo`.

| | read 1 · `0xeba3eb9e…` | read 2 · `0xf3d62fb9…` | read 3 · `0xdc0a66ba…` |
|---|---|---|---|
| sent by | Push EOA, `cast send` | Push EOA, `cast send` | **through a UEA** — Sepolia-origin signer, SDK `universal.sendTransaction` (Route 1) |
| query | Sepolia native balance of `0xdead` | same | same |
| consensus | `ERROR` / `READ_ERROR_INVALID_QUERY` | `SUCCESS` | `SUCCESS` |
| `result_data` | empty | `0x…92b406e140cc2c8871` | `0x…92b406e140cc2c8871` |
| Sepolia ground truth at pin | — | `2706196938206701455473` wei — **exact match** | **exact match** at pin 11667924 |
| `callbackDelivered` | n/a | `ReadFulfilled` | `ReadFulfilled` (fresh; client gained a 2nd sink entry) |
| settlement | burned 0.000117 PC, refunded 0.049883 PC — sums to the 0.05 PC budget to the wei | same shape | same shape; refund landed at the UEA |

**Read 3 is the one that matters most.** `ReadRequested` was emitted inside the UEA's payload
execution (`CallUEAExecutePayload`), the path the N1 fix added ingestion to — and
`x/ucallback` recorded it, voted, fulfilled and settled. It also confirms two SDK assumptions:
`ReadsByTx` finds the record by **the exact hash `sendTransaction` returns**, so tx-hash-first
tracking works for UEA-originated reads; and `refundTo = the UEA` received the refund (Q8).

Read 1's error was **my encoding, not the validators'** — and it is the single most important
implementation detail in this spec:

> **Envelope encoding rule.** Every `ReadSpec.query` is `abi.encode` of **one tuple**, because
> the validator unpacks `abi.Arguments{ tuple }`. Encoding the fields as separate ABI
> parameters (`abi.encode(a, b, c)`) produces a different layout that parses only by
> coincidence when `queryType == 0`, and the `AccountBalance` payload must be
> `abi.encode(address)` (32 bytes), not the raw 20-byte address. Get either wrong and
> validators reach quorum on `INVALID_QUERY` with the fee spent. The SDK must encode with
> `encodeAbiParameters([{ type: 'tuple', components }], [envelope])` and ship the
> cross-language golden vectors from the test plan.

### The remaining four — all passed, 2026-09-09 18:00–18:02 (`_requestNonce` 3 → 7)

Driven by `plan/read-state-tools/live-read-matrix.sh`, one request each from the Push EOA.

| check | requestId | what happened | proves |
|---|---|---|---|
| **reverting callback** | `0x9f0466e2…` → client `0x15372211…` | validators `SUCCESS`; fulfil tx `0x717295e9…` emitted **`CallbackFailed`**, no `ReadFulfilled`; client's `attempts()` stayed 0; node status **`FULFILLED`**; contract went on to `SETTLED` | `callbackDelivered = false` is real and `FULFILLED` does not imply delivery (I4) |
| **expiry** | `0x4a6e27e0…` | `minConfirmations: 500` held validators; `expiryBlocks: 30` won at height 22963638; contract `statusOf = 4`, node `EXPIRED`, `expiry_attempts 1`; escrow → 0 and contract balance → 0, so the full 0.05 PC budget was pushed to `refundTo` | expiry + full-budget refund, and the observability constraint below |
| **SVM** | `0x1e995107…` | Solana devnet lamport balance of `3nK8X1re…`, `owner` = raw 32-byte pubkey, floor = oracle slot − 200 | `result_data` = `abi.encode(727156477)` — **exact match** with finalized devnet |
| **web2** | `0x3870d2af…` | GET `jsonplaceholder.typicode.com/todos/1`, extracts `$.id` uint256 + `$.completed` bool, `blockNumber = 0` (heightless branch) | `result_data` = `abi.encode(1, false)` — **exact match**, flat argument list |

Every destination type and every terminal outcome the SDK models has now been observed live.

> **Expiry is invisible to the EVM RPC.** The sweeper runs in the node's `EndBlocker`, so its
> `expireExternalRead` call has **no fetchable transaction, no receipt, and no `getLogs` entry** —
> `eth_getTransactionByHash`, `eth_getTransactionReceipt` and `getLogs` for `RequestExpired` /
> `RefundSent` all return nothing, while every vote-triggered fulfil tx is fully indexed. The
> evidence exists on the Cosmos side: `block_results?height=<expiry>` carries an `ethereum_tx`
> event (`ethereumTxHash` = the record's `pc_tx` hash, recipient `0x…C2`, `txData` =
> `expireExternalRead(requestId)`) and a `tx_log` event with the two contract logs,
> `mode: EndBlock`. **SDK rule (`trackRead`):** for `EXPIRED`, do not fetch the `pc_tx`
> receipt; take `fees.refunded = request.callback_budget` (contract logic refunds it in full) and,
> if log-level confirmation is wanted, read `block_results` via the existing Tendermint client.
> Explorers will show nothing for an expiry on the EVM side — worth flagging to the chain team.

---

## Design principles

1. **Mirror the tx family 1:1.** `read` ↔ `sendTransaction`, `prepareRead` ↔ `prepareTransaction`,
   `executeReads` ↔ `executeTransactions`, `trackRead` ↔ `trackTransaction`. Same option names,
   same `advanced` bag, same progress-event grammar.
2. **The SDK computes what the dev can't guess.** Preflight (oracle height, protocol fee, gas
   price), callback budget sizing, expiry math, envelope encoding, ATA derivation — all internal.
   Filter: *can the SDK compute it better than the dev can guess it? → internal. Does a real v1
   persona need it? → keep. Hypothetical persona? → cut.*
3. **Typed both directions.** `abi` encodes the call AND decodes the result. No raw-calldata form.
4. **Two personas, one grammar.** Off-chain (bot/backend/frontend) → `read()` one-shot via the
   canonical `UniversalReadRegistry`. Contract devs → inherit `UniversalReadClient`, frontends
   call their entrypoint via plain `sendTransaction` (fee quote = `estimateFee` view + SDK budget
   sizing, exposed through `prepareRead(...).fees`).

---

## Method family

```ts
client.universal.read(subject, options)        // one-shot: request → quorum → decoded value
client.universal.prepareRead(subject, options) // per-item: query + pinning + callback → PreparedRead
client.universal.executeReads(reads, options?) // batch: one multicall tx, N independent requests
client.universal.trackRead(ref, options?)      // resume by { txHash } (array) or { requestId } (single)

// read(subject, opts) ≡ prepareRead(subject, opts) → executeReads([prepared]) → wait()
```

`requestId` is derived on-chain (`chainid, block.number, address(this), specHash, nonce++`) — it
cannot be known before broadcast. Tracking is **tx-hash-first**; requestIds are recovered from
`ReadRequested` logs and become the durable per-read key.

**Batching is supported** (confirmed by Nilesh, 2026-09-07): multiple `requestExternalReadSelf`
calls in one tx are ingested as separate requests and presented to validators separately.
**Chaining is not — by decision (2026-09-09): nested reads are out of scope for v1.** A read
requested from inside a callback reverts (`ReentrancyGuardReentrantCall`, shared guard) and is
swallowed into `CallbackFailed`. The SDK does not attempt it and the docs say so.

---

## read(subject, options)

`subject` = the thing you're asking about: **holder** (balances) · **contract** (calls, state) ·
**https URL** (web2).

```ts
await read(user,     { chain });                                // native balance (ETH / lamports)
await read(user,     { chain, token });                         // token balance (ERC-20 / SPL)
await read(contract, { chain, abi, functionName, args });       // typed call
await read(contract, { chain, storageSlot });                   // storage
await read(url,      { chain: CHAIN.WEB2, web2: { extract } }); // web2
```

### Options

```ts
await client.universal.read(subject, {

  // ══ QUERY — WHAT is read. Kind = which keys are present; TS union enforces exclusivity. ══

  chain: CHAIN,                        // required. Destination + namespace.
                                       //   CHAIN.WEB2 = 'web2:https' (confirmed; also in UV)

  // — balance (EVM + SVM) —
                                       // no query keys → native balance of `subject`
  token: string,                       // token balance of `subject`:
                                       //   EVM → contractCall(balanceOf) envelope
                                       //   SVM → SPLTokenAccount envelope, ATA(token, subject)
                                       //         derived by SDK — deterministic, no network

  // — call (EVM now; SVM via `idl` when program reads land) —
  abi: Abi,                            // encodes AND decodes — `value` typed from outputs.
  functionName: string,                //   view/pure only. No raw callData form.
  args: readonly unknown[],

  // — state (EVM) —
  storageSlot: `0x${string}` | bigint, // storage location, bytes32-normalized

  // — web2 (subject = https URL) —
  web2: {
    extract: [{                        // required; 1–16 entries, result order
      path: string,                    //   JSONPath, e.g. '$.data.price'
      valueType: 'uint256' | 'int256' | 'bool' | 'string' | 'bytes',
      decimals?: number,               //   numeric only; ×10^decimals, TRUNCATED
    }],
    method?: 'GET' | 'POST',           // default 'GET'
    headers?: Record<string, string>,  // default {} — ⚠ PUBLIC event log, forever.
                                       //   SDK warns on /auth|key|token|secret|bearer/i
    body?: string | Uint8Array,        // POST only
    timeoutMs?: number,                // default 5_000; validator-clamped
  },

  // ══ PINNING — HOW/WHEN. All optional, filled from internal preflight.
  //    Maps 1:1 to the deployed ReadSpec. ══

  blockNumber: bigint,                 // EVM pin. default observedChainHeight − minConfirmations.
                                       //   Ceiling is the ORACLE height (UniversalCore), not the
                                       //   real head. Web2: forced to 0 (heightless branch).
  minConfirmations: number,            // default 1. Validators hold until
                                       //   latest ≥ blockNumber + minConfirmations
  expiryBlocks: bigint,                // default 300n Push blocks → EXPIRED; full callbackBudget
                                       //   refunded to `refundTo`; protocol fee is NOT refunded
  maxFee: bigint,                      // cap on msg.value (= protocolFee + callbackBudget).
                                       //   default: computed total × (1 + buffer).
                                       //   Too low fails loud pre-broadcast (ExcessiveFee)

  // ══ CALLBACK — WHERE it lands on-chain. ══

  callback: {
    target: `0x${string}`,             // default canonical UniversalReadRegistry (§Q3, unbuilt).
                                       //   Override with your UniversalReadClient contract
    gasLimit: bigint,                  // default REGISTRY_CALLBACK_GAS. MANDATORY if target
                                       //   overridden. 1n..1_000_000n.
                                       //   ⚠ sizes your callbackBudget — see Fees
  },

  // ══ REFUND — WHERE unspent budget goes. New vs draft: the deployed ReadSpec requires it. ══

  refundTo: `0x${string}`,             // ReadSpec.revertRecipient. Non-zero, REQUIRED by contract.
                                       //   Refunds are PUSHED here. default: the sending account —
                                       //   safe for UEAs (UEA_EVM/UEA_SVM both have a payable
                                       //   receive(); verified live on Donut, Q8). A non-UEA
                                       //   contract without receive() forfeits the refund to the
                                       //   admin rescue pool (verified live) → prepareRead WARNS
                                       //   unless UEAFactory.getOriginForUEA says isUEA

  // ══ LIFECYCLE — HOW the promise behaves. Mirrors trackTransaction. ══

  progressHook: (e: ProgressEvent) => void,
  waitForCompletion: boolean,          // default true
  advanced: {                          // kept — Aman: useful for power users + test scenarios
    pollingIntervalMs: number,         // default 2_000 (min 500)
    timeout: number,                   // default: expiryBlocks × blockTime, capped at 180_000.
                                       //   (Aman: scale to expiry up to a ceiling)
    enforceGasCheck: boolean,          // default false: WARN + proceed · true: throw pre-broadcast
  },
});
```

**Rules the types enforce:** query keys mutually exclusive · `token`/`storageSlot` per-namespace ·
`chain: WEB2` ⇔ `web2` key · `callback.target` set ⇒ `callback.gasLimit` required.

**Three timeouts, three actors:**

```ts
web2.timeoutMs      // how long a VALIDATOR waits on the HTTP fetch     (5s)
expiryBlocks        // how long the CHAIN keeps the request alive       (300 Push blocks)
advanced.timeout    // how long YOUR CLIENT polls before ReadTimeoutError (≤180s)
```

A read can time out at the client and still fulfil on-chain — that is what `trackRead` is for.

---

## Fees — how the deployed contract actually charges

This is the section the draft got wrong. Two separate amounts, one payment:

```
msg.value  =  protocolFee  +  callbackBudget
              ───────────     ──────────────
              estimateFee()   SDK-sized: callback.gasLimit × pushGasPrice × buffer
              → VaultPC at    → escrowed; burned as consumed; remainder pushed to refundTo
                request time    at settlement (or in full at expiry)
```

- `estimateFee(ns, chainId)` returns **only** the protocol fee. It is `0` on every Donut domain
  today. **Zero does not mean free** — the budget is still required.
- The node **refuses to fulfil an unaffordable read** (`CanAffordCallback`; logs
  "callback budget too small") and lets it expire. So `callbackBudget = 0` is not "free execution",
  it is a guaranteed expiry with the protocol fee lost. The SDK never sends zero budget.
- Settlement: after the callback runs, the module calls `reportCallbackGas`; the contract burns
  `min(gasBurned, callbackBudget)` and pushes the remainder to `refundTo`. Events:
  `CallbackGasReported(id, gasReported, burned, refunded)` then `RefundSent` or `RefundFailed`.
- Expiry: `expireExternalRead` refunds the **full** `callbackBudget` to `refundTo`
  (`RequestExpired(id, refundTo, refunded)`). Protocol fee is never refunded (Aman, 2026-08-31).
- `maxFee` caps `msg.value`. It protects against a moving gas price between quote and inclusion.

`prepareRead(...).fees` exposes all three: `{ protocolFee, callbackBudget, total }`.

---

## Responses

```ts
type UniversalReadResponse<T = unknown> = {
  // identity
  requestId:  `0x${string}`;
  txHash:     `0x${string}`;          // Push tx that carried the request
  chain:      CHAIN;

  // outcome
  status:     UNIVERSAL_READ_STATUS;  // PENDING | VOTING | FULFILLED | EXPIRED | FAILED | ABORTED
  isTerminal: boolean;
  callbackDelivered?: boolean;        // FULFILLED only. true = ReadFulfilled emitted;
                                      //   false = CallbackFailed (your callback reverted/OOG).
                                      //   ⚠ FULFILLED does NOT imply delivered — see below
  value?:     T;                      // decoded. undefined unless FULFILLED && callbackDelivered
  raw: { status: READ_STATUS; resultData: `0x${string}`; errorCode: READ_ERROR_CODE } | null;
                                      // consensus bytes — what ⅔ voted on
  errorMsg:   string;

  // accounting — from ReadRequested + CallbackGasReported + RefundSent/Failed/RequestExpired
  fees: {
    paid:           bigint;           // msg.value (totalPaid)
    protocolFee:    bigint;           // gone at request time
    callbackBudget: bigint;           // escrowed
    burned?:        bigint;           // consumed by the callback (settlement)
    refunded?:      bigint;           // pushed to refundTo
    refundFailed?:  boolean;          // push rejected → sits in admin rescue pool
  };

  // provenance — the on-chain record
  request: {
    spec: ReadSpec;                   // 7 fields, incl. revertRecipient
    callbackTarget: `0x${string}`;
    originalFunder: `0x${string}`;    // who paid (msg.sender at request) — NOT where refunds go
    refundTo:       `0x${string}`;    // where refunds go
    logIndex: number;
  };

  explorerUrl: string;

  wait(opts?):  Promise<UniversalReadResponse<T>>;
  refresh():    Promise<UniversalReadResponse<T>>;
};

type BatchReadResponse = {
  txHash: `0x${string}`;
  reads:  UniversalReadResponse[];    // order preserved vs prepared array
  count:  number;
  atomic: boolean;
  wait(opts?): Promise<UniversalReadResponse[]>;
};
```

**`FULFILLED` does not mean delivered.** The node sets it whenever `fulfillExternalCallback`
returns cleanly (`ballot_hooks.go:143-146`) — including when your callback reverted, which the
contract swallows into a `CallbackFailed` event. `FAILED` is *not* that case; it only means the
contract had already settled the request by another path (`CallAlreadySettled`). The SDK parses
the fulfil tx (`pcTx[].txHash`) for `ReadFulfilled` vs `CallbackFailed` and exposes the answer as
`callbackDelivered`. **Check both** `status === FULFILLED && callbackDelivered` before trusting
`value`.

**Failure semantics (house convention):** `read()`/`wait()` resolve on terminal failure. Only
timeout throws `ReadTimeoutError`, carrying last-seen status.

---

## prepareRead / executeReads / trackRead

```ts
function prepareRead(
  subject: string,
  options: ReadQueryOptions & ReadPinningOptions & ReadCallbackOptions & { refundTo? }
): Promise<PreparedRead>;                      // async — preflight: height, protocolFee, gasPrice

function executeReads(
  reads: PreparedRead[],
  options?: ReadLifecycleOptions
): Promise<BatchReadResponse>;
// One multicall tx to the registry, each inner call carrying its own msg.value.
// Parallel fan-out, not ordered hops. Batching confirmed supported end-to-end.

function trackRead(
  ref: { txHash: `0x${string}` } | { requestId: `0x${string}` | bigint },
  options?: ReadLifecycleOptions
): Promise<UniversalReadResponse[] | UniversalReadResponse>;
```

```ts
type PreparedRead = {
  spec:        ReadSpec;              // 7 fields, ready to encode
  chain:       CHAIN;
  value:       bigint;                // = fees.total, the msg.value to send
  fees:        { protocolFee: bigint; callbackBudget: bigint; total: bigint };
  resultShape: ReadResultShape;
  preflight:   { observedChainHeight; pushBlockNumber; pushGasPrice; fetchedAt };
};
```

For contract devs not using the registry: `prepareRead` is still the right entry — take
`spec`, `callback.gasLimit` and `value`, splice into your own entrypoint with `encodeFunctionData`,
send via `sendTransaction`, then `trackRead({ txHash })`.

---

## ProgressHook events

Event object identical to `sendTransaction`. Inner `SEND-TX-1xx` events pass through.

### Single read — `READ-TX-1xx`

| ID | Title | Level | Response |
|---|---|---|---|
| `READ-TX-101` | `<chain>` Read Requested | INFO | `{ chain, namespace, queryType }` |
| `READ-TX-102-01` | Fetching Destination Height & Fee | INFO | `{ chain, stage: 'preflight' }` |
| `READ-TX-102-02` | Read Spec Assembled | SUCCESS | `{ protocolFee, callbackBudget, total, blockNumber, expiryPushChainHeight }` |
| `READ-TX-102-03` | Destination Height Unavailable | ERROR | `{ chain }` |
| `READ-TX-102-04` | Preflight Stale, Refetching | WARNING | `{ fetchedAt, ageMs }` |
| `READ-TX-102-05` | Refund Target Is A Contract | WARNING | `{ refundTo }` — non-UEA contract; may forfeit refund. Suppressed when `getOriginForUEA(refundTo).isUEA` |
| `READ-TX-103-01` | Checking Balance Requirements | INFO / WARNING | `{ required, available, sufficient, shortfall }` |
| `READ-TX-103-02` | Insufficient Balance | ERROR | `{ required, available, shortfall }` |
| `READ-TX-103-03` | Sensitive Header Detected (web2) | WARNING | `{ matchedHeaders }` |
| `READ-TX-104-01` | Broadcasting Read Request | INFO | `{ stage: 'broadcasting' }` |
| `READ-TX-104-02` | Request Confirmed, Read Detected | SUCCESS | `{ txHash, requestId, logIndex }` |
| `READ-TX-105-01` | Awaiting Quorum | INFO | `{ requestId, status: 'PENDING' }` |
| `READ-TX-105-02` | Voting In Progress | INFO | `{ requestId, status: 'VOTING' }` |
| `READ-TX-105-03` | Awaiting Destination Confirmations | INFO | `{ requestId, current, required }` |
| `READ-TX-105-04` | Approaching Expiry | WARNING | `{ requestId, pushBlocksRemaining }` |
| `READ-TX-106-01` | Quorum Reached, Executing Callback | INFO | `{ requestId, callbackTarget }` |
| `READ-TX-106-02` | Callback Delivered | SUCCESS | `{ requestId }` — `ReadFulfilled` |
| `READ-TX-106-03` | Callback Reverted | WARNING | `{ requestId, reason }` — `CallbackFailed`; read still FULFILLED |
| `READ-TX-106-04` | Callback Gas Settled | INFO | `{ requestId, burned, refunded }` — `CallbackGasReported` |
| `READ-TX-106-05` | Refund Sent | INFO | `{ requestId, amount, refundTo }` — `RefundSent` |
| `READ-TX-106-06` | Refund Rejected | WARNING | `{ requestId, amount, refundTo }` — `RefundFailed` |
| `READ-TX-199-01` | Read Fulfilled | SUCCESS | `{ requestId, value, resultData, callbackDelivered }` |
| `READ-TX-199-02` | Read Failed / Expired / Aborted | ERROR | `{ requestId, status, errorCode, errorMsg, refunded? }` |
| `READ-TX-199-03` | Read Timeout | ERROR | `{ requestId, lastStatus, elapsedMs }` |
| `READ-TX-199-99` | Intermediate Read Step Completed | INFO | `{ requestId, txHash }` |

Vote-count events (`105-02-01/-02`) are **deferred** — Aman: exposing mid-ballot tallies needs
a new query msg exported from the node; ballots differ by data received. Revisit when it lands.

### Batch — `READ-TX-0xx / 9xx`

| ID | Title | Level | Response |
|---|---|---|---|
| `READ-TX-001` | Batch Read Initiated | INFO | `{ count, chains }` |
| `READ-TX-002-01` | Starting Read #`<n>`/`<total>` | INFO | `{ n, total, chain }` |
| `READ-TX-002-99-99` | Read #`<n>`/`<total>` Complete | INFO | `{ n, total, requestId }` |
| `READ-TX-999-01` | All Reads Fulfilled | SUCCESS | `{ count }` |
| `READ-TX-999-02` | Batch Reads Failed | ERROR | `{ failedAt, total, error }` |
| `READ-TX-999-03` | Batch Reads Timeout | ERROR | `{ failedAt, total }` |

---

## Errors

All extend `ReadStateError`.

| Class | Thrown by | When |
|---|---|---|
| `InvalidReadSpecError` | `prepareRead` | contract precondition unsatisfiable; `violations[]` mirror the deployed reverts: `InvalidAccountId`, `EmptyQuery`, `InvalidMinConfirmations`, `DomainBlocked`, `InvalidBlockNumber`, `InvalidExpiryHeight`, `ZeroRevertRecipient`, `ZeroCallbackGasLimit`, `CallbackGasLimitExceeded`, `InsufficientFee`, `ExcessiveFee` |
| `ReadHeightUnavailableError` | `prepareRead` | non-web2 destination whose oracle height is 0 (unconfigured chain) |
| `UnsupportedReadDestinationError` | `prepareRead` | domain on the on-chain blacklist |
| `ReadDecodeError` | decode path | bytes do not match declared shape |
| `ReadTimeoutError` | `read`, `trackRead`, `wait` | client timeout; carries last-seen status |
| `PushChainExecutionError` | `executeReads` | inherited multicall errors |

Terminal EXPIRED / FAILED / ABORTED are **statuses, not throws**.

---

## Constants — `PushChain.CONSTANTS.READ`

| Name | Value | Source (verified against deployed) |
|---|---|---|
| `MAX_CALLBACK_GAS_LIMIT` | `1_000_000n` | `ReadTypes.sol:50` |
| `MIN_CONFIRMATIONS_FLOOR` | `1` | `ReadTypes.sol:43` |
| `DEFAULT_EXPIRY_BLOCKS` | `300n` | SDK default |
| `CALLBACK_BUDGET_BUFFER` | `3` | SDK default — multiple of `gasLimit × gasPrice`; leftovers refund |
| `WEB2_MAX_EXTRACT_ENTRIES` | `16` | `web2/read_envelope.go` |
| `WEB2_DEFAULT_TIMEOUT_MS` | `5_000` | SDK default |
| `REGISTRY_CALLBACK_GAS` | TBD | pinned once registry ships (§Q3) |
| `UNIVERSAL_CORE_ADDRESSES` | `0x…C0` | genesis predeploy, all networks |
| `UNIVERSAL_CALLBACK_ADDRESSES` | `0x…C2` | genesis predeploy, all networks |
| `UNIVERSAL_READ_REGISTRY_ADDRESS` | TBD | §Q3 |

---

## Ground truth — the deployed surface

`push-chain-core-contracts@feat-read-state` `f8d1a0c` · `src/UniversalCallback.sol`,
`src/UniversalReadClient.sol`, `src/libraries/ReadTypes.sol`. Confirmed identical to the Donut
bytecode by selector.

```solidity
struct ReadSpec {                       // 7 fields — encodes to selector 0x72767171
    UniversalAccountId account;         // { chainNamespace, chainId, owner }
    bytes   query;
    uint16  minConfirmations;           // ≥ 1
    uint64  blockNumber;                // web2/heightless: MUST be 0; else 1..oracleHeight
    uint64  expiryPushChainHeight;      // > block.number
    uint256 maxFee;                     // ≥ msg.value
    address revertRecipient;            // ≠ 0. Refunds are PUSHED here.
}

enum RequestStatus { NONE, PENDING, EXECUTED, SETTLED, EXPIRED }

function requestExternalReadSelf(ReadSpec spec, bytes4 callbackSelector, uint64 callbackGasLimit)
    payable returns (uint256 requestId);
// require msg.value ≥ estimateFee(ns, chainId)   (protocol fee → VaultPC immediately)
// require msg.value ≤ spec.maxFee
// callbackBudget = msg.value − protocolFee        (escrowed; totalEscrowed += budget)

function estimateFee(string chainNamespace, string chainId) view returns (uint256); // protocol fee ONLY
function statusOf(uint256) view returns (RequestStatus);
function getPendingRead(uint256) view returns (PendingRead);   // callbackGasLimit lives here, not in the event
function reportCallbackGas(uint256, uint256 gasBurned) returns (uint256 burned);  // module OR UVCALLBACK_ADMIN_ROLE
function expireExternalRead(uint256);                          // module only; refunds full budget

event ReadRequested(uint256 indexed requestId, ReadSpec readSpec, address indexed callbackTarget,
                    address indexed originalFunder, uint64 callbackGasLimit,
                    uint256 totalPaid, uint256 protocolFee, uint256 callbackBudget);
event ReadFulfilled(uint256 indexed requestId, bytes resultData);
event CallbackFailed(uint256 indexed requestId, bytes reason);
event CallbackGasReported(uint256 indexed requestId, uint256 gasReported, uint256 burned, uint256 refunded);
event RefundSent(uint256 indexed requestId, address indexed recipient, uint256 amount);
event RefundFailed(uint256 indexed requestId, address indexed recipient, uint256 amount);
event RequestExpired(uint256 indexed requestId, address indexed revertRecipient, uint256 refunded);
```

Height guard (post-fix): `chainKey = ns + ":" + chainId`; if `oracleHeight[chainKey] == 0` then
`blockNumber` must be `0`, else `1 ≤ blockNumber ≤ oracleHeight`.

**Node decoder (`x/ucallback/types/read_event.go:30-56`) matches this exactly**, including the
7-field spec and `callbackGasLimit` in fifth position. No reconciliation needed.

**What enforces this doc:** a drift-check script pinning the `ReadSpec` field list, the
`requestExternalReadSelf` and `estimateFee` selectors, the two `ReadTypes` constants, the
`readRequestedABI` string in the node, and the registry address + `REGISTRY_CALLBACK_GAS` once
they exist. **Currently nothing enforces it** — the draft's pin to a stale branch is exactly the
failure this prevents. Lands with the SDK PR.

---

## Open questions — status after team comments (2026-08-31 → 09-09)

| # | Question | Status |
|---|---|---|
| Q1 | Fee composition / refund on expiry | **Resolved.** Fee = protocol fee (flat, admin-set, `0` today) + SDK-sized callback budget. Expiry refunds the full budget; protocol fee never refunded (Aman). Corrected in §Fees. |
| Q2 | Keep `advanced.*`? | **Resolved — keep** (Aman: power users + test scenarios). `timeout` default now scales with expiry, capped at 180s. |
| Q3 | `UniversalReadRegistry` | **Open — blocks `read()` one-shot.** Nilesh/Zaryab to weigh in. Simplified by the deployed contract: the registry sets `spec.revertRecipient = msg.sender` per request, so the "registry is `originalFunder`, must track payer per requestId" problem in the draft **does not exist**. Requirements: EOA-callable `read(spec, gasLimit) payable` forwarding `msg.value`, `latestResult[reader][queryKey]` view, pinned `REGISTRY_CALLBACK_GAS`. |
| Q4 | `CHAIN.WEB2` identifier | **Resolved — `'web2:https'`** (Aman; also added to UV). Exclude from `sendTransaction`'s `to.chain` type + runtime guard. |
| Q5 | node ↔ contracts ABI reconciliation | **Resolved — inverted.** The node is correct; the draft's contract pin was stale. Nothing to change on the node. |
| Q6 | Batching + timeout interplay | **Resolved.** Batching supported contract + core side, separate requests to UV (Nilesh). `advanced.timeout` scales to expiry with a 180s ceiling (Aman). |
| Q7 | Vote tally queryability | **Deferred.** Needs a new query msg exported (Aman). `105-02-01/-02` events removed until then. |
| **Q8** | `refundTo` default for UEA users | **Resolved — default to the sending account.** `UEA_EVM.sol:295` and `UEA_SVM.sol:317` both declare `receive() external payable {}`; the proxy's payable fallback delegates an empty-calldata call through. Verified live: a 1-wei `eth_call` push to a deployed Donut UEA (`0x5C70C864…`) succeeds. `prepareRead` still warns for a contract `refundTo` that is **not** a UEA. |
| **Q9** | **CEA-originated reads** | **New.** Reads requested by CEA-originated inbounds to a contract recipient (`CallExecuteUniversalTx`) are still not ingested — budget strands. Either fix in `x/uexecutor` or the SDK must refuse `read()` when the signer resolves to a CEA. |

---

## Changes vs the team's v2 draft (and why)

| Draft | This doc | Why |
|---|---|---|
| Ground truth `read-state-fixes-v1` | `feat-read-state@f8d1a0c` (deployed) | Draft branch is an 18-commit-stale ancestor; `e990ea9` rewrote the surface |
| `ReadSpec` 6 fields, no `revertRecipient` | 7 fields; `refundTo` option | Contract requires it non-zero; refunds push there, not to `originalFunder` |
| `estimateFee(ns, chainId, gasLimit)` one quote | `estimateFee(ns, chainId)` = protocol fee; SDK sizes budget separately | 3-arg selector does not exist on-chain; fee model is fee + escrowed budget |
| `callbackBudget` "derived from gasLimit" (internal) | Same, but **documented as required and non-zero** with `CALLBACK_BUDGET_BUFFER` | Node refuses to fulfil unaffordable reads — zero budget = guaranteed expiry |
| `FeeRefunded` → `originalFunder` | `RefundSent`/`RefundFailed`/`RequestExpired`/`CallbackGasReported` → `refundTo` | Those are the deployed events |
| `fees: { paid, protocolFee, refunded }` | `+ callbackBudget, burned, refundFailed` | Settlement is observable; a rejected refund is a real outcome |
| `value` present iff FULFILLED | present iff FULFILLED **and** `callbackDelivered` | FULFILLED is set even when the callback reverted |
| `106-02 Fee Refunded` / `106-03 Fee Refund Failed` | 6 settlement events `106-02..06` | Delivered / reverted / gas-settled / refund sent / refund rejected are all distinct on-chain |
| `105-02-01/-02` vote-count events | Removed | Q7 deferred — no query exists |
| `advanced.timeout` default 180s | `expiryBlocks × blockTime`, capped 180s | Aman, Q6 |
| "Known drift: node still has `revertRecipient`" | Removed — node is correct | Q5 inverted |
| Q3 registry must track payer per requestId | Not needed — set `revertRecipient = msg.sender` | Deployed field solves it |
| — | Q8, Q9 added | Surfaced by verification |
| — | Chaining explicitly unsupported | Shared reentrancy guard + fulfil path doesn't ingest |

## Removed vs the v1 builder draft

Unchanged from the team's list: `buildEvmQuery.* / buildSvmQuery.* / buildWeb2Query` → one
options bag · `estimateFee` / `estimateCallbackBudget` → internal, surfaced on `PreparedRead.fees`
· `buildSpec` → `prepareRead` · `track` / `get` / `listByTx` / `parseRequests` / `decodeResult`
→ `trackRead` + auto-decode · `callData` · `splToken` / `accountData` booleans → `token` ·
`expiryPushChainHeight` / `maxFeeBufferBps` / `minSlot` → computed internally · `MetaCallbackSpec`
→ superseded by identity-by-storage.

**Not removed** (draft removed it in error): `revertRecipient` → kept as `refundTo`.

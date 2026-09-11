# Read State API Reference

# Universal Read — SDK API Reference (v2)

**Status:** Draft for team review · **Package:** `@pushchain/core` · **Ground truth:** `push-chain-core-contracts@read-state-fixes-v1` · **Prior draft:** moved to Initial Research (linked at bottom)

The cross-chain read surface, redesigned to mirror the shipped `universal.*` transaction family. Four methods, one options bag, no builders, no estimators.

---

## Design principles

1. **Mirror the tx family 1:1.** `read` ↔ `sendTransaction`, `prepareRead` ↔ `prepareTransaction`, `executeReads` ↔ `executeTransactions`, `trackRead` ↔ `trackTransaction`. Same option names, same `advanced` bag, same progress-event grammar.
2. **The SDK computes what the dev can't guess.** Preflight (oracle height, fee), expiry math, envelope encoding, ATA derivation — all internal. Params filter: *can the SDK compute it better than the dev can guess it? → internal. Does a real v1 persona need it? → keep. Hypothetical persona? → cut.*
3. **Typed both directions.** `abi` encodes the call AND decodes the result — reads without decode are useless, so there is no raw-calldata form.
4. **Two personas, one grammar.** Off-chain (bot/backend/frontend) → `read()` one-shot via the canonical `UniversalReadRegistry`. Contract devs → inherit `UniversalReadClient`, frontends call their entrypoint via plain `sendTransaction` (fee quote = on-chain `estimateFee` view, vanilla viem).

---

## Method family

```tsx
client.universal.read(subject, options)        // one-shot: request → quorum → decoded value
client.universal.prepareRead(subject, options) // per-item: query + pinning + callback → PreparedRead
client.universal.executeReads(reads, options?) // batch: one multicall tx, N independent requests
client.universal.trackRead(ref, options?)      // resume by { txHash } (array) or { requestId } (single)

// read(subject, opts) ≡ prepareRead(subject, opts) → executeReads([prepared]) → wait()
```

`requestId` is derived on-chain (`block.number, msg.sender, specHash, nonce++`) — it cannot be known before broadcast. Tracking is therefore **tx-hash-first**; requestIds are recovered from `ReadRequested` logs and become the durable per-read key.

---

## read(subject, options)

`subject` = the thing you're asking about: **holder** (balances) · **contract** (calls, state) · **https URL** (web2).

```tsx
await read(user,     { chain });                              // native balance (ETH / lamports)
await read(user,     { chain, token });                       // token balance (ERC-20 / SPL)
await read(contract, { chain, abi, functionName, args });     // typed call
await read(contract, { chain, storageSlot });                 // storage
await read(url,      { chain: CHAIN.WEB2, web2: { extract } }); // web2
```

### Options

```tsx
await client.universal.read(subject, {

  // ══ QUERY — WHAT is read. Kind = which keys are present; TS union enforces exclusivity. ══

  chain: CHAIN,                        // required. Destination + namespace (eip155 / solana / web2*)
                                       // *CHAIN.WEB2 identifier — open question §Q4

  // — balance (EVM + SVM) —
                                       // no query keys → native balance of `subject`
  token: string,                       // token balance of `subject`:
                                       //   EVM → ERC20Balance envelope (token, subject)
                                       //   SVM → SPLTokenAccount envelope, ATA(token, subject)
                                       //         derived by SDK — deterministic, no network

  // — call (EVM now; SVM via `idl` when program reads land) —
  abi: Abi,                            // encodes AND decodes — `value` typed from outputs.
  functionName: string,                //   view/pure only; same { abi|idl, functionName, args }
  args: readonly unknown[],            //   grammar as encodeTxData. No raw callData form —
                                       //   decode needs the ABI anyway; additive later if asked

  // — state (EVM) —
  storageSlot: `0x${string}` | bigint, // storage LOCATION (which cell), bytes32-normalized.
                                       //   Read at `blockNumber` like everything else.
                                       //   (SVM raw account bytes: future `layout` key)

  // — web2 (subject = https URL) —
  web2: {
    extract: [{                        // required; 1–16 entries (contract-verified), result order
      path: string,                    //   JSONPath, e.g. '$.data.price'
      valueType: 'uint256' | 'int256' | 'bool' | 'string' | 'bytes',
      decimals?: number,               //   numeric only; ×10^decimals, TRUNCATED (determinism)
    }],
    method?: 'GET' | 'POST',           // default 'GET'
    headers?: Record<string, string>,  // default {} — ⚠ PUBLIC event log, forever.
                                       //   SDK warns on /auth|key|token|secret|bearer/i
    body?: string | Uint8Array,        // POST only; rejected on GET
    timeoutMs?: number,                // default 5_000; validator-clamped
  },                                   // TS: chain WEB2 ⇔ web2 key present

  // ══ PINNING — HOW/WHEN. All optional, filled from internal preflight.
  //    Maps 1:1 to implemented ReadSpec. ══

  blockNumber: bigint,                 // EVM pin — makes the read reproducible.
                                       //   default observedChainHeight − minConfirmations
                                       //   (ceiling: oracle height, lags real head;
                                       //    backoff: default executes immediately)
  minConfirmations: number,            // default 1 (MIN_CONFIRMATIONS_FLOOR) — validators hold
                                       //   until latest ≥ blockNumber + minConfirmations
  expiryBlocks: bigint,                // default 300n Push blocks → EXPIRED, refund auto-pushed
                                       //   to originalFunder (spec field: expiryPushChainHeight,
                                       //   computed at prepare time)
  maxFee: bigint,                      // hard cap on the ONE upfront payment (read + callback,
                                       //   quoted together by _estimateFee at inclusion time).
                                       //   Protects the quote→inclusion oracle gap.
                                       //   default: on-chain estimateFee + internal buffer.
                                       //   Too low fails loud pre-broadcast (ExcessiveFee)

  // ══ CALLBACK — WHERE it lands on-chain. Mirrors the two non-spec call args. ══

  callback: {
    target: `0x${string}`,             // default canonical UniversalReadRegistry (§Q3).
                                       //   Override with your UniversalReadClient contract →
                                       //   off-chain trigger, on-chain delivery, Self intact
    gasLimit: bigint,                  // default REGISTRY_CALLBACK_GAS (pinned once registry
                                       //   ships). MANDATORY if target overridden — the SDK
                                       //   never guesses a foreign callback's gas.
                                       //   1n..1_000_000n (MAX_CALLBACK_GAS_LIMIT).
                                       //   ⚠ priced into your fee — raising it raises what you pay
  },

  // ══ LIFECYCLE — HOW the promise behaves. Mirrors trackTransaction. ══

  progressHook: (e: ProgressEvent) => void,   // READ-TX-1xx + inner SEND-TX pass-through
  waitForCompletion: boolean,          // default true. false → returns after request confirm;
                                       //   resume via .wait() / trackRead
  advanced: {                          // ← kept for house parity; needed at all? open question §Q2
    pollingIntervalMs: number,         // default 2_000 (min 500)
    timeout: number,                   // default 180_000 — confirmations + ballot outlive the tx
    enforceGasCheck: boolean,          // default false: WARN + proceed · true: throw pre-broadcast
  },
});
```

**Rules the types enforce (not the docs):** query keys mutually exclusive across kinds · `token`/`storageSlot` per-namespace · `chain: WEB2` ⇔ `web2` key · `callback.target` set ⇒ `callback.gasLimit` required.

**Three timeouts, three actors** — do not conflate:

```tsx
web2.timeoutMs      // how long a VALIDATOR waits on the HTTP fetch      (5s)
expiryBlocks        // how long the CHAIN keeps the request alive        (300 Push blocks)
advanced.timeout    // how long YOUR CLIENT polls before ReadTimeoutError (180s)
```

A read can time out at the client and still fulfil on-chain — that is what `trackRead` resuming is for.

---

## Responses

```tsx
type UniversalReadResponse<T = unknown> = {
  // identity
  requestId:  `0x${string}`;
  txHash:     `0x${string}`;          // Push tx that carried the request
  chain:      CHAIN;

  // outcome
  status:     UNIVERSAL_READ_STATUS;  // PENDING | VOTING | FULFILLED | EXPIRED | FAILED | ABORTED
  isTerminal: boolean;                // safe to stop polling
  value?:     T;                      // decoded. viem rule: single output = value, tuple = array.
                                      //   typed from abi / extract. undefined unless FULFILLED
  raw: { status: READ_STATUS; resultData: `0x${string}`; errorCode: READ_ERROR_CODE } | null;
                                      // consensus bytes — what ⅔ voted on
  errorMsg:   string;

  // accounting — from ReadRequested / FeeRefunded events
  fees: {
    paid:        bigint;              // msg.value (feesDeposited / totalPaid)
    protocolFee: bigint;              // consumed portion
    refunded?:   bigint;              // auto-pushed to originalFunder at terminal
  };

  // provenance — the on-chain record, verbatim
  request: {
    spec: ReadSpec;
    callbackTarget: `0x${string}`;
    originalFunder: `0x${string}`;    // who paid — and where the refund went
    logIndex: number;                 // batch correlation
  };

  explorerUrl: string;

  // tx.wait() convention: terminal statuses RESOLVE (check status), only timeout THROWS
  wait(opts?):  Promise<UniversalReadResponse<T>>;
  refresh():    Promise<UniversalReadResponse<T>>;
};

type BatchReadResponse = {
  txHash: `0x${string}`;              // the single multicall tx
  reads:  UniversalReadResponse[];    // order preserved vs prepared array
  count:  number;
  atomic: boolean;                    // EIP-7702 / UEA batch vs sequential fallback
  wait(opts?): Promise<UniversalReadResponse[]>;  // all terminal
};
```

**Failure semantics (house convention):** `read()`/`wait()` resolve on terminal failure — always check `status === UNIVERSAL_READ_STATUS.FULFILLED` (Common Mistakes row, same as `receipt.status`). Only timeout throws `ReadTimeoutError`, carrying last-seen status.

---

## prepareRead / executeReads / trackRead

```tsx
function prepareRead(                          // QUERY + PINNING + CALLBACK (no lifecycle)
  subject: string,
  options: ReadQueryOptions & ReadPinningOptions & ReadCallbackOptions
): Promise<PreparedRead>;                      // async — fetches preflight (height, fee)

function executeReads(                         // LIFECYCLE only
  reads: PreparedRead[],
  options?: ReadLifecycleOptions
): Promise<BatchReadResponse>;
// One multicall tx to the registry (outer zero-address, inner registry.read calls, each
// carrying its own value). Inherits EIP-7702 atomicity + sequential fallback + `atomic` flag.
// Unlike cascade: reads are PARALLEL fan-out, not ordered hops — no dependencies.

function trackRead(
  ref: { txHash: `0x${string}` } | { requestId: `0x${string}` | bigint },
  options?: ReadLifecycleOptions               // minus enforceGasCheck (nothing to broadcast)
): Promise<UniversalReadResponse[] | UniversalReadResponse>;
// Overloads: txHash → array (one tx can request many reads), requestId → single.
// txHash is the only key that exists at send time; requestId is the durable stored key.
```

`PreparedRead`: `{ spec, chain, value, fees, resultShape, preflight }` — mirrors `PreparedUniversalTx`.

---

## ProgressHook events

Event object identical to `sendTransaction`: `{ id, title, message, level: INFO|SUCCESS|WARNING|ERROR, response, timestamp }`. Inner `SEND-TX-1xx` events pass through on the same hook (cascade precedent, deduped).

### Single read — `READ-TX-1xx` (`read()` emits all; `trackRead` attaches from `104-02`)

| ID | Title | Level | Response |
| --- | --- | --- | --- |
| `READ-TX-101` | `<chain>` Read Requested | INFO | `{ chain, namespace, queryType }` |
| `READ-TX-102-01` | Fetching Destination Height & Fee | INFO | `{ chain, stage: 'preflight' }` |
| `READ-TX-102-02` | Read Spec Assembled | SUCCESS | `{ protocolFee, totalValue, blockNumber, expiryPushChainHeight }` |
| `READ-TX-102-03` | Destination Height Unavailable | ERROR | `{ chain }` |
| `READ-TX-102-04` | Preflight Stale, Refetching | WARNING | `{ fetchedAt, ageMs }` |
| `READ-TX-103-01` | Checking Balance Requirements | INFO / WARNING | `{ required, available, sufficient, shortfall, enforceGasCheck }` |
| `READ-TX-103-02` | Insufficient Balance | ERROR | `{ required, available, shortfall }` |
| `READ-TX-103-03` | Sensitive Header Detected (web2) | WARNING | `{ matchedHeaders }` |
| `READ-TX-104-01` | Broadcasting Read Request | INFO | `{ stage: 'broadcasting' }` |
| `READ-TX-104-02` | Request Confirmed, Read Detected | SUCCESS | `{ txHash, requestId, logIndex }` |
| `READ-TX-105-01` | Awaiting Quorum | INFO | `{ requestId, status: 'PENDING' }` |
| `READ-TX-105-02` | Voting In Progress | INFO | `{ requestId, status: 'VOTING' }` |
| `READ-TX-105-02-01` | Vote `<current>`/`<required>` Received | INFO | `{ requestId, current, required }` — needs §Q7 |
| `READ-TX-105-02-02` | Vote `<current>`/`<required>` Received (quorum) | SUCCESS | `{ requestId, current, required }` |
| `READ-TX-105-03` | Awaiting Destination Confirmations | INFO | `{ requestId, current, required }` |
| `READ-TX-105-04` | Approaching Expiry | WARNING | `{ requestId, pushBlocksRemaining }` |
| `READ-TX-106-01` | Quorum Reached, Executing Callback | INFO | `{ requestId, callbackTarget }` |
| `READ-TX-106-02` | Fee Refunded | INFO | `{ requestId, amount, originalFunder }` |
| `READ-TX-106-03` | Fee Refund Failed | WARNING | `{ requestId, amount, originalFunder }` |
| `READ-TX-199-01` | Read Fulfilled | SUCCESS | `{ requestId, value, resultData }` |
| `READ-TX-199-02` | Read Failed / Expired / Aborted (title by `status`) | ERROR | `{ requestId, status, errorCode, errorMsg }` |
| `READ-TX-199-03` | Read Timeout | ERROR | `{ requestId, lastStatus, elapsedMs }` |
| `READ-TX-199-99` | Intermediate Read Step Completed | INFO | `{ requestId, txHash }` |

### Batch — `READ-TX-0xx / 9xx` (cascade grammar)

| ID | Title | Level | Response |
| --- | --- | --- | --- |
| `READ-TX-001` | Batch Read Initiated | INFO | `{ count, chains }` |
| `READ-TX-002-01` | Starting Read #`<n>`/`<total>` | INFO | `{ n, total, chain }` |
| `READ-TX-002-99-99` | Read #`<n>`/`<total>` Complete | INFO | `{ n, total, requestId }` |
| `READ-TX-999-01` | All Reads Fulfilled | SUCCESS | `{ count }` |
| `READ-TX-999-02` | Batch Reads Failed | ERROR | `{ failedAt, total, error }` |
| `READ-TX-999-03` | Batch Reads Timeout | ERROR | `{ failedAt, total, error: 'read timeout' }` |

---

## Errors

All extend `ReadStateError` (pc20/errors.ts precedent).

| Class | Thrown by | When |
| --- | --- | --- |
| `InvalidReadSpecError` | `prepareRead` | contract precondition unsatisfiable; carries `violations[]` mirroring contract reverts (`InvalidAccountId`, `EmptyQuery`, `InvalidMinConfirmations`, `ExcessiveFee`, `InsufficientFee`, `DomainBlocked`, …) |
| `ReadHeightUnavailableError` | `prepareRead` | destination height ceiling resolves to zero |
| `UnsupportedReadDestinationError` | `prepareRead` | domain on the on-chain **blacklist** (validation flipped whitelist → blacklist, commit 2026-08-03) |
| `ReadDecodeError` | decode path | bytes do not match declared shape — fails loud, never mis-decodes |
| `ReadTimeoutError` | `read`, `trackRead`, `wait` | client timeout; carries last-seen status |
| `PushChainExecutionError` | `executeReads` | inherited multicall errors |

Terminal EXPIRED / FAILED / ABORTED are **statuses, not throws** — see Failure semantics.

---

## Constants — `PushChain.CONSTANTS.READ`

| Name | Value | Source (verified) |
| --- | --- | --- |
| `MAX_CALLBACK_GAS_LIMIT` | `1_000_000n` | `ReadTypes.sol` |
| `MIN_CONFIRMATIONS_FLOOR` | `1` | `ReadTypes.sol` |
| `DEFAULT_EXPIRY_BLOCKS` | `300n` | SDK default |
| `WEB2_MAX_EXTRACT_ENTRIES` | `16` | `web2/read_executor.go` |
| `WEB2_DEFAULT_TIMEOUT_MS` | `5_000` | SDK default |
| `REGISTRY_CALLBACK_GAS` | TBD | pinned + drift-checked once registry ships (§Q3) |
| `UNIVERSAL_CALLBACK_ADDRESS` | TBD at deploy | genesis predeploy |
| `UNIVERSAL_READ_REGISTRY_ADDRESS` | TBD | §Q3 |

---

## Ground truth & enforcement

**Repo pinning.** The SDK reference pins to `push-chain-core-contracts` (branch `read-state-fixes-v1` at time of writing): `UniversalCallback.sol`, `UniversalReadClient.sol`, `ReadTypes.sol`. Verified implemented surface:

```solidity
struct ReadSpec {          // NO revertRecipient — refunds auto-push to originalFunder
    UniversalAccountId account;   // { chainNamespace, chainId, owner }
    bytes   query;
    uint16  minConfirmations;
    uint64  blockNumber;
    uint64  expiryPushChainHeight;
    uint256 maxFee;
}

requestExternalReadSelf(ReadSpec spec, bytes4 callbackSelector, uint64 callbackGasLimit)
    payable → uint256 requestId;
// fee = _estimateFee(namespace, chainId, callbackGasLimit)  — ONE quote, read + callback
// require msg.value ≥ fee  &&  msg.value ≤ spec.maxFee
// refund at terminal: feesDeposited − protocolFee → originalFunder (FeeRefunded)

estimateFee(chainNamespace, chainId, callbackGasLimit) view → uint256;  // public, viem-readable
```

**Known drift (open):** `push-chain-node`'s `ReadRequested` decode ABI still carries `revertRecipient` in the spec tuple — stale vs core-contracts. Must reconcile before SDK ships.

**What enforces this doc:** a drift-check script (per `check-agent-docs-drift.mjs` pattern) pinning: the `ReadSpec` struct fields, `requestExternalReadSelf` selector, `MAX_CALLBACK_GAS_LIMIT` / `MIN_CONFIRMATIONS_FLOOR`, `maxExtractEntries`, the deployed registry address + `REGISTRY_CALLBACK_GAS`, and the SDK's public method names/option shapes against the shipped `universal.*` surface. **Currently: nothing enforces it — the script must land with the SDK PR.**

---

## Open questions (team)

1. **Fee implementation** — how is `_estimateFee` composed (oracle gas price × base + callback gas)? Confirm intended `maxFee` UX: SDK sets `msg.value = quoted fee`, `maxFee` caps quote→inclusion drift. Also: does the refund (`feesDeposited − protocolFee`) fire on success only, or expiry too (`refundExpiredRequest` path)?
2. **Is `advanced.*` needed** (`pollingIntervalMs` / `timeout` / `enforceGasCheck`)? Kept for `trackTransaction` parity; cut if the team prefers a leaner bag.
3. **`UniversalReadRegistry`** — unbuilt anywhere (checked push-chain-node, core-contracts, gateway-contracts, all branches). The one-shot depends on it. Requirements now known: EOA-callable `read(spec, gasLimit) payable`, **refund handling** (registry is `originalFunder` for every one-shot — must track payer per requestId and forward/withdraw), `latestResult[reader][queryKey]` view, canonical deployment + pinned `REGISTRY_CALLBACK_GAS`. ~60 lines on `UniversalReadClient`.
4. **`CHAIN.WEB2` identifier** — proposal: `'web2:https'` (matches domain-registry keying; group slot reserved for provider-specific groups). Requires excluding WEB2 from `sendTransaction`'s `to.chain` type + runtime guard. Confirm what chainId the blacklist keys web2 under.
5. **node ↔ core-contracts ABI reconciliation** — `revertRecipient` removal must propagate to the module decoder.
6. **Batching** — confirm multiple `requestExternalReadSelf` calls per tx are supported (multicall through registry); `executeReads` depends on it. Also Push block time vs `expiryBlocks 300n` vs client `timeout 180s` interplay.
7. **Vote tally queryability** — are mid-ballot vote counts exposed? Decides the `READ-TX-105-02-01/-02` events.

---

### Contract addresses — genesis predeploys, identical on every network:

| Name | Address |
| --- | --- |
| `UNIVERSAL_CORE_ADDRESSES` | `0x00000000000000000000000000000000000000C0` |
| `UNIVERSAL_CALLBACK_ADDRESSES` | `0x00000000000000000000000000000000000000C2` |

---

## Removed vs prior draft (and why)

`buildEvmQuery.* / buildSvmQuery.* / buildWeb2Query` (8 builders → one options bag, chain-discriminated) · `estimateFee` / `estimateCallbackBudget` (internal; quote surfaces on `PreparedRead.fees`) · `buildSpec` / `buildSpecFromPreflight` (→ `prepareRead`) · `track` / `get` / `listByTx` / `parseRequests` / `decodeResult` (→ `trackRead` keyed ref + auto-decode) · `callbackBudget` param (derived from `callback.gasLimit`; `0n` default was a guaranteed-loss footgun) · `revertRecipient` (removed from contract — refunds auto-push to `originalFunder`) · `callData` (decode needs the ABI anyway) · `splToken` / `accountData` booleans (→ `token` key; raw account bytes deferred to future `layout`) · `payGasWith` (not needed here) · `expiryPushChainHeight` / `maxFeeBufferBps` / `minSlot` params (computed internally / no v1 persona) · `MetaCallbackSpec` and all meta-forwarding (superseded by v2 architecture: identity by storage via `UniversalReadClient._localContext`).

---

[Initial Research](https://app.notion.com/p/Initial-Research-3c6188aea7f48030b28ad9d9d20f9e51?pvs=21)

---

## Original review comments (verbatim; preserved)

These comments are transcribed from the original spec review. Their wording is preserved and should not be edited. Context labels are editorial and are not part of the quoted comments.

### Web2 extraction — Aman Gupta, Aug 31

> For docs - Do mention extraction done is aggregated for identical - ie votes are finalized when majority of validators report the same result on the API
>
> In case API data changes a lot - vote may not be finalized. Later we plan to introduce diff aggregation eg - median etc

### `blockNumber` for Solana — Aman Gupta, Aug 31

> For solana this field is not available - query is always done on finalizedSlot

### `minConfirmations` for Solana — Aman Gupta, Aug 31

> For solana this field is not available - query is always done on finalizedSlot

### Q1: fee implementation and expiry — Aman Gupta, Aug 31

> On expiry we do refund the feesDeposited.
> Protocol fee is never refunded irrespective of success or failure

### Q2: `advanced.*` — Aman Gupta, Aug 31

> I think we should add this
> Normal users won’t care about this and there can be usecases as well as testing scenarios where this can be helpful

### Q3: `UniversalReadRegistry` — Aman Gupta, Aug 31 (edited)

> Don’t have much idea about this.
> @Nilesh Gupta @Zaryab Afser needs to comment on this

### Q4: `CHAIN.WEB2` — Aman Gupta, Aug 31

> Agreed - this particular thing has also been added to UV

### Q6: batching — Aman Gupta, Aug 31

> Batching is not supported at UV level but @Nilesh Gupta has to verify if multiple calls are parsed as separate calls and presented to UV or not

### Q6: batching follow-up — Nilesh Gupta, Sep 7

> yes, batching is supported from the contract and core side. Separate requests will be presented to UV and they all will settle separately as well

### Q6: timeout interplay — cropped comment fragment

The screenshot does not show the author, date, or beginning of this comment; the visible fragment is preserved without reconstruction:

> votes are not done - standard 180s timeout works

### Q7: vote tally queryability — Aman Gupta, Aug 31

> This can be done, but I believe new msg needs to be exported
>
> Currently any outbound / read state can have diff ballots based on voting and data received ( ballot id depends on vote data )
> Ie anyone can see ballots related to process and even see the no. of votes in it

---

# Discrepancies from the OG spec and rationale

This section records only the remaining places where the deployed contract or current SDK differs from the original proposal. Resolved SDK-local parity items are removed. The OG spec is intentionally preserved as the design baseline; this section is the operational source of truth for the current implementation.

## 1. Ground-truth contract changed after the OG branch

The OG spec pins `push-chain-core-contracts@read-state-fixes-v1`. That branch is an ancestor of `feat-read-state` and was 18 commits behind the contract deployed on Donut when the SDK implementation was verified. Commit `e990ea9` (`final fixes`, 2026-08-14) rewrote `UniversalCallback`, replaced its interface, and added an explicit request lifecycle.

The current SDK is therefore pinned to `push-chain-core-contracts@feat-read-state` at `f8d1a0c`, matching the deployed Donut `UniversalCallback` implementation. Building against the OG ABI would encode the wrong function selector and every request would revert before execution.

| Area | OG spec | Deployed contract / SDK | Why we made the call |
| --- | --- | --- | --- |
| `ReadSpec` | Six fields; no refund recipient | Seven fields; includes non-zero `revertRecipient` | The deployed function selector requires the seven-field tuple. The SDK exposes the field as `refundTo`. |
| `requestExternalReadSelf` | Six-field selector `0xd37c1add` | Seven-field selector `0x72767171` | Selector probes against Donut bytecode showed only the seven-field selector. |
| `requestId` derivation | `block.number, msg.sender, specHash, nonce++` | `chainid, block.number, address(this), specHash, nonce++` | The deployed hash includes chain-domain separation and the callback contract address. It still cannot be known before broadcast. |
| `estimateFee` | `(namespace, chainId, callbackGasLimit)` | `(namespace, chainId)` | The deployed view quotes only the protocol fee; the three-argument selector reverts. |
| Fee composition | One combined quote | `protocolFee + callbackBudget` | The callback budget is escrow, not protocol revenue. The node refuses to fulfil a request whose remaining escrow cannot afford the callback. |
| Refund destination | `originalFunder` | `revertRecipient` / `refundTo` | This is an explicit required field in the deployed `ReadSpec`. |
| Refund events | `FeeRefunded` | `CallbackGasReported`, `RefundSent`, `RefundFailed`, `RequestExpired` | These are the events actually emitted by the deployed contract. |
| Contract lifecycle | Implicit | `NONE → PENDING → EXECUTED → SETTLED / EXPIRED` | Settlement is completed through `reportCallbackGas`. |

The deployed Solidity surface is:

```solidity
struct ReadSpec {
    UniversalAccountId account;
    bytes   query;
    uint16  minConfirmations;
    uint64  blockNumber;
    uint64  expiryPushChainHeight;
    uint256 maxFee;
    address revertRecipient;
}

requestExternalReadSelf(ReadSpec spec, bytes4 callbackSelector, uint64 callbackGasLimit)
    payable returns (uint256 requestId);

estimateFee(string chainNamespace, string chainId) view returns (uint256);
```

The node decoder is not stale: its seven-field `ReadSpec` and `callbackGasLimit` placement match the deployed contract. The OG drift finding was inverted because it compared the node with the stale branch.

## 2. Fee and refund model

The SDK sends one payment composed of two independently observable amounts:

```text
msg.value = protocolFee + callbackBudget
            ───────────   ──────────────
            estimateFee   callback.gasLimit × Push gas price × SDK buffer
```

- `protocolFee` is transferred to `VaultPC` at request time and is not refunded.
- `callbackBudget` is escrowed. At settlement, the contract burns the measured callback cost and pushes the remainder to `refundTo`.
- Expiry returns the full callback budget but not the protocol fee.
- A rejected refund does not undo settlement or expiry. The SDK reports `refundFailed`, and the funds remain recoverable only through the contract's administrative rescue path.
- `maxFee` caps the total `msg.value`, protecting the caller from a fee or gas-price change between preparation and inclusion.
- The SDK uses a callback-budget buffer of `3 × callback.gasLimit × pushGasPrice`. Zero callback budget is rejected client-side because it leads to guaranteed expiry at the node affordability gate.

`PreparedRead.fees` consequently exposes `{ protocolFee, callbackBudget, total }`, while a tracked response adds the observed `burned`, `refunded`, and `refundFailed` fields.

## 3. Callback delivery is separate from consensus fulfilment

The OG treats `FULFILLED` as sufficient for trusting `value`. Live verification showed that the node marks a read `FULFILLED` when the fulfil transaction itself succeeds even if the application callback reverts or runs out of gas. `UniversalCallback` swallows that application failure and emits `CallbackFailed`.

The SDK therefore exposes:

```ts
callbackDelivered?: boolean;
callbackFailReason?: `0x${string}`;
```

Applications must check all of the following before trusting the decoded value:

```ts
response.status === UNIVERSAL_READ_STATUS.FULFILLED &&
response.callbackDelivered === true &&
response.raw?.status === READ_STATUS.SUCCESS
```

`value` is populated only when these conditions hold and decoding succeeds.

## 4. Registry-dependent defaults are not available yet

The OG presents `read(subject, { chain })` as a complete one-shot flow with default callback target and gas limit. The canonical `UniversalReadRegistry` has not been built or deployed, so the SDK cannot safely supply those defaults.

Current behavior:

- `prepareRead` requires `callback.gasLimit` because it is needed to size the callback budget.
- `read` and `executeReads` require `callback.target` plus `callback.request`, which describes the public payable entrypoint on the application's `UniversalReadClient` contract.
- Omitting the custom receiver produces `ReadRegistryUnavailableError`.
- A canonical registry can later restore the OG shorthand without changing the query grammar or tracking model.

Example of the currently executable path:

```ts
const callback = {
  target: myReadClient,
  gasLimit: 200_000n,
  request: { abi: myReadClientAbi, functionName: 'request' },
};

const result = await client.universal.read(user, {
  chain: CHAIN.ETHEREUM_SEPOLIA,
  callback,
});
```

The public TypeScript options still permit an omitted callback because that is the intended registry-era API. Until the registry exists, runtime validation is intentionally stricter than the future-facing type shape. This mismatch should be removed when the registry lands or tightened if the team no longer wants forward-compatible types.

## 5. Batch recovery metadata

The SDK adds optional `transactionHashes` beyond the OG `BatchReadResponse` because a sequential-wallet fallback can produce multiple Push transactions and one `txHash` is not sufficient recovery metadata when `atomic === false`.

For partial sequential failure, `READ_REQUEST_TX_FAILED` carries confirmed `transactionHashes` and, when receipt confirmation is uncertain, `pendingTransactionHash`. Confirmed requests can be resumed individually with `trackRead({ txHash })`.

## 6. Query and result-shape differences

- EVM token balance uses the ordinary `contractCall(balanceOf)` envelope; there is no separate deployed `ERC20Balance` query type.
- SVM token reads add `tokenProgram?: 'spl-token' | 'token-2022'`, defaulting to the original SPL Token program. ATA derivation remains deterministic and offline.
- Web2 results remain arrays in extraction order, including a single extraction.

The public response adds `destination`, `callbackDelivered`, `callbackFailReason`, `decoded`, `decodeError`, `pcTx`, callback accounting, `request.callbackGasLimit`, and `request.createdAtHeight` beyond the OG shape.

`PreparedRead` adds `specTuple`, `encodedSpec`, `encodedQuery`, `callbackGasLimit`, warnings, and detailed preflight data for custom entrypoints, exact ABI matching, decoding, and pre-broadcast revalidation.

## 7. Envelope encoding correction

Every `ReadSpec.query` must be `abi.encode` of one tuple because the validator decodes one tuple argument. Encoding each envelope field as a separate ABI parameter creates a different layout. The EVM `AccountBalance` payload must itself contain `abi.encode(address)` rather than a raw 20-byte address.

The SDK uses:

```ts
encodeAbiParameters([{ type: 'tuple', components }], [envelope])
```

This rule is covered by cross-language golden vectors. A malformed envelope does not necessarily revert at request time; validators can instead reach quorum on `INVALID_QUERY`, consuming the protocol fee. That is why the SDK owns this encoding rather than exposing it as a user option.

## 8. Progress-event differences

The OG vote-count events `READ-TX-105-02-01` and `READ-TX-105-02-02` are not emitted. Mid-ballot tallies are not exposed by the node query API, and synthesizing them would be inaccurate.

Settlement progress is split into observable stages:

| ID | Meaning |
| --- | --- |
| `READ-TX-106-02` | Callback delivered (`ReadFulfilled`) |
| `READ-TX-106-03` | Callback reverted (`CallbackFailed`) |
| `READ-TX-106-04` | Callback gas settled (`CallbackGasReported`) |
| `READ-TX-106-05` | Refund sent (`RefundSent`) |
| `READ-TX-106-06` | Refund rejected (`RefundFailed`) |

## 9. Timeout behavior

`advanced.*` was retained for power users and test scenarios. The default client polling timeout is no longer always 180 seconds. It is derived from the remaining request lifetime using the measured Push block time, with a 180-second ceiling and a 500-millisecond minimum. A client timeout still does not cancel the on-chain request; callers can resume it through `trackRead`.

## 10. Expiry observability

Expiry is performed by the node's EndBlocker. The resulting `expireExternalRead` execution has no ordinary, fetchable EVM transaction receipt and does not appear through `eth_getLogs`. The SDK therefore checks Cosmos `block_results` at the recorded expiry-attempt heights and parses `RequestExpired`, `RefundSent`, and `RefundFailed` from EndBlock events.

Because a refund recipient can reject the push without preventing expiry, `EXPIRED` alone does not prove that the refund landed. `fees.refunded` and `fees.refundFailed` remain undefined when the EndBlock evidence cannot be recovered.

## 11. Unsupported flows and refund safety

- Nested reads initiated inside a callback are not supported for v1. The shared reentrancy guard rejects them, and the outer fulfil path records the rejection as `CallbackFailed`.
- `refundTo` defaults to the sending Push account. This is safe for EVM and SVM UEAs because both accept native Push payments; it was also verified on Donut. The SDK warns when the target is a contract that cannot be identified as a UEA.
- CEA-originated reads remain an open chain-side issue: reads created through `CallExecuteUniversalTx` are not ingested, which can strand the callback budget. The node path must be fixed or the SDK must reject that signer route.

## 12. Additional constants and errors

Additional constants used by the implementation include:

| Name | Value | Scope |
| --- | --- | --- |
| `CALLBACK_BUDGET_BUFFER` | `3` | Public through `PushChain.CONSTANTS.READ` |
| `WEB2_MAX_TIMEOUT_MS` | `15_000` | Internal validator clamp |
| `PUSH_BLOCK_TIME_MS` | `1_340` | Internal timeout calculation |
| `READ_TRACK_POLL_INTERVAL_MS` | `2_000` | Internal default |
| `READ_TRACK_MIN_POLL_INTERVAL_MS` | `500` | Internal floor |
| `READ_TRACK_MAX_TIMEOUT_MS` | `180_000` | Internal ceiling |

The implementation adds three public error classes that the OG list did not anticipate:

- `InvalidReadQueryError` rejects malformed public query grammar before building a `ReadSpec`.
- `ReadNotFoundError` distinguishes an unknown or not-yet-ingested tracking reference from a polling timeout.
- `ReadRegistryUnavailableError` explains why the shorthand one-shot path cannot run before the canonical registry is deployed.

Execution can also surface stable `ReadStateError` codes such as `READ_REQUEST_TX_FAILED` and `READ_REQUEST_MISMATCH`. These preserve transaction hashes needed to recover reads from a partially successful sequential fallback; reducing every execution failure to the OG's generic `PushChainExecutionError` would lose that recovery context.

## 13. Verification evidence

Live Donut verification covered EVM, SVM, and Web2 reads, plus success, validator error, callback failure, expiry, EOA-originated requests, and UEA-originated requests. Observed reads settled in roughly 12–23 seconds during the verification run.

Key observations:

- A Sepolia native-balance result matched the pinned destination value exactly.
- A Solana devnet lamport result matched the finalized destination value exactly.
- A Web2 request returned the expected flat ABI-encoded extract list.
- A reverting callback produced node status `FULFILLED` with `callbackDelivered = false`.
- An expired request returned the full callback budget while retaining the protocol fee.
- A UEA-originated request was discoverable by the exact transaction hash returned by `sendTransaction`, validating tx-hash-first recovery.

## 14. Remaining work

1. Build and deploy the canonical `UniversalReadRegistry`, then pin `UNIVERSAL_READ_REGISTRY_ADDRESS` and `REGISTRY_CALLBACK_GAS`.
2. Reconcile the future-facing callback option types with the stricter pre-registry runtime requirement.
3. Fix CEA-originated read ingestion or add an explicit SDK route guard.
4. Add the contract/node/SDK drift-check script so the ABI, selectors, constants, event tuple, registry address, and public surface cannot silently diverge again.

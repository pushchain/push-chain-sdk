## Docs parity update — 2026-09-23 (supersedes the 2026-09-22 Solana note and the view/pure rule below)

- **`idl` replaces `idl` + `accountName`.** `read(account, { chain, idl })` decodes with the layout whose discriminator prefixes the account data. `functionName` optionally names the layout (snake/camel/Pascal all resolve to the IDL spelling) and types `value`. `read(programId, { chain, idl, functionName, args })` derives the PDA from the seed template Anchor records on the instruction accounts named like `functionName`; `args` fill the non-constant seeds in order, encoded by the IDL-declared type (pubkey: base58 / 0x-hex / PublicKey; integers: LE of the declared width; string: utf8; bytes). Conflicting templates, struct-field seed paths, and non-constant `pda.program` are rejected rather than guessed. Passing `accountName` throws. Resume with `resultShape: { kind: 'svmAccount', idl }`.
- **EVM calls: any mutability.** `functionName` accepts `nonpayable`/`payable` functions; the runtime view/pure guard in `envelopes/evm.ts` is gone. Validators `eth_call` at the pinned block; verified live with QuoterV2 (nonpayable) and Multicall3.aggregate (payable).
- **`outcome`.** SDK-derived `READ_OUTCOME`: non-terminal → `PENDING`; `EXPIRED`/`FAILED`/`ABORTED` pass through; FULFILLED → `SOURCE_ERROR` (raw.status ≠ SUCCESS, checked first) → `CALLBACK_FAILED` (callbackDelivered false) → `UNKNOWN` (delivery unconfirmed) → `DECODE_FAILED` → `SUCCESS`. Protocol ask (not ours): `CALLBACK_FAILED` / `SOURCE_ERROR` terminal statuses in `ReadTypes.sol`, after which `outcome` maps 1:1.
- **Terminal events follow `outcome`.** `READ-TX-199-01` only for `SUCCESS`; any other FULFILLED outcome ends on `READ-TX-199-02` with `status` = the outcome name. `106-05/06` refund events also fire for EXPIRED. `105-04` fires once in `wait()` at ≤ 30 Push blocks left (head fetched once, then estimated from block time). `102-04` fires in `executeReads` for a read prepared > 60 s earlier. `105-03`, `106-01`, `199-99` remain defined but unemitted: the node exposes no confirmation count, and VOTING → FULFILLED is one step.
- **Response:** `requestIdUint: bigint`; `explorerUrl` on `donut.push.network`. **Callback gas** defaults to `500_000n` for custom targets as well.
- **trackRead lookup events** `READ-TX-104-03/04/05` (table below). The 19 s lookup was receipt fetching (prune RPC −32002 retried ~8 s per receipt, two receipts in series), not polling.

# Read State API Reference

## Solana API update — 2026-09-22 (supersedes tokenProgram and deferred account-IDL notes below)

`tokenProgram` is removed. Solana token preparation selects the RPC from `chain` (including configured overrides), reads the initialized mint's owner, and derives the ATA for SPL Token or Token-2022. Missing/invalid mints and RPC failures are surfaced before broadcast; no program is guessed.

`read(accountAddress, { chain: CHAIN.SOLANA_DEVNET, idl, accountName })` uses the existing raw-account query and decodes the result with Anchor's account coder, validating its discriminator. ABI and IDL options are exclusive. Account reads do not accept instruction `functionName`/`args`. Decoded integers/public keys retain Anchor types; dynamic IDLs may yield an unknown TypeScript result. Preparation/batching carry the result shape; resuming requires `resultShape: { kind: 'svmAccount', idl, accountName }`. The query proves account bytes, not IDL program ownership. No contract/node changes are needed.

---

# Other Resources

[Read State Response Doc](https://app.notion.com/p/Read-State-Response-Doc-3db188aea7f48047ac9becc04a1d57a1?pvs=21)

# Universal Read — SDK API Reference (v3)

**Status:** Iteration on v2 (kept intact below) · **Reviewed against:** [push-chain-sdk PR #265](https://github.com/pushchain/push-chain-sdk/pull/265) @ `24f0a6d`, `push-chain-core-contracts` branches `core-testnet` / `feat-read-state` / `128-provide-a-universalregistry-contract` · **Node record:** [Read State Response Doc](https://app.notion.com/p/Read-State-Response-Doc-3db188aea7f48047ac9becc04a1d57a1?pvs=21)

This section lists only what changes relative to v2. Anything not mentioned stands as written in v2.

---

## What changed vs v2

| # | Change | Why |
| --- | --- | --- |
| 1 | **`refundTo` restored** in PINNING (= `ReadSpec.revertRecipient`) | v2's "removed from contract" claim came from the stale `read-state-fixes-v1` branch. All current branches carry `revertRecipient`. **Correction on our side.** |
| 2 | **Fee model corrected**: `paid` → `protocolFee` (spent, never refunded) + `callbackBudget` (escrowed) → `burned` (`CallbackGasReported`) + `refunded` (`RefundSent`) | Live contract + Aman: "On expiry we do refund the feesDeposited. Protocol fee is never refunded irrespective of success or failure." |
| 3 | **`callbackDelivered` / `callbackFailReason` on the response** | `FULFILLED` = fulfil tx landed, NOT that your callback ran. Most important addition; v2 lacked it. |
| 4 | **Registry is real and integrated** — `callback` fully optional; defaults to `UNIVERSAL_READ_REGISTRY_ADDRESS`  • `REGISTRY_CALLBACK_GAS`; SDK computes `queryKey` offline | Branch 128: `read(spec, queryKey, callbackGasLimit)`, `latestResult`, `resultByRequestId`. Closes §Q3. |
| 5 | **`callback` flattened** — `{ target, abi, functionName, args, gasLimit }`, same vocabulary as viem `writeContract` / `encodeTxData`. Replaces the PR's nested `callback.request` | No new nouns. Neither ethers nor viem names this concept; they never nest it. |
| 6 | **Registry helpers are private** (`getReadQueryKey`, `getRegistryReadResult`, `getLatestRegistryReadResult` — internal to `registry.ts`, not exported) | Devs never touch registry storage. Surface later under `PushChain.utils.read.*` only if a real need appears (additive). |
| 7 | `tokenProgram: 'spl-token' \ | 'token-2022'` — SVM token reads only |
| 8 | **`token` on EVM = `balanceOf` contract call**, not an `ERC20Balance` envelope | Node does not ship that query type. |
| 9 | **`trackRead` gains `resultShape?`** | Typed decode on resume-by-hash — the ABI is not on-chain. |
| 10 | **`BatchReadResponse.transactionHashes[]`** | Sequential (non-atomic) fallback. |
| 11 | **Response gains `decodeError`, `pcTx[]`, `destination`, `request.refundTo`, `request.createdAtHeight`** | All sourced from the node record. |
| 12 | **`advanced.timeout` default becomes** `min(expiryBlocks × pushBlockTime + margin, 180s ceiling)` instead of flat 180s | Aman: "timeout should be increased to expiryTime till a ceil value." Needs a Push block-time constant. → **Shoaib** |
| 13 | **Extra progress events**: `READ-TX-102-05` (refundTo is a non-UEA contract without `receive()`), `106-04 / 106-05 / 106-06` (callback gas reported / refund sent / refund failed) | Settlement stages now observable. |
| 14 | **Vote-tally events `105-02-01/-02` parked** (not in PR) | Aman: feasible but "a new msg needs to be exported" by the node. Additive later. |
| 15 | **Solana pinning**: `blockNumber` / `minConfirmations` are compile errors on SVM | Aman: "For solana this field is not available — query is always done on finalizedSlot." Doc must say it. |
| 16 | **Web2 quorum callout** required on `web2.extract` | Aman: votes finalize only on identical extracted bytes; volatile APIs may never reach quorum in v1; `decimals` truncation is the stabilizer; median aggregation is v2. |
| 17 | **`payGasWith` cut** (never implemented) | Not needed here. |
| 18 | **v2's node-ABI "drift" claim retracted** | The node was right; the branch I compared against was stale. |

---

## read(subject, options) — v3

```tsx
await client.universal.read(subject, {

  // ══ QUERY — WHAT is read. subject = the thing you're asking about:
  //    holder (balances) | contract (calls, state) | https URL (web2)

  chain: CHAIN,                        // required. type ReadChain = EvmChain | SvmChain | CHAIN.WEB2
                                       //   CHAIN.WEB2 = 'web2:https' (confirmed, also added to UV)

  // — balance (EVM + SVM) —
                                       // no query keys → native balance of `subject` (ETH / lamports)
  token: string,                       // token balance of `subject`:
                                       //   EVM → balanceOf contract call
                                       //   SVM → SPLTokenAccount envelope, ATA(token, subject)
                                       //         derived by SDK — deterministic, no network
  tokenProgram: 'spl-token' | 'token-2022', // SVM token reads only. default 'spl-token'

  // — call (EVM now; SVM via `idl` when program reads land) —
  abi: Abi,                            // encodes AND decodes — `value` typed from outputs
  functionName: string,                //   any mutability (eth_call simulation); args typed at COMPILE time
  args: readonly unknown[],            //   typed against abi at compile time. No raw callData form

  // — state (EVM) —
  storageSlot: `0x${string}` | bigint, // storage LOCATION (which cell), bytes32-normalized.
                                       //   Read at `blockNumber`. (SVM raw bytes: future `layout`)

  // — web2 (subject = https URL) —
  web2: {
    extract: [{                        // required; 1–16 entries, defines result order.
      path: string,                    //   ⚠ QUORUM: validators vote on IDENTICAL extracted bytes.
      valueType: 'uint256' | 'int256' | 'bool' | 'string' | 'bytes',  //   Volatile APIs may never
      decimals?: number,               //   finalize in v1 — use `decimals` truncation to stabilize.
    }],                                //   Median aggregation is v2.
    method?: 'GET' | 'POST',           // default 'GET'
    headers?: Record<string, string>,  // default {} — ⚠ PUBLIC event log, forever
    body?: string | Uint8Array,        // POST only; rejected on GET
    timeoutMs?: number,                // default 5_000; validator-clamped
  },                                   // TS: chain WEB2 ⇔ web2 key present

  // ══ PINNING — HOW/WHEN. All optional, filled from internal preflight.
  //    Maps 1:1 to implemented ReadSpec (core-contracts: core-testnet / feat-read-state / 128). ══

  blockNumber: bigint,                 // EVM only (SVM/web2 → compile error; Solana always reads at
                                       //   finalizedSlot). default observedChainHeight − minConfirmations
  minConfirmations: number,            // EVM only. default 1
  expiryBlocks: bigint,                // default 300n Push blocks → EXPIRED, feesDeposited − protocolFee
                                       //   refunded to refundTo
  maxFee: bigint,                      // hard cap on the ONE upfront payment (protocolFee +
                                       //   callbackBudget). default: preflight quote + internal buffer
  refundTo: `0x${string}`,             // = ReadSpec.revertRecipient. Where unspent callbackBudget is
                                       //   PUSHED. default: your Push account. READ-TX-102-05 warns
                                       //   if it's a non-UEA contract without receive()

  // ══ CALLBACK — WHERE it lands, and the call that triggers it. Same vocabulary
  //    as viem writeContract / encodeTxData — no new nouns. ══

  callback: {
    target: `0x${string}`,             // default canonical UniversalReadRegistry.
                                       //   Override → your UniversalReadClient
    abi: Abi,                          // ┐ the payable call on `target` that requests the read.
    functionName: string,              // │ Omit for the registry (SDK knows its `read`).
    args: (spec, gasLimit) => unknown[], // ┘ mapper, not array — the SDK owns `spec`.
                                       //   default (spec, gas) => [spec, gas]
    gasLimit: bigint,                  // execution bound on the RESULT callback.
                                       //   default REGISTRY_CALLBACK_GAS; MANDATORY with custom
                                       //   target. 1n..1_000_000n. ⚠ priced into your fee
  },                                   // TS: target set ⇒ abi + functionName + gasLimit required;
                                       //     target absent ⇒ none allowed

  // ══ LIFECYCLE — HOW the promise behaves. Mirrors trackTransaction. ══

  progressHook: (e: ProgressEvent) => void,   // READ-TX-1xx + inner SEND-TX pass-through
  waitForCompletion: boolean,          // default true. false → returns after request confirm;
                                       //   resume via .wait() / trackRead
  advanced: {                          // kept (team: useful for power users + testing)
    pollingIntervalMs: number,         // default 2_000 (min 500)
    timeout: number,                   // default min(expiryBlocks × pushBlockTime + margin, 180_000)
    enforceGasCheck: boolean,          // default false: WARN + proceed · true: throw pre-broadcast
  },
});
```

## Response — v3 deltas

```tsx
type UniversalReadResponse<T> = {
  …as v2, plus:
  callbackDelivered?: boolean;         // FULFILLED ≠ delivered. false → CallbackFailed
  callbackFailReason?: `0x${string}`;  // revert data from CallbackFailed
  decodeError?: string;                // why `value` is absent though the read succeeded
  fees: {
    paid: bigint;                      // msg.value (feesDeposited)
    protocolFee: bigint;               // spent at request time, never refunded
    callbackBudget: bigint;            // escrowed
    burned?: bigint;                   // CallbackGasReported
    refunded?: bigint;                 // RefundSent; on EXPIRED = paid − protocolFee
    refundFailed?: boolean;            // push rejected → admin rescue pool
  };
  request: { …, refundTo, createdAtHeight };
  pcTx: { txHash, blockHeight, status, errorMsg }[];   // fulfil / settle / expiry txs
  destination: ResolvedDestination;
};

type BatchReadResponse = { …, transactionHashes?: Hex[] };   // sequential-fallback hashes
trackRead(ref, { …, resultShape? })                          // typed decode on resume-by-hash

// Failure shapes (same object, different fields lit):
// read errored at source:  FULFILLED, callbackDelivered true,  value undefined, raw.status ERROR
// your callback reverted:  FULFILLED, callbackDelivered FALSE, callbackFailReason, raw.status SUCCESS
// no quorum in time:       EXPIRED, raw null, fees.refunded = paid − protocolFee
// client gave up:          throws ReadTimeoutError { lastStatus } — the only throw
```

**Multiple requests in one tx (the "receipt" question):** `txHash` is the batch receipt; `requestId` + `logIndex` is the per-read receipt. `executeReads` sorts `ReadRequested` logs by `logIndex`, maps them onto the prepared array in order (`reads[i]` ≡ `prepared[i]`), and throws `READ_REQUEST_MISMATCH` (carrying the tx hashes for `trackRead` resume) if the app emitted unexpected extra reads. No separate job/receipt id needed.

---

## Questions — status after team review

**Closed:** Q1 fee/refund (protocol fee never refunded; expiry refunds `feesDeposited − protocolFee`) · Q2 `advanced.*` (keep) · Q3 registry (branch 128) · Q4 `CHAIN.WEB2 = 'web2:https'` (SDK still owes the `sendTransaction` exclusion guard) · Q5 drift (retracted) · Q6 batching (Nilesh: supported contract + core side, settles separately) · Solana pinning (finalizedSlot) · web2 quorum (doc callout).

**Parked (additive later):** Q7 vote-tally events — pending a new node query msg.

**Action:** timeout default formula → Shoaib.

**Remaining — node response doc only, not SDK:**

1. `callback_delivered` + settlement accounting (`callback_gas_used`, `refunded`, `refund_failed`) on the gRPC record.
2. Status definitions (`FAILED` vs `FULFILLED`+`CallbackFailed`, `ABORTED`, `expiry_attempts`, `error_msg`) + three-vocabulary mapping (contract `RequestStatus` ↔ module lifecycle ↔ observation).

## PR #265 — merge conditions

1. Flatten `callback` (delete `ReadRequestEntrypoint` / `callback.request`; lift `abi`/`functionName`/`args` into `ReadCallback`; `resolveReadCallback` builds the registry call internally).
2. Make the three registry helpers private.
3. **CI gate** — 162 unit tests exist, no workflow runs them on PR; e2e is manual dispatch. Hard condition.
4. Minor: `read-state.types.ts` (436) / `read-tracker.ts` (412) over 400 lines; `plan/` docs living in the SDK repo.

---

## SDK feedback on the V3 review — 2026-09-16

**Status:** SDK changes and decisions 1.B / 2.A implemented locally on 2026-09-16. Shoaib excluded CI changes. The imported V3 proposal and V2 baseline above/below are preserved as historical review material; this implementation update takes precedence.

### Implementation update

- Custom callbacks now use `{ target, gasLimit, abi, functionName, args? }`. The nested `request` field and exported `ReadRequestEntrypoint` type are removed. Runtime validation rejects the removed field.
- `callback: { gasLimit }` remains supported for the default registry. A targetless callback cannot override the internal request ABI/function/arguments.
- `prepareRead()` still accepts a custom target and gas limit without an entrypoint. `read()` requires its ABI/function at compile time; `executeReads()` validates every prepared entrypoint before broadcasting.
- Batch mismatch errors include structured `transactionHashes`, including every hash in a sequential fallback.
- The proposed PR workflow was removed at Shoaib's request. No CI or merge-rule changes are included.
- `node scripts/check-read-state-drift.mjs` runs the reviewed contract selector/struct/event pins, node record and query-envelope fixtures, public API types, constants, registry address/default gas and stable query-key regressions. This is an offline snapshot gate; new upstream releases and deployments still need explicit verification.
- Registry key/address/lookup helpers are package-internal. Default waits use fresh remaining Push lifetime plus 10 seconds, capped at 180 seconds; explicit timeouts take precedence. Terminal snapshots need no height query. A stalled height lookup is bounded by the 180-second ceiling; lookup latency counts toward that ceiling and lookup failures reject.

### Recommended changes

1. **Flatten the custom callback configuration.** Agreed: lift `abi`, `functionName`, and the optional argument mapper out of `callback.request`. Since Read State is unreleased, remove the nested form without a compatibility alias. Clearly say that these fields describe the **request entrypoint**, while `gasLimit` controls execution of the **result callback**. Those are different contract calls despite sharing this options bag.
2. **Keep a registry gas override.** Amend “target absent ⇒ none allowed” to allow `callback: { gasLimit: 750_000n }`. The contract team's agreed behavior is a 500,000 default with user increases up to 1,000,000 for larger results. Requiring a custom target/ABI merely to increase registry gas would remove that useful shorthand. Without a target, disallow only `abi`, `functionName`, and `args`.
3. **Separate preparation from execution requirements.** `read()` and executable prepared reads need an app request ABI/function. However, the existing contract-first flow also uses `prepareRead()` with a target/gas limit and then inserts the spec into an independently constructed `sendTransaction`. Preserve that preparation use case or explicitly decide to remove it; applying the strict V3 callback type everywhere would break it.
4. **Registry helpers — decision 1.B.** Keep helpers package-internal. Contract storage remains accessible through direct viem calls; stable query-key calculation remains internal and prepared requests retain their key.
5. **PR CI — excluded by Shoaib.** Local type, unit and drift checks remain available; no new workflow or merge-rule changes.
6. **Timeout — decision 2.A.** Fetch the current Push height on each default wait/resume; use remaining blocks × 1,340 ms + 10,000 ms, capped at 180,000 ms. Clamp remaining blocks at zero. The margin is an observation allowance, not a protocol guarantee. Explicit user timeouts override this.
7. **Treat file size and planning-doc placement as maintenance work.** Current files are 438 and 412 lines. Split by responsibility when helpful, rather than treating 400 lines as a correctness boundary. Moving planning docs requires a destination decision; it is separate from the requested API corrections.

### Corrections needed in the review text

- **Refund warning:** `READ-TX-102-05` warns for a contract that is not recognized as a UEA (with delegated EOAs exempted). It does not detect that `receive()` is absent. Even a payable receiver can reject a transfer. Describe this as “ensure the recipient accepts native Push refunds.”
- **Response provenance:** `callbackDelivered`, failure bytes, and settlement amounts are derived from contract events, including EndBlock events for expiry; `decodeError` is computed locally. They are not all sourced from the node record. The requested gRPC additions would improve observability, but the SDK already derives these facts where evidence is available.
- **Error semantics:** terminal lifecycle failures resolve as statuses, but “timeout is the only throw” is too broad. Invalid input, request broadcast/revert, missing records, RPC failures, and batch mismatches can also reject. Also, `trackRead()` returns a snapshot; call `.wait()` to wait for terminal status.
- **Batch matching:** the SDK sorts each transaction's records by log index, then matches spec + callback target + callback gas against each input; it does not blindly zip sorted logs with inputs. Mismatch errors now include structured `transactionHashes` as well as the primary `txHash`.
- **Web2 transaction exclusion:** the current namespace constant keeps `CHAIN.WEB2` outside the transaction `CHAIN` enum type. Compile-time exclusion is already present. Any runtime guard for JavaScript/untyped callers is a separate validation requirement, not an unimplemented type exclusion.
- **Web2 truncation:** lowering precision may help nearby values encode identically, but it cannot guarantee quorum; values can still straddle a truncation boundary. Describe median aggregation as deferred/planned, not a committed v2 release.
- **Resume typing:** `resultShape` enables correct runtime decoding; it does not by itself establish compile-time ABI inference for the return type of `trackRead`.
- **Table row 7:** the exported Markdown splits the `tokenProgram` union across table cells. The intended option is `'spl-token' | 'token-2022'`, for SVM token reads only.

### Already aligned with V3

The SDK already implements the seven-field spec with `refundTo`, separate protocol fee/callback budget accounting, callback delivery/failure fields, the deployed Donut registry, EVM token reads through `balanceOf`, SVM token-program selection, resume result shapes, sequential transaction hashes, EVM-only public pinning, Web2 quorum documentation, and settlement progress events. Vote-tally events remain deferred. N1's CEA ingestion fix was verified live on 2026-09-15.

**Resolved:** helper visibility and timeout policy. Callback flattening, offline drift checks and structured batch-mismatch recovery are implemented. CI is excluded. Any future planning-document relocation still requires a destination decision.

---


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
  functionName: string,                //   any mutability; same { abi|idl, functionName, args }
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
| `READ-TX-104-03` | Looking Up Request | INFO | `{ requestId }` or `{ txHash }` |
| `READ-TX-104-04` | Request Found | SUCCESS | `{ requestId, status }` (one per record) |
| `READ-TX-104-05` | Request Not Found | ERROR | `{ requestId \| txHash, elapsedMs }` |
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

## 4. Registry deployment and network availability

Donut now supports the OG `read(subject, { chain })` shorthand through registry proxy `0x00000000000000000000000000000000000000b2`. Default callback gas is `500_000n`, overridable up to `1_000_000n`. Other network settings still require a custom receiver until a registry deployment is verified there.

Current behavior:

- Omitted targets select the configured network's registry and `read(spec, queryKey, callbackGasLimit)` entrypoint.
- Custom targets still require explicit gas and, for execution, a request ABI/function.
- Networks without a pinned deployment produce `ReadRegistryUnavailableError` for the default path.
- The SDK computes a stable logical key retained in `PreparedRead.queryKey`; key and storage lookup helpers are internal. The contract accepts it as a caller-supplied label.

Example of the currently executable path:

```ts
const callback = {
  target: myReadClient,
  gasLimit: 200_000n,
  abi: myReadClientAbi,
  functionName: 'request',
};

const result = await client.universal.read(user, {
  chain: CHAIN.ETHEREUM_SEPOLIA,
  callback,
});
```

See [`read-state-registry-integration.md`](./read-state-registry-integration.md) for the exact key algorithm, storage lookup helpers, refund behavior and validation scope. The registry preserves explicit non-zero refund recipients. Callback failures require a new paid request; 500,000 gas is not a guarantee for arbitrary result sizes.

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

`advanced.*` was retained for power users and test scenarios. Each default wait/resume fetches the current Push height and uses `min(180_000, max(0, expiryPushChainHeight - currentPushHeight) × 1_340 + 10_000)` ms. Already-expired pending records get 10 seconds to observe the terminal update. Explicit timeouts take precedence. A client timeout does not cancel the request; resume through `trackRead`.

## 10. Expiry observability

Expiry is performed by the node's EndBlocker. The resulting `expireExternalRead` execution has no ordinary, fetchable EVM transaction receipt and does not appear through `eth_getLogs`. The SDK therefore checks Cosmos `block_results` at the recorded expiry-attempt heights and parses `RequestExpired`, `RefundSent`, and `RefundFailed` from EndBlock events.

Because a refund recipient can reject the push without preventing expiry, `EXPIRED` alone does not prove that the refund landed. `fees.refunded` and `fees.refundFailed` remain undefined when the EndBlock evidence cannot be recovered.

## 11. Unsupported flows and refund safety

- Nested reads initiated inside a callback are not supported for v1. The shared reentrancy guard rejects them, and the outer fulfil path records the rejection as `CallbackFailed`.
- `refundTo` defaults to the sending Push account. This is safe for EVM and SVM UEAs because both accept native Push payments; it was also verified on Donut. The SDK warns when the target is a contract that cannot be identified as a UEA.

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
- `ReadRegistryUnavailableError` identifies a network without a configured registry.

Execution can also surface stable `ReadStateError` codes such as `READ_REQUEST_TX_FAILED` and `READ_REQUEST_MISMATCH`. These preserve transaction hashes needed to recover reads from a partially successful sequential fallback; reducing every execution failure to the OG's generic `PushChainExecutionError` would lose that recovery context.

## 13. Verification evidence

Live Donut verification covered EVM, SVM, and Web2 reads, plus success, validator error, callback failure, expiry, EOA-originated requests, UEA-originated requests, and the contract CEA round trip.

Key observations:

- A Sepolia native-balance result matched the pinned destination value exactly.
- A Solana devnet lamport result matched the finalized destination value exactly.
- A Web2 request returned the expected flat ABI-encoded extract list.
- A reverting callback produced node status `FULFILLED` with `callbackDelivered = false`.
- An expired request returned the full callback budget while retaining the protocol fee.
- A UEA-originated request was discoverable by the exact transaction hash returned by `sendTransaction`, validating tx-hash-first recovery.
- A Push contract created its initially undeployed Sepolia CEA, received a CEA-originated inbound, and requested a read inside `executeUniversalTx`. Node `v0.0.49` indexed request `0x57e2562a…` under inbound Push tx `0x38098563…`; it reached `FULFILLED`, the registry stored the result, and settlement succeeded.

## 14. Remaining work

1. Verify registry deployments before enabling defaults on additional networks.
2. Re-verify upstream releases/deployments before updating compatibility pins. The offline `scripts/check-read-state-drift.mjs` checks reviewed ABI/event pins, node record/envelope fixtures, constants, registry configuration and public types. It does not automatically detect external repository or deployment changes. CI is excluded by decision.

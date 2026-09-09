# Read State — SDK Implementation Plan

**Branch:** `feature/readstate` · **Package:** `@pushchain/core` · **Spec:** [`read-state-sdk-spec.md`](./read-state-sdk-spec.md) · **Blockers:** [`read-state-blockers.md`](./read-state-blockers.md) · **Tools:** [`read-state-tools/`](./read-state-tools/)
**Date:** 2026-09-09

Seven PRs on one branch, each independently reviewable and green. Groups 1–3 (PR1–PR6) are
unblocked today. PR7 waits on the `UniversalReadRegistry`.

---

## 0. Invariants every PR is held to

These came out of the live runs and the audit. A PR that violates one is wrong even if its
tests pass.

| # | Invariant | Where it bites |
|---|---|---|
| I1 | `ReadSpec.query` is `abi.encode` of **one tuple** (`encodeAbiParameters([{type:'tuple',components}], [env])`). Never `encodeAbiParameters(fields…)`. | Validators unpack `abi.Arguments{tuple}`; the three-param form parses only by coincidence at `queryType==0`. Cost the first live read. |
| I2 | `AccountBalance` payload is `abi.encode(address)` (32 B), not the raw 20-B address. | Same failure mode as I1. |
| I3 | `callbackBudget > 0` always. `msg.value = protocolFee + budget`; `estimateFee` returns the fee **only** (0 on Donut today). | Node refuses to fulfil at zero budget → guaranteed expiry, fee lost. |
| I4 | `FULFILLED ≠ delivered`. `callbackDelivered` comes from `ReadFulfilled` vs `CallbackFailed` on the fulfil tx. `value` only when both. | Node sets FULFILLED even when the app callback reverted. |
| I5 | `refundTo` is required by the contract, defaults to the sending account (UEAs have `receive()`), warns for non-UEA contracts. | Rejected refund → forfeited to admin pool. |
| I6 | Tracking is tx-hash-first; `requestId` recovered from `ReadRequested` logs, filtered on **address and topic0**. | `requestId` is unknowable pre-broadcast; address filter is a security control. |
| I7 | Codecs for `ucallback.v1` are **hand-authored**. Never run `yarn build:proto`. | The script `rm -r`s hand-authored `generated/uexecutor/{v1/query,v2}`. |
| I8 | Read methods work in **read-only mode**. No `isReadMode` throw on any `read*` method. | Nothing here signs; a UniversalAccount-only client must work. |
| I9 | Contract surface = `feat-read-state@f8d1a0c` (7-field spec, 2-arg `estimateFee`). Selectors pinned by test. | The team's draft was pinned to a stale branch. |
| I10 | We never commit to `push-chain-core-contracts` or `push-chain`. | Repo ownership. |

---

## 1. Test strategy — three tiers, mapped to the three Jest configs

| tier | config | runs where | needs | what lives here |
|---|---|---|---|---|
| **Unit** | `packages/core/jest.config.ts` (30 s) | every commit, CI | nothing | encoders, decoders, codecs, validation, spec builder, tracker with fake timers, wiring |
| **Integration** | `jest.integration.config.ts` (300 s, `dotenv`) — specs must be **added to its explicit `testMatch` list** | on demand, CI nightly | RPC only, no key, no writes | preflight against live `UniversalCore`/`UniversalCallback`; `getUniversalRead`/`getReadsByTx` decoding real records; `trackRead` on the two settled fixture reads |
| **E2E** | `jest.e2e.config.ts` (`__e2e__/**/*.spec.ts`, `globalSetup`) | manual GH Action | funded key (`PUSH_PRIVATE_KEY`), spends ~0.002 PC per read | real requests through the validator set; the five owed live checks |

**Fixtures (committed once, immutable):**

| fixture | source | used by |
|---|---|---|
| `envelope-vectors.json` — `{name, kind, input, expectedHex}` for every query type | authored in PR1, cross-checked by decoding with the exact tuple shapes from `read_envelope.go` | unit (both encode and decode), **and handed to the chain team** to run through their Go decoders |
| `universal-read.fixture.b64` — raw `abci_query` value for read `0xf3d62fb9…` | captured from Donut (`node-read.sh` path, keep the base64) | codec unit test — the one regression guard for hand-authored protobuf |
| `receipts/request.json`, `receipts/fulfil.json`, `receipts/settle.json` | `cast receipt --json` for tx `0x8329b613…`, `0x1d241ed8…`, `0x47eb5d30…` | event parsing unit tests: `ReadRequested`, `ReadFulfilled`, `CallbackGasReported`, `RefundSent` |
| `receipts/fulfil-callbackfailed.json` | captured when the reverting-callback e2e runs (PR6) | `callbackDelivered=false` path |
| Deployed clients `0x6ffde03d…`, `0x5F7221d3…`; settled reads `0xeba3eb9e…` (ERROR), `0xf3d62fb9…` (SUCCESS) | already on Donut, never change | integration `trackRead`/`getUniversalRead` — deterministic, no funds |

**Mocking pattern:** the hand-built `OrchestratorContext` from `orchestrator/__tests__/preflight.spec.ts:17-31` — stub only what the function touches, assert on captured `ProgressEvent[]`. `jest.mock` for module boundaries (`push-client`).

---

## 2. Work breakdown

### PR1 — Foundation: types, envelopes, decoders, codecs, constants · **~2 days**

Pure, offline, everything else imports from it.

**Files**

```
src/lib/read-state/
  read-state.types.ts        ReadDestination, ReadQuery (discriminated), ReadSpec, ReadPreflight,
                             PreparedRead, UniversalReadRecord/Response, status enums, ReadResultShape
  envelopes/evm.ts           encodeEvmQueryEnvelope / decodeEvmQueryEnvelope (I1, I2)
  envelopes/svm.ts           encodeSvmQueryEnvelope; svmOwnerBytes (base58 → raw 32 B); ATA derivation
  envelopes/web2.ts          encodeWeb2QueryEnvelope; header canonicalisation; sensitive-header warn
  envelopes/index.ts         encodeQuery(destination, query) dispatch
  result-decoder.ts          decodeReadResult(bytes, shape); readResultShapeFor(query)
  read-events.ts             READ_REQUESTED_EVENT / TOPIC0, parseReadRequestsFromReceipt (I6),
                             parseFulfilOutcome(receipt) → { delivered, burned, refunded, refundFailed }
  errors.ts                  ReadStateError + subclasses (pc20/errors.ts precedent)
  index.ts
src/lib/generated/ucallback/v1/{types,query,index}.ts   hand-authored (I7); imports PCTx from uexecutor/v1
src/lib/constants/abi/universalCallback.evm.ts          estimateFee, requestExternalReadSelf, statusOf,
                                                        isFulfilled, getPendingRead, 7 events, 11 errors
src/lib/constants/abi/prc20.evm.ts                      + chainHeightByChainNamespace, readBaseFeeByChainNamespace
src/lib/constants/chain.ts                              UNIVERSAL_CORE_ADDRESSES, UNIVERSAL_CALLBACK_ADDRESSES
src/lib/constants/read-state.ts                         MAX_CALLBACK_GAS_LIMIT 1_000_000n, MIN_CONFIRMATIONS_FLOOR 1,
                                                        DEFAULT_EXPIRY_BLOCKS 300n, CALLBACK_BUDGET_BUFFER 3,
                                                        WEB2_MAX_EXTRACT_ENTRIES 16, WEB2_DEFAULT_TIMEOUT_MS 5000
```

**Unit tests** (`src/lib/read-state/__tests__/`)

| spec | asserts |
|---|---|
| `envelope-evm.spec.ts` | golden vectors for AccountBalance / ContractCall / StorageSlot; first word is `0x20`; three-param form ≠ tuple form; round-trip through `decodeAbiParameters` with the Go tuple shape; `blockRef.blockNumber` mirrored |
| `envelope-svm.spec.ts` | three types, empty payload, `minSlot` 0 and non-zero; `svmOwnerBytes` gives exactly 32 B from base58, rejects 20-B input; ATA derivation matches `@solana/spl-token` for a known pair |
| `envelope-web2.spec.ts` | GET/POST, 1 and 16 extracts, all five value types, non-zero decimals; >16 rejected; body on GET rejected; scrambled header key order → identical bytes; `/auth\|key\|token\|secret\|bearer/i` warns |
| `result-decoder.spec.ts` | uint256 / bytes32 / raw / evmCall (real ERC-20 `balanceOf` ABI) / web2 flat multi-value in extract order; **negative:** web2 against wrong extract list throws `ReadDecodeError` |
| `read-events.spec.ts` | `READ_REQUESTED_TOPIC0` equals the hash from `read_event.go`; parses the real `receipts/request.json`; ignores a matching topic0 from a **different address**; two logs → two ids in log order; `parseFulfilOutcome` on `receipts/fulfil.json` → delivered=true, on settle → burned/refunded from `CallbackGasReported` |
| `ucallback-codec.spec.ts` | decodes `universal-read.fixture.b64`: id, status FULFILLED, result SUCCESS, `result_data` = `0x…92b406e140cc2c8871`, two `pc_tx`; encodes `QueryReadsByTxRequest{tx_hash}` to the exact bytes `node-read.sh` sends |
| `abi-selectors.spec.ts` | `requestExternalReadSelf` selector = `0x72767171`, `estimateFee(string,string)` = `0xdca9f068` (I9) |

**Done when:** all vectors pass both directions; the chain team has the vector file.

---

### PR2 — Chain client: queries, preflight, budget · **~1.5 days**

**Files**

```
src/lib/push-client/push-client.ts          getUniversalRead(requestId), getReadsByTx(txHash)
                                            — copy getUniversalTxById (:375-391) against 'ucallback.v1.Query';
                                            NO archive fallback (current-state query)
src/lib/read-state/preflight.ts             preflightRead(ctx, destination) → ReadPreflight
                                            { observedChainHeight (UniversalCore, CAIP-2 key), protocolFee
                                              (UniversalCallback.estimateFee), pushBlockNumber, pushGasPrice, fetchedAt }
src/lib/read-state/budget.ts                sizeCallbackBudget(gasLimit, gasPrice, buffer) (I3)
```

**Unit** — `preflight.spec.ts` with a mocked `pushClient`: CAIP-2 key is joined `ns:chainId`; web2 → `observedChainHeight = 0` is not an error; unknown EVM chain with height 0 → `ReadHeightUnavailableError`. `budget.spec.ts`: never returns 0; buffer applied; bigint math exact.

**Integration** (`src/lib/read-state/__integration__/preflight.integration.spec.ts`, add to `jest.integration.config.ts`)

| asserts |
|---|
| `preflightRead(Sepolia)` → `observedChainHeight > 11_000_000`, `protocolFee = 0n`, `pushBlockNumber > 22_000_000` |
| `preflightRead(SolanaDevnet)` → height populated |
| `getReadsByTx(0x8329b613…)` → one record, FULFILLED, SUCCESS, `result_data` matches fixture |
| `getUniversalRead(0xeba3eb9e…)` → FULFILLED, result ERROR, `error_code = 1` |
| `getReadsByTx(0x00…00)` → empty array, no throw |

---

### PR3 — `prepareRead` · **~2 days**

**Files**

```
src/lib/read-state/validate.ts              validateReadSpec → violations[] mirroring every contract revert
src/lib/read-state/spec-builder.ts          prepareRead(ctx, subject, options) → PreparedRead
                                            buildReadSpecFromPreflight(preflight, …) (pure)
                                            refundTo default + UEA check via UEAFactory.getOriginForUEA (I5)
src/lib/orchestrator/internals/read-state.ts  thin delegators; exported from internals/index.ts
```

**Behaviour to pin**

- `blockNumber` default = `observedChainHeight − minConfirmations`, clamped ≥ 1; web2 forced to 0.
- `expiryPushChainHeight = pushBlockNumber + expiryBlocks` (default 300).
- `value = protocolFee + budget`; `maxFee` default `value × (1 + buffer)`; `msg.value > maxFee` caught client-side.
- `PreparedRead.toCallData({abi, functionName, args?})` and `.specTuple` for `encodeFunctionData`.
- `simulate(appContract, selector)` — `eth_call` with `from` = app; decodes the 11 custom errors; warns when `fetchedAt` > 60 s.

**Unit** — `validate.spec.ts` table-driven, one row per violation, named by the Solidity line. `spec-builder.spec.ts`: every default above; SVM `owner` exactly 32 B; EVM `owner` 20 B; `refundTo` required when not derivable; UEA `refundTo` does not warn, EOA does not warn, non-UEA contract warns (`READ-TX-102-05`); `web2` ⇔ `CHAIN.WEB2`; TS-level: exclusivity of query keys compiles as expected (`// @ts-expect-error` cases).

**Integration** — `prepare.integration.spec.ts`: `prepareRead` for Sepolia balance against live preflight, then `simulate()` from deployed client `0x5F7221d3…` returns `{ok:true}`; `simulate()` with `blockNumber = height+1` returns decoded `InvalidBlockNumber`.

---

### PR4 — `trackRead`, lifecycle, progress events · **~2 days**

**Files**

```
src/lib/read-state/read-tracker.ts          trackRead(ctx, {txHash}|{requestId}, opts); wait(); refresh();
                                            callbackDelivered via parseFulfilOutcome on pc_tx[].txHash (I4);
                                            fees {paid, protocolFee, callbackBudget, burned?, refunded?, refundFailed?}
src/lib/progress-hook/progress-hook.types.ts  PROGRESS_HOOK += READ_TX_101 … READ_TX_199_99, READ_TX_001…999_03
src/lib/progress-hook/progress-hook.ts        message table for the READ-TX band
src/lib/orchestrator/internals/context.ts     READ-TX ids must NOT be added to R1_SUPPRESSED_IN_NON_R1 (:90)
```

**Behaviour to pin**

- Terminal set `FULFILLED | EXPIRED | FAILED | ABORTED`; `wait()` **resolves** on terminal, throws only `ReadTimeoutError` (house convention).
- Polling `pollingIntervalMs` 2 000 (min 500); `timeout` default `expiryBlocks × blockTime` capped 180 000.
- `value` present iff `status === FULFILLED && callbackDelivered && result.status === SUCCESS`.
- Hook emission order 104-02 → 105-01/02 → 106-01..06 → 199-xx; inner `SEND-TX` pass-through preserved.

**Unit** — `read-tracker.spec.ts` with `jest.useFakeTimers()` and a scripted `pushClient` (PENDING → VOTING → FULFILLED): resolves; EXPIRED/FAILED/ABORTED resolve with status (no throw); timeout throws with `lastStatus`; `callbackDelivered` false when fulfil receipt carries `CallbackFailed`; `fees` populated from `CallbackGasReported`/`RefundSent`/`RefundFailed`; hook ids emitted in order; `READ-TX-*` not suppressed under a non-R1 `currentRoute`. `progress-hook/__tests__/read-tx-spec-strings.spec.ts`: exact titles/levels (mirrors `r3-spec-strings.spec.ts`).

**Integration** — `track.integration.spec.ts`: `trackRead({txHash: 0x8329b613…})` → array of 1, FULFILLED, `callbackDelivered = true`, `value = 2706196938206701455473n`, `fees.burned = 117_000_000_000_000n`, `fees.refunded = 49_883_000_000_000_000n`; `trackRead({requestId: 0xeba3eb9e…})` → FULFILLED, result ERROR, `value` undefined. Deterministic forever — no funds, no waiting.

---

### PR5 — `PushChain` wiring, exports, docs, changeset · **~1 day**

**Files**

```
src/lib/push-chain/push-chain.ts     universal.read / prepareRead / executeReads / trackRead — declared + wired
                                     in the private constructor; NO isReadMode throw (I8)
src/lib/index.ts                     // Read state export block (types, enums, errors, pure helpers)
src/lib/constants/index.ts           CONSTANTS.READ
.changeset/read-state.md             minor: "feat(core): cross-chain read state — prepareRead/trackRead"
```

`read()` and `executeReads()` are wired to internals that throw `UnsupportedReadDestinationError('registry not deployed')` until PR7 — so the surface is complete and typed from day one.

**Unit** — `push-chain.read-state.spec.ts`: all four methods exist on a client built from a **`UniversalAccount`** (read-only mode) and `prepareRead`/`trackRead` execute (mocked); exports snapshot; `CONSTANTS.READ` values.

---

### PR6 — E2E: the live checks · **~2 days, gated on `PUSH_PRIVATE_KEY`**

New tree `__e2e__/read/`, using `shared/fresh-wallet.ts`, `evm-client.ts`, `progress-tracker.ts`, `validators.ts`. Each spec deploys nothing — it calls the already-deployed client `0x5F7221d3…` (or, for the reverting/expiry cases, two more tiny clients deployed once and their addresses added to `shared/chain-fixtures.ts`).

| spec | flow | proves |
|---|---|---|
| `evm/balance-eoa.spec.ts` | `prepareRead` → `sendTransaction` (EOA) to client → `trackRead` → `value` equals `cast balance` at pin | the happy path the SDK way |
| `evm/balance-uea.spec.ts` | same, but sent **through a UEA** via `universal.sendTransaction` from a Sepolia-origin signer | **N1 fix live** — the flagship path, never yet exercised |
| `evm/contract-call.spec.ts` | `abi`/`functionName` read of an ERC-20 `balanceOf` on Sepolia; typed `value` | `contractCallFn` + `evmCall` decode |
| `evm/callback-reverts.spec.ts` | client whose `onUniversalData` reverts | `status FULFILLED`, `callbackDelivered false`, `value undefined`, `READ-TX-106-03` emitted (I4) |
| `lifecycle/expiry.spec.ts` | `expiryBlocks: 2n` | `EXPIRED`, `fees.refunded == callbackBudget`, `RequestExpired` parsed |
| `svm/lamports.spec.ts` | Solana devnet lamport balance; `owner` raw 32 B | SVM envelope + `minSlot` floor |
| `web2/price.spec.ts` | GET a public JSON endpoint, one `uint256` extract with decimals | web2 envelope reachable post-C3; fee 0 |
| `docs-examples/13-read-state/*.spec.ts` | 1:1 mirror of the runnable blocks in the (future) website MDX | docs never drift (house rule in `__e2e__/docs-examples/README.md`) |

Register the tree in `__e2e__/ci/suite.ts` with a `read` tag and the per-scenario fund estimate (≈0.06 PC each incl. budget refund).

---

### PR7 — `read()` one-shot and `executeReads()` batch · **blocked on registry**

When `UniversalReadRegistry` ships: pin `UNIVERSAL_READ_REGISTRY_ADDRESS` + `REGISTRY_CALLBACK_GAS`, wire `read()` = `prepareRead → executeReads([p]) → wait()`, `executeReads` = one multicall via the existing EIP-7702/UEA batch path (`atomic` flag, sequential fallback). Tests: unit (batch response shape, order preserved, `atomic`), integration (`latestResult[reader][queryKey]` view), e2e (`read()` returns typed value; 3-read batch → 3 ids in log order).

---

## 3. Sequencing and parallelism

```
PR1 ──► PR2 ──► PR3 ──► PR4 ──► PR5 ──► PR6
 │                                        ▲
 └── vector file → chain team (Go check)  │
                                          └── live check "UEA-originated" can run NOW with the
                                              harness + existing sendTransaction; do it before PR3
                                                                                   PR7 (registry)
```

**Gate cleared 2026-09-09.** The UEA-originated live read ran via
`plan/read-state-tools/live-read-uea.ts` (SDK Route 1, Sepolia-origin signer): read
`0xdc0a66ba…` ingested, fulfilled and settled in 23 s, `ReadsByTx` found by the SDK's tx hash,
refund landed at the UEA. PR3–PR6 can proceed on verified assumptions.

---

## 4. Dependencies and risks

| item | owner | effect on this plan |
|---|---|---|
| `UniversalReadRegistry` unbuilt | contracts | PR7 blocked; PR5 ships `read()` as a typed stub |
| N1 CEA path not ingested | chain | PR3 refuses `prepareRead` when the signer resolves to a CEA (`isCEA`) — until they say otherwise |
| N4 fee 0, no affordability gate | chain/ops | none on the SDK; launch gate only |
| `yarn build:proto` destructive (I7) | us | hand-author; add a CI guard that fails if `generated/ucallback` differs from committed |
| Q9 web2 `CHAIN.WEB2 = 'web2:https'` | us | exclude from `sendTransaction`'s `to.chain` type + runtime guard (PR5) |
| Progress-hook suppression set | us | READ-TX band must be left out of `R1_SUPPRESSED_IN_NON_R1` or events vanish under R2/R3 |

---

## 5. Definition of done (v1 = PR1–PR6)

- `prepareRead` + `trackRead` public, typed, documented, working in read-only mode.
- Unit: every invariant I1–I9 has a named test; golden vectors pass in TS **and** in the chain team's Go run.
- Integration: passes against Donut with no key.
- E2E: the seven live specs green on Donut, including UEA-originated and reverting-callback.
- Changeset + `docs-examples/13-read-state` in place; website MDX handed to docs.
- `read()` / `executeReads()` present as typed stubs with a clear error until PR7.

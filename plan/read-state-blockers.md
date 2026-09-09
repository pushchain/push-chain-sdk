# Read State — Blockers & Open Issues

**Audience:** contracts team + chain team
**Repos:** `push-chain-core-contracts@feat-read-state` · `push-chain@develop`
**Measured against:** live Donut testnet (`https://evm.donut.rpc.push.org/`)

| | |
|---|---|
| **Original findings** | 2026-09-08 — 11 defects, 6 blockers |
| **Verification update** | 2026-09-09 — team fixes re-verified against redeployed Donut |

Companion doc: [`read-state-sdk-spec.md`](./read-state-sdk-spec.md)

---

# Status as of 2026-09-09

**5 of 6 blockers fixed and live on Donut. 1 blocker untouched and widened. 1 fix half-complete.**

Verified against: node `v0.0.47` (what Donut's `abci_info` reports; contains all three node
fixes), contracts redeployed (`UniversalCallback` impl `0x3b34de3c…` → `0xa481f5b0…`,
`UniversalCore` impl also changed).

| # | Defect | Owner | Before | Now | Verified by |
|---|---|---|---|---|---|
| **C1** | Chain-height lookup keyed on bare namespace | Contracts | Blocker | ✅ **Fixed** `82e982b` | Bare-namespace request accepted live at observed height; above-height rejected; old CAIP-2 workaround now rejected; the 1024-run fuzz that proved "no valid input" now fails with a counterexample |
| **C2** | `fulfillExternalCallback` swallows callback failure | Contracts | Blocker | ⬇️ **Neutralised by N2** | Contract unchanged (`:203-211`) but the estimator it fed is gone |
| **C3** | Web2 can never pass the height guard | Contracts | Blocker (web2) | ✅ **Fixed** `c603558` | web2 accepted at `blockNumber=0`; non-zero still rejected |
| **C4** | `EXECUTED` unrecoverable | Contracts | Latent | ✅ **Fixed** `6fc7a18`+`46b56c1` | Drove request to `EXECUTED`, settled via an address holding **only** `UVCALLBACK_ADMIN_ROLE` — confirms the merged version is deployed, not the pre-merge `DEFAULT_ADMIN_ROLE` one |
| **C5** | Failed refunds admin-sweepable | Contracts | Latent→active | ⬇️ **Back to Latent** | Still present — rejecting recipient moved 0.2 ETH to the rescuable pool live. But N2 gives refunds a fixed 150k, so `RefundFailed` is no longer routine |
| **C6** | Callback can't chain a read | Contracts | Latent | ❌ **Unfixed, no decision** | Chained read reverts `0x3ee5aeb5` (`ReentrancyGuardReentrantCall`). Fix needs contract **and** node — see §Still open |
| **C7** | `readBaseFee` split-key naming trap | Contracts | Latent | ❌ **Unfixed** | Mapping unchanged at `UniversalCore.sol:115` |
| **N1** | UEA reads never ingested | Chain | Blocker | ⚠️ **Half-fixed** `d4ef66db` | `CallUEAExecutePayload` now ingests, inside the cacheCtx so it commits with the payload — correct. `CallExecuteUniversalTx` (`evm.go:868`, CEA→contract inbounds) still does not. New test covers UEA path only |
| **N2** | `nil` gas → estimator starves callback | Chain | Blocker | ✅ **Fixed** `e28367b6` | Explicit `callbackGasLimit + 50_000`. Measured against the most demanding callback that fits each limit: needed buffer 0 @200k, 21,771 @500k, 15,394 @1M — ≥2× headroom |
| **N3** | Read votes not gasless | Chain | Blocker (econ) | ✅ **Fixed** `47a25eed` | `MsgVoteReadResult` in `GaslessMsgTypes` |
| **N4** | No affordability gate; free validator work | Chain | Blocker (econ) | ❌ **Unfixed — widened by C3** | Fee still 0 on every domain incl. `web2:https`; `blockedDomains` empty; `cosmos:foo`, `eip155:999999` and `web2:https` all accepted live for free |

## Still open — with the action

**1. N4 — set a non-zero `readBaseFee` before enabling publicly.** Config only, no code.
Before the C3 fix, an unconfigured destination had height 0 and was rejected by the guard — an
accidental allow-list. The heightless branch now accepts any unknown destination at
`blockNumber=0`. For a nonsense chain that is cheap (validators resolve no handler, vote an
error). For `web2:https` it is the first time the "every validator fetches an attacker-chosen
URL for the cost of one tx" vector is *reachable*. N3 removed the per-vote gas cost, which
narrows it, but the external work and unbounded on-chain state remain. Affordability gate in
`AllPendingReadRequests` can follow; the fee cannot wait.

**2. N1 CEA path — decide if in scope.** `CallExecuteUniversalTx` is used by both
`execute_inbound_funds_and_payload.go:244` and `execute_inbound_gas_and_payload.go:239` for
CEA-originated inbounds whose recipient is a Push contract. It needs the same
`IngestReadRequests` hand-off, or a CEA-driven tx that hits a read-requesting app strands
its budget exactly as N1 did.

**3. C6 — needs a yes/no on nested reads.** Zartaj's question in the thread got no answer.
If yes, two changes, not one:
- Contract: a separate reentrancy guard for `requestExternalReadSelf` (option b). Prefer it
  over removing the guard — the protocol-fee push to VaultPC is an external call.
- Node: a nested `ReadRequested` is emitted *inside the module's own fulfil call*
  (`callAsModule → DerivedEVMCallWithData`). The N1 fix added ingest to uexecutor's
  `CallUEAExecutePayload` only; the ucallback fulfil path has none. Removing the guard alone
  would let the nested request through the contract and strand its budget.

If no, say so in the docs — read → callback → read is the obvious composition and it fails
silently today.

**4. Status semantics — document them.** From the bool discussion in the thread: the node
does not need a callback-success signal, and none was added. Correct for the module's
lifecycle. But `ballot_hooks.go:143-146` sets `FULFILLED` whenever the outer call returns
cleanly — including when the app's callback reverted and `CallbackFailed` was swallowed.
`FAILED` (line 165) is set only for `CallAlreadySettled`. So **`FULFILLED` does not mean
delivered.** The only signal is the `CallbackFailed` log in the fulfil tx (`pcTx[].txHash`).
Consumers — SDK, explorer, app ops — must parse it. The API reference's definition of
`FAILED` was wrong on this point and has been corrected.

**5. C7 — rename or re-key.** Low urgency, but it is the trap that silently reintroduces N4
when someone sets the fee following house convention.

**6. C5 — design choice, now genuinely latent.** With refunds on a fixed 150k, only a
recipient that actively rejects loses its budget to the rescuable pool. A pull-based
`withdrawRefund` still removes the leak entirely; not a blocker.

## Resolved from the thread

- **Bool return on `fulfillExternalCallback`** — not needed. See item 4 for the documentation
  consequence.
- **`reportCallbackGas` retry** — module calls it once with no retry (Nilesh), so contract-side
  recovery was correct. Admin-or-module modifier landed and is what's deployed. One realistic
  revert cause does exist: `_refund` forwards all remaining gas to `revertRecipient` with no
  cap (`:290`), and the module gives `reportCallbackGas` a fixed 150k, so a gas-burning
  `receive()` can leave the outer with too little to emit `RefundFailed`. Admin retry covers
  it — admin passes any gas — so it is a manual-ops case, not fund loss.

## Deployment state

- Contracts: fixes on `feat-read-state@f8d1a0c`, deployed to Donut. **Not merged to `main`.**
- Node: fixes on `develop@7024bb4b`, also on `release/v1.1.42-donut` and `testnet/donut`.
  Donut is running the tag that contains them.
- No stranded funds from the pre-fix window: `totalEscrowed = 0`, contract balance `0`.
- **Live end-to-end verified 2026-09-09 15:50 UTC+5:30.** Two real reads through the validator
  set (`0xeba3eb9e…`, `0xf3d62fb9…`): request → ingest → quorum → fulfil → settle → refund in
  12 s each. Read 2 returned the exact Sepolia balance at the pinned block. C1, N1 (UEA path
  untested — request came from an EOA), N2 (callback saw ~193.5k of a 200k limit) and N3 all
  exercised for real. Details in `read-state-sdk-spec.md` § Verified live.

## Reference test file

`push-chain-core-contracts/test/fork/ForkReadStateFixVerification.t.sol` — **13 tests, all
passing** against live Donut. Skips cleanly without the RPC var.

```bash
cd push-chain-core-contracts
export PUSH_CHAIN_TESTNET_RPC_URL=https://evm.donut.rpc.push.org/
forge test --match-path test/fork/ForkReadStateFixVerification.t.sol -vv
```

| Test | Asserts |
|---|---|
| `C1_Fixed_*` (3) | bare namespace accepted; above-height rejected; old CAIP-2 workaround rejected |
| `C3_Fixed_*` (2) | web2 accepted at 0; rejected at non-zero |
| `C4_Fixed_AdminCanSettleExecuted` | `EXECUTED → SETTLED` via admin; random caller rejected |
| `C4_DeployedImplUsesUvcallbackAdminRole` | settles with `UVCALLBACK_ADMIN_ROLE` only — merged version live |
| `C5_StillPresent_*` | rejected refund lands in rescuable pool |
| `C6_StillPresent_*` | chained read reverts with reentrancy error |
| `N2_Boundary_*` (2) | buffer holds for the most demanding callback at 200k/500k/1M; measures needed buffer |
| `N4_Regression_*` | unconfigured destinations accepted for free |
| `Envelope_MustBeSingleTupleNotThreeParams` | query must be `abi.encode` of ONE tuple — the shape validators decode; caught by the first live read |

The two original repro suites (`ForkReadStateHeightKey.t.sol`, `ForkReadStateBlockers.t.sol`)
were deleted on 2026-09-09. They now failed in exactly the pattern the fixes predict — the C1
and web2 "must revert" assertions failed, and everything staged via the CAIP-2 workaround
failed because that workaround is now correctly rejected — and the verification file carries
regression guards for everything they covered.

---
---

# Original findings — 2026-09-08

Kept as the record the fixes were made against. Each section carries a status line; the
detail below it describes the defect as originally found.

## Original summary

| # | Defect | Owner | Severity | Evidence |
|---|---|---|---|---|
| **C1** | Chain-height lookup uses the bare namespace; oracle writes full CAIP-2 → every request reverts | Contracts | **Blocker** | ✅ test |
| **C2** | `fulfillExternalCallback` swallows callback failure → blinds the node's gas estimator | Contracts | **Blocker** | ✅ test |
| **C3** | Web2 destinations can never satisfy the height guard; no admin path exists | Contracts | **Blocker** (web2) | ✅ test |
| **C4** | `EXECUTED` is an unrecoverable terminal state; budget lost | Contracts | Latent | ⚠️ audit |
| **C5** | Failed refund pushes become admin-sweepable | Contracts | Latent → **active once C2 fires** | ⚠️ audit |
| **C6** | A callback can never chain a follow-up read (shared reentrancy guard) | Contracts | Latent | ⚠️ audit |
| **C7** | `readBaseFeeByChainNamespace` split-key diverges from every sibling mapping | Contracts | Latent | ⚠️ audit |
| **N1** | Reads requested from a Universal Account are never ingested; budget locked | Chain | **Blocker** | ✅ traced + test |
| **N2** | `nil` gas limit hands fulfilment to the estimator, which under-funds the callback | Chain | **Blocker** | ✅ traced |
| **N3** | `MsgVoteReadResult` is not gasless — validators pay per read vote | Chain | **Blocker** (econ) | ✅ verified |
| **N4** | No affordability filter before validators execute a read → free work amplification | Chain | **Blocker** (econ) | ⚠️ audit |

**Severity:**

- **Blocker** — the feature does not work at all until this is fixed.
- **Blocker (econ)** — the code is correct and does what it was written to do, but the
  cost falls on the wrong party. Nothing fails a test; the feature is simply unsafe to
  enable publicly.
- **Latent** — a real bug in shipped code that cannot fire today, because reads never reach
  the path that triggers it. These become live bugs the day C1 and N1 land.

---

# Part A — Contract defects

Repo: `push-chain-core-contracts`, branch `feat-read-state`.

## C1 — Chain-height lookup key mismatch · BLOCKER

**Status (2026-09-09): ✅ Fixed in `82e982b`, deployed, verified live.** The lookup now uses
`string.concat(chainNamespace, ":", chainId)` exactly as recommended, and all four test
files' mock call sites were updated. *Note: the "useful side effect" originally described
below — the height guard doubling as a destination gate — no longer holds after the C3 fix.*

`UniversalCallback.sol:113-118` read the destination-height ceiling with the **bare
namespace**:

```solidity
spec.blockNumber == 0
  || spec.blockNumber > _universalCore.chainHeightByChainNamespace(spec.account.chainNamespace)
      // ^ passed "eip155"
```

But `x/uexecutor/keeper/chain_meta.go:173` writes that mapping via
`CallUniversalCoreSetChainMeta(ctx, observedChainId, …)` where `observedChainId` is the
**full CAIP-2 id**. `UniversalCore.sol:72` is a single-level `mapping(string => uint256)`,
so these were different slots.

Measured on Donut before the fix:

| key | height |
|---|---:|
| `eip155:11155111` | 11,522,631 |
| `solana:EtWTRABZ…` | 485,449,700 |
| `eip155` | **0** |
| `solana` | **0** |

With the ceiling at zero, `blockNumber == 0` reverted and `blockNumber > 0` reverted. There
was no valid input. Confirmed with a 1024-run fuzz over the full `uint64` range.

**Why the unit tests missed it.** `test/mocks/MockUniversalCore.sol` was seeded on the bare
namespace, so the mock agreed with the reader rather than the real writer. Commit
`eb8c3b1 "fixes"` added the height check **and** the mock getter in the same commit.

## C2 — Callback failure is swallowed, blinding the gas estimator · BLOCKER

**Status (2026-09-09): ⬇️ Neutralised by N2. Contract unchanged.** The team decided not to
add a `returns (bool)` — correct, the node does not need it. See "Still open" item 4 for the
status-semantics consequence.

Paired with **N2**; either side alone would be harmless.

`fulfillExternalCallback` catches the callback's failure and returns normally
(`UniversalCallback.sol:203-211`): a sub-call OOG leaves `success = false`, emits
`CallbackFailed`, and the outer transaction completes with no `VmError`.

The node ran the whole fulfilment at *estimated* gas (see N2), and the estimator's only
failure signal is a top-level `VmError`. So the binary search converged on "just enough for
the outer frame to survive a **failed** inner call" — not on the app's declared
`callbackGasLimit`.

Measured on the fork before the fix. A correct fulfilment cost **347,827 gas**:

| outer gas | outer call | callback |
|---:|---|---|
| 250,000 | reverted | starved |
| **300,000** | **OK** | **starved** |
| **350,000** | **OK** | **starved** |
| 400,000 | OK | ran |

At 300k the outer call returned cleanly while the callback OOG'd and the request went
terminal as `EXECUTED`. Fee spent, data never delivered, no error surfaced anywhere.

## C3 — Web2 reads can never pass validation · BLOCKER (web2 only)

**Status (2026-09-09): ✅ Fixed in `c603558`, deployed, verified live.** Heightless
namespaces are accepted at `blockNumber == 0`. *This is what widened N4 — see "Still open"
item 1.*

The same height guard had no exemption branch. For a web2 destination the node expects
`chainNamespace == "web2"` (`universalClient/externalchains/web2/read_executor.go:29`), but
`chainHeightByChainNamespace` is written **only** by `setChainMeta`, which is `onlyUEModule`
(`UniversalCore.sol:394`), and its only caller is the chain-meta oracle driven by votes on
**configured external chains**. There is no web2 chain-meta voter, and no admin path.

Verified on Donut: height was `0` for `web2`, `web2:https` and `https`; a non-module caller
invoking `setChainMeta("web2", …)` reverted.

## C4 — `EXECUTED` is an unrecoverable terminal state · LATENT

**Status (2026-09-09): ✅ Fixed in `6fc7a18` + `46b56c1`, deployed, verified live.**
`reportCallbackGas` is now gated `onlyUCallbackModuleOrAdmin` using `UVCALLBACK_ADMIN_ROLE`.
Confirmed the deployed version is the post-merge one by settling with an address holding
only that role.

If `fulfillExternalCallback` succeeded but `reportCallbackGas` failed, the node still marked
the read `FULFILLED` (`ballot_hooks.go:153-160`), removing it from `PendingByExpiry` so
nothing retried. On the contract the request sat at `EXECUTED`, where `expireExternalRead`
required `PENDING`, nothing called `reportCallbackGas`, and `rescueNativePC` excluded it
because `totalEscrowed` still counted it. Nilesh confirmed in the thread that the module
calls `reportCallbackGas` exactly once with no retry.

## C5 — Failed refunds become admin-sweepable · LATENT

**Status (2026-09-09): ⬇️ Back to genuinely Latent. Design unchanged.** Verified live that a
rejecting `revertRecipient` moves its budget to the rescuable pool. But N2 now gives
`reportCallbackGas` a fixed 150k, so `RefundFailed` is no longer routine — only a recipient
that actively rejects loses out.

`UniversalCallback.sol:289-296` treats a failed refund push as non-fatal and emits
`RefundFailed`. `totalEscrowed` has already been decremented, so the stranded PC lands in
`rescueNativePC`'s available pool. A pull-based `withdrawRefund(requestId)` credit would
remove this entirely.

## C6 — A callback cannot chain a follow-up read · LATENT

**Status (2026-09-09): ❌ Unfixed. No decision made.** See "Still open" item 3 — the fix is
contract **and** node.

`requestExternalReadSelf` and `fulfillExternalCallback` share the same `nonReentrant` guard
(`:107`, `:192`). An app whose `_onReadResult` issues a follow-up `_requestRead` gets
`ReentrancyGuardReentrantCall`, swallowed into `CallbackFailed`. Read → callback → read is
the obvious composition pattern and it is silently impossible.

## C7 — `readBaseFee` split-key diverges from house convention · LATENT

**Status (2026-09-09): ❌ Unfixed.**

`readBaseFeeByChainNamespace` is internally consistent but is the **only** mapping in
`UniversalCore` that splits the CAIP-2 id; every sibling takes the joined form. An admin
following house convention calls `updateReadBaseFeeByChain("eip155:11155111", "", fee)`,
the lookup returns **0**, and reads become free with no revert — silently arming **N4**.

---

# Part B — Chain defects

Repo: `push-chain`, branch `develop`.

## N1 — Reads from a Universal Account are never ingested · BLOCKER

**Status (2026-09-09): ⚠️ Half-fixed in `d4ef66db`, deployed.** The UEA path is correct:
`CallUEAExecutePayload` calls `IngestReadRequests` on its response, inside the cacheCtx that
`execute_payload.go` commits only on success — so ingest persists exactly when the payload
does. **The CEA→contract inbound path (`CallExecuteUniversalTx`, `evm.go:868`) was not
covered** and still strands budgets. No recovery path was added for reads stranded before
the fix; moot on Donut (`totalEscrowed = 0`) but a gap elsewhere.

`IngestReadRequests` was driven **only** by `EVMHooks.PostTxProcessing`
(`x/ucallback/keeper/evm_hooks.go:32-49`). Traced:

```
x/uexecutor/keeper/evm.go:190→221   CallUEAExecutePayload → DerivedEVMCall
x/vm/keeper/call_evm.go:230         DerivedEVMCallWithData → ApplyMessageWithConfig
x/vm/keeper/state_transition.go:275 the ONLY production PostTxProcessing call site,
                                    inside ApplyTransaction (declared :197)
```

`DerivedEVMCall*` never reaches `ApplyTransaction`, so hooks never fire. A UEA-driven read
succeeded on-chain — fee to VaultPC, budget escrowed, `ReadRequested` emitted — and
`x/ucallback` never saw it. Reproduced on the fork: the budget was unreachable by the
requester, by the module (no record), and by admin (`rescuable: 0`).

## N2 — `nil` gas limit hands fulfilment to the estimator · BLOCKER

**Status (2026-09-09): ✅ Fixed in `e28367b6`, deployed, measured.** `callAsModule` now takes
an explicit limit: `callbackGasLimit + 50_000` for fulfil, fixed 150k for expire and report.
Against the most demanding callback that fits each limit, the buffer actually needed was 0
@200k, 21,771 @500k, 15,394 @1M — the 50k gives ≥2× headroom even when an app burns its
whole budget.

`x/ucallback/keeper/evm.go:88-93` passed `nil`, and `call_evm.go:168-186` turns
`commit && gasLimit == nil` into `EstimateGasInternal`, whose only failure signal is
`len(rsp.VmError) > 0`, with `BinSearch` returning the smallest non-failing gas. Because the
contract swallows callback failure (C2), the search landed in the starvation band. The
production `nil` path was never exercised — `lifecycle_e2e_test.go:155` passed an explicit
`500_000`.

## N3 — `MsgVoteReadResult` is not gasless · BLOCKER (economic)

**Status (2026-09-09): ✅ Fixed in `47a25eed`, deployed.** `MsgRetryReadExpiry` was not added;
it is admin-only, so that is fine.

`app/txpolicy/gasless.go` listed every other validator vote type but did not import
`ucallbacktypes` at all. Validators paid a flat `500000000000000upc` per read vote.

## N4 — No affordability filter before validators execute · BLOCKER (economic)

**Status (2026-09-09): ❌ Unfixed, and widened by the C3 fix.** Not discussed in the thread.
See "Still open" item 1 for the minimum action.

`AllPendingReadRequests` (`x/ucallback/keeper/query_server.go:45-72`) applies **no
affordability filter**. Validators fetch, execute the read against the destination, and
vote — *before* anything checks whether the budget covers the callback. Then `FulfilRead`
finds `!affordable` and does nothing.

With a zero protocol fee, an attacker emits many zero-budget requests for tx gas only.
`universalClient/externalchains/web2/read_executor.go:41-48` carries a `TODO(core)` naming
exactly this. Before the C3 fix, unconfigured destinations were rejected by the height guard
as a side effect; that gate is now gone.

---

# Verified clean — please don't re-investigate

Checked directly; all correct. Unchanged by the fixes.

- **`ReadRequested` ABI, field order and topic0** — matches `read_event.go:30-56`
  field-for-field.
- **`callback_abi.go` function and custom-error signatures** — match the compiled artifact;
  selectors derived from the ABI, cannot drift.
- **Module address gating** — `authtypes.NewModuleAddress("ucallback")` =
  `0x07a0258D…`, matching the hardcoded immutable.
- **Reentrancy and state ordering** — status written before the external call; `_pending`
  deleted and `totalEscrowed` decremented before `_refund`.
- **Escrow arithmetic** — incremented once, decremented exactly once per request.
- **Expiry boundary** — sweeper, contract, query and vote all agree on the same instant.
- **Upgrade/initialization safety** — `_disableInitializers()`, OZ v5 namespaced storage,
  append-only layout.
- **Ballot key construction** — domain-separated, excludes validator-local strings.
- **Chain-meta oracle freshness** — lag against real Sepolia measured at **0 blocks**.
- **Post-C1 chain coverage** — all five configured Donut chains have populated heights.

---

# Before enabling — checklist

- [ ] **Set `readBaseFee` per supported domain.** Still zero on every Donut pair on
      2026-09-09, including `web2:https`. **This is now the single most important item** —
      see "Still open" 1. Mind **C7** when choosing the key.
- [ ] **Issue the new authz grant to every universal validator** for
      `/ucallback.v1.MsgVoteReadResult`. `grant_verifier.go:133-140` hard-errors on a
      missing grant.
- [ ] **Land the `read-state` upgrade handler on `develop`.** Was on `testnet/donut` and
      the release branch only; not re-checked on 2026-09-09.
- [ ] **Merge `feat-read-state` to `main`.** Fixes are deployed but the branch is unmerged.
- [ ] **Commit a `UniversalCallback` deploy/upgrade script.** Donut was upgraded manually
      twice now; localnet and fresh-genesis chains still get placeholder bytecode.

# Known Failures in docs-examples — Session Log 2026-04-16

Snapshot of what's failing, why, what's fixed, and what still needs external action. Come back to this when resuming.

## Short story

After this session's SDK fixes, **4 tests still fail** — but none of the remaining failures are SDK bugs. Three are blocked on pSOL/WPC pool calibration (contracts team), and one on chain-side SVM inbound handling for fresh-key / lazy-UEA (chain-infra team).

---

## What was fixed this session

**`packages/core/src/lib/orchestrator/internals/cascade.ts`**
1. **Line ~224** — stale 1-wei `burnAmount` for SVM payload-only cascade hops → `0n`. Was causing `InsufficientBalance (0xf4d678b8)` reverts from `PRC20._transfer` on UEAs holding zero pSOL. The UGPC upgrade (2026-03-19) removed this workaround everywhere else but missed this branch.
2. **`composeCascade` made async + per-SVM pool-price `nativeValueForGas`**. Mirrors single-hop SVM (`executeUoaToCeaSvm` in `route-handlers.ts:717-729`). The flat `(ueaBalance − 3 PC) / numOutbounds` split worked for pBNB but massively under-priced pSOL swaps. Now calls `estimateNativeValueForSwap` per SVM segment, caps externally at `(ueaBalance − EVM reservation − 1 PC safety) / svmSegments`.

**Regression checks passed**: `route3_native`, `execute_transactions_fund_and_call` (both BNB-only / single-hop Solana paths) still green.

---

## The 4 failing tests

| # | Test | File | Why | Owner |
|---|---|---|---|---|
| 1 | `execute_transactions_counter` | `08-multichain-transactions/multichain-transactions.spec.ts:119` | pSOL pool | Contracts |
| 2 | `execute_transactions_batch` | `08-multichain-transactions/multichain-transactions.spec.ts:345` | pSOL pool | Contracts |
| 3 | `execute_transactions` (AMM) | `08-multichain-transactions/multichain-transactions.spec.ts:178` | pSOL pool + test approval likely | Contracts + test |
| 4 | `send_transaction_solana_basic` | `06-send-universal-transaction/send-universal-transaction.spec.ts:73` | Fresh-key / lazy-UEA SVM inbound | Chain-infra |

---

## Tests 1, 2, 3 — pSOL/WPC pool is mispriced on Donut testnet

### Empirical data from the SDK's pool-price read (session 2026-04-16)

```
Solana outbound gasFee   = 500000000 pSOL wei
gasToken (pSOL)          = 0x5D525Df2bD99a6e7ec58b76aF2fd95F39874EBed
Pool-price estimatedWpc  = 872914160099923035220  (≈ 872.9 PC, 2× buffer)
Raw pool-price estimate  ≈ 436 PC
Test funds UEA with      = 5 PC
```

The pSOL/WPC pool is **~100× too expensive**. The tests can never pass at 5 PC — the Uniswap V3 `exactOutputSingle` for PC→pSOL reverts `STF` (SafeTransferFrom — insufficient WPC input to cover the swap).

### Compare to BNB

`execute_transactions_fund_and_call` (Push+BNB cascade) passes at 1 PC, because pBNB's pool price is healthy. The ratio between pSOL/WPC and pBNB/WPC is ~500× off.

### Unblock options

1. **Contracts team — recalibrate pSOL/WPC pool** on Donut (seed more liquidity, or fix the initial price ratio). Primary fix.
2. **Quick workaround (not applied)**: bump `fundUeaPC` from `'5'` to `'1000'` for the 3 Solana cascade tests. Master PC wallet has 4308 PC (as of session snapshot) — enough for ~4 runs before refill. Not worth burning testnet PC while root cause is a pool miscalibration.

### Extra caveat for Test 3 (`execute_transactions` AMM→Solana)

Two separate issues in this test:

- **(a)** hop1 `exactInputSingle.recipient` was `account.address` (Sepolia EOA). **Fixed this session** at line 248 → now `client.universal.account as '0x${string}'` so pSOL lands on the UEA.
- **(b) Possible follow-up (unverified)**: hop1 is a raw router call with no `pETH.approve(router, AMOUNT_IN)` multicall beforehand. The cascade likely does not auto-insert ERC20 approvals for Route-1 payload hops. If this surfaces after the pool is fixed, prepend an approval multicall. Don't add speculatively — wait for the actual revert.

---

## Test 4 — `solana_basic` — fresh-key / lazy-UEA SVM inbound drops

### Symptom

Progress hook reaches "Gas Funding Confirmed" (Solana deposit observed on origin chain), then silence. SDK polls `queryUniversalTxStatusFromGatewayTx` for 15 retries (~2.5 min) looking for a UniversalTx record on Push Chain. Record never appears; `extractPcTxAndTransform` throws.

### Key finding from this session

Ran the existing SVM inbound suite `__e2e__/svm/inbound/uea-to-push.spec.ts` — **11 of its 21 tests passed cleanly** (the other 10 failed on master-wallet SOL shortage or transient external DNS, not the same pattern). These tests cover the same flow but with the **master Solana keypair**, whose UEA is pre-deployed on Push Chain.

The SDK path is identical for master and fresh. The only difference is whether the destination UEA on Push is already deployed.

### Repro added to this repo

`packages/core/__e2e__/svm/inbound/uea-to-push.spec.ts` section `22. Fresh-Key Repro (solana_basic pattern)` — `Keypair.generate()` + `fundSolanaUoa` + identical `sendTransaction({ to: RECIPIENT, value: 0.001 PC })` as `solana_basic`. Currently set to `0.013` SOL funding due to tight master-wallet budget (verbatim spec uses `0.02`); when running fresh, revert this to `0.02` to match exactly.

**To run**:
```bash
cd packages/core
npx jest __e2e__/svm/inbound/uea-to-push.spec.ts -t "Fresh-Key Repro" --forceExit
```
Requires master Solana devnet wallet (`3nK8X1re4zLNrgz9Y3xKS4g2fKPJ6M3N9BhNuFfkjwAb`) to have ≥0.02 SOL. This session hit a persistent public-devnet `requestAirdrop` rate limit from this IP — a browser faucet or different-IP airdrop unblocks it.

### Code paths verified as correct (not the bug)

| Concern | File:line | Verdict |
|---|---|---|
| Lazy UEA deploy exists for SVM inbound | `push-chain/x/uexecutor/keeper/execute_inbound_gas_and_payload.go:121-149` and `execute_inbound_gas.go:74-100` | ✓ Present, records deploy pcTx |
| Factory `deployUEA` needs no pre-verification | `push-chain-core-contracts/src/uea/UEAFactory.sol:162-191` | ✓ Pure CREATE2 clone |
| `UEA_SVM.initialize` is plain state-set | `push-chain-core-contracts/src/uea/UEA_SVM.sol:62-73` | ✓ No external calls |
| UE module bypasses UEA signature check | `UEA_SVM.sol:143-153` | ✓ Chain-triggered payloads don't need a signature |
| SVM event listener handles `send_funds` (the gateway's `UniversalTx` event discriminator) | `push-chain/universalClient/chains/svm/event_listener.go:67-72` | ✓ Handled |
| Inbound ballot + vote creates UTX only after finalization | `push-chain/x/uexecutor/keeper/msg_vote_inbound.go:40-107` | ✓ |

### Hypotheses ranked (H1 best matches the "silent drop → 2.5 min timeout" signature)

**H1 — Validator vote quorum not reached for fresh-UEA SVM events** (MOST LIKELY)
- Only failure mode that produces silent drop (not a FAILED pcTx).
- Look at: validator-side observation/confirmation filters. Is `event_confirmer.go` filtering by destination UEA existence? Do enough validators observe the Solana tx?
- Instrument: `universalClient/chains/common/event_processor.go:198 processInboundEvent` and `x/uexecutor/keeper/msg_vote_inbound.go:60 VoteOnInboundBallot` with fresh-key event.

**H2 — `DeployUEAV2` reverts (e.g. SVM registration missing)**
- Factory's `getVMType(chainHash)` + `UEA_VM[vmHash]` must both be set for Solana (`UEAFactory.sol:170-177`). If SVM chain's registration was dropped in a recent upgrade, `deployUEA` reverts with `InvalidInputArgs()`.
- Would produce FAILED pcTx, not silent drop — **less likely**. Easy to verify: `eth_call` factory's `getVMType(keccak256(abi.encode("solana", "EtWTRABZaYq6iMfeYKouRu166VU2xqa1")))` on Donut.

**H3 — `StoreVerifiedPayloadHash` → `CallUEADomainSeparator` fails on a just-deployed UEA**
- `push-chain/x/uexecutor/keeper/payload.go:76` calls `domainSeparator` on the UEA that was just deployed in the same tx. If state-commit ordering is wrong, the read might see uninitialized state.
- Would produce FAILED pcTx — less likely silent drop.

**H4 — SVM verifier stub path (`x/utxverifier/keeper/verify_tx_svm.go:74-94`) reached pre-write**
- Returns `"removed rpc calls"` when metadata isn't pre-stored. `StoreVerifiedPayloadHash` writes it during inbound execution; if any reader runs first, it fails. Unlikely in the normal flow but worth grepping for any early caller of `VerifySVMInboundTx`.

### Diagnostic procedure when resuming

Run `send_transaction_solana_basic` (or the fresh-key repro) with validator logs at DEBUG for modules: `uexecutor`, `utxverifier`, `universalClient/chains/svm`. Grep the log stream for these markers in order:

```
vote inbound received             ← if missing: validator observer/listener drop (H1)
inbound ballot finalized          ← if missing: quorum not reached (H1)
execute inbound gas and payload   ← if present, we're past H1
UEA not deployed, deploying now   ← fresh-key path entered
DeployUEAV2                       ← if "failed", H2
GetPayloadHashEVM / CallUEADomainSeparator  ← if "failed", H3
StoreVerifiedInboundTx            ← write completes
removed rpc calls                 ← if seen, H4
```

A single run against the fresh-key repro with these logs surfaced should pin the hypothesis to one in a single sentence.

---

## Artifacts left in the repo this session

1. `packages/core/src/lib/orchestrator/internals/cascade.ts` — the two SDK fixes described above
2. `packages/core/__e2e__/docs-examples/08-multichain-transactions/multichain-transactions.spec.ts:248` — hop1 recipient fix for Test 3
3. `packages/core/__e2e__/svm/inbound/uea-to-push.spec.ts` — "22. Fresh-Key Repro (solana_basic pattern)" added at end; 0.013 SOL funding (change back to 0.02 before running to match the spec verbatim)
4. This doc: `packages/core/__e2e__/docs-examples/KNOWN_FAILURES.md`

---

## Quick recovery checklist (come-back-to-it)

- [ ] Top up master Solana devnet wallet `3nK8X1re4zLNrgz9Y3xKS4g2fKPJ6M3N9BhNuFfkjwAb` to ≥0.05 SOL (browser faucet at https://faucet.solana.com)
- [ ] Revert `uea-to-push.spec.ts` fresh-key repro funding from `0.013` to `0.02` to match `solana_basic` verbatim
- [ ] Ping contracts team about pSOL/WPC pool recalibration on Donut (Tests 1, 2, 3)
- [ ] Ping chain-infra about Test 4 with the H1–H4 list and diagnostic procedure above
- [ ] After pool is fixed, re-run Test 3; if it reverts with allowance error, add `pETH.approve(router)` multicall before hop1

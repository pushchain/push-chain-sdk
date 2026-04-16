# Known Failures in docs-examples — Session Log 2026-04-16

Snapshot of what's failing, why, what's fixed, and what still needs external action. Come back to this when resuming.

## Short story

After this session's SDK fixes, **3 tests still fail** — all blocked on pSOL/WPC pool calibration on Donut testnet (contracts team). No open SDK bugs, no open chain-infra items.

---

## What was fixed this session

**`packages/core/src/lib/orchestrator/internals/cascade.ts`**
1. **Line ~224** — stale 1-wei `burnAmount` for SVM payload-only cascade hops → `0n`. Was causing `InsufficientBalance (0xf4d678b8)` reverts from `PRC20._transfer` on UEAs holding zero pSOL. The UGPC upgrade (2026-03-19) removed this workaround everywhere else but missed this branch.
2. **`composeCascade` made async + per-SVM pool-price `nativeValueForGas`**. Mirrors single-hop SVM (`executeUoaToCeaSvm` in `route-handlers.ts:717-729`). The flat `(ueaBalance − 3 PC) / numOutbounds` split worked for pBNB but massively under-priced pSOL swaps. Now calls `estimateNativeValueForSwap` per SVM segment, caps externally at `(ueaBalance − EVM reservation − 1 PC safety) / svmSegments`.
3. **Three drained-UEA fallbacks** in `composeCascade` EVM OUTBOUND and SVM/EVM INBOUND branches — changed `gasFee * BigInt(1000)` to balance-aware `ueaBalance / numOutbounds`. Undersized fallback was sending 51x too little PC for the Uniswap V3 gas swap, surfacing as `STF` on cascades with drained UEAs.

**`packages/core/src/lib/orchestrator/internals/execute-standard.ts`**
4. **SVM payload encoding** — new `encodePayloadForOrigin(ctx, payload)` helper branches on `CHAIN_INFO[chain].vm === VM.SVM` and uses `encodeUniversalPayloadSvm` (Borsh) instead of `encodeUniversalPayload` (ABI) for SVM origins. The chain's `DecodeUniversalPayloadSolana` expects Borsh; the old ABI bytes produced `gasLimit=0` via misaligned offset reads → "intrinsic gas too low" on the post-deploy `executeUniversalTx` call. Master-UEA cases masked the bug because deployed UEAs take the `MsgExecutePayload` Cosmos path that bypasses the Solana gateway entirely.

**Regression checks passed**: `route3_native`, `execute_transactions_fund_and_call`, `send_transaction_solana_basic`, and the Fresh-Key Repro (`__e2e__/svm/inbound/uea-to-push.spec.ts` §22) — all green.

---

## The 3 failing tests

| # | Test | File | Why | Owner |
|---|---|---|---|---|
| 1 | `execute_transactions_counter` | `08-multichain-transactions/multichain-transactions.spec.ts:119` | pSOL pool | Contracts |
| 2 | `execute_transactions_batch` | `08-multichain-transactions/multichain-transactions.spec.ts:345` | pSOL pool | Contracts |
| 3 | `execute_transactions` (AMM) | `08-multichain-transactions/multichain-transactions.spec.ts:178` | pSOL pool + test approval likely | Contracts + test |

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

## Artifacts left in the repo this session

1. `packages/core/src/lib/orchestrator/internals/cascade.ts` — the three cascade fixes described above
2. `packages/core/src/lib/orchestrator/internals/execute-standard.ts` — the SVM payload-encoding fix (`encodePayloadForOrigin` helper)
3. `packages/core/__e2e__/docs-examples/08-multichain-transactions/multichain-transactions.spec.ts:248` — hop1 recipient fix for Test 3
4. `packages/core/__e2e__/svm/inbound/uea-to-push.spec.ts` — "22. Fresh-Key Repro (solana_basic pattern)" added at end; kept as a fast regression target for the SVM payload-encoding bug
5. This doc: `packages/core/__e2e__/docs-examples/KNOWN_FAILURES.md`

---

## Quick recovery checklist (come-back-to-it)

- [ ] Top up master Solana devnet wallet `3nK8X1re4zLNrgz9Y3xKS4g2fKPJ6M3N9BhNuFfkjwAb` to ≥0.05 SOL (browser faucet at https://faucet.solana.com)
- [ ] Ping contracts team about pSOL/WPC pool recalibration on Donut (Tests 1, 2, 3)
- [ ] After pool is fixed, re-run Test 3; if it reverts with allowance error, add `pETH.approve(router)` multicall before hop1

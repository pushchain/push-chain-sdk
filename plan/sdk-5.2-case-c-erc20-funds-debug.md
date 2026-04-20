# SDK 5.2 — Case C + ERC-20 funds: problem statement & solution options

**Status:** open question for product/contracts decision
**Branch:** `feat/sdk-5.2-gas-abstraction`
**Affected error class:** `GasExceedsCategoryCWithErc20FundsError`
**Last updated:** 2026-04-18

---

## TL;DR

The SDK currently throws a typed error when **all three** conditions hold:
1. Sizer classifies the tx as **Case C** (destination gas > $10)
2. User passes `funds` with a **non-native ERC-20 token** (e.g., USDT_BNB)
3. Tx is **Route 2** (UOA → CEA) or a cascade **OUTBOUND_TO_CEA segment**

This document captures the problem in detail and the 6 candidate solutions so a fresh debugger / decision-maker can pick a direction.

---

## Scope of the problem

### Routes affected vs unaffected

| Path | Affected? | Why |
|---|:-:|---|
| Route 1 (UOA → Push) | ❌ No | No outbound delivery, no Case C composition needed |
| **Route 2 (UOA → CEA)** | ✅ **YES** | Bridge-swap composition requires single-token outbound |
| Route 3 (CEA → Push) | ❌ No | R3 Case C only bumps `msg.value`; no destination funds-delivery semantic |
| Route 4 / cascade `OUTBOUND_TO_CEA` segment | ✅ **YES** | Same as R2 — uses bridge-swap composition |
| Cascade `INBOUND_FROM_CEA` segment | ❌ No | R3-style msg.value bump |

### User-input shapes affected (Route 2 only)

| Shape | Under Case C | Affected? |
|---|:-:|:-:|
| Funds (ERC-20 — e.g., USDT) | ✓ | ❌ **errors** |
| Payload alone | ✗ | ✅ works |
| Multicall alone | ✗ | ✅ works |
| Funds + Payload (ERC-20) | ✓ | ❌ **errors** |
| Funds + Multicall (ERC-20) | ✓ | ❌ **errors** |
| Native funds | ✗ | ✅ works (folds into native burn) |
| Native funds + Payload | ✗ | ✅ works |

**3 of 7 shapes affected, all involving ERC-20 funds.**

### When it fires in practice

- **Testnet donut**: never naturally — gas prices too low to reach Case C ($10+). The error doesn't fire today.
- **Mainnet**: only when destination chain gas spikes (e.g., congested ETH mainnet). Edge-case combo of "user bridges ERC-20 + happens to hit gas spike". Probably <1% of all txs.

---

## Why it errors — technical detail

### The Case C composition pattern (for non-funds and native-funds)

Today's working flow (`route-handlers.ts:executeUoaToCea` Case C branch):

1. Sizer returns `{ category: 'C', gasLegNativePc, overflowNativePc }`
2. SDK calls `buildBridgeSwapEntries(ctx, { overflowNativePc, destinationPrc20: prc20Token, ueaAddress })` to build 3 multicall entries:
   - `WPC.deposit{value: overflowNativePc}()` — wrap native PC → WPC
   - `WPC.approve(SwapRouter, overflowNativePc)`
   - `SwapRouter.exactInputSingle({tokenIn: WPC, tokenOut: prc20Token, ...})`
3. SDK calls `buildOutboundApprovalAndCall(...)` with `bridgeSwapEntries` + `extraBurnAmount = expectedPrc20Out`
4. The builder folds `extraBurnAmount` into the outbound's `burnAmount` and approve target
5. UEA executes the composed multicall: wrap → approve → swap → approve-zero PRC20 → approve-total PRC20 → `sendUniversalTxOutbound`
6. On Push Chain, `sendUniversalTxOutbound` burns `(originalBurn + swappedAmount)` of `prc20Token`
7. Destination CEA mints that amount to recipient

**This works because** there's exactly ONE PRC-20 token throughout: `prc20Token = swapTargetToken = burnToken`.

### What breaks for ERC-20 funds

When user passes `funds: { token: USDT_BNB, amount: 10 }`:
- `prc20Token = pUSDT_BNB` (mapped from user's funds.token)
- `burnAmount = 10 pUSDT_BNB` (user's intended bridge amount)
- Sizer Case C says "deliver $5 worth of overflow"

The `sendUniversalTxOutbound` interface accepts ONE `prc20Token` and ONE `burnAmount`. Two reasonable interpretations of "deliver overflow":

**Interpretation A** — overflow as destination native (matches spec literal reading):
- Need to burn pUSDT (10) + pBNB (overflow's worth) in the same outbound
- Contract takes only one PRC-20 → cannot atomically express both

**Interpretation B** — overflow as more user-USDT (matches "fold-in" mechanic):
- Swap WPC → pUSDT_BNB (instead of pBNB)
- Fold into existing pUSDT burn (`burnAmount = 10 + swappedPusdt`)
- User receives ~15 USDT on destination instead of 10
- Atomic, single PRC-20, no contract conflict — BUT user gets more than they asked for

The current SDK chose neither and throws `GasExceedsCategoryCWithErc20FundsError` to surface the decision.

### Code references

- Throw site (R2 EVM): `packages/core/src/lib/orchestrator/internals/route-handlers.ts:executeUoaToCea` Case C branch
- Throw site (R2 SVM): same file, `executeUoaToCeaSvm` Case C branch
- Throw site (cascade): `packages/core/src/lib/orchestrator/internals/cascade.ts:composeCascade` early scan loop
- Error class: `packages/core/src/lib/orchestrator/route-detector.ts:GasExceedsCategoryCWithErc20FundsError`
- Bridge-swap composer: `packages/core/src/lib/orchestrator/internals/bridge-swap-builder.ts:buildBridgeSwapEntries`
- Outbound builder with fold-in: `packages/core/src/lib/orchestrator/payload-builders.ts:buildOutboundApprovalAndCall` (opts: `bridgeSwapEntries`, `extraBurnAmount`)

### Contract-side facts (verified via repo scan)

- `UniversalCore.sol` has `refundUnusedGas(withSwap=true)` (L164-186) which swaps arbitrary PRC-20s — **no protocol-level block on Solution 1**.
- `sendUniversalTxOutbound(req)` takes `req.token` (single PRC-20) and `req.amount` (single burn amount) — no struct-level support for multi-token burn in one call.
- `swapAndBurnGas` (UniversalCore.sol:193-249) expects `msg.value` in native PC, swaps to `gasToken` (destination native PRC-20), burns it. This is the gas-payment side; orthogonal to the funds burn.
- WPC/pUSDT_* pools exist on testnet donut at fee tier 500 for all four EVM destination routes (verified via factory probe earlier).

---

## Solution catalogue

| # | Approach | Atomicity | UX | SDK effort | Contract effort | Recommendation |
|---|---|:-:|---|:-:|:-:|---|
| 1 | Swap overflow → user's ERC-20 (WPC → pUSDT), fold into existing pUSDT burn | ✅ atomic | User receives **more USDT than requested** ($10 → ~$15) | ~30 lines | none | ⭐ best for v1.1 if Harsh OK with UX |
| 2 | Two separate outbounds — funds burn (pUSDT) + overflow burn (pBNB) | ❌ non-atomic | User receives exact USDT + extra native BNB on destination | ~3-4 hrs | none | rejected — non-atomic, ugly polling |
| 3 | Pay gas in user's ERC-20 (pUSDT gas leg instead of PC) | ✅ atomic | Uniform token throughout | large | **needs contract changes** | rejected — too big |
| 4 | Keep error + add `splitCaseCTx()` SDK helper to auto-split into 2 user-side txs | ❌ non-atomic | Two signatures, two waits — explicit | ~1 hr | none | ⭐ nice-to-have UX polish alongside #6 or #1 |
| 5 | Silently cap funds + ignore overflow | ✅ atomic | **Destination may revert for out-of-gas (silent failure)** | ~5 lines | none | rejected — silent failure |
| 6 | Keep error as-is (current v1) | N/A | User must split tx manually or use native funds | 0 | none | ⭐ ship for v1; affects rare combo |

### Recommended path

- **v1 (ship now): Solution 6** — zero risk; affects only Route 2 + ERC-20 funds + Case C combo, which is rare on mainnet and impossible on testnet.
- **v1.1 (next cycle): Solution 1** — pending Harsh's confirmation that "user receives more USDT than requested" is acceptable UX.
- **Optional alongside either**: Solution 4 helper for users who want explicit two-tx split.

### The one-line decision needed from product

> **For Route 2 / cascade OUTBOUND_TO_CEA only**: is it acceptable UX for a user passing `funds: { amount: 10 USDT }` under Case C to receive **~$15 worth of USDT** on destination (Solution 1), or should we require exact amounts (Solution 2 / 4 / 6)?

Yes → ship Solution 1 in v1.1.
No → keep Solution 6 + maybe add Solution 4 helper.

---

## Implementation sketch — Solution 1 (if approved)

### Changes

**File: `bridge-swap-builder.ts`**
- Already accepts `destinationPrc20` parameter — no signature change needed
- Caller (route-handlers, cascade) passes `prc20Token` from user's funds (which is pUSDT_BNB) instead of hardcoded destination native

**File: `route-handlers.ts:executeUoaToCea` Case C branch**
- Remove the `if (fundsToken && fundsToken.mechanism !== 'native') throw` guard
- Always compose: `buildBridgeSwapEntries(ctx, { overflowNativePc, destinationPrc20: prc20Token /* may be pUSDT or pBNB */, ueaAddress })`
- The fold-in math in `buildOutboundApprovalAndCall` already handles any PRC-20 (it's a generic `approve(gateway, total)` + bump of `burnAmount`)

**Files: cascade.ts** — same change in the OUTBOUND_TO_CEA branch of `composeCascade`

**Files: tests** — flip the `gas-abstraction-scenarios.spec.ts` "C + ERC-20 throws" test to verify it composes successfully with extra USDT in burn

### Risks / caveats for Solution 1

- WPC/pUSDT_* pool liquidity may be thinner than WPC/pETH on mainnet. Slippage tolerance might need bump from 100 bps to 300 bps in the bridge-swap builder.
- User-facing surprise: `funds.amount` becomes a **floor** under Case C, not an exact amount. Must be documented in JSDoc + release notes.
- Mainnet pool depth on WPC/pUSDT pairs is unknown. Verify before mainnet launch.

---

## Verification status (current branch)

29 signed-tx e2e verifications passed on `feat/sdk-5.2-gas-abstraction`:

- 8 Case A (existing route2 suite)
- 13 Route 2 forced B/C (jest-mocked sizer)
- 2 Route 3 forced B/C
- 3 cascade forced B/B + B/C + ERC-20-rejection
- 3 live read-only smokes
- 140 unit tests across 6 suites (gas-usd-sizer, bridge-swap-builder, gas-abstraction-scenarios, payload-builders, cascade-composition, tx-transformer-gas)

The `GasExceedsCategoryCWithErc20FundsError` path is itself **verified** at unit + e2e level — it does throw correctly when the conditions are met. The question is whether to keep throwing or implement Solution 1.

---

## Files for the new agent to read first

1. `packages/core/src/lib/orchestrator/internals/route-handlers.ts` — Case C branch in `executeUoaToCea` (around the `GasExceedsCategoryCWithErc20FundsError` throw site)
2. `packages/core/src/lib/orchestrator/internals/cascade.ts` — early-scan reject in `composeCascade` + per-segment Case C composition in `OUTBOUND_TO_CEA` branch
3. `packages/core/src/lib/orchestrator/internals/bridge-swap-builder.ts:buildBridgeSwapEntries` — the composer that needs the `destinationPrc20` swap target
4. `packages/core/src/lib/orchestrator/payload-builders.ts:buildOutboundApprovalAndCall` — the builder with `bridgeSwapEntries` + `extraBurnAmount` opts (already token-agnostic)
5. `packages/core/src/lib/orchestrator/__tests__/gas-abstraction-scenarios.spec.ts` — has the "C + ERC-20 throws" test that would flip to "C + ERC-20 composes" under Solution 1
6. `packages/core/src/lib/orchestrator/route-detector.ts:GasExceedsCategoryCWithErc20FundsError` — the error class + JSDoc

## Related docs

- `plan/sdk-5.2-gas-abstraction.md` — full SDK 5.2 plan (Phase 0–4 + Addenda 1–5)
- `plan/sdk-5.2-case-c-contract-questions.md` — earlier contract-team questions (now mostly answered)

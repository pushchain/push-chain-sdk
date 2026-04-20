# SDK 5.2 — Gas Abstraction (Cases A / B / C)

## Context

**Problem.** For cross-chain transactions destined for an **external** chain (Routes 2, 3, 4), the SDK today sizes the native value sent to Push Chain's `sendUniversalTxOutbound` with a blind `gasFee * 1_000_000` buffer at `gas-calculator.ts:202`. That has nothing to do with the actual dollar cost of destination gas — it's a conservative over-send that `swapAndBurnGas` refunds the excess from. In effect, gas abstraction is not being enabled the way it is meant to be.

**Intended outcome.** Replace the hard-coded buffer with a USD-anchored sizing policy matching the product spec:

- **Case A — gas < $1**: floor to $1 (origin gateway already rejects below $1 via `MIN_CAP_UNIVERSAL_TX_USD`).
- **Case B — $1 ≤ gas ≤ $10**: happy path, send as-is.
- **Case C — gas > $10**: split into a $10 gas leg + an overflow bridged via the gateway's already-live multi-fund path (EVM `_sendTxWithFunds` Case 2.3 / SVM `handle_*_funds_route`).

Routes that target Push Chain (Route 1) already use USD-based sizing ($1–$1000 caps in `execute-funds-payload.ts:118-126`) and remain unchanged.

**Alignment with contracts.** Origin gateways already enforce $1/$10 USD caps via Chainlink (EVM) and Pyth (SVM); multi-fund bridge (Edge Case 1) is already deployed. The $PC oracle does not exist on-chain — per Harsh's direction (2026-04-17), derive $PC/USD from the per-route WPC/stable Uniswap V3 pool on Push Chain (WPC/USDT.eth or USDC.eth for Ethereum routes, WPC/USDT.sol or USDC.sol for Solana routes), pool pair pending Zaryab/Zartaj confirmation.

## Recommended approach

### Phase 0 — Oracle + sizer primitives (new files)

1. **`packages/core/src/lib/orchestrator/internals/pc-usd-oracle.ts`** — new.
   - `getPcUsdPrice(ctx, originChain): Promise<bigint>` (returns PC price in 8-dec USD, aligned with `PriceFetch`).
   - Config map keyed by `CHAIN` → `{ quoteToken: PRC20Address, decimals }`. Start with `USDT.eth` / `USDT.sol`; flip to USDC if Zaryab/Zartaj says so (one-line change).
   - Implementation reuses the existing QuoterV2 plumbing in `gas-calculator.ts:618` (`estimateNativeForDesiredDeposit`). Extract the quoter-read part into a private helper in the new file.
   - 30-second cache mirroring `price-fetch.ts:14`.
   - Deprecate `pushToUSDC` (`push-client.ts:95`) for oracle use; keep it only as the fallback when the pool quote fails.

2. **`packages/core/src/lib/orchestrator/internals/gas-usd-sizer.ts`** — new.
   - `sizeOutboundGas(ctx, { gasFee, gasToken, originChain, userValue }): Promise<SizingDecision>`
   - `SizingDecision = { category: 'A'|'B'|'C', gasLegNativePc: bigint, overflowNativePc: bigint, gasUsd: bigint, overflowUsd: bigint }`.
   - USD math: `gasUsd = gasFee * ethOrSolUsdPrice / 1e18` (ETH/SOL price from existing `PriceFetch.getPrice`).
   - Case A: pad to $1 by inflating swap input on the PC side.
   - Case C: clamp gas leg to $10 worth, route remainder to `overflowNativePc`.

### Phase 1 — Replace the 1M buffer (Cases A + B)

3. **`packages/core/src/lib/orchestrator/internals/gas-calculator.ts:148-206`** (`queryOutboundGasFee`).
   - Delete line 33 constant `GAS_FEE_BUFFER_MULTIPLIER` and line 202's `protocolFee + gasFee * 1_000_000`.
   - Call `sizeOutboundGas` → use `gasLegNativePc + protocolFee` as the new `nativeValueForGas`.
   - Log `category` and `gasUsd` for observability.

4. **`packages/core/src/lib/orchestrator/internals/gas-calculator.ts:335-382`** (`queryRescueGasFee`).
   - Same replacement; rescue path follows the same sizing rules.

### Phase 2 — Case C split + overflow bridge

5. **`packages/core/src/lib/orchestrator/payload-builders.ts:497`** (`buildOutboundApprovalAndCall`).
   - When `category === 'C'`: emit a **single multicall on PC** with two entries in one transaction:
     1. `sendUniversalTxOutbound` sized at exactly $10 worth of native PC (gas leg only).
     2. A WPC→destination-native swap on the PC Uniswap V3 pool + a gateway funds leg that rides alongside, carrying `overflowNativePc` as bridged funds.
   - Keeps atomicity (no split-state if leg 2 fails) and leverages the existing multicall composition path.
   - Keep Cases A/B on the existing single-call path unchanged.

6. **`packages/core/src/lib/orchestrator/internals/cascade.ts:213-247`** — check cascade `burnAmount` computation; Case C changes what "funds" means. Touch only if a cascade crosses into Case C.

### Phase 3 — Progress hooks + types

7. **`packages/core/src/lib/progress-hook/progress-hook.types.ts`** — new hooks:
   - `SEND_TX_2xx_GAS_SIZE_A`, `_B`, `_C` (category resolved).
   - `SEND_TX_2xx_OVERFLOW_BRIDGE` (Case C split built).
   - Add to Routes 2, 3, 4 handlers at `route-handlers.ts` fire points.

8. **`packages/core/src/lib/orchestrator/orchestrator.types.ts`** — new error type `GasExceedsCategoryCError` guarded behind a capability flag if Case C proves harder than expected (contingency only).

### Phase 4 — Tests

9. **Unit tests** — `packages/core/src/lib/orchestrator/__tests__/gas-usd-sizer.spec.ts` (new).
   - Mock `pushClient.readContract` following the pattern in `tx-transformer-gas.spec.ts:105-124`.
   - Cases: $0.50 → $1 pad, $5 → pass-through, $50 → split into $10 + $40 overflow.
   - EVM (Ethereum Sepolia) + SVM (Solana Devnet) paths.

10. **E2E** — extend `packages/core/__e2e__/push/route2-fresh-wallet-gas-bug.spec.ts` and `__e2e__/docs-examples/07-transaction-scenarios/route2.spec.ts`.
    - Force Case C with `execute({ gasLimit: 1_000_000n })` — destination gas will exceed $10 with that limit.
    - Assert outbound receipt shows both a gas leg and a funds leg.

## Critical files

| File | Change |
|------|--------|
| `packages/core/src/lib/orchestrator/internals/pc-usd-oracle.ts` | **new** — per-route WPC/stable pool reader |
| `packages/core/src/lib/orchestrator/internals/gas-usd-sizer.ts` | **new** — A/B/C categorizer |
| `packages/core/src/lib/orchestrator/internals/gas-calculator.ts` | replace 1M buffer, integrate sizer (L148-206, L335-382) |
| `packages/core/src/lib/orchestrator/payload-builders.ts` | split-call for Case C (L497) |
| `packages/core/src/lib/orchestrator/internals/cascade.ts` | check burn amount path (L213-247) |
| `packages/core/src/lib/progress-hook/progress-hook.types.ts` | new SEND_TX_2xx hooks |
| `packages/core/src/lib/orchestrator/__tests__/gas-usd-sizer.spec.ts` | **new** — unit tests |
| `packages/core/__e2e__/push/route2-fresh-wallet-gas-bug.spec.ts` | extend for Case C |

## Reuse (don't re-invent)

- `PriceFetch` (`price-fetch.ts`) — ETH/USD, SOL/USD via Chainlink/Pyth. 30s cache, TTL module-level.
- `estimateNativeForDesiredDeposit`, `estimateDepositFromLockedNative` (`gas-calculator.ts:618, :518`) — QuoterV2 plumbing for PC-side Uniswap V3 reads.
- `calculateNativeAmountForDeposit` (`gas-calculator.ts:388`) — Route 1's USD→native pattern; mirror its 1-unit precision bump.
- `SYNTHETIC_PUSH_ERC20` map (`chain.ts:75-91`) — already has `USDT_ETH`, `USDC_ETH`, etc. for testnet donut.
- Mock pattern: `orchestrator/__tests__/tx-transformer-gas.spec.ts:105-124`.

## Verification

**Unit:**
```
yarn nx test core --testPathPattern="gas-usd-sizer|tx-transformer-gas|payload-builders"
```

**Typecheck + lint:**
```
yarn nx typecheck core
yarn nx lint core
```

**E2E on testnet donut** (`PUSH_TESTNET_DONUT`, chain 42101 — quoter `0x8331...9037`, factory `0x81b8...b454` both live):
```
EVM_PRIVATE_KEY=... PUSH_PRIVATE_KEY=... \
  yarn nx test core --testPathPattern="route2-fresh-wallet-gas-bug|route2\\.spec|route3\\.spec"
```
- Case B probe: default gasLimit, assert `SEND_TX_2xx_GAS_SIZE_B` fires, nativeValueForGas within ±5% of quoted WPC.
- Case A probe: tiny gasLimit, assert padded to $1.
- Case C probe: `gasLimit: 1_000_000n`, assert `SEND_TX_2xx_GAS_SIZE_C` + `SEND_TX_2xx_OVERFLOW_BRIDGE` fire, outbound receipt shows split.

**Manual smoke:** `packages/core/scripts/poll-outbound.ts` to watch a testnet outbound finalize under the new sizing and confirm no refund path regression (`applyGasRefund` in push-chain Go still credits excess to UEA).

## Branching

- Branch: `feat/sdk-5.2-gas-abstraction` off `main`.
- Rebase against contract team's `gas-abstraction-implementation` branch before final PR if they land structural changes to `getOutboundTxGasAndFees` return shape.
- No SDK release until at least Phases 0, 1, 4 are green on testnet donut.

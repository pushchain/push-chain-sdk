# SDK 5.2 — Case C (overflow bridging) — contract questions

**Status:** ⏳ Blocking SDK Phase 2 (overflow bridging for gas >$10 scenarios)

## Context (TL;DR)

Per the SDK 5.2 gas-abstraction spec:

- **Case A** (<$1): SDK floors gas to $1 — ✅ shipped
- **Case B** ($1–$10): SDK passes gas through — ✅ shipped
- **Case C** (>$10): SDK caps gas at $10 and bridges the **overflow** as funds to the destination CEA — ⏸ needs contract guidance

For Case C, the SDK already computes:

```
gasLegNativePc    = $10 worth of PC  (goes into sendUniversalTxOutbound as msg.value)
overflowNativePc  = (gasUsd − $10) worth of PC  (needs to land on destination as native)
```

The blocker: `sendUniversalTxOutbound` today has no surface for "bridge X additional native destination token to the recipient alongside this payload." We need your call on the shape before we can wire Phase 2.

## The three questions

### Q1 — Shape of a funds-aware outbound

Three options we see; please confirm (a) / (b) / (c) or propose your own:

**Option (a) — Extend `UniversalOutboundTxRequest`**
```solidity
struct UniversalOutboundTxRequest {
    // ...existing fields...
    uint256 extraFunds;   // NEW — extra native destination token to mint for recipient
}
```
- **SDK work:** small (~1 day). Update ABI, encode in `buildOutboundRequest`, plumb `overflowNativePc` as `extraFunds` in `buildOutboundApprovalAndCall`.
- **Contract work:** extend the struct; relayer reads `extraFunds` and mints that amount on destination inbound.
- **Pro:** one event, atomic semantics, simplest for progress hooks and `wait()`.

**Option (b) — Sibling method**
```solidity
function sendUniversalTxOutboundWithFunds(
    UniversalOutboundTxRequest req,
    uint256 extraFunds
) external payable;
```
- Semantically identical to (a) but keeps the old struct stable.
- **Pro:** no ABI break for existing integrators.
- **Con:** two methods to maintain, two code paths on the relayer.

**Option (c) — Compose at UEA-multicall level**
UEA executes two multicall entries:
1. `UniversalCore.swapAndBridgeFunds(overflow, destChain, recipient)` — **new helper contract method** that swaps WPC → destination-native and queues a bridge to `recipient` on `destChain`
2. `sendUniversalTxOutbound(req)` with gas capped at $10

- **SDK work:** larger (~2–3 days). New multicall entry, new helper ABI, coordination of two events.
- **Contract work:** add `swapAndBridgeFunds` helper on UniversalCore.
- **Con:** two outbound events — non-atomic for the relayer unless explicitly linked.

**Our preference:** (a) — simplest end-to-end, atomic by construction. But we'll work with whatever you pick.

### Q2 — Who owns the overflow → destination-native swap?

The overflow is denominated in WPC. The destination expects pETH / pSOL / etc. Two sub-questions:

- Does UniversalCore expose a helper we can call that **swaps WPC → gas token and mints to the recipient's account on destination** (not burns)?
  - Today `swapAndBurnGas` swaps WPC → gasToken and *burns* the output (this is correct for gas; not for funds delivery).
  - We'd need a sibling like `swapAndMintForDestination(gasToken, amountOut, destChain, recipient)` — or is this already implicit inside the inbound/outbound machinery?
- If **option (a)** above: does the relayer, when it sees `extraFunds > 0`, automatically do the WPC → gasToken swap and mint on destination, or does the SDK need to pre-swap WPC → gasToken on Push Chain and pass the gasToken amount instead?

**SDK slight preference:** relayer-side swap, so SDK doesn't have to manage two different amounts (WPC + gasToken).

### Q3 — Atomicity + progress-hook UX

If the outbound gas leg succeeds but the funds bridge on destination fails (e.g., destination CEA reverts), what state does the user end up in? Three sub-concerns:

- **Is there a single outbound event that covers both legs?** This matters for our `wait()` polling in `response-builder.ts` and for the `SEND_TX_299_*` progress hooks. A single event = one clean success/failure signal.
- **On destination failure, is the overflow returned to the UEA?** Or stuck on destination? (Informs whether we need a rescue path and whether we should refuse Case C if the destination chain is known to be flaky.)
- **Gas-leg success + funds-leg failure** — does this state exist, or is it impossible by construction? If it exists, we need an error type + rescue flow. If it's impossible, that's a strong argument for option (a).

## What's already shipped on SDK side

Branch: `feat/sdk-5.2-gas-abstraction` (not yet merged)

- `pc-usd-oracle.ts` — per-route $PC/USD price from WPC/USDT.* Uniswap V3 pools on Push Chain. Falls back to `pushToUSDC` if pool missing.
- `gas-usd-sizer.ts` — A/B/C categorizer. For Case C, already returns `{category: 'C', gasLegNativePc, overflowNativePc, gasUsd, overflowUsd}`.
- `queryOutboundGasFee` (gas-calculator.ts) — integrates sizer; Case C currently falls back to the legacy `gasFee * 1_000_000` buffer (safe, swapAndBurnGas refunds excess) while we wait on your answers.
- Progress hooks: `SEND_TX_202_03_03` / `SEND_TX_302_03_03` already fire and carry `overflowNativePc` in the payload — UIs can already render the "will bridge X UPC as funds" state.
- Unit tests cover Case C categorization (`gas-usd-sizer.spec.ts`).

We've verified on testnet donut that:
- WPC/USDT.eth pool exists at fee 500 and returns ~$0.279 / PC (vs hardcoded $0.10 — 2.8× difference)
- WPC/USDT.* pools exist for ETH, ARB, BASE, BNB routes. **WPC/USDT_SOL missing** — SDK falls back to hardcoded rate for Solana origin. Pool deployment would be appreciated.

## Ask

Short async reply with answers (or pushback) to Q1/Q2/Q3 is enough to unblock us. Happy to jump on a 15-min call if easier. Goal: land Phase 2 in SDK 5.2 release cycle.

## Links

- SDK plan: `plan/sdk-5.2-gas-abstraction.md`
- Spec (Notion): SDK V4.0 (Core + UI Kit) — sendUniversalTx
- Branch: `feat/sdk-5.2-gas-abstraction`

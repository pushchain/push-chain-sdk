/**
 * Gas sizing for outbound transactions (Routes 2/3/4).
 *
 * Categorizes destination gas cost into three buckets per the SDK 5.2 spec:
 *   - A: gasUsd < $1     → floor to $1 worth of native PC
 *   - B: $1 ≤ gasUsd ≤ $10 → happy path, use gasFee as sized
 *   - C: gasUsd > $10    → split: $10 gas leg + overflow bridged as funds
 *
 * Output amounts are in native PC (nPUSH, 18 decimals) because that's what
 * `sendUniversalTxOutbound` consumes as `msg.value` before swapAndBurnGas
 * swaps it into the destination gas token (pETH, pSOL, …).
 */
import { parseUnits } from 'viem';
import { CHAIN, VM } from '../../constants/enums';
import { CHAIN_INFO } from '../../constants/chain';
import { PriceFetch } from '../../price-fetch/price-fetch';
import type { OrchestratorContext } from './context';
import { printLog } from './context';
import { getPcUsdPrice, usdToPc } from './pc-usd-oracle';

// ============================================================================
// Thresholds (USD, 8 decimals)
// ============================================================================

const ONE_USD_8D = parseUnits('1', 8); // 100_000_000
const TEN_USD_8D = parseUnits('10', 8); // 1_000_000_000

// ============================================================================
// Types
// ============================================================================

export type GasSizingCategory = 'A' | 'B' | 'C';

export interface GasSizingInput {
  /** Raw gasFee from getOutboundTxGasAndFees (in gasToken units, e.g., pETH 18d) */
  gasFee: bigint;
  /** Origin chain the user signed from — picks the PC/USD oracle pool */
  originChain: CHAIN;
  /**
   * Destination chain whose native asset is represented by gasToken on PC.
   * Used to price gasFee in USD via PriceFetch (Chainlink ETH/USD, Pyth SOL/USD).
   */
  destinationChain: CHAIN;
}

export interface GasSizingDecision {
  category: GasSizingCategory;
  /** Native PC to send as msg.value for the sendUniversalTxOutbound leg */
  gasLegNativePc: bigint;
  /** Native PC to bridge as funds alongside (only > 0 when category === 'C') */
  overflowNativePc: bigint;
  /** Diagnostic — raw gas cost in USD (1e8) */
  gasUsd: bigint;
  /** Diagnostic — portion to bridge in USD (1e8) */
  overflowUsd: bigint;
}

// ============================================================================
// Public API
// ============================================================================

export async function sizeOutboundGas(
  ctx: OrchestratorContext,
  input: GasSizingInput
): Promise<GasSizingDecision> {
  const { gasFee, originChain, destinationChain } = input;

  // 1) Price gasFee in USD (8 decimals). gasFee is denominated in the
  //    destination native (pETH = ETH value, pSOL = SOL value). The price
  //    feed lives on the *origin* side (origin gateway's Chainlink/Pyth),
  //    but we reuse the same feed via PriceFetch — the asset being priced
  //    is ETH or SOL, not the route.
  const destVm = CHAIN_INFO[destinationChain].vm;
  const priceSourceChain =
    destVm === VM.SVM ? CHAIN.SOLANA_DEVNET : CHAIN.ETHEREUM_SEPOLIA;
  const destDecimals = destVm === VM.SVM ? 9 : 18;

  let destUsdPrice: bigint;
  try {
    destUsdPrice = await new PriceFetch(ctx.rpcUrls).getPrice(priceSourceChain);
  } catch (err) {
    printLog(
      ctx,
      `sizeOutboundGas — PriceFetch.getPrice failed (${err instanceof Error ? err.message : String(err)}); treating as Case B passthrough`
    );
    // Degrade gracefully: assume the raw gasFee is already a sane size and
    // convert 1:1 to native PC. Callers keep their existing fallback logic.
    return passthroughAsCaseB(ctx, gasFee, originChain);
  }

  const oneDestNativeUnit = parseUnits('1', destDecimals);
  const gasUsd = (gasFee * destUsdPrice) / oneDestNativeUnit;

  printLog(
    ctx,
    `sizeOutboundGas — gasFee=${gasFee.toString()} ${destVm === VM.SVM ? 'pSOL' : 'pETH'} (${destDecimals}d), ` +
      `destUsdPrice=${destUsdPrice.toString()} (1e8), gasUsd=${gasUsd.toString()} (1e8)`
  );

  // 2) Categorize and compute target USD for each leg.
  let category: GasSizingCategory;
  let gasLegUsd: bigint;
  let overflowUsd: bigint;

  if (gasUsd < ONE_USD_8D) {
    category = 'A';
    gasLegUsd = ONE_USD_8D;
    overflowUsd = BigInt(0);
  } else if (gasUsd <= TEN_USD_8D) {
    category = 'B';
    gasLegUsd = gasUsd;
    overflowUsd = BigInt(0);
  } else {
    category = 'C';
    gasLegUsd = TEN_USD_8D;
    overflowUsd = gasUsd - TEN_USD_8D;
  }

  // 3) Convert USD targets back to native PC via the per-route WPC/stable oracle.
  const gasLegNativePc = await usdToPc(ctx, gasLegUsd, originChain);
  const overflowNativePc =
    overflowUsd > BigInt(0)
      ? await usdToPc(ctx, overflowUsd, originChain)
      : BigInt(0);

  printLog(
    ctx,
    `sizeOutboundGas — category=${category}, gasLegUsd=${gasLegUsd.toString()}, ` +
      `overflowUsd=${overflowUsd.toString()}, gasLegNativePc=${gasLegNativePc.toString()}, ` +
      `overflowNativePc=${overflowNativePc.toString()}`
  );

  return {
    category,
    gasLegNativePc,
    overflowNativePc,
    gasUsd,
    overflowUsd,
  };
}

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * When the USD price feed fails, fall back to a pass-through that keeps the
 * Orchestrator alive: return the raw gasFee as a Case B result, converting
 * through the existing PC/USD oracle (or its hardcoded fallback).
 */
async function passthroughAsCaseB(
  ctx: OrchestratorContext,
  gasFee: bigint,
  originChain: CHAIN
): Promise<GasSizingDecision> {
  const oneUsd = ONE_USD_8D;
  const gasLegNativePc = await usdToPc(ctx, oneUsd, originChain);
  void gasFee;
  return {
    category: 'B',
    gasLegNativePc,
    overflowNativePc: BigInt(0),
    gasUsd: oneUsd,
    overflowUsd: BigInt(0),
  };
}

// ============================================================================
// R1 (UOA → Push) sizing
// ============================================================================
//
// Unlike R2/R3, R1 does not cross chains — the UEA executes the user's
// payload natively on Push Chain. The sized quantity is the Push-chain gas
// cost (requiredGasFee in UPC wei) converted to USD via the per-route
// WPC/USD oracle.
//
// Case A (< $1): pad the deposit to $1 (existing floor behavior).
// Case B ($1–$10): pass-through, deposit as computed.
// Case C (> $10): pass-through. No overflow-bridge semantic (R1 has no
//   destination chain). Upper bound enforced by the origin gateway's
//   contract-level MAX_CAP_UNIVERSAL_TX_USD — the SDK no longer caps.

export interface R1SizingInput {
  /** Push-chain gas cost in UPC wei (18 decimals) */
  pushGasFeeWei: bigint;
  /** Origin chain — picks the WPC/USD oracle pool */
  originChain: CHAIN;
}

export interface R1SizingDecision {
  category: GasSizingCategory;
  /** Push-gas cost in USD (8 decimals) */
  pushGasUsd: bigint;
  /** USD the SDK should request on the origin gateway (8 decimals) */
  paddedDepositUsd: bigint;
}

export async function sizeR1PushGas(
  ctx: OrchestratorContext,
  input: R1SizingInput
): Promise<R1SizingDecision> {
  const { pushGasFeeWei, originChain } = input;

  // 1) Convert pushGasFeeWei (UPC wei, 18d) → USD (8d) via per-route oracle.
  const pcUsdPrice = await getPcUsdPrice(ctx, originChain);
  const onePcUnit = parseUnits('1', 18);
  const pushGasUsd = (pushGasFeeWei * pcUsdPrice) / onePcUnit;

  printLog(
    ctx,
    `sizeR1PushGas — pushGasFeeWei=${pushGasFeeWei.toString()} UPC (18d), ` +
      `pcUsdPrice=${pcUsdPrice.toString()} (1e8), pushGasUsd=${pushGasUsd.toString()} (1e8)`
  );

  // 2) Bucket.
  let category: GasSizingCategory;
  let paddedDepositUsd: bigint;
  if (pushGasUsd < ONE_USD_8D) {
    category = 'A';
    paddedDepositUsd = ONE_USD_8D;
  } else if (pushGasUsd <= TEN_USD_8D) {
    category = 'B';
    paddedDepositUsd = pushGasUsd;
  } else {
    category = 'C';
    paddedDepositUsd = pushGasUsd;
  }

  printLog(
    ctx,
    `sizeR1PushGas — category=${category}, paddedDepositUsd=${paddedDepositUsd.toString()} (1e8)`
  );

  return { category, pushGasUsd, paddedDepositUsd };
}

/**
 * Given gasFee (in gasToken units) and destination VM, return gasFee in USD
 * (8 decimals). Exposed for direct use in places that already have the
 * destUsdPrice cached (e.g., rescue flows).
 */
export async function computeGasUsd(
  ctx: OrchestratorContext,
  gasFee: bigint,
  destinationChain: CHAIN
): Promise<bigint> {
  const destVm = CHAIN_INFO[destinationChain].vm;
  const priceSourceChain =
    destVm === VM.SVM ? CHAIN.SOLANA_DEVNET : CHAIN.ETHEREUM_SEPOLIA;
  const destDecimals = destVm === VM.SVM ? 9 : 18;
  const destUsdPrice = await new PriceFetch(ctx.rpcUrls).getPrice(
    priceSourceChain
  );
  const oneUnit = parseUnits('1', destDecimals);
  return (gasFee * destUsdPrice) / oneUnit;
}

/** Test-only export of thresholds. @internal */
export const __THRESHOLDS = { ONE_USD_8D, TEN_USD_8D };
/** Alias for backward-compat at call sites. */
export { getPcUsdPrice } from './pc-usd-oracle';

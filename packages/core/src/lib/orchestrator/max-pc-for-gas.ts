const BPS_DENOMINATOR = BigInt(10_000);

export const DEFAULT_MAX_PC_FOR_GAS_BUFFER_BPS = 1_000;
export const MAX_PC_FOR_GAS_BUFFER_BPS_LIMIT = 10_000;

export interface MaxPCForGasCapInput {
  /**
   * Native PC estimate intended for the gas-token swap, excluding protocolFee.
   */
  gasLegNativePc: bigint;
  /**
   * Protocol fee returned by UniversalCore. Included in nativeValueForGas but
   * excluded from maxPCForGas because UGPC subtracts it before applying the cap.
   */
  protocolFee?: bigint;
  /**
   * Slippage buffer in basis points. Defaults to 1000 bps (10%).
   */
  bufferBps?: number;
}

export interface MaxPCForGasCapFromNativeValueInput {
  /**
   * Total native PC value planned for sendUniversalTxOutbound msg.value.
   */
  nativeValueForGas: bigint;
  /**
   * Protocol fee returned by UniversalCore.
   */
  protocolFee: bigint;
  /**
   * Slippage buffer in basis points. Defaults to 1000 bps (10%).
   */
  bufferBps?: number;
}

export interface MaxPCForGasCapQuote {
  /**
   * Value to pass as UniversalExecuteParams.maxPCForGas.
   */
  maxPCForGas: bigint;
  /**
   * Minimum native PC msg.value that satisfies the cap:
   * protocolFee + maxPCForGas.
   */
  nativeValueForGas: bigint;
  /**
   * Gas-swap leg before the buffer, excluding protocolFee.
   */
  gasLegNativePc: bigint;
  protocolFee: bigint;
  bufferBps: number;
}

/**
 * Builds a contract-safe maxPCForGas cap from a native PC gas-leg estimate.
 *
 * UGPC validates maxPCForGas against `msg.value - protocolFee`, so the helper
 * returns the minimum matching nativeValueForGas as well as the cap.
 */
export function quoteMaxPCForGasCap(
  input: MaxPCForGasCapInput
): MaxPCForGasCapQuote {
  assertNonNegativeBigInt('gasLegNativePc', input.gasLegNativePc);
  const protocolFee = input.protocolFee ?? BigInt(0);
  assertNonNegativeBigInt('protocolFee', protocolFee);

  const bufferBps = normalizeBufferBps(input.bufferBps);
  const maxPCForGas = applyBufferCeil(input.gasLegNativePc, bufferBps);

  return {
    maxPCForGas,
    nativeValueForGas: protocolFee + maxPCForGas,
    gasLegNativePc: input.gasLegNativePc,
    protocolFee,
    bufferBps,
  };
}

/**
 * Builds a maxPCForGas cap from queryOutboundGasFee's nativeValueForGas and
 * protocolFee fields.
 */
export function quoteMaxPCForGasCapFromNativeValue(
  input: MaxPCForGasCapFromNativeValueInput
): MaxPCForGasCapQuote {
  assertNonNegativeBigInt('nativeValueForGas', input.nativeValueForGas);
  assertNonNegativeBigInt('protocolFee', input.protocolFee);

  if (input.nativeValueForGas < input.protocolFee) {
    throw new RangeError(
      'nativeValueForGas must be greater than or equal to protocolFee'
    );
  }

  return quoteMaxPCForGasCap({
    gasLegNativePc: input.nativeValueForGas - input.protocolFee,
    protocolFee: input.protocolFee,
    bufferBps: input.bufferBps,
  });
}

function normalizeBufferBps(bufferBps?: number): number {
  const normalized = bufferBps ?? DEFAULT_MAX_PC_FOR_GAS_BUFFER_BPS;
  if (
    !Number.isInteger(normalized) ||
    normalized < 0 ||
    normalized > MAX_PC_FOR_GAS_BUFFER_BPS_LIMIT
  ) {
    throw new RangeError(
      `bufferBps must be an integer between 0 and ${MAX_PC_FOR_GAS_BUFFER_BPS_LIMIT}`
    );
  }
  return normalized;
}

function applyBufferCeil(amount: bigint, bufferBps: number): bigint {
  if (amount === BigInt(0)) return BigInt(0);
  const multiplier = BPS_DENOMINATOR + BigInt(bufferBps);
  return (amount * multiplier + BPS_DENOMINATOR - BigInt(1)) / BPS_DENOMINATOR;
}

function assertNonNegativeBigInt(name: string, value: bigint): void {
  if (value < BigInt(0)) {
    throw new RangeError(`${name} must be non-negative`);
  }
}

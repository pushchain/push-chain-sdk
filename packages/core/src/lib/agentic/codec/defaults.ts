/**
 * THE single home for omitted-limit defaults. Native PC defaults are zero as
 * confirmed on October 7. Nothing else in the SDK may invent
 * a fallback for these fields; update this table for future changes.
 *
 * Explicit zero always stays zero. In the native policy a zero value/amount
 * cap forbids positive value/amount, while maxCalls = 0 means unlimited.
 */
export const UINT256_MAX = BigInt(2) ** BigInt(256) - BigInt(1);

export interface DefaultRow {
  value: bigint;
  meaning: string;
  source: 'product' | 'v4';
}

export const AGENTIC_DEFAULTS = {
  native: {
    maxValuePerCall: {
      value: BigInt(0),
      meaning: 'no native value transfer',
      source: 'product',
    },
    maxValueTotal: {
      value: BigInt(0),
      meaning: 'no native value transfer',
      source: 'product',
    },
    amountMaxTotal: {
      value: UINT256_MAX,
      meaning: 'unlimited metered total',
      source: 'product',
    },
    maxCalls: {
      value: BigInt(0),
      meaning: 'unlimited calls until expiry',
      source: 'product',
    },
  },
  universal: {
    assetMaxTotal: {
      value: UINT256_MAX,
      meaning: 'unlimited total; explicit zero forbids movement',
      source: 'v4',
    },
    allowedCallMaxValue: {
      value: BigInt(0),
      meaning: 'no native value attached to the destination call',
      source: 'product',
    },
  },
} as const satisfies Record<string, Record<string, DefaultRow>>;

export function withDefault(
  value: bigint | undefined,
  row: DefaultRow
): bigint {
  return value === undefined ? row.value : value;
}

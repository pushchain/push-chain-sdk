/**
 * THE single home for omitted-limit defaults. Native defaults remain
 * provisional pending product confirmation. Nothing else in the SDK may invent
 * a fallback for these fields; change a row here once the decision lands.
 *
 * Explicit zero always stays zero. In the native policy a zero value/amount
 * cap forbids positive value/amount, while maxCalls = 0 means unlimited.
 */
export const UINT256_MAX = BigInt(2) ** BigInt(256) - BigInt(1);

export interface DefaultRow {
  value: bigint;
  meaning: string;
  source: 'A03' | 'v4';
}

export const AGENTIC_DEFAULTS = {
  native: {
    maxValuePerCall: {
      value: BigInt(0),
      meaning: 'no native value transfer',
      source: 'A03',
    },
    maxValueTotal: {
      value: BigInt(0),
      meaning: 'no native value transfer',
      source: 'A03',
    },
    amountMaxTotal: {
      value: UINT256_MAX,
      meaning: 'unlimited metered total',
      source: 'A03',
    },
    maxCalls: {
      value: BigInt(0),
      meaning: 'unlimited calls until expiry',
      source: 'A03',
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
      source: 'A03',
    },
  },
} as const satisfies Record<string, Record<string, DefaultRow>>;

export function withDefault(
  value: bigint | undefined,
  row: DefaultRow
): bigint {
  return value === undefined ? row.value : value;
}

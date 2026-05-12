const PC_DECIMALS = 18;

function formatTokenUnits(
  value: bigint,
  decimals: number,
  precision?: number
): string {
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new Error('decimals must be a non-negative integer');
  }
  if (
    precision !== undefined &&
    (!Number.isInteger(precision) || precision < 0)
  ) {
    throw new Error('precision must be a non-negative integer');
  }

  const negative = value < BigInt(0);
  const absolute = negative ? -value : value;
  let scale = BigInt(1);
  for (let i = 0; i < decimals; i++) {
    scale *= BigInt(10);
  }
  const whole = absolute / scale;
  const remainder = absolute % scale;
  let fraction = decimals > 0 ? remainder.toString().padStart(decimals, '0') : '';

  if (precision !== undefined) {
    fraction = fraction.slice(0, precision);
  }
  fraction = fraction.replace(/0+$/, '');

  const sign = negative ? '-' : '';
  return `${sign}${whole.toString()}${fraction ? `.${fraction}` : ''}`;
}

export function formatPc(valueWei: bigint, precision?: number): string {
  return `${formatTokenUnits(valueWei, PC_DECIMALS, precision)} PC`;
}

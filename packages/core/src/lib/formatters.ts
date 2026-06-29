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

function getErrorMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  const stringifyFallback = (value: unknown): string => {
    try {
      const json = JSON.stringify(value);
      return json === undefined ? String(value) : json;
    } catch {
      return String(value);
    }
  };
  if (error instanceof Error) {
    const maybe = error as Error & {
      shortMessage?: unknown;
      details?: unknown;
      cause?: { shortMessage?: unknown; reason?: unknown; message?: unknown };
    };
    return String(
      maybe.shortMessage ??
        maybe.cause?.shortMessage ??
        maybe.cause?.reason ??
        maybe.details ??
        maybe.message ??
        stringifyFallback(error)
    );
  }
  if (typeof error === 'object' && error !== null) {
    const maybe = error as {
      shortMessage?: unknown;
      details?: unknown;
      message?: unknown;
      reason?: unknown;
      cause?: { shortMessage?: unknown; reason?: unknown; message?: unknown };
    };
    return String(
      maybe.shortMessage ??
        maybe.cause?.shortMessage ??
        maybe.cause?.reason ??
        maybe.reason ??
        maybe.details ??
        maybe.message ??
        stringifyFallback(error)
    );
  }
  return String(error);
}

function collectErrorMessages(error: unknown, depth = 0): string[] {
  if (depth > 4) return [];
  if (typeof error === 'string') return [error];
  if (error instanceof Error || (typeof error === 'object' && error !== null)) {
    const maybe = error as {
      shortMessage?: unknown;
      details?: unknown;
      message?: unknown;
      reason?: unknown;
      cause?: unknown;
    };
    const values = [
      maybe.shortMessage,
      maybe.details,
      maybe.reason,
      maybe.message,
    ].filter((value): value is string => typeof value === 'string');
    return [...values, ...collectErrorMessages(maybe.cause, depth + 1)];
  }
  return [String(error)];
}

/**
 * Push Chain EVM/RPC insufficient-funds errors surface native balances as raw
 * wei, usually in the form "have <wei> want <wei>". Preserve the raw value for
 * debugging but prefix it with the human PC amount users can reason about.
 */
export function normalizePcInsufficientFundsError(message: string): string {
  if (!/insufficient funds for gas \* price \+ value/i.test(message)) {
    return message;
  }

  return message
    .replace(/\bhave\s+([0-9]+)(?=\s+want\b)/gi, (_match, value: string) =>
      `have ${formatPc(BigInt(value))} (${value} wei)`
    )
    .replace(
      /\bwant\s+([0-9]+)(?!\d|\.\d|\s*(?:wei|PC))/gi,
      (_match, value: string) =>
        `want ${formatPc(BigInt(value))} (${value} wei)`
    );
}

export function normalizePublicErrorMessage(error: unknown): string {
  const message = normalizePcInsufficientFundsError(getErrorMessage(error));
  const searchableMessage = normalizePcInsufficientFundsError(
    collectErrorMessages(error).join(' ')
  );

  const haveWant = searchableMessage.match(
    /\bhave\s+([0-9]+(?:\.[0-9]+)?\s+PC)(?:\s+\([^)]+\))?\s+want\s+([0-9]+(?:\.[0-9]+)?\s+PC)/i
  );
  if (
    /insufficient funds for gas \* price \+ value/i.test(searchableMessage) ||
    /exceeds the balance of the account/i.test(searchableMessage) ||
    /insufficient funds for intrinsic transaction cost/i.test(searchableMessage)
  ) {
    const havePc = haveWant?.[1];
    const wantPc = haveWant?.[2];
    if (havePc && wantPc) {
      return `Insufficient balance for transaction gas/value: have ${havePc}, need ${wantPc}.`;
    }
    return 'Insufficient balance for transaction gas/value.';
  }

  if (
    /Attempt to debit an account but found no record of a prior credit/i.test(searchableMessage)
  ) {
    return 'Insufficient Solana balance for transaction fee/value: account has no prior credit.';
  }

  if (
    /insufficient lamports/i.test(searchableMessage) ||
    /custom program error: 0x1/i.test(searchableMessage) ||
    /insufficient funds for rent/i.test(searchableMessage)
  ) {
    return 'Insufficient Solana balance for transaction fee/value.';
  }

  return message.length > 500 ? `${message.slice(0, 497)}...` : message;
}

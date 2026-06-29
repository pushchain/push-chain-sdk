import {
  formatPc,
  normalizePcInsufficientFundsError,
  normalizePublicErrorMessage,
} from './formatters';

describe('formatters', () => {
  it('formats PC exactly by default', () => {
    expect(formatPc(BigInt('7410755801443190242892'))).toBe(
      '7410.755801443190242892 PC'
    );
    expect(formatPc(BigInt('5500000000000000000'))).toBe('5.5 PC');
    expect(formatPc(BigInt(0))).toBe('0 PC');
  });

  it('formats PC with truncated precision when requested', () => {
    expect(formatPc(BigInt('7410755801443190242892'), 4)).toBe(
      '7410.7558 PC'
    );
    expect(formatPc(BigInt('1000000000000000000'), 4)).toBe('1 PC');
  });

  it('normalizes Push Chain insufficient-funds wei amounts', () => {
    const message =
      'Details: failed with 16777216 gas: insufficient funds for gas * price + value: address 0x36cDbAfcDEea9CF912D285017f246e55BaF14f0F have 8000000000000000 want 20517277398607022';
    const normalized = normalizePcInsufficientFundsError(message);

    expect(normalized).toContain(
      'have 0.008 PC (8000000000000000 wei)'
    );
    expect(normalized).toContain(
      'want 0.020517277398607022 PC (20517277398607022 wei)'
    );
    expect(normalizePcInsufficientFundsError(normalized)).toBe(normalized);
  });

  it('leaves unrelated insufficient-funds messages unchanged', () => {
    expect(
      normalizePcInsufficientFundsError(
        'insufficient funds for intrinsic transaction cost'
      )
    ).toBe('insufficient funds for intrinsic transaction cost');
  });

  it('shortens source-chain insufficient gas/value errors for public display', () => {
    const raw =
      'Details: failed with 16777216 gas: insufficient funds for gas * price + value: address 0xabc have 8000000000000000 want 20517277398607022. ' +
      'Transaction execution reverted with a very long library payload that should not leak to UI.';

    expect(normalizePublicErrorMessage(raw)).toBe(
      'Insufficient balance for transaction gas/value: have 0.008 PC, need 0.020517277398607022 PC.'
    );
  });

  it('shortens Solana no-prior-credit simulation errors for public display', () => {
    const raw =
      'Transaction simulation failed: Attempt to debit an account but found no record of a prior credit. ' +
      'Logs: []';

    expect(normalizePublicErrorMessage(raw)).toBe(
      'Insufficient Solana balance for transaction fee/value: account has no prior credit.'
    );
  });

  it('prefers library shortMessage when normalizing error objects', () => {
    const err = {
      shortMessage:
        'The total cost (gas * gas fee + value) of executing this transaction exceeds the balance of the account.',
      message: 'very long raw viem error body',
    };

    expect(normalizePublicErrorMessage(err)).toBe(
      'Insufficient balance for transaction gas/value.'
    );
  });

  it('looks through generic viem shortMessage wrappers for nested balance details', () => {
    const err = {
      shortMessage: 'Transaction creation failed.',
      details: 'Transaction creation failed.',
      message: 'Transaction creation failed.',
      cause: {
        shortMessage:
          'The total cost (gas * gas fee + value) of executing this transaction exceeds the balance of the account.',
      },
    };

    expect(normalizePublicErrorMessage(err)).toBe(
      'Insufficient balance for transaction gas/value.'
    );
  });

  it('keeps plain object errors readable for terminal hooks', () => {
    expect(
      normalizePublicErrorMessage({
        code: -32000,
        data: { reason: 'execution reverted' },
      })
    ).toBe('{"code":-32000,"data":{"reason":"execution reverted"}}');
  });
});

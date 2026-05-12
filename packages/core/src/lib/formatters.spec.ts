import { formatPc, normalizePcInsufficientFundsError } from './formatters';

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
});

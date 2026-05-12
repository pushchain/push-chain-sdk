import { formatPc } from './formatters';

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
});

import { CALLBACK_BUDGET_BUFFER } from '../../constants/read-state';
import { MIN_CALLBACK_BUDGET_GAS_PRICE, sizeCallbackBudget } from '../budget';
import { InvalidReadQueryError } from '../errors';

describe('sizeCallbackBudget', () => {
  it('is gasLimit × gasPrice × buffer', () => {
    expect(sizeCallbackBudget(200_000n, 1_000_000_000n)).toBe(200_000n * 1_000_000_000n * BigInt(CALLBACK_BUDGET_BUFFER));
    expect(sizeCallbackBudget(200_000n, 1_000_000_000n, 1)).toBe(200_000_000_000_000n);
  });

  it('never returns zero — a zero gas price falls back to the 1 gwei floor', () => {
    expect(sizeCallbackBudget(1n, 0n, 1)).toBe(MIN_CALLBACK_BUDGET_GAS_PRICE);
    expect(sizeCallbackBudget(200_000n, 0n)).toBeGreaterThan(0n);
  });

  it('covers what Donut actually burned for a 200k-limit callback (118,289 gas at 1 gwei)', () => {
    const budget = sizeCallbackBudget(200_000n, 1_000_000_000n);
    expect(budget).toBeGreaterThan(118_289n * 1_000_000_000n);
  });

  it('bigint math is exact at the 1M gas ceiling', () => {
    expect(sizeCallbackBudget(1_000_000n, 1_000_000_000n, 3)).toBe(3_000_000_000_000_000n);
  });

  it('rejects a non-positive gas limit or a bad buffer', () => {
    expect(() => sizeCallbackBudget(0n, 1n)).toThrow(InvalidReadQueryError);
    expect(() => sizeCallbackBudget(1n, 1n, 0)).toThrow(InvalidReadQueryError);
    expect(() => sizeCallbackBudget(1n, 1n, 1.5)).toThrow(InvalidReadQueryError);
  });
});

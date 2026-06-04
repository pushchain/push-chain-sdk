import { resolveRequiredFunds } from '../internals/execute-standard';

describe('resolveRequiredFunds', () => {
  it('uses gas fee plus execute value when no override is provided', () => {
    expect(resolveRequiredFunds(BigInt(10), BigInt(20))).toBe(BigInt(30));
  });

  it('uses the override when route-level required funds are higher', () => {
    expect(resolveRequiredFunds(BigInt(10), BigInt(20), BigInt(50))).toBe(
      BigInt(50)
    );
  });

  it('keeps the base required funds when the override is lower', () => {
    expect(resolveRequiredFunds(BigInt(10), BigInt(20), BigInt(25))).toBe(
      BigInt(30)
    );
  });
});

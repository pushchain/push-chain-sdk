import type { Idl } from '@coral-xyz/anchor';
import { encodeAnchorIxData, isAnchorIdl } from './ix-encoder';
import testCounterIdl from './__fixtures__/test_counter.idl.json';

function buildReceiveSolIxData(amount: bigint): Uint8Array {
  const discriminator = new Uint8Array([121, 244, 250, 3, 8, 229, 225, 1]);
  const amountBuf = new Uint8Array(8);
  new DataView(amountBuf.buffer).setBigUint64(0, amount, true);
  return new Uint8Array([...discriminator, ...amountBuf]);
}

describe('encodeAnchorIxData', () => {
  const idl = testCounterIdl as unknown as Idl;

  it('matches hand-rolled receive_sol bytes for amount=0', () => {
    const actual = encodeAnchorIxData(idl, 'receive_sol', [BigInt(0)]);
    const expected = buildReceiveSolIxData(BigInt(0));
    expect(Array.from(actual)).toEqual(Array.from(expected));
  });

  it('matches hand-rolled receive_sol bytes for non-zero amount', () => {
    const amount = BigInt(123456789);
    const actual = encodeAnchorIxData(idl, 'receive_sol', [amount]);
    const expected = buildReceiveSolIxData(amount);
    expect(Array.from(actual)).toEqual(Array.from(expected));
  });

  it('accepts camelCase function name equivalent to snake_case IDL name', () => {
    const actual = encodeAnchorIxData(idl, 'receiveSol', [BigInt(7)]);
    const expected = buildReceiveSolIxData(BigInt(7));
    expect(Array.from(actual)).toEqual(Array.from(expected));
  });

  it('throws when instruction is not in IDL', () => {
    expect(() => encodeAnchorIxData(idl, 'does_not_exist', [])).toThrow(
      /not found in IDL/
    );
  });

  it('throws on arg count mismatch', () => {
    expect(() => encodeAnchorIxData(idl, 'receive_sol', [])).toThrow(
      /Arg count mismatch/
    );
  });
});

describe('isAnchorIdl', () => {
  it('returns true for the test_counter IDL', () => {
    expect(isAnchorIdl(testCounterIdl)).toBe(true);
  });

  it('returns false for an EVM ABI array', () => {
    const evmAbi = [{ type: 'function', name: 'increment', inputs: [], outputs: [] }];
    expect(isAnchorIdl(evmAbi)).toBe(false);
  });

  it('returns false for null/primitives', () => {
    expect(isAnchorIdl(null)).toBe(false);
    expect(isAnchorIdl(undefined)).toBe(false);
    expect(isAnchorIdl('not-an-idl')).toBe(false);
  });
});

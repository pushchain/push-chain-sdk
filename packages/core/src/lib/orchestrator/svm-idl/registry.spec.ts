import { registerIdl, getIdl, getRegisteredIdls, clearRegistry } from './registry';
import testCounterIdl from './__fixtures__/test_counter.idl.json';

const PROGRAM_BASE58 = '8yNqjrMnFiFbVTVQcKij8tNWWTMdFkrDf9abCGgc2sgx';
const PROGRAM_HEX =
  '0x7673075a980bfd5d6b1dffe99c31f63e8938519cc1c2af009dda5e568a94460d' as const;

describe('svm-idl/registry — single-arg registerIdl(idl)', () => {
  beforeEach(() => clearRegistry());

  it('registers an IDL keyed by toSvmHexAddress(idl.address)', () => {
    registerIdl(testCounterIdl);
    expect(getIdl(PROGRAM_HEX)).toBe(testCounterIdl);
    expect(getIdl(PROGRAM_BASE58)).toBe(testCounterIdl);
  });

  it('is idempotent — re-registering the same IDL is a no-op', () => {
    registerIdl(testCounterIdl);
    registerIdl(testCounterIdl);
    expect(getRegisteredIdls()).toHaveLength(1);
  });

  it('rejects non-Anchor input', () => {
    expect(() => registerIdl(null)).toThrow(/Anchor IDL/);
    expect(() => registerIdl([])).toThrow(/Anchor IDL/);
    expect(() => registerIdl({ foo: 'bar' })).toThrow(/Anchor IDL/);
  });

  it('rejects an IDL whose address is not a valid Solana pubkey', () => {
    const bad = { ...testCounterIdl, address: 'not-a-real-address' };
    expect(() => registerIdl(bad)).toThrow();
  });

  it('getRegisteredIdls returns normalized hex keys', () => {
    registerIdl(testCounterIdl);
    const list = getRegisteredIdls();
    expect(list).toHaveLength(1);
    expect(list[0].address).toBe(PROGRAM_HEX);
    expect(list[0].idl).toBe(testCounterIdl);
  });
});

import { registerIdl, getIdl, getRegisteredIdls, clearRegistry } from './registry';
import testCounterIdl from './__fixtures__/test_counter.idl.json';

const PROGRAM_HEX = '0x7673075a980bfd5d6b1dffe99c31f63e8938519cc1c2af009dda5e568a94460d';
const PROGRAM_BASE58 = '8yNqjrMnFiFbVTVQcKij8tNWWTMdFkrDf9abCGgc2sgx';

describe('svm-idl registry', () => {
  beforeEach(() => clearRegistry());

  it('registers and retrieves an IDL by 0x-hex program address', () => {
    registerIdl(PROGRAM_HEX, testCounterIdl);
    const got = getIdl(PROGRAM_HEX);
    expect(got).toBeDefined();
    expect(got?.metadata?.name).toBe('test_counter');
  });

  it('registers with base58 and retrieves with either form', () => {
    registerIdl(PROGRAM_BASE58, testCounterIdl);
    expect(getIdl(PROGRAM_BASE58)).toBeDefined();
    expect(getIdl(PROGRAM_HEX)).toBeDefined();
  });

  it('registers with 0x-hex and retrieves with base58', () => {
    registerIdl(PROGRAM_HEX, testCounterIdl);
    expect(getIdl(PROGRAM_BASE58)).toBeDefined();
  });

  it('address lookup is case-insensitive for hex form', () => {
    registerIdl(PROGRAM_HEX.toUpperCase().replace('0X', '0x'), testCounterIdl);
    expect(getIdl(PROGRAM_HEX)).toBeDefined();
    expect(getIdl(PROGRAM_HEX.toLowerCase())).toBeDefined();
  });

  it('returns undefined for unregistered addresses', () => {
    expect(getIdl(PROGRAM_HEX)).toBeUndefined();
  });

  it('rejects malformed inputs', () => {
    expect(() => registerIdl('', testCounterIdl)).toThrow();
    expect(() => registerIdl('0xdeadbeef', testCounterIdl)).toThrow(/32 bytes/);
  });

  it('rejects non-Anchor-IDL inputs', () => {
    expect(() => registerIdl(PROGRAM_HEX, null)).toThrow(/Anchor IDL/);
    expect(() => registerIdl(PROGRAM_HEX, [])).toThrow(/Anchor IDL/);
    expect(() => registerIdl(PROGRAM_HEX, { foo: 'bar' })).toThrow(/Anchor IDL/);
  });

  it('getRegisteredIdls lists all entries with normalized hex keys', () => {
    registerIdl(PROGRAM_BASE58, testCounterIdl);
    const list = getRegisteredIdls();
    expect(list).toHaveLength(1);
    expect(list[0].address).toBe(PROGRAM_HEX);
  });
});

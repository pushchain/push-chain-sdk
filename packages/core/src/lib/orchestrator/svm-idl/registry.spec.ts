import { registerIdl, getIdl, getRegisteredIdls, clearRegistry } from './registry';
import testCounterIdl from './__fixtures__/test_counter.idl.json';

const PROGRAM = '0x7673075a980bfd5d6b1dffe99c31f63e8938519cc1c2af009dda5e568a94460d';

describe('svm-idl registry', () => {
  beforeEach(() => clearRegistry());

  it('registers and retrieves an IDL by program address', () => {
    registerIdl(PROGRAM, testCounterIdl);
    const got = getIdl(PROGRAM);
    expect(got).toBeDefined();
    expect(got?.metadata?.name).toBe('test_counter');
  });

  it('address lookup is case-insensitive', () => {
    registerIdl(PROGRAM.toUpperCase().replace('0X', '0x'), testCounterIdl);
    expect(getIdl(PROGRAM)).toBeDefined();
    expect(getIdl(PROGRAM.toLowerCase())).toBeDefined();
  });

  it('returns undefined for unregistered addresses', () => {
    expect(getIdl(PROGRAM)).toBeUndefined();
  });

  it('rejects non-hex / wrong-length addresses', () => {
    expect(() => registerIdl('not-hex', testCounterIdl)).toThrow(/0x-prefixed/);
    expect(() => registerIdl('0xdeadbeef', testCounterIdl)).toThrow(/32 bytes/);
  });

  it('rejects non-Anchor-IDL inputs', () => {
    expect(() => registerIdl(PROGRAM, null)).toThrow(/Anchor IDL/);
    expect(() => registerIdl(PROGRAM, [])).toThrow(/Anchor IDL/);
    expect(() => registerIdl(PROGRAM, { foo: 'bar' })).toThrow(/Anchor IDL/);
  });

  it('getRegisteredIdls lists all entries', () => {
    registerIdl(PROGRAM, testCounterIdl);
    const list = getRegisteredIdls();
    expect(list).toHaveLength(1);
    expect(list[0].address).toBe(PROGRAM.toLowerCase());
  });
});

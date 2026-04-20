import { toSvmHexAddress, isValidSvmAddress } from './normalize-address';

const HEX = '0x7673075a980bfd5d6b1dffe99c31f63e8938519cc1c2af009dda5e568a94460d';
const BASE58 = '8yNqjrMnFiFbVTVQcKij8tNWWTMdFkrDf9abCGgc2sgx';

describe('svm-idl normalize-address', () => {
  describe('toSvmHexAddress', () => {
    it('accepts canonical 0x-hex and returns lowercase', () => {
      expect(toSvmHexAddress(HEX)).toBe(HEX);
      expect(toSvmHexAddress(HEX.toUpperCase().replace('0X', '0x'))).toBe(HEX);
    });

    it('accepts base58 and returns the matching 0x-hex', () => {
      expect(toSvmHexAddress(BASE58)).toBe(HEX);
    });

    it('accepts the canonical System Program base58', () => {
      const systemProgram = '11111111111111111111111111111111';
      expect(toSvmHexAddress(systemProgram)).toBe('0x' + '00'.repeat(32));
    });

    it('rejects hex with wrong length', () => {
      expect(() => toSvmHexAddress('0xdeadbeef')).toThrow(/32 bytes/);
      expect(() => toSvmHexAddress('0x' + 'a'.repeat(63))).toThrow(/32 bytes/);
      expect(() => toSvmHexAddress('0x' + 'a'.repeat(65))).toThrow(/32 bytes/);
    });

    it('rejects base58 that decodes to a non-32-byte length', () => {
      const thirtyOne = '1' + '1'.repeat(30);
      expect(() => toSvmHexAddress(thirtyOne)).toThrow(/32/);
    });

    it('rejects malformed base58 (contains 0/O/I/l)', () => {
      expect(() => toSvmHexAddress('0OIl00000000000000000000000000000')).toThrow();
    });

    it('rejects empty / non-string', () => {
      expect(() => toSvmHexAddress('')).toThrow(/non-empty/);
      expect(() => toSvmHexAddress(undefined as unknown as string)).toThrow();
      expect(() => toSvmHexAddress(null as unknown as string)).toThrow();
      expect(() => toSvmHexAddress(123 as unknown as string)).toThrow();
    });
  });

  describe('isValidSvmAddress', () => {
    it.each([HEX, BASE58, '11111111111111111111111111111111'])('accepts %s', (v) => {
      expect(isValidSvmAddress(v)).toBe(true);
    });

    it.each(['', 'not-base58-at-all-!', '0xdeadbeef', 123 as unknown as string])(
      'rejects %s',
      (v) => {
        expect(isValidSvmAddress(v)).toBe(false);
      }
    );
  });
});

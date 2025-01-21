import { PushChain } from '../../src';

describe('PushChain.utils.account', () => {
  const evmAddress = '0x35B84d6848D16415177c64D64504663b998A6ab4';
  const pushAddress = 'push1xkuy66zg69jp29muvnty2prx8wvc5645f9y5ux';

  // A checksum EVM address for additional coverage:
  const checksumEvmAddress = '0x35B84D6848D16415177C64D64504663B998A6Ab4';
  // The same address but uppercase (viem should normalize it):
  const uppercaseEvmAddress = '0x35B84D6848D16415177C64D64504663B998A6AB4';

  describe('evmToPushAddress', () => {
    it('should convert a valid EVM address to a Push address', () => {
      const result = PushChain.utils.account.evmToPushAddress(evmAddress);
      expect(result).toEqual(pushAddress);
    });

    it('should accept a checksum EVM address and still produce the same Push address', () => {
      const result =
        PushChain.utils.account.evmToPushAddress(checksumEvmAddress);
      expect(result).toEqual(pushAddress);
    });

    it('should handle uppercase "0x..." prefix by normalizing the address', () => {
      const result =
        PushChain.utils.account.evmToPushAddress(uppercaseEvmAddress);
      expect(result).toEqual(pushAddress);
    });

    it('should throw an error for invalid EVM addresses', () => {
      const invalidAddress = '0xinvalidaddress';
      expect(() => {
        PushChain.utils.account.evmToPushAddress(invalidAddress);
      }).toThrow();
    });
  });

  describe('pushToEvmAddress', () => {
    it('should convert a valid Push address back to an EVM address', () => {
      const result = PushChain.utils.account.pushToEvmAddress(pushAddress);
      expect(result).toEqual(evmAddress);
    });

    it('should throw an error for invalid Push addresses', () => {
      const invalidPushAddress = 'pushinvalidaddress';
      expect(() => {
        PushChain.utils.account.pushToEvmAddress(invalidPushAddress);
      }).toThrow();
    });
  });
});

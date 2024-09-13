import { Address } from '../../src/lib/address/address'; // Adjust the import path accordingly
import { ENV } from '../../src/lib/constants';

describe('Address', () => {
  const evmAddress = '0x35B84d6848D16415177c64D64504663b998A6ab4';
  const pushAddress = 'push1xkuy66zg69jp29muvnty2prx8wvc5645f9y5ux';

  describe('evmToPush', () => {
    it('should convert a valid EVM address to a Push address', () => {
      const result = Address.evmToPush(evmAddress);
      expect(result).toEqual(pushAddress);
    });

    it('should throw an error for invalid EVM addresses', () => {
      const invalidAddress = '0xinvalidaddress';
      expect(() => Address.evmToPush(invalidAddress)).toThrow();
    });
  });

  describe('pushToEvm', () => {
    it('should convert a valid Push address back to an EVM address', () => {
      const result = Address.pushToEvm(pushAddress);
      expect(result).toEqual(evmAddress);
    });

    it('should throw an error for invalid Push addresses', () => {
      const invalidPushAddress = 'pushinvalidaddress';
      expect(() => Address.pushToEvm(invalidPushAddress)).toThrow();
    });
  });

  describe('toPushCAIP', () => {
    it('should convert evm address to Push Devnet CAIP', () => {
      const result1 = Address.toPushCAIP(evmAddress, ENV.LOCAL);
      const result2 = Address.toPushCAIP(evmAddress, ENV.DEV);
      expect(result1).toEqual(result2);
      expect(result1).toEqual(`push:devnet:${evmAddress}`);
    });
    it('should convert evm address to Push Testnet CAIP', () => {
      const result = Address.toPushCAIP(evmAddress, ENV.STAGING);
      expect(result).toEqual(`push:testnet:${evmAddress}`);
    });
    it('should convert evm address to Push Mainnet CAIP', () => {
      const result = Address.toPushCAIP(evmAddress, ENV.PROD);
      expect(result).toEqual(`push:mainnet:${evmAddress}`);
    });
  });
});

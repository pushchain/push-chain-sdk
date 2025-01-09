import { Address } from '../../src/lib/address/address'; // Adjust the import path accordingly
import { ENV } from '../../src/lib/constants';

describe('Address', () => {
  const evmAddress = '0x35B84d6848D16415177c64D64504663b998A6ab4';
  const pushAddress = 'push1xkuy66zg69jp29muvnty2prx8wvc5645f9y5ux';
  const customPushAddress = 'custom1xkuy66zg69jp29muvnty2prx8wvc5645hlgxkx';
  const solanaAddress = '69EUYJKr2NE8vHFphyRPSU2tqRbXhMu9gzNo96mjvFLv';

  describe('evmToPush', () => {
    it('should convert a valid EVM address to a Push address', () => {
      const result = Address.evmToPush(evmAddress);
      expect(result).toEqual(pushAddress);
    });

    it('should throw an error for invalid EVM addresses', () => {
      const invalidAddress = '0xinvalidaddress';
      expect(() => Address.evmToPush(invalidAddress)).toThrow();
    });

    it('should convert a valid EVM address to a Push address with a custom prefix', () => {
      const customPrefix = 'custom';
      const result = Address.evmToPush(evmAddress, customPrefix);
      expect(result).toEqual(customPushAddress);
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
      const result2 = Address.toPushCAIP(evmAddress, ENV.DEVNET);
      expect(result1).toEqual(result2);
      expect(result1).toEqual(`push:devnet:${pushAddress}`);
    });

    it('should convert evm address to Push Testnet CAIP', () => {
      const result = Address.toPushCAIP(evmAddress, ENV.TESTNET);
      expect(result).toEqual(`push:testnet:${pushAddress}`);
    });

    it('should convert evm address to Push Mainnet CAIP', () => {
      const result = Address.toPushCAIP(evmAddress, ENV.MAINNET);
      expect(result).toEqual(`push:mainnet:${pushAddress}`);
    });

    it('should convert push address to Push Devnet CAIP', () => {
      const result = Address.toPushCAIP(pushAddress, ENV.DEVNET);
      expect(result).toEqual(`push:devnet:${pushAddress}`);
    });

    it('should convert evm address to Push Testnet CAIP', () => {
      const result = Address.toPushCAIP(pushAddress, ENV.TESTNET);
      expect(result).toEqual(`push:testnet:${pushAddress}`);
    });

    it('should convert evm address to Push Mainnet CAIP', () => {
      const result = Address.toPushCAIP(pushAddress, ENV.MAINNET);
      expect(result).toEqual(`push:mainnet:${pushAddress}`);
    });
  });

  describe('toCAIP', () => {
    it('should convert evm address to CAIP', () => {
      const result1 = Address.toCAIP(evmAddress, 1);
      expect(result1).toEqual(`eip155:1:${evmAddress}`);
    });

    it('should convert push address to CAIP', () => {
      const result1 = Address.toCAIP(pushAddress, 'devnet');
      expect(result1).toEqual(`push:devnet:${pushAddress}`);
    });

    it('should convert solana address to CAIP', () => {
      const result = Address.toCAIP(solanaAddress, 'devnet');
      expect(result).toEqual(
        `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1:${solanaAddress}`
      );
    });

    it('should throw an error for invalid network for EIP155 address', () => {
      expect(() => Address.toCAIP(evmAddress, 'devnet')).toThrow();
    });

    it('should throw an error for invalid network for push address', () => {
      expect(() => Address.toCAIP(pushAddress, 1)).toThrow();
    });

    it('should throw an error for invalid network for solana address', () => {
      expect(() => Address.toCAIP(solanaAddress, 1)).toThrow();
    });
  });
});

import {
  createUniversalAccount,
  toChainAgnostic,
  toUniversal,
} from './account';
import { CHAIN } from '../../constants/enums';

const EVM_ADDRESS = '0xeCba9a32A9823f1cb00cdD8344Bf2D1d87a8dd97';

describe('Universal Account Utilities', () => {
  describe('createUniversalAccount()', () => {
    it('returns a checksummed address for EVM chains', () => {
      const account = createUniversalAccount({
        chain: CHAIN.ETHEREUM_SEPOLIA,
        address: EVM_ADDRESS.toLowerCase(), // simulate unchecksummed input
      });

      expect(account.address).toBe(EVM_ADDRESS);
      expect(account.chain).toBe(CHAIN.ETHEREUM_SEPOLIA);
    });

    it('returns the address as-is for non-EVM chains', () => {
      const account = createUniversalAccount({
        chain: CHAIN.SOLANA_TESTNET,
        address: 'solanaAddress123',
      });

      expect(account.address).toBe('solanaAddress123');
      expect(account.chain).toBe(CHAIN.SOLANA_TESTNET);
    });

    it('throws an error on invalid EVM address format', () => {
      expect(() =>
        createUniversalAccount({
          chain: CHAIN.ETHEREUM_SEPOLIA,
          address: 'not-an-eth-address',
        })
      ).toThrow('Invalid EVM address format');
    });
  });

  describe('toChainAgnostic()', () => {
    it('converts a UniversalAccount to a CAIP-10 string for EVM', () => {
      const caip = toChainAgnostic({
        chain: CHAIN.ETHEREUM_SEPOLIA,
        address: EVM_ADDRESS,
      });

      expect(caip).toBe(`eip155:11155111:${EVM_ADDRESS}`);
    });

    it('converts a UniversalAccount to a CAIP-10 string for Solana', () => {
      const caip = toChainAgnostic({
        chain: CHAIN.SOLANA_TESTNET,
        address: 'solanaAddress123',
      });

      expect(caip).toBe(
        'solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z:solanaAddress123'
      );
    });
  });

  describe('toUniversal()', () => {
    it('converts a CAIP-10 string to a UniversalAccount (EVM)', () => {
      const account = toUniversal(`eip155:11155111:${EVM_ADDRESS}`);

      expect(account.chain).toBe(CHAIN.ETHEREUM_SEPOLIA);
      expect(account.address).toBe(EVM_ADDRESS);
    });

    it('converts a CAIP-10 string to a UniversalAccount (Solana)', () => {
      const account = toUniversal(
        'solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z:solanaAddress123'
      );

      expect(account.chain).toBe(CHAIN.SOLANA_TESTNET);
      expect(account.address).toBe('solanaAddress123');
    });

    it('throws an error if the CAIP string is unsupported', () => {
      expect(() => toUniversal('foo:999:bar')).toThrow(
        'Unsupported or unknown CAIP address: foo:999:bar'
      );
    });
  });
});

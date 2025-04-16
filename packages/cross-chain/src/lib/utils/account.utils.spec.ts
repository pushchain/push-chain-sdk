import { toUniversal, toChainAgnostic } from './account.utils';
import { CHAIN } from '../constants/enums';
import { UniversalAccount } from '../universal/universal.types';

describe('account.utils', () => {
  describe('toChainAgnostic()', () => {
    it('should convert an EVM UniversalAccount to CAIP-10 string', () => {
      const account: UniversalAccount = {
        chain: CHAIN.ETHEREUM_SEPOLIA,
        address: '0xabc123...',
      };

      const result = toChainAgnostic(account);
      expect(result).toBe('eip155:11155111:0xabc123...');
    });

    it('should convert a Solana UniversalAccount to CAIP-10 string', () => {
      const account: UniversalAccount = {
        chain: CHAIN.SOLANA_DEVNET,
        address: 'solanaAddress123',
      };

      const result = toChainAgnostic(account);
      expect(result).toBe(
        'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1:solanaAddress123'
      );
    });
  });

  describe('toUniversal()', () => {
    it('should convert a CAIP-10 EVM address to a UniversalAccount', () => {
      const caip = 'eip155:11155111:0xabc123...';
      const result = toUniversal(caip);

      expect(result).toEqual({
        chain: CHAIN.ETHEREUM_SEPOLIA,
        address: '0xabc123...',
      });
    });

    it('should convert a CAIP-10 Solana address to a UniversalAccount', () => {
      const caip = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1:solanaAddress123';
      const result = toUniversal(caip);

      expect(result).toEqual({
        chain: CHAIN.SOLANA_DEVNET,
        address: 'solanaAddress123',
      });
    });

    it('should throw for unsupported namespace/chainId combo', () => {
      const caip = 'eip155:999:0xabc';
      expect(() => toUniversal(caip)).toThrow(
        'Unsupported or unknown CAIP address'
      );
    });

    it('should throw for malformed CAIP strings', () => {
      const invalid = 'eip155:onlytwoparts';
      expect(() => toUniversal(invalid)).toThrow(
        'Unsupported or unknown CAIP address'
      );
    });
  });
});

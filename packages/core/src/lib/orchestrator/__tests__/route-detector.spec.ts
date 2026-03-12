/**
 * Unit tests for route-detector.ts
 */
import { CHAIN } from '../../constants/enums';
import {
  TransactionRoute,
  detectRoute,
  validateRouteParams,
  isChainTarget,
  isPushChain,
  isSupportedExternalChain,
  RouteValidationError,
} from '../route-detector';
import type { UniversalExecuteParams, ChainTarget } from '../orchestrator.types';

describe('route-detector', () => {
  describe('isChainTarget', () => {
    it('should return true for valid ChainTarget object', () => {
      const target: ChainTarget = {
        address: '0x1234567890123456789012345678901234567890',
        chain: CHAIN.BNB_TESTNET,
      };
      expect(isChainTarget(target)).toBe(true);
    });

    it('should return false for simple string address', () => {
      expect(isChainTarget('0x1234567890123456789012345678901234567890')).toBe(false);
    });

    it('should return false for null/undefined', () => {
      expect(isChainTarget(null)).toBe(false);
      expect(isChainTarget(undefined)).toBe(false);
    });

    it('should return false for object without chain property', () => {
      expect(isChainTarget({ address: '0x123' })).toBe(false);
    });
  });

  describe('isPushChain', () => {
    it('should return true for Push Chain testnet', () => {
      expect(isPushChain(CHAIN.PUSH_TESTNET_DONUT)).toBe(true);
    });

    it('should return true for Push Chain mainnet', () => {
      expect(isPushChain(CHAIN.PUSH_MAINNET)).toBe(true);
    });

    it('should return true for Push Chain localnet', () => {
      expect(isPushChain(CHAIN.PUSH_LOCALNET)).toBe(true);
    });

    it('should return false for external EVM chains', () => {
      expect(isPushChain(CHAIN.ETHEREUM_SEPOLIA)).toBe(false);
      expect(isPushChain(CHAIN.BNB_TESTNET)).toBe(false);
      expect(isPushChain(CHAIN.ARBITRUM_SEPOLIA)).toBe(false);
    });

    it('should return false for Solana', () => {
      expect(isPushChain(CHAIN.SOLANA_DEVNET)).toBe(false);
    });
  });

  describe('isSupportedExternalChain', () => {
    it('should return true for supported EVM chains', () => {
      expect(isSupportedExternalChain(CHAIN.ETHEREUM_SEPOLIA)).toBe(true);
      expect(isSupportedExternalChain(CHAIN.BNB_TESTNET)).toBe(true);
      expect(isSupportedExternalChain(CHAIN.ARBITRUM_SEPOLIA)).toBe(true);
      expect(isSupportedExternalChain(CHAIN.BASE_SEPOLIA)).toBe(true);
    });

    it('should return false for Push Chain', () => {
      expect(isSupportedExternalChain(CHAIN.PUSH_TESTNET_DONUT)).toBe(false);
    });

    it('should return true for Solana', () => {
      expect(isSupportedExternalChain(CHAIN.SOLANA_DEVNET)).toBe(true);
    });
  });

  describe('detectRoute', () => {
    describe('Route 1: UOA_TO_PUSH', () => {
      it('should detect simple string address as UOA_TO_PUSH', () => {
        const params: UniversalExecuteParams = {
          to: '0x1234567890123456789012345678901234567890',
          value: BigInt(1000),
        };
        expect(detectRoute(params)).toBe(TransactionRoute.UOA_TO_PUSH);
      });

      it('should detect ChainTarget with Push Chain as UOA_TO_PUSH', () => {
        const params: UniversalExecuteParams = {
          to: {
            address: '0x1234567890123456789012345678901234567890',
            chain: CHAIN.PUSH_TESTNET_DONUT,
          },
          value: BigInt(1000),
        };
        expect(detectRoute(params)).toBe(TransactionRoute.UOA_TO_PUSH);
      });
    });

    describe('Route 2: UOA_TO_CEA', () => {
      it('should detect ChainTarget with external chain as UOA_TO_CEA', () => {
        const params: UniversalExecuteParams = {
          to: {
            address: '0x1234567890123456789012345678901234567890',
            chain: CHAIN.BNB_TESTNET,
          },
          value: BigInt(1000),
        };
        expect(detectRoute(params)).toBe(TransactionRoute.UOA_TO_CEA);
      });

      it('should detect with Ethereum Sepolia', () => {
        const params: UniversalExecuteParams = {
          to: {
            address: '0x1234567890123456789012345678901234567890',
            chain: CHAIN.ETHEREUM_SEPOLIA,
          },
        };
        expect(detectRoute(params)).toBe(TransactionRoute.UOA_TO_CEA);
      });
    });

    describe('Route 3: CEA_TO_PUSH', () => {
      it('should detect from.chain with Push target as CEA_TO_PUSH', () => {
        const params: UniversalExecuteParams = {
          from: { chain: CHAIN.BNB_TESTNET },
          to: {
            address: '0x1234567890123456789012345678901234567890',
            chain: CHAIN.PUSH_TESTNET_DONUT,
          },
          value: BigInt(1000),
        };
        expect(detectRoute(params)).toBe(TransactionRoute.CEA_TO_PUSH);
      });
    });

    describe('Route 4: CEA_TO_CEA', () => {
      it('should detect from.chain with external target as CEA_TO_CEA', () => {
        const params: UniversalExecuteParams = {
          from: { chain: CHAIN.BNB_TESTNET },
          to: {
            address: '0x1234567890123456789012345678901234567890',
            chain: CHAIN.ETHEREUM_SEPOLIA,
          },
          value: BigInt(1000),
        };
        expect(detectRoute(params)).toBe(TransactionRoute.CEA_TO_CEA);
      });
    });
  });

  describe('validateRouteParams', () => {
    it('should pass for valid UOA_TO_PUSH params', () => {
      const params: UniversalExecuteParams = {
        to: '0x1234567890123456789012345678901234567890',
        value: BigInt(1000),
      };
      expect(() => validateRouteParams(params)).not.toThrow();
    });

    it('should pass for valid UOA_TO_CEA params', () => {
      const params: UniversalExecuteParams = {
        to: {
          address: '0x1234567890123456789012345678901234567890',
          chain: CHAIN.BNB_TESTNET,
        },
        value: BigInt(1000),
      };
      expect(() => validateRouteParams(params)).not.toThrow();
    });

    it('should throw for invalid to address', () => {
      // Use type assertion to bypass TypeScript for testing runtime validation
      const params = {
        to: 'invalid-address',
      } as unknown as UniversalExecuteParams;
      expect(() => validateRouteParams(params)).toThrow(RouteValidationError);
    });

    it('should throw for ChainTarget with invalid address', () => {
      const params: UniversalExecuteParams = {
        to: {
          address: 'invalid' as `0x${string}`,
          chain: CHAIN.BNB_TESTNET,
        },
      };
      expect(() => validateRouteParams(params)).toThrow(RouteValidationError);
    });
  });
});

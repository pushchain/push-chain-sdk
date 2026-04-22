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
  chainEnumToName,
  findTokenChain,
} from '../route-detector';
import type { UniversalExecuteParams, ChainTarget } from '../orchestrator.types';
import { MOVEABLE_TOKEN_CONSTANTS } from '../../constants/tokens';

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

  describe('C-5: Enhanced unsupported token validation', () => {
    describe('Route 2 (UOA_TO_CEA) token validation', () => {
      it('should throw with clientChain in error message for unsupported token', () => {
        // SOL is not available on Ethereum Sepolia
        const params: UniversalExecuteParams = {
          to: {
            address: '0x1234567890123456789012345678901234567890',
            chain: CHAIN.ETHEREUM_SEPOLIA,
          },
          funds: {
            token: {
              symbol: 'SOL',
              decimals: 9,
              address: '0x0000000000000000000000000000000000000000',
              mechanism: 'native' as const,
            },
            amount: BigInt(1000),
          },
        };

        expect(() =>
          validateRouteParams(params, { clientChain: CHAIN.SOLANA_DEVNET })
        ).toThrow(RouteValidationError);

        try {
          validateRouteParams(params, { clientChain: CHAIN.SOLANA_DEVNET });
        } catch (e: unknown) {
          const msg = (e as Error).message;
          expect(msg).toContain('Unsupported moveable token');
          expect(msg).toContain('clientChain=SOLANA_DEVNET');
          expect(msg).toContain('destination=ETHEREUM_SEPOLIA');
        }
      });

      it('should pass for USDT on Ethereum Sepolia (compatible token)', () => {
        const params: UniversalExecuteParams = {
          to: {
            address: '0x1234567890123456789012345678901234567890',
            chain: CHAIN.ETHEREUM_SEPOLIA,
          },
          funds: {
            token: {
              symbol: 'USDT',
              decimals: 6,
              address: '0x7169D38820dfd117C3FA1f22a697dBA58d90BA06',
              mechanism: 'approve' as const,
            },
            amount: BigInt(1000),
          },
        };

        expect(() =>
          validateRouteParams(params, { clientChain: CHAIN.ETHEREUM_SEPOLIA })
        ).not.toThrow();
      });

      it('should throw for Push PRC-20 whose sourceChain does not match destination', () => {
        // pEth represents ETHEREUM_SEPOLIA ETH → sending to BASE_SEPOLIA is invalid.
        const params: UniversalExecuteParams = {
          to: {
            address: '0xFaE3594C68EDFc2A61b7527164BDAe80bC302108',
            chain: CHAIN.BASE_SEPOLIA,
          },
          funds: {
            token: MOVEABLE_TOKEN_CONSTANTS.PUSH_TESTNET_DONUT.pEth,
            amount: BigInt(1000),
          },
        };

        expect(() =>
          validateRouteParams(params, { clientChain: CHAIN.ETHEREUM_SEPOLIA })
        ).toThrow(RouteValidationError);

        try {
          validateRouteParams(params, { clientChain: CHAIN.ETHEREUM_SEPOLIA });
        } catch (e: unknown) {
          const msg = (e as Error).message;
          expect(msg).toContain('Unsupported moveable token');
          expect(msg).toContain('destination=BASE_SEPOLIA');
        }
      });

      it('should pass for Push PRC-20 whose sourceChain matches destination', () => {
        // pEthBase (sourceChain=BASE_SEPOLIA) → BASE_SEPOLIA is valid.
        const params: UniversalExecuteParams = {
          to: {
            address: '0xFaE3594C68EDFc2A61b7527164BDAe80bC302108',
            chain: CHAIN.BASE_SEPOLIA,
          },
          funds: {
            token: MOVEABLE_TOKEN_CONSTANTS.PUSH_TESTNET_DONUT.pEthBase,
            amount: BigInt(1000),
          },
        };

        expect(() =>
          validateRouteParams(params, { clientChain: CHAIN.ETHEREUM_SEPOLIA })
        ).not.toThrow();
      });

      it('should pass for Push PRC-20 USDT variant matching destination', () => {
        const params: UniversalExecuteParams = {
          to: {
            address: '0xFaE3594C68EDFc2A61b7527164BDAe80bC302108',
            chain: CHAIN.BASE_SEPOLIA,
          },
          funds: {
            token: MOVEABLE_TOKEN_CONSTANTS.PUSH_TESTNET_DONUT.USDT.base,
            amount: BigInt(1000),
          },
        };

        expect(() =>
          validateRouteParams(params, { clientChain: CHAIN.ETHEREUM_SEPOLIA })
        ).not.toThrow();
      });

      it('should show "unknown" clientChain when context is omitted', () => {
        const params: UniversalExecuteParams = {
          to: {
            address: '0x1234567890123456789012345678901234567890',
            chain: CHAIN.ETHEREUM_SEPOLIA,
          },
          funds: {
            token: {
              symbol: 'SOL',
              decimals: 9,
              address: '0x0000000000000000000000000000000000000000',
              mechanism: 'native' as const,
            },
            amount: BigInt(1000),
          },
        };

        try {
          validateRouteParams(params);
        } catch (e: unknown) {
          const msg = (e as Error).message;
          expect(msg).toContain('clientChain=unknown');
        }
      });
    });

    describe('Route 3 (CEA_TO_PUSH) token validation', () => {
      it('should throw for incompatible token on source chain', () => {
        // SOL is not available on Ethereum Sepolia
        const params: UniversalExecuteParams = {
          from: { chain: CHAIN.ETHEREUM_SEPOLIA },
          to: '0x1234567890123456789012345678901234567890',
          funds: {
            token: {
              symbol: 'SOL',
              decimals: 9,
              address: '0x0000000000000000000000000000000000000000',
              mechanism: 'native' as const,
            },
            amount: BigInt(1000),
          },
        };

        expect(() =>
          validateRouteParams(params, { clientChain: CHAIN.ETHEREUM_SEPOLIA })
        ).toThrow(RouteValidationError);

        try {
          validateRouteParams(params, { clientChain: CHAIN.ETHEREUM_SEPOLIA });
        } catch (e: unknown) {
          const msg = (e as Error).message;
          expect(msg).toContain('Unsupported moveable token');
          expect(msg).toContain('clientChain=ETHEREUM_SEPOLIA');
          expect(msg).toContain('source=ETHEREUM_SEPOLIA');
        }
      });

      it('should pass for compatible token on source chain', () => {
        // USDT is available on Ethereum Sepolia
        const params: UniversalExecuteParams = {
          from: { chain: CHAIN.ETHEREUM_SEPOLIA },
          to: '0x1234567890123456789012345678901234567890',
          funds: {
            token: {
              symbol: 'USDT',
              decimals: 6,
              address: '0x7169D38820dfd117C3FA1f22a697dBA58d90BA06',
              mechanism: 'approve' as const,
            },
            amount: BigInt(1000),
          },
        };

        expect(() =>
          validateRouteParams(params, { clientChain: CHAIN.ETHEREUM_SEPOLIA })
        ).not.toThrow();
      });

      it('should pass for Push PRC-20 whose sourceChain matches from.chain', () => {
        // pEth (sourceChain=ETHEREUM_SEPOLIA) with from=ETHEREUM_SEPOLIA is valid.
        const params: UniversalExecuteParams = {
          from: { chain: CHAIN.ETHEREUM_SEPOLIA },
          to: '0x1234567890123456789012345678901234567890',
          funds: {
            token: MOVEABLE_TOKEN_CONSTANTS.PUSH_TESTNET_DONUT.pEth,
            amount: BigInt(1000),
          },
        };

        expect(() =>
          validateRouteParams(params, { clientChain: CHAIN.ETHEREUM_SEPOLIA })
        ).not.toThrow();
      });

      it('should throw for Push PRC-20 whose sourceChain does not match from.chain', () => {
        // pEthBase (sourceChain=BASE_SEPOLIA) with from=ETHEREUM_SEPOLIA is invalid.
        const params: UniversalExecuteParams = {
          from: { chain: CHAIN.ETHEREUM_SEPOLIA },
          to: '0x1234567890123456789012345678901234567890',
          funds: {
            token: MOVEABLE_TOKEN_CONSTANTS.PUSH_TESTNET_DONUT.pEthBase,
            amount: BigInt(1000),
          },
        };

        expect(() =>
          validateRouteParams(params, { clientChain: CHAIN.ETHEREUM_SEPOLIA })
        ).toThrow(RouteValidationError);
      });

      it('should throw for ETH on Solana source chain', () => {
        // ETH is not available on Solana Devnet
        const params: UniversalExecuteParams = {
          from: { chain: CHAIN.SOLANA_DEVNET },
          to: '0x1234567890123456789012345678901234567890',
          funds: {
            token: {
              symbol: 'ETH',
              decimals: 18,
              address: '0x0000000000000000000000000000000000000000',
              mechanism: 'native' as const,
            },
            amount: BigInt(1000),
          },
        };

        expect(() =>
          validateRouteParams(params, { clientChain: CHAIN.SOLANA_DEVNET })
        ).toThrow(RouteValidationError);
      });
    });

    describe('error message format', () => {
      it('should include token label with chain prefix when token is found in registry', () => {
        // USDT from ETH Sepolia → send to Solana (USDT exists on both but let's use a
        // token that doesn't exist on target)
        const params: UniversalExecuteParams = {
          to: {
            address: '0x1234567890123456789012345678901234567890',
            chain: CHAIN.BNB_TESTNET,
          },
          funds: {
            token: {
              // stETH exists on Ethereum Sepolia but NOT on BNB Testnet
              symbol: 'stETH',
              decimals: 18,
              address: '0x3e3FE7dBc6B4C189E7128855dD526361c49b40Af',
              mechanism: 'approve' as const,
            },
            amount: BigInt(1000),
          },
        };

        try {
          validateRouteParams(params, { clientChain: CHAIN.ETHEREUM_SEPOLIA });
        } catch (e: unknown) {
          const msg = (e as Error).message;
          // Token found in registry → label includes chain prefix
          expect(msg).toContain('ETHEREUM_SEPOLIA.stETH');
          expect(msg).toContain('clientChain=ETHEREUM_SEPOLIA');
          expect(msg).toContain('destination=BNB_TESTNET');
        }
      });
    });
  });

  describe('chainEnumToName', () => {
    it('should return friendly name for known chains', () => {
      expect(chainEnumToName(CHAIN.ETHEREUM_SEPOLIA)).toBe('ETHEREUM_SEPOLIA');
      expect(chainEnumToName(CHAIN.SOLANA_DEVNET)).toBe('SOLANA_DEVNET');
      expect(chainEnumToName(CHAIN.BNB_TESTNET)).toBe('BNB_TESTNET');
    });

    it('should return the raw value for unknown chains', () => {
      expect(chainEnumToName('unknown:chain' as CHAIN)).toBe('unknown:chain');
    });
  });

  describe('findTokenChain', () => {
    it('should find USDT on Ethereum Sepolia by address match', () => {
      const chain = findTokenChain({
        symbol: 'USDT',
        decimals: 6,
        address: '0x7169D38820dfd117C3FA1f22a697dBA58d90BA06',
        mechanism: 'approve',
      });
      expect(chain).toBe(CHAIN.ETHEREUM_SEPOLIA);
    });

    it('should return undefined for unknown token', () => {
      const chain = findTokenChain({
        symbol: 'UNKNOWN',
        decimals: 18,
        address: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
        mechanism: 'approve',
      });
      expect(chain).toBeUndefined();
    });
  });
});

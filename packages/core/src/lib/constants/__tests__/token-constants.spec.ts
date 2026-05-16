/**
 * Unit tests for CONSTANTS.MOVEABLE.TOKEN and CONSTANTS.PAYABLE.TOKEN
 * Covers C-2 (external chain moveable tokens), C-3 (Push Chain outward tokens), C-4 (payable tokens)
 */
import { CHAIN } from '../enums';
import { SYNTHETIC_PUSH_ERC20 } from '../chain';
import { MOVEABLE_TOKEN_CONSTANTS, PAYABLE_TOKEN_CONSTANTS } from '../tokens';
import type { PushChainMoveableToken } from '../tokens';

describe('MOVEABLE_TOKEN_CONSTANTS (C-2: external chain tokens)', () => {
  describe('ETHEREUM_SEPOLIA', () => {
    it('should expose USDT with correct metadata', () => {
      const usdt = MOVEABLE_TOKEN_CONSTANTS.ETHEREUM_SEPOLIA.USDT;
      expect(usdt.symbol).toBe('USDT');
      expect(usdt.decimals).toBe(6);
      expect(usdt.address).toBe('0xC4230aEaFcF6b8B49a7b4e53886420f00ff71876');
      expect(usdt.mechanism).toBe('approve');
    });

    it('should expose ETH as native token', () => {
      const eth = MOVEABLE_TOKEN_CONSTANTS.ETHEREUM_SEPOLIA.ETH;
      expect(eth.symbol).toBe('ETH');
      expect(eth.decimals).toBe(18);
      expect(eth.mechanism).toBe('native');
    });

    it('should expose USDC', () => {
      const usdc = MOVEABLE_TOKEN_CONSTANTS.ETHEREUM_SEPOLIA.USDC;
      expect(usdc.symbol).toBe('USDC');
      expect(usdc.decimals).toBe(6);
      expect(usdc.mechanism).toBe('approve');
    });

    it('should expose WETH', () => {
      const weth = MOVEABLE_TOKEN_CONSTANTS.ETHEREUM_SEPOLIA.WETH;
      expect(weth.symbol).toBe('WETH');
      expect(weth.decimals).toBe(18);
    });

    it('should expose stETH', () => {
      const steth = MOVEABLE_TOKEN_CONSTANTS.ETHEREUM_SEPOLIA.stETH;
      expect(steth.symbol).toBe('stETH');
      expect(steth.decimals).toBe(18);
    });
  });

  describe('ARBITRUM_SEPOLIA', () => {
    it('should expose USDT', () => {
      const usdt = MOVEABLE_TOKEN_CONSTANTS.ARBITRUM_SEPOLIA.USDT;
      expect(usdt.symbol).toBe('USDT');
      expect(usdt.decimals).toBe(6);
      expect(usdt.address).toBe('0xE30928528f52CAEeB75fB07837e22d77D47e9c07');
    });

    it('should expose ETH as native', () => {
      const eth = MOVEABLE_TOKEN_CONSTANTS.ARBITRUM_SEPOLIA.ETH;
      expect(eth.mechanism).toBe('native');
    });
  });

  describe('BASE_SEPOLIA', () => {
    it('should expose USDT and USDC', () => {
      expect(MOVEABLE_TOKEN_CONSTANTS.BASE_SEPOLIA.USDT.symbol).toBe('USDT');
      expect(MOVEABLE_TOKEN_CONSTANTS.BASE_SEPOLIA.USDT.address).toBe(
        '0x4D7646B9eE3D68F4b0F135B5cbc66B00819F6b61'
      );
      expect(MOVEABLE_TOKEN_CONSTANTS.BASE_SEPOLIA.USDC.symbol).toBe('USDC');
    });
  });

  describe('BNB_TESTNET', () => {
    it('should expose USDT', () => {
      expect(MOVEABLE_TOKEN_CONSTANTS.BNB_TESTNET.USDT.symbol).toBe('USDT');
      expect(MOVEABLE_TOKEN_CONSTANTS.BNB_TESTNET.USDT.address).toBe(
        '0xE935d9c9C24D02E61186c640cc01d713C876d40F'
      );
    });

    it('should expose USDC', () => {
      expect(MOVEABLE_TOKEN_CONSTANTS.BNB_TESTNET.USDC.address).toBe(
        '0xA8802F96cAd0d45343d9bc660B6f7d80050A660b'
      );
    });

    it('should throw for SOL (unavailable on BNB)', () => {
      expect(() => MOVEABLE_TOKEN_CONSTANTS.BNB_TESTNET.SOL).toThrow(
        'SOL token not available on this chain'
      );
    });
  });

  describe('SOLANA_DEVNET', () => {
    it('should expose SOL as native token', () => {
      const sol = MOVEABLE_TOKEN_CONSTANTS.SOLANA_DEVNET.SOL;
      expect(sol.symbol).toBe('SOL');
      expect(sol.decimals).toBe(9);
      expect(sol.mechanism).toBe('native');
    });

    it('should expose USDT', () => {
      expect(MOVEABLE_TOKEN_CONSTANTS.SOLANA_DEVNET.USDT.symbol).toBe('USDT');
    });

    it('should throw for ETH (unavailable on Solana)', () => {
      expect(() => MOVEABLE_TOKEN_CONSTANTS.SOLANA_DEVNET.ETH).toThrow(
        'ETH token not available on this chain'
      );
    });
  });

  describe('ETHEREUM_MAINNET', () => {
    it('should expose ETH, USDT, WETH', () => {
      expect(MOVEABLE_TOKEN_CONSTANTS.ETHEREUM_MAINNET.ETH.symbol).toBe('ETH');
      expect(MOVEABLE_TOKEN_CONSTANTS.ETHEREUM_MAINNET.USDT.symbol).toBe('USDT');
      expect(MOVEABLE_TOKEN_CONSTANTS.ETHEREUM_MAINNET.WETH.symbol).toBe('WETH');
    });
  });
});

describe('MOVEABLE_TOKEN_CONSTANTS.PUSH_TESTNET_DONUT (C-3: outward tokens)', () => {
  const pushTokens = MOVEABLE_TOKEN_CONSTANTS.PUSH_TESTNET_DONUT;
  const synth = SYNTHETIC_PUSH_ERC20['TESTNET_DONUT'];

  describe('deployed stable PRC-20 addresses on Push Chain', () => {
    it('should use the current USDT deployment addresses', () => {
      expect(synth.USDT_ETH).toBe(
        '0x0f97A213207703923F5f0C613C9827f7C9A0f96B'
      );
      expect(synth.USDT_ARB).toBe(
        '0xFE6E9DF2BbC9ce05D98b83B1365df6DcA9951891'
      );
      expect(synth.USDT_BASE).toBe(
        '0x148823809B853e1db187BC09A9ac909BC42F971a'
      );
      expect(synth.USDT_BSC).toBe(
        '0x731aF1Da5365259d27528557EE4aFBA4baC90ef2'
      );
      expect(synth.USDT_BNB).toBe(synth.USDT_BSC);
    });

    it('should use the current USDC BSC deployment address', () => {
      expect(synth.USDC_BSC).toBe(
        '0x120EBf25Dad7D6a09Ad2316f23f9Be95DBb90639'
      );
      expect(synth.USDC_BNB).toBe(synth.USDC_BSC);
    });
  });

  describe('native wrapped tokens', () => {
    it('should expose pEth with correct sourceChain and prc20Address', () => {
      const pEth = pushTokens.pEth;
      expect(pEth.symbol).toBe('pETH');
      expect(pEth.decimals).toBe(18);
      expect(pEth.mechanism).toBe('approve');
      expect(pEth.sourceChain).toBe(CHAIN.ETHEREUM_SEPOLIA);
      expect(pEth.prc20Address).toBe(synth.pETH);
      expect(pEth.address).toBe(synth.pETH);
    });

    it('should expose pEthArb sourced from Arbitrum', () => {
      const t = pushTokens.pEthArb;
      expect(t.symbol).toBe('pETH_ARB');
      expect(t.sourceChain).toBe(CHAIN.ARBITRUM_SEPOLIA);
      expect(t.prc20Address).toBe(synth.pETH_ARB);
    });

    it('should expose pEthBase sourced from Base', () => {
      const t = pushTokens.pEthBase;
      expect(t.symbol).toBe('pETH_BASE');
      expect(t.sourceChain).toBe(CHAIN.BASE_SEPOLIA);
      expect(t.prc20Address).toBe(synth.pETH_BASE);
    });

    it('should expose pBnb sourced from BNB', () => {
      const t = pushTokens.pBnb;
      expect(t.symbol).toBe('pBNB');
      expect(t.sourceChain).toBe(CHAIN.BNB_TESTNET);
      expect(t.prc20Address).toBe(synth.pBNB);
    });

    it('should expose pSol sourced from Solana', () => {
      const t = pushTokens.pSol;
      expect(t.symbol).toBe('pSOL');
      expect(t.decimals).toBe(9);
      expect(t.sourceChain).toBe(CHAIN.SOLANA_DEVNET);
      expect(t.prc20Address).toBe(synth.pSOL);
    });
  });

  describe('USDT chain-suffix accessor', () => {
    it('should expose USDT.eth from Ethereum Sepolia', () => {
      const t = pushTokens.USDT.eth;
      expect(t.symbol).toBe('USDT');
      expect(t.decimals).toBe(6);
      expect(t.sourceChain).toBe(CHAIN.ETHEREUM_SEPOLIA);
      expect(t.prc20Address).toBe(synth.USDT_ETH);
    });

    it('should expose USDT.arb from Arbitrum', () => {
      const t = pushTokens.USDT.arb;
      expect(t.sourceChain).toBe(CHAIN.ARBITRUM_SEPOLIA);
      expect(t.prc20Address).toBe(synth.USDT_ARB);
    });

    it('should expose USDT.base from Base', () => {
      const t = pushTokens.USDT.base;
      expect(t.sourceChain).toBe(CHAIN.BASE_SEPOLIA);
      expect(t.prc20Address).toBe(synth.USDT_BASE);
    });

    it('should expose USDT.bsc from BSC', () => {
      const t = pushTokens.USDT.bsc;
      expect(t.sourceChain).toBe(CHAIN.BNB_TESTNET);
      expect(t.prc20Address).toBe(synth.USDT_BSC);
    });

    it('should keep USDT.bnb as a deprecated alias', () => {
      expect(pushTokens.USDT.bnb).toBe(pushTokens.USDT.bsc);
      expect(synth.USDT_BNB).toBe(synth.USDT_BSC);
    });

    it('should expose USDT.sol from Solana', () => {
      const t = pushTokens.USDT.sol;
      expect(t.sourceChain).toBe(CHAIN.SOLANA_DEVNET);
      expect(t.prc20Address).toBe(synth.USDT_SOL);
    });

    it('USDT.eth and USDT.sol should have different prc20Addresses', () => {
      expect(pushTokens.USDT.eth.prc20Address).not.toBe(
        pushTokens.USDT.sol.prc20Address
      );
    });
  });

  describe('USDC chain-suffix accessor', () => {
    it('should expose USDC.eth from Ethereum Sepolia', () => {
      const t = pushTokens.USDC.eth;
      expect(t.symbol).toBe('USDC');
      expect(t.sourceChain).toBe(CHAIN.ETHEREUM_SEPOLIA);
      expect(t.prc20Address).toBe(synth.USDC_ETH);
    });

    it('should expose USDC.arb from Arbitrum', () => {
      expect(pushTokens.USDC.arb.prc20Address).toBe(synth.USDC_ARB);
    });

    it('should expose USDC.base from Base', () => {
      expect(pushTokens.USDC.base.prc20Address).toBe(synth.USDC_BASE);
    });

    it('should expose USDC.sol from Solana', () => {
      expect(pushTokens.USDC.sol.prc20Address).toBe(synth.USDC_SOL);
    });

    it('should expose USDC.bsc from BSC', () => {
      const t = pushTokens.USDC.bsc;
      expect(t.sourceChain).toBe(CHAIN.BNB_TESTNET);
      expect(t.prc20Address).toBe(synth.USDC_BSC);
    });

    it('should keep USDC.bnb as a deprecated alias', () => {
      expect(pushTokens.USDC.bnb).toBe(pushTokens.USDC.bsc);
      expect(synth.USDC_BNB).toBe(synth.USDC_BSC);
    });
  });

  describe('PushChainMoveableToken interface compliance', () => {
    it('all tokens should have required PushChainMoveableToken fields', () => {
      const tokens: PushChainMoveableToken[] = [
        pushTokens.pEth,
        pushTokens.pEthArb,
        pushTokens.pEthBase,
        pushTokens.pBnb,
        pushTokens.pSol,
        pushTokens.USDT.eth,
        pushTokens.USDT.arb,
        pushTokens.USDT.base,
        pushTokens.USDT.bsc,
        pushTokens.USDT.sol,
        pushTokens.USDC.eth,
        pushTokens.USDC.arb,
        pushTokens.USDC.base,
        pushTokens.USDC.bsc,
        pushTokens.USDC.sol,
      ];

      for (const t of tokens) {
        expect(t).toHaveProperty('symbol');
        expect(t).toHaveProperty('decimals');
        expect(t).toHaveProperty('address');
        expect(t).toHaveProperty('mechanism');
        expect(t).toHaveProperty('sourceChain');
        expect(t).toHaveProperty('prc20Address');
        expect(typeof t.symbol).toBe('string');
        expect(typeof t.decimals).toBe('number');
        expect(t.address).toMatch(/^0x/);
        expect(t.prc20Address).toMatch(/^0x/);
      }
    });
  });
});

describe('PAYABLE_TOKEN_CONSTANTS (C-4: payable tokens)', () => {
  describe('ETHEREUM_SEPOLIA', () => {
    it('should expose USDT', () => {
      const usdt = PAYABLE_TOKEN_CONSTANTS.ETHEREUM_SEPOLIA.USDT;
      expect(usdt.symbol).toBe('USDT');
      expect(usdt.decimals).toBe(6);
      expect(usdt.mechanism).toBe('approve');
    });

    it('should expose ETH as native', () => {
      const eth = PAYABLE_TOKEN_CONSTANTS.ETHEREUM_SEPOLIA.ETH;
      expect(eth.mechanism).toBe('native');
    });

    it('should expose USDC', () => {
      expect(PAYABLE_TOKEN_CONSTANTS.ETHEREUM_SEPOLIA.USDC.symbol).toBe('USDC');
    });

    it('should expose stETH', () => {
      expect(PAYABLE_TOKEN_CONSTANTS.ETHEREUM_SEPOLIA.stETH.symbol).toBe('stETH');
    });
  });

  describe('BNB_TESTNET', () => {
    it('should expose USDT', () => {
      expect(PAYABLE_TOKEN_CONSTANTS.BNB_TESTNET.USDT.symbol).toBe('USDT');
    });

    it('should expose USDC', () => {
      expect(PAYABLE_TOKEN_CONSTANTS.BNB_TESTNET.USDC.symbol).toBe('USDC');
    });
  });

  describe('SOLANA_DEVNET', () => {
    it('should expose SOL as native token (payable)', () => {
      // Note: PayableTokenAccessor doesn't have SOL getter, but it has USDT/USDC
      expect(PAYABLE_TOKEN_CONSTANTS.SOLANA_DEVNET.USDT.symbol).toBe('USDT');
      expect(PAYABLE_TOKEN_CONSTANTS.SOLANA_DEVNET.USDC.symbol).toBe('USDC');
    });
  });

  describe('ARBITRUM_SEPOLIA', () => {
    it('should expose ETH and USDT', () => {
      expect(PAYABLE_TOKEN_CONSTANTS.ARBITRUM_SEPOLIA.ETH.mechanism).toBe('native');
      expect(PAYABLE_TOKEN_CONSTANTS.ARBITRUM_SEPOLIA.USDT.symbol).toBe('USDT');
    });
  });

  describe('BASE_SEPOLIA', () => {
    it('should expose ETH, USDT, USDC', () => {
      expect(PAYABLE_TOKEN_CONSTANTS.BASE_SEPOLIA.ETH.mechanism).toBe('native');
      expect(PAYABLE_TOKEN_CONSTANTS.BASE_SEPOLIA.USDT.symbol).toBe('USDT');
      expect(PAYABLE_TOKEN_CONSTANTS.BASE_SEPOLIA.USDC.symbol).toBe('USDC');
    });
  });

  describe('ETHEREUM_MAINNET', () => {
    it('should expose ETH and USDT', () => {
      expect(PAYABLE_TOKEN_CONSTANTS.ETHEREUM_MAINNET.ETH.mechanism).toBe('native');
      expect(PAYABLE_TOKEN_CONSTANTS.ETHEREUM_MAINNET.USDT.symbol).toBe('USDT');
    });
  });
});

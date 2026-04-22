import { CHAIN, PUSH_NETWORK } from './enums';
import { SYNTHETIC_PUSH_ERC20 } from './chain';

export interface MoveableToken {
  symbol: string;
  decimals: number;
  address: string; // chain-native may use a sentinel value
  // TODO: If true, then we do a ERC-20 approve. If false, then permit2 or similar.
  // TODO: Rename it to `mechanism`. Then have it as enum: `approve` or `permit2` or `native`
  // requiresApprove: boolean; // true for ERC20/SPL, false for native tokens
  mechanism: 'approve' | 'permit2' | 'native';
}

export interface PayableToken {
  symbol: string;
  decimals: number;
  address: string;
  mechanism: 'approve' | 'permit2' | 'native';
}

// Explicit token symbol maps to enable dot-access (no index signature errors)
export type MoveableTokenMap = Partial<{
  ETH: MoveableToken;
  SOL: MoveableToken;
  USDT: MoveableToken;
  USDC: MoveableToken;
  WETH: MoveableToken;
  stETH: MoveableToken;
  DAI: MoveableToken;
}>;

export type PayableTokenMap = Partial<{
  ETH: PayableToken;
  USDT: PayableToken;
  USDC: PayableToken;
  WETH: PayableToken;
  stETH: PayableToken;
  DAI: PayableToken;
}>;

// Strongly-typed accessors that throw at runtime if a token is unavailable,
// while providing non-undefined types at compile time.
export class MoveableTokenAccessor {
  constructor(private readonly tokens: Record<string, MoveableToken>) {}

  private require(name: keyof MoveableTokenMap): MoveableToken {
    const t = this.tokens[name as string];
    if (!t)
      throw new Error(`${String(name)} token not available on this chain`);
    return t;
  }

  get ETH(): MoveableToken {
    return this.require('ETH');
  }
  get SOL(): MoveableToken {
    return this.require('SOL');
  }
  get USDT(): MoveableToken {
    return this.require('USDT');
  }
  get WETH(): MoveableToken {
    return this.require('WETH');
  }
  get USDC(): MoveableToken {
    return this.require('USDC');
  }
  get stETH(): MoveableToken {
    return this.require('stETH');
  }
  get DAI(): MoveableToken {
    return this.require('DAI');
  }
}

export class PayableTokenAccessor {
  constructor(private readonly tokens: Record<string, PayableToken>) {}

  private require(name: keyof PayableTokenMap): PayableToken {
    const t = this.tokens[name as string];
    if (!t)
      throw new Error(`${String(name)} token not available on this chain`);
    return t;
  }

  get ETH(): PayableToken {
    return this.require('ETH');
  }
  get USDT(): PayableToken {
    return this.require('USDT');
  }
  get USDC(): PayableToken {
    return this.require('USDC');
  }
  get WETH(): PayableToken {
    return this.require('WETH');
  }
  get stETH(): PayableToken {
    return this.require('stETH');
  }
}

export interface ConversionQuote {
  amountIn: string; // smallest units
  amountOut: string; // smallest units
  rate: number; // normalized (tokenOut per tokenIn)
  route?: string[]; // optional: swap path if available
  timestamp: number; // unix ms
}

// Native token sentinel addresses
const NATIVE: `0x${string}` = '0x0000000000000000000000000000000000000000';

// Centralized token metadata by chain to avoid duplication (symbol, decimals, address, mechanism)
type TokenMeta = {
  symbol: string;
  decimals: number;
  address: string;
  mechanism: 'approve' | 'permit2' | 'native';
};

const TOKEN_META: Partial<Record<CHAIN, Record<string, TokenMeta>>> = {
  // Ethereum Sepolia (testnet)
  [CHAIN.ETHEREUM_SEPOLIA]: {
    ETH: {
      symbol: 'ETH',
      decimals: 18,
      address: NATIVE,
      mechanism: 'native',
    },
    USDT: {
      symbol: 'USDT',
      decimals: 6,
      address: '0x7169D38820dfd117C3FA1f22a697dBA58d90BA06',
      mechanism: 'approve',
    },
    WETH: {
      symbol: 'WETH',
      decimals: 18,
      address: '0xfff9976782d46cc05630d1f6ebab18b2324d6b14',
      mechanism: 'approve',
    },
    USDC: {
      symbol: 'USDC',
      decimals: 6,
      address: '0x97F477B7f970D47a87B42869ceeace218106152a',
      mechanism: 'approve',
    },
    stETH: {
      symbol: 'stETH',
      decimals: 18,
      address: '0x3e3FE7dBc6B4C189E7128855dD526361c49b40Af',
      mechanism: 'approve',
    },
  },

  // Ethereum Mainnet
  [CHAIN.ETHEREUM_MAINNET]: {
    ETH: {
      symbol: 'ETH',
      decimals: 18,
      address: NATIVE,
      mechanism: 'native',
    },
    USDT: {
      symbol: 'USDT',
      decimals: 6,
      address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      mechanism: 'approve',
    },
    WETH: {
      symbol: 'WETH',
      decimals: 18,
      address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      mechanism: 'approve',
    },
  },

  // Arbitrum Sepolia
  [CHAIN.ARBITRUM_SEPOLIA]: {
    ETH: {
      symbol: 'ETH',
      decimals: 18,
      address: NATIVE,
      mechanism: 'native',
    },
    USDT: {
      symbol: 'USDT',
      decimals: 6,
      address: '0x1419d7C74D234fA6B73E06A2ce7822C1d37922f0',
      mechanism: 'approve',
    },
    USDC: {
      symbol: 'USDC',
      decimals: 6,
      address: '0x5dd39b0b3610F666F631a6506b7713EF83e1Ac5C',
      mechanism: 'approve',
    },
    WETH: {
      symbol: 'WETH',
      decimals: 18,
      address: '0x980B62Da83eFf3D4576C647993b0c1D7faf17c73',
      mechanism: 'approve',
    },
  },

  // Base Sepolia
  [CHAIN.BASE_SEPOLIA]: {
    ETH: {
      symbol: 'ETH',
      decimals: 18,
      address: NATIVE,
      mechanism: 'native',
    },
    USDT: {
      symbol: 'USDT',
      decimals: 6,
      address: '0x9FF5a186f53F6E6964B00320Da1D2024DE11E0cB',
      mechanism: 'approve',
    },
    USDC: {
      symbol: 'USDC',
      decimals: 6,
      address: '0x5c3504F0E3bA28FDc1F74234fE936518276AaBB8',
      mechanism: 'approve',
    },
    WETH: {
      symbol: 'WETH',
      decimals: 18,
      address: '0xfff9976782d46cc05630d1f6ebab18b2324d6b14',
      mechanism: 'approve',
    },
  },

  // BNB Testnet
  [CHAIN.BNB_TESTNET]: {
    // NOTE: Both symbols are provided to mirror existing usage across maps
    BNB: {
      symbol: 'BNB',
      decimals: 18,
      address: NATIVE,
      mechanism: 'native',
    },
    ETH: {
      symbol: 'ETH',
      decimals: 18,
      address: NATIVE,
      mechanism: 'native',
    },
    USDT: {
      symbol: 'USDT',
      decimals: 6,
      address: '0xBC14F348BC9667be46b35Edc9B68653d86013DC5',
      mechanism: 'approve',
    },
    DAI: {
      symbol: 'DAI',
      decimals: 18,
      address: '0xEC5dCb5Dbf4B114C9d0F65BcCAb49EC54F6A0867',
      mechanism: 'approve',
    },
  },

  // Solana Devnet
  [CHAIN.SOLANA_DEVNET]: {
    SOL: {
      symbol: 'SOL',
      decimals: 9,
      address: NATIVE,
      mechanism: 'native',
    },
    USDT: {
      symbol: 'USDT',
      decimals: 6,
      address: 'EiXDnrAg9ea2Q6vEPV7E5TpTU1vh41jcuZqKjU5Dc4ZF',
      mechanism: 'approve',
    },
    USDC: {
      symbol: 'USDC',
      decimals: 6,
      address: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
      mechanism: 'approve',
    },
    DAI: {
      symbol: 'DAI',
      decimals: 18,
      address: 'G2ZLaRhpohW23KTEX3fBjZXtNTFFwemqCaWWnWVTj4TB',
      mechanism: 'approve',
    },
  },
};

function makeToken(chain: CHAIN, symbol: string) {
  const meta = TOKEN_META[chain]?.[symbol];
  if (!meta) throw new Error(`Token ${symbol} not available on chain ${chain}`);
  return {
    symbol: meta.symbol,
    decimals: meta.decimals,
    address: meta.address,
    mechanism: meta.mechanism,
  };
}

// Flat PRC-20 list for Push Chain — synthetic ERC-20 representations of
// origin-chain assets that can be moved out of Push Chain back to their source.
// Source of truth: SYNTHETIC_PUSH_ERC20 in ./chain.
function buildPushChainMoveableTokenList(): MoveableToken[] {
  const s = SYNTHETIC_PUSH_ERC20[PUSH_NETWORK.TESTNET_DONUT];
  const mk = (
    symbol: string,
    decimals: number,
    address: `0x${string}`
  ): MoveableToken => ({ symbol, decimals, address, mechanism: 'approve' });
  return [
    mk('pETH', 18, s.pETH),
    mk('pETH_ARB', 18, s.pETH_ARB),
    mk('pETH_BASE', 18, s.pETH_BASE),
    mk('pETH_BNB', 18, s.pETH_BNB),
    mk('pSOL', 9, s.pSOL),
    mk('USDT', 6, s.USDT_ETH),
    mk('USDT', 6, s.USDT_ARB),
    mk('USDT', 6, s.USDT_BASE),
    mk('USDT', 6, s.USDT_BNB),
    mk('USDT', 6, s.USDT_SOL),
    mk('USDC', 6, s.USDC_ETH),
    mk('USDC', 6, s.USDC_ARB),
    mk('USDC', 6, s.USDC_BASE),
    mk('USDC', 6, s.USDC_BNB),
    mk('USDC', 6, s.USDC_SOL),
    mk('WETH', 18, s.WETH_ETH),
    mk('stETH', 18, s.stETH_ETH),
    mk('DAI', 18, s.DAI_SOL),
  ];
}

// Minimal initial registries. These can be extended safely without breaking the API.
export const MOVEABLE_TOKENS: Partial<Record<CHAIN, MoveableToken[]>> = {
  [CHAIN.PUSH_TESTNET_DONUT]: buildPushChainMoveableTokenList(),
  [CHAIN.ETHEREUM_SEPOLIA]: [
    makeToken(CHAIN.ETHEREUM_SEPOLIA, 'ETH'),
    makeToken(CHAIN.ETHEREUM_SEPOLIA, 'USDT'),
    makeToken(CHAIN.ETHEREUM_SEPOLIA, 'USDC'),
    makeToken(CHAIN.ETHEREUM_SEPOLIA, 'WETH'),
    makeToken(CHAIN.ETHEREUM_SEPOLIA, 'stETH'),
  ],
  [CHAIN.ETHEREUM_MAINNET]: [
    makeToken(CHAIN.ETHEREUM_MAINNET, 'ETH'),
    makeToken(CHAIN.ETHEREUM_MAINNET, 'USDT'),
    makeToken(CHAIN.ETHEREUM_MAINNET, 'WETH'),
  ],
  [CHAIN.ARBITRUM_SEPOLIA]: [
    makeToken(CHAIN.ARBITRUM_SEPOLIA, 'ETH'),
    makeToken(CHAIN.ARBITRUM_SEPOLIA, 'USDT'),
    makeToken(CHAIN.ARBITRUM_SEPOLIA, 'USDC'),
    makeToken(CHAIN.ARBITRUM_SEPOLIA, 'WETH'),
  ],
  [CHAIN.BASE_SEPOLIA]: [
    makeToken(CHAIN.BASE_SEPOLIA, 'ETH'),
    makeToken(CHAIN.BASE_SEPOLIA, 'USDT'),
    makeToken(CHAIN.BASE_SEPOLIA, 'USDC'),
    makeToken(CHAIN.BASE_SEPOLIA, 'WETH'),
  ],
  [CHAIN.BNB_TESTNET]: [
    makeToken(CHAIN.BNB_TESTNET, 'ETH'),
    makeToken(CHAIN.BNB_TESTNET, 'USDT'),
    makeToken(CHAIN.BNB_TESTNET, 'DAI'),
  ],
  [CHAIN.SOLANA_DEVNET]: [
    makeToken(CHAIN.SOLANA_DEVNET, 'SOL'),
    makeToken(CHAIN.SOLANA_DEVNET, 'USDT'),
    makeToken(CHAIN.SOLANA_DEVNET, 'USDC'),
    makeToken(CHAIN.SOLANA_DEVNET, 'DAI'),
  ],
};

export const PAYABLE_TOKENS: Partial<Record<CHAIN, PayableToken[]>> = {
  [CHAIN.ETHEREUM_SEPOLIA]: [
    makeToken(CHAIN.ETHEREUM_SEPOLIA, 'ETH'),
    makeToken(CHAIN.ETHEREUM_SEPOLIA, 'USDT'),
    makeToken(CHAIN.ETHEREUM_SEPOLIA, 'USDC'),
    makeToken(CHAIN.ETHEREUM_SEPOLIA, 'WETH'),
    makeToken(CHAIN.ETHEREUM_SEPOLIA, 'stETH'),
  ],
  [CHAIN.ETHEREUM_MAINNET]: [
    makeToken(CHAIN.ETHEREUM_MAINNET, 'ETH'),
    makeToken(CHAIN.ETHEREUM_MAINNET, 'USDT'),
    makeToken(CHAIN.ETHEREUM_MAINNET, 'WETH'),
  ],
  [CHAIN.ARBITRUM_SEPOLIA]: [
    makeToken(CHAIN.ARBITRUM_SEPOLIA, 'ETH'),
    makeToken(CHAIN.ARBITRUM_SEPOLIA, 'USDT'),
    makeToken(CHAIN.ARBITRUM_SEPOLIA, 'USDC'),
  ],
  [CHAIN.BASE_SEPOLIA]: [
    makeToken(CHAIN.BASE_SEPOLIA, 'ETH'),
    makeToken(CHAIN.BASE_SEPOLIA, 'USDT'),
    makeToken(CHAIN.BASE_SEPOLIA, 'USDC'),
  ],
  [CHAIN.BNB_TESTNET]: [
    makeToken(CHAIN.BNB_TESTNET, 'BNB'),
    makeToken(CHAIN.BNB_TESTNET, 'USDT'),
  ],
  [CHAIN.SOLANA_DEVNET]: [
    makeToken(CHAIN.SOLANA_DEVNET, 'SOL'),
    makeToken(CHAIN.SOLANA_DEVNET, 'USDT'),
    makeToken(CHAIN.SOLANA_DEVNET, 'USDC'),
  ],
};

// ---------------------------------------------------------------------------
// C-2 / C-3 / C-4: Static CONSTANTS.MOVEABLE.TOKEN and CONSTANTS.PAYABLE.TOKEN
// ---------------------------------------------------------------------------

// Extends MoveableToken with Push Chain outbound context (C-3)
export interface PushChainMoveableToken extends MoveableToken {
  /** The external chain this synthetic PRC-20 asset is bridged from */
  sourceChain: CHAIN;
  /** The PRC-20 address on Push Chain */
  prc20Address: `0x${string}`;
}

// Chain-suffix accessor for multi-origin tokens like USDT, USDC (C-3)
export interface ChainSuffixAccessor {
  readonly eth: PushChainMoveableToken;
  readonly arb: PushChainMoveableToken;
  readonly base: PushChainMoveableToken;
  readonly bnb: PushChainMoveableToken;
  readonly sol: PushChainMoveableToken;
}

// Push Chain outward token accessor type (C-3)
export interface PushChainMoveableTokenAccessor {
  readonly pEth: PushChainMoveableToken;
  readonly pEthArb: PushChainMoveableToken;
  readonly pEthBase: PushChainMoveableToken;
  readonly pEthBnb: PushChainMoveableToken;
  readonly pSol: PushChainMoveableToken;
  readonly pWeth: PushChainMoveableToken;
  readonly pStEth: PushChainMoveableToken;
  readonly pDai: PushChainMoveableToken;
  readonly USDT: ChainSuffixAccessor;
  readonly USDC: ChainSuffixAccessor;
}

// Combined type for CONSTANTS.MOVEABLE.TOKEN (C-2 + C-3)
export type MoveableTokenConstantsMap = {
  ETHEREUM_SEPOLIA: MoveableTokenAccessor;
  ETHEREUM_MAINNET: MoveableTokenAccessor;
  ARBITRUM_SEPOLIA: MoveableTokenAccessor;
  BASE_SEPOLIA: MoveableTokenAccessor;
  BNB_TESTNET: MoveableTokenAccessor;
  SOLANA_DEVNET: MoveableTokenAccessor;
  PUSH_TESTNET_DONUT: PushChainMoveableTokenAccessor;
};

// Type for CONSTANTS.PAYABLE.TOKEN (C-4)
export type PayableTokenConstantsMap = {
  ETHEREUM_SEPOLIA: PayableTokenAccessor;
  ETHEREUM_MAINNET: PayableTokenAccessor;
  ARBITRUM_SEPOLIA: PayableTokenAccessor;
  BASE_SEPOLIA: PayableTokenAccessor;
  BNB_TESTNET: PayableTokenAccessor;
  SOLANA_DEVNET: PayableTokenAccessor;
};

// Helper: token array → Record<symbol, Token>
const toSymbolMap = <T extends { symbol: string }>(
  arr: T[] | undefined
): Record<string, T> =>
  (arr ?? []).reduce<Record<string, T>>((acc, t) => {
    acc[t.symbol] = t;
    return acc;
  }, {});

function buildPushChainMoveableTokenAccessor(): PushChainMoveableTokenAccessor {
  const s = SYNTHETIC_PUSH_ERC20[PUSH_NETWORK.TESTNET_DONUT];

  const mk = (
    symbol: string,
    decimals: number,
    address: `0x${string}`,
    sourceChain: CHAIN
  ): PushChainMoveableToken => ({
    symbol,
    decimals,
    address,
    mechanism: 'approve',
    sourceChain,
    prc20Address: address,
  });

  return {
    pEth: mk('pETH', 18, s.pETH, CHAIN.ETHEREUM_SEPOLIA),
    pEthArb: mk('pETH_ARB', 18, s.pETH_ARB, CHAIN.ARBITRUM_SEPOLIA),
    pEthBase: mk('pETH_BASE', 18, s.pETH_BASE, CHAIN.BASE_SEPOLIA),
    pEthBnb: mk('pETH_BNB', 18, s.pETH_BNB, CHAIN.BNB_TESTNET),
    pSol: mk('pSOL', 9, s.pSOL, CHAIN.SOLANA_DEVNET),
    pWeth: mk('WETH', 18, s.WETH_ETH, CHAIN.ETHEREUM_SEPOLIA),
    pStEth: mk('stETH', 18, s.stETH_ETH, CHAIN.ETHEREUM_SEPOLIA),
    pDai: mk('DAI', 18, s.DAI_SOL, CHAIN.SOLANA_DEVNET),
    USDT: {
      eth: mk('USDT', 6, s.USDT_ETH, CHAIN.ETHEREUM_SEPOLIA),
      arb: mk('USDT', 6, s.USDT_ARB, CHAIN.ARBITRUM_SEPOLIA),
      base: mk('USDT', 6, s.USDT_BASE, CHAIN.BASE_SEPOLIA),
      bnb: mk('USDT', 6, s.USDT_BNB, CHAIN.BNB_TESTNET),
      sol: mk('USDT', 6, s.USDT_SOL, CHAIN.SOLANA_DEVNET),
    },
    USDC: {
      eth: mk('USDC', 6, s.USDC_ETH, CHAIN.ETHEREUM_SEPOLIA),
      arb: mk('USDC', 6, s.USDC_ARB, CHAIN.ARBITRUM_SEPOLIA),
      base: mk('USDC', 6, s.USDC_BASE, CHAIN.BASE_SEPOLIA),
      bnb: mk('USDC', 6, s.USDC_BNB, CHAIN.BNB_TESTNET),
      sol: mk('USDC', 6, s.USDC_SOL, CHAIN.SOLANA_DEVNET),
    },
  };
}

function buildMoveableTokenConstants(): MoveableTokenConstantsMap {
  return {
    ETHEREUM_SEPOLIA: new MoveableTokenAccessor(
      toSymbolMap(MOVEABLE_TOKENS[CHAIN.ETHEREUM_SEPOLIA]) as Record<
        string,
        MoveableToken
      >
    ),
    ETHEREUM_MAINNET: new MoveableTokenAccessor(
      toSymbolMap(MOVEABLE_TOKENS[CHAIN.ETHEREUM_MAINNET]) as Record<
        string,
        MoveableToken
      >
    ),
    ARBITRUM_SEPOLIA: new MoveableTokenAccessor(
      toSymbolMap(MOVEABLE_TOKENS[CHAIN.ARBITRUM_SEPOLIA]) as Record<
        string,
        MoveableToken
      >
    ),
    BASE_SEPOLIA: new MoveableTokenAccessor(
      toSymbolMap(MOVEABLE_TOKENS[CHAIN.BASE_SEPOLIA]) as Record<
        string,
        MoveableToken
      >
    ),
    BNB_TESTNET: new MoveableTokenAccessor(
      toSymbolMap(MOVEABLE_TOKENS[CHAIN.BNB_TESTNET]) as Record<
        string,
        MoveableToken
      >
    ),
    SOLANA_DEVNET: new MoveableTokenAccessor(
      toSymbolMap(MOVEABLE_TOKENS[CHAIN.SOLANA_DEVNET]) as Record<
        string,
        MoveableToken
      >
    ),
    PUSH_TESTNET_DONUT: buildPushChainMoveableTokenAccessor(),
  };
}

function buildPayableTokenConstants(): PayableTokenConstantsMap {
  return {
    ETHEREUM_SEPOLIA: new PayableTokenAccessor(
      toSymbolMap(PAYABLE_TOKENS[CHAIN.ETHEREUM_SEPOLIA]) as Record<
        string,
        PayableToken
      >
    ),
    ETHEREUM_MAINNET: new PayableTokenAccessor(
      toSymbolMap(PAYABLE_TOKENS[CHAIN.ETHEREUM_MAINNET]) as Record<
        string,
        PayableToken
      >
    ),
    ARBITRUM_SEPOLIA: new PayableTokenAccessor(
      toSymbolMap(PAYABLE_TOKENS[CHAIN.ARBITRUM_SEPOLIA]) as Record<
        string,
        PayableToken
      >
    ),
    BASE_SEPOLIA: new PayableTokenAccessor(
      toSymbolMap(PAYABLE_TOKENS[CHAIN.BASE_SEPOLIA]) as Record<
        string,
        PayableToken
      >
    ),
    BNB_TESTNET: new PayableTokenAccessor(
      toSymbolMap(PAYABLE_TOKENS[CHAIN.BNB_TESTNET]) as Record<
        string,
        PayableToken
      >
    ),
    SOLANA_DEVNET: new PayableTokenAccessor(
      toSymbolMap(PAYABLE_TOKENS[CHAIN.SOLANA_DEVNET]) as Record<
        string,
        PayableToken
      >
    ),
  };
}

export const MOVEABLE_TOKEN_CONSTANTS = buildMoveableTokenConstants();
export const PAYABLE_TOKEN_CONSTANTS = buildPayableTokenConstants();

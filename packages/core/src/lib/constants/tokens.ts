import { CHAIN } from './enums';

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
  WETH: MoveableToken;
}>;

export type PayableTokenMap = Partial<{
  ETH: PayableToken;
  USDT: PayableToken;
  WETH: PayableToken;
  USDC: PayableToken;
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
}

export interface ConversionQuote {
  amountIn: string; // smallest units
  amountOut: string; // smallest units
  rate: number; // normalized (tokenOut per tokenIn)
  route?: string[]; // optional: swap path if available
  timestamp: number; // unix ms
}

// Native token sentinel addresses
const EVM_NATIVE: `0x${string}` = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

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
      address: EVM_NATIVE,
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
      address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
      mechanism: 'approve',
    },
  },

  // Ethereum Mainnet
  [CHAIN.ETHEREUM_MAINNET]: {
    ETH: {
      symbol: 'ETH',
      decimals: 18,
      address: EVM_NATIVE,
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
      address: EVM_NATIVE,
      mechanism: 'native',
    },
    USDT: {
      symbol: 'USDT',
      decimals: 6,
      address: '0x1419d7C74D234fA6B73E06A2ce7822C1d37922f0',
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
      address: EVM_NATIVE,
      mechanism: 'native',
    },
    USDT: {
      symbol: 'USDT',
      decimals: 6,
      address: '0x9FF5a186f53F6E6964B00320Da1D2024DE11E0cB',
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
      address: EVM_NATIVE,
      mechanism: 'native',
    },
    ETH: {
      symbol: 'ETH',
      decimals: 18,
      address: EVM_NATIVE,
      mechanism: 'native',
    },
    USDT: {
      symbol: 'USDT',
      decimals: 6,
      address: '0xBC14F348BC9667be46b35Edc9B68653d86013DC5',
      mechanism: 'approve',
    },
  },

  // Solana Devnet
  [CHAIN.SOLANA_DEVNET]: {
    SOL: {
      symbol: 'SOL',
      decimals: 9,
      address: 'solana-native',
      mechanism: 'native',
    },
    USDT: {
      symbol: 'USDT',
      decimals: 6,
      address: 'EiXDnrAg9ea2Q6vEPV7E5TpTU1vh41jcuZqKjU5Dc4ZF',
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

// Minimal initial registries. These can be extended safely without breaking the API.
export const MOVEABLE_TOKENS: Partial<Record<CHAIN, MoveableToken[]>> = {
  [CHAIN.ETHEREUM_SEPOLIA]: [
    makeToken(CHAIN.ETHEREUM_SEPOLIA, 'ETH'),
    makeToken(CHAIN.ETHEREUM_SEPOLIA, 'USDT'),
    makeToken(CHAIN.ETHEREUM_SEPOLIA, 'WETH'),
  ],
  [CHAIN.ETHEREUM_MAINNET]: [
    makeToken(CHAIN.ETHEREUM_MAINNET, 'ETH'),
    makeToken(CHAIN.ETHEREUM_MAINNET, 'USDT'),
    makeToken(CHAIN.ETHEREUM_MAINNET, 'WETH'),
  ],
  [CHAIN.ARBITRUM_SEPOLIA]: [
    makeToken(CHAIN.ARBITRUM_SEPOLIA, 'ETH'),
    makeToken(CHAIN.ARBITRUM_SEPOLIA, 'USDT'),
    makeToken(CHAIN.ARBITRUM_SEPOLIA, 'WETH'),
  ],
  [CHAIN.BASE_SEPOLIA]: [
    makeToken(CHAIN.BASE_SEPOLIA, 'ETH'),
    makeToken(CHAIN.BASE_SEPOLIA, 'USDT'),
    makeToken(CHAIN.BASE_SEPOLIA, 'WETH'),
  ],
  [CHAIN.BNB_TESTNET]: [
    makeToken(CHAIN.BNB_TESTNET, 'ETH'),
    makeToken(CHAIN.BNB_TESTNET, 'USDT'),
  ],
  [CHAIN.SOLANA_DEVNET]: [
    makeToken(CHAIN.SOLANA_DEVNET, 'SOL'),
    makeToken(CHAIN.SOLANA_DEVNET, 'USDT'),
  ],
};

export const PAYABLE_TOKENS: Partial<Record<CHAIN, PayableToken[]>> = {
  [CHAIN.ETHEREUM_SEPOLIA]: [
    makeToken(CHAIN.ETHEREUM_SEPOLIA, 'ETH'),
    makeToken(CHAIN.ETHEREUM_SEPOLIA, 'USDT'),
    makeToken(CHAIN.ETHEREUM_SEPOLIA, 'USDC'),
    makeToken(CHAIN.ETHEREUM_SEPOLIA, 'WETH'),
  ],
  [CHAIN.ETHEREUM_MAINNET]: [
    makeToken(CHAIN.ETHEREUM_MAINNET, 'ETH'),
    makeToken(CHAIN.ETHEREUM_MAINNET, 'USDT'),
    makeToken(CHAIN.ETHEREUM_MAINNET, 'WETH'),
  ],
  [CHAIN.ARBITRUM_SEPOLIA]: [
    makeToken(CHAIN.ARBITRUM_SEPOLIA, 'ETH'),
    makeToken(CHAIN.ARBITRUM_SEPOLIA, 'USDT'),
  ],
  [CHAIN.BASE_SEPOLIA]: [
    makeToken(CHAIN.BASE_SEPOLIA, 'ETH'),
    makeToken(CHAIN.BASE_SEPOLIA, 'USDT'),
  ],
  [CHAIN.BNB_TESTNET]: [
    makeToken(CHAIN.BNB_TESTNET, 'BNB'),
    makeToken(CHAIN.BNB_TESTNET, 'USDT'),
  ],
  [CHAIN.SOLANA_DEVNET]: [
    makeToken(CHAIN.SOLANA_DEVNET, 'SOL'),
    makeToken(CHAIN.SOLANA_DEVNET, 'USDT'),
  ],
};

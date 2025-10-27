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

// Minimal initial registries. These can be extended safely without breaking the API.
export const MOVEABLE_TOKENS: Partial<Record<CHAIN, MoveableToken[]>> = {
  // Ethereum Sepolia (testnet)
  [CHAIN.ETHEREUM_SEPOLIA]: [
    {
      symbol: 'ETH',
      decimals: 18,
      address: EVM_NATIVE,
      mechanism: 'native',
    },
    {
      symbol: 'USDT',
      decimals: 6,
      address: '0x7169D38820dfd117C3FA1f22a697dBA58d90BA06',
      mechanism: 'approve',
    },
    // Sepolia WETH9
    {
      symbol: 'WETH',
      decimals: 18,
      address: '0xfff9976782d46cc05630d1f6ebab18b2324d6b14',
      mechanism: 'approve',
    },
  ],

  // Ethereum Mainnet (placeholder addresses for now)
  [CHAIN.ETHEREUM_MAINNET]: [
    {
      symbol: 'ETH',
      decimals: 18,
      address: EVM_NATIVE,
      mechanism: 'native',
    },
    {
      symbol: 'USDT',
      decimals: 6,
      address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      mechanism: 'approve',
    },
    // Mainnet WETH
    {
      symbol: 'WETH',
      decimals: 18,
      address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      mechanism: 'approve',
    },
  ],

  // Arbitrum Sepolia
  [CHAIN.ARBITRUM_SEPOLIA]: [
    {
      symbol: 'ETH',
      decimals: 18,
      address: EVM_NATIVE,
      mechanism: 'native',
    },
    {
      symbol: 'USDT',
      decimals: 6,
      address: '0x1419d7C74D234fA6B73E06A2ce7822C1d37922f0',
      mechanism: 'approve',
    },
    {
      symbol: 'WETH',
      decimals: 18,
      address: '0x980B62Da83eFf3D4576C647993b0c1D7faf17c73',
      mechanism: 'approve',
    },
  ],

  // Base Sepolia
  [CHAIN.BASE_SEPOLIA]: [
    {
      symbol: 'ETH',
      decimals: 18,
      address: EVM_NATIVE,
      mechanism: 'native',
    },
    {
      symbol: 'USDT',
      decimals: 6,
      address: '0x9FF5a186f53F6E6964B00320Da1D2024DE11E0cB',
      mechanism: 'approve',
    },
    {
      symbol: 'WETH',
      decimals: 18,
      address: '0xfff9976782d46cc05630d1f6ebab18b2324d6b14',
      mechanism: 'approve',
    },
  ],

  // BNB Testnet
  [CHAIN.BNB_TESTNET]: [
    {
      symbol: 'ETH',
      decimals: 18,
      address: EVM_NATIVE,
      mechanism: 'native',
    },
    {
      symbol: 'USDT',
      decimals: 6,
      address: '0xBC14F348BC9667be46b35Edc9B68653d86013DC5',
      mechanism: 'approve',
    },
  ],

  // Solana Devnet (decimals are per SPL mint; addresses TBD)
  [CHAIN.SOLANA_DEVNET]: [
    // Native SOL (lamports) sentinel: use 'solana-native' string; not used as a Pubkey
    {
      symbol: 'SOL',
      decimals: 9,
      address: 'solana-native',
      mechanism: 'native',
    },
    // Example SPL USDT mint address on Devnet (placeholder or set via config if needed)
    {
      symbol: 'USDT',
      decimals: 6,
      address: 'EiXDnrAg9ea2Q6vEPV7E5TpTU1vh41jcuZqKjU5Dc4ZF',
      mechanism: 'approve',
    },
  ],
};

export const PAYABLE_TOKENS: Partial<Record<CHAIN, PayableToken[]>> = {
  // For now mirror moveable; can extend with additional payable-only tokens (e.g., DAI, PEPE)
  [CHAIN.ETHEREUM_SEPOLIA]: [
    {
      symbol: 'ETH',
      decimals: 18,
      address: EVM_NATIVE,
      mechanism: 'native',
    },
    {
      symbol: 'USDT',
      decimals: 6,
      address: '0x7169D38820dfd117C3FA1f22a697dBA58d90BA06',
      mechanism: 'approve',
    },
    {
      symbol: 'USDC',
      decimals: 6,
      address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
      mechanism: 'approve',
    },
    // Sepolia WETH9
    {
      symbol: 'WETH',
      decimals: 18,
      address: '0xfff9976782d46cc05630d1f6ebab18b2324d6b14',
      mechanism: 'approve',
    },
  ],
  [CHAIN.ETHEREUM_MAINNET]: [
    {
      symbol: 'ETH',
      decimals: 18,
      address: EVM_NATIVE,
      mechanism: 'native',
    },
    {
      symbol: 'USDT',
      decimals: 6,
      address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      mechanism: 'approve',
    },
    // Mainnet WETH
    {
      symbol: 'WETH',
      decimals: 18,
      address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      mechanism: 'approve',
    },
  ],
  [CHAIN.ARBITRUM_SEPOLIA]: [
    {
      symbol: 'ETH',
      decimals: 18,
      address: EVM_NATIVE,
      mechanism: 'native',
    },
    {
      symbol: 'USDT',
      decimals: 6,
      address: '0x1419d7C74D234fA6B73E06A2ce7822C1d37922f0',
      mechanism: 'approve',
    },
  ],
  [CHAIN.BASE_SEPOLIA]: [
    {
      symbol: 'ETH',
      decimals: 18,
      address: EVM_NATIVE,
      mechanism: 'native',
    },
    {
      symbol: 'USDT',
      decimals: 6,
      address: '0x9FF5a186f53F6E6964B00320Da1D2024DE11E0cB',
      mechanism: 'approve',
    },
  ],
  [CHAIN.BNB_TESTNET]: [
    {
      symbol: 'BNB',
      decimals: 18,
      address: EVM_NATIVE,
      mechanism: 'native',
    },
    {
      symbol: 'USDT',
      decimals: 6,
      address: '0xBC14F348BC9667be46b35Edc9B68653d86013DC5',
      mechanism: 'approve',
    },
  ],
  [CHAIN.SOLANA_DEVNET]: [
    {
      symbol: 'SOL',
      decimals: 9,
      address: 'solana-native',
      mechanism: 'native',
    },
    { symbol: 'USDT', decimals: 6, address: 'TBD', mechanism: 'approve' },
  ],
};

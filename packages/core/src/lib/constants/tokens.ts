import { CHAIN } from './enums';

export interface MoveableToken {
  symbol: string;
  decimals: number;
  address: string; // chain-native may use a sentinel value
  // TODO: If true, then we do a ERC-20 approve. If false, then permit2 or similar.
  // TODO: Rename it to `mechanism`. Then have it as enum: `approve` or `permit2`.
  requiresApprove: boolean; // true for ERC20/SPL, false for native tokens
}

export interface PayableToken {
  symbol: string;
  decimals: number;
  address: string;
  requiresApprove: boolean;
}

// Explicit token symbol maps to enable dot-access (no index signature errors)
export type MoveableTokenMap = Partial<{
  ETH: MoveableToken;
  USDC: MoveableToken;
  USDT: MoveableToken;
  UNI: MoveableToken;
  WETH: MoveableToken;
  SOL: MoveableToken;
}>;

export type PayableTokenMap = Partial<{
  ETH: PayableToken;
  USDC: PayableToken;
  USDT: PayableToken;
  DAI: PayableToken;
  PEPE: PayableToken;
  UNI: PayableToken;
  WETH: PayableToken;
  SOL: PayableToken;
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
  get USDC(): MoveableToken {
    return this.require('USDC');
  }
  get USDT(): MoveableToken {
    return this.require('USDT');
  }
  get UNI(): MoveableToken {
    return this.require('UNI');
  }
  get WETH(): MoveableToken {
    return this.require('WETH');
  }
  get SOL(): MoveableToken {
    return this.require('SOL');
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
  get USDT(): PayableToken {
    return this.require('USDT');
  }
  get DAI(): PayableToken {
    return this.require('DAI');
  }
  get PEPE(): PayableToken {
    return this.require('PEPE');
  }
  get UNI(): PayableToken {
    return this.require('UNI');
  }
  get WETH(): PayableToken {
    return this.require('WETH');
  }
  get SOL(): PayableToken {
    return this.require('SOL');
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
      requiresApprove: false,
    },
    // Sepolia USDC
    {
      symbol: 'USDC',
      decimals: 6,
      address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
      requiresApprove: true,
    },
    {
      symbol: 'USDT',
      decimals: 6,
      address: '0x7169D38820dfd117C3FA1f22a697dBA58d90BA06',
      requiresApprove: true,
    },
    // Sepolia WETH9
    {
      symbol: 'WETH',
      decimals: 18,
      address: '0xfff9976782d46cc05630d1f6ebab18b2324d6b14',
      requiresApprove: true,
    },
  ],

  // Ethereum Mainnet (placeholder addresses for now)
  [CHAIN.ETHEREUM_MAINNET]: [
    {
      symbol: 'ETH',
      decimals: 18,
      address: EVM_NATIVE,
      requiresApprove: false,
    },
    {
      symbol: 'USDC',
      decimals: 6,
      address: '0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      requiresApprove: true,
    },
    {
      symbol: 'USDT',
      decimals: 6,
      address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      requiresApprove: true,
    },
    // Mainnet WETH
    {
      symbol: 'WETH',
      decimals: 18,
      address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      requiresApprove: true,
    },
    // Mainnet UNI
    {
      symbol: 'UNI',
      decimals: 18,
      address: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984',
      requiresApprove: true,
    },
  ],

  // Solana Devnet (decimals are per SPL mint; addresses TBD)
  [CHAIN.SOLANA_DEVNET]: [
    { symbol: 'SOL', decimals: 9, address: 'native', requiresApprove: false },
    { symbol: 'USDC', decimals: 6, address: 'TBD', requiresApprove: true },
    { symbol: 'USDT', decimals: 6, address: 'TBD', requiresApprove: true },
  ],
};

export const PAYABLE_TOKENS: Partial<Record<CHAIN, PayableToken[]>> = {
  // For now mirror moveable; can extend with additional payable-only tokens (e.g., DAI, PEPE)
  [CHAIN.ETHEREUM_SEPOLIA]: [
    {
      symbol: 'ETH',
      decimals: 18,
      address: EVM_NATIVE,
      requiresApprove: false,
    },
    // Sepolia USDC
    {
      symbol: 'USDC',
      decimals: 6,
      address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
      requiresApprove: true,
    },
    {
      symbol: 'USDT',
      decimals: 6,
      address: '0x7169D38820dfd117C3FA1f22a697dBA58d90BA06',
      requiresApprove: true,
    },
    // Sepolia WETH9
    {
      symbol: 'WETH',
      decimals: 18,
      address: '0xfff9976782d46cc05630d1f6ebab18b2324d6b14',
      requiresApprove: true,
    },
  ],
  [CHAIN.ETHEREUM_MAINNET]: [
    {
      symbol: 'ETH',
      decimals: 18,
      address: EVM_NATIVE,
      requiresApprove: false,
    },
    {
      symbol: 'USDC',
      decimals: 6,
      address: '0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      requiresApprove: true,
    },
    {
      symbol: 'USDT',
      decimals: 6,
      address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      requiresApprove: true,
    },
    // Mainnet WETH
    {
      symbol: 'WETH',
      decimals: 18,
      address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      requiresApprove: true,
    },
    // Mainnet UNI
    {
      symbol: 'UNI',
      decimals: 18,
      address: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984',
      requiresApprove: true,
    },
  ],
  [CHAIN.SOLANA_DEVNET]: [
    { symbol: 'SOL', decimals: 9, address: 'native', requiresApprove: false },
    { symbol: 'USDC', decimals: 6, address: 'TBD', requiresApprove: true },
    { symbol: 'USDT', decimals: 6, address: 'TBD', requiresApprove: true },
  ],
};

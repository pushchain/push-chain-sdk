import { CHAIN } from './enums';

export interface MoveableToken {
  symbol: string;
  decimals: number;
  address: string; // chain-native may use a sentinel value
  requiresApprove: boolean; // true for ERC20/SPL, false for native tokens
}

export interface PayableToken {
  symbol: string;
  decimals: number;
  address: string;
  requiresApprove: boolean;
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
    { symbol: 'USDC', decimals: 6, address: '0xTBD', requiresApprove: true },
    { symbol: 'USDT', decimals: 6, address: '0xTBD', requiresApprove: true },
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
    { symbol: 'USDC', decimals: 6, address: '0xTBD', requiresApprove: true },
    { symbol: 'USDT', decimals: 6, address: '0xTBD', requiresApprove: true },
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
  ],
  [CHAIN.SOLANA_DEVNET]: [
    { symbol: 'SOL', decimals: 9, address: 'native', requiresApprove: false },
    { symbol: 'USDC', decimals: 6, address: 'TBD', requiresApprove: true },
    { symbol: 'USDT', decimals: 6, address: 'TBD', requiresApprove: true },
  ],
};

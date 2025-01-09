export enum Order {
  ASC = 'ASC',
  DESC = 'DESC',
}

export enum ENV {
  MAINNET = 'MAINNET',
  DEVNET = 'DEVNET',
  TESTNET = 'TESTNET',
  LOCAL = 'LOCAL',
}

export enum CHAIN {
  PUSH = 'PUSH',
  ETHEREUM = 'ETHEREUM',
  SOLANA = 'SOLANA',
}

export const CHAIN_ID = {
  [CHAIN.PUSH]: {
    MAINNET: 'mainnet',
    DEVNET: 'devnet',
  },
  [CHAIN.ETHEREUM]: {
    MAINNET: '1',
    SEPOLIA: '11155111',
  },
  [CHAIN.SOLANA]: {
    DEVNET: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
  },
} as const;

export const CONSTANTS = {
  ENV,
  CHAIN,
  CHAIN_ID,
};

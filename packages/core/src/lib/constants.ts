export enum ORDER {
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
    MAINNET: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    DEVNET: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
    TESTNET: '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z',
  },
} as const;

export const CONSTANTS = {
  ENV,
  CHAIN,
  CHAIN_ID,
  ORDER,
};

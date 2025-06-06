/**
 * Specifies the Push Chain environment the SDK will connect to.
 * Determines the RPC endpoints, contract addresses, and network context
 * for interacting with Push Chain.
 */
export enum PUSH_NETWORK {
  MAINNET = 'MAINNET',
  TESTNET_DONUT = 'TESTNET_DONUT',
  TESTNET = 'TESTNET',
  LOCALNET = 'LOCALNET',
}

/**
 * Supported Chains
 */
export enum CHAIN {
  // Push
  PUSH_MAINNET = 'eip155:9',
  PUSH_TESTNET = 'eip155:9000',
  PUSH_TESTNET_DONUT = PUSH_TESTNET,
  PUSH_LOCALNET = PUSH_TESTNET,

  // Ethereum
  ETHEREUM_MAINNET = 'eip155:1',
  ETHEREUM_SEPOLIA = 'eip155:11155111',

  // Solana
  SOLANA_MAINNET = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:7S3P4HxJpyyigGzodYwHtCxZyUQe9JiBMHyRWXArAaKv',
  SOLANA_TESTNET = 'solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z:6LmSRCiu3z6NCSpF19oz1pHXkYkN4jWbj9K1nVELpDkT',
  SOLANA_DEVNET = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1:DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK',
}

/**
 * Represents the virtual machine or execution environment for a chain.
 */
export enum VM {
  EVM = 'EVM',
  SVM = 'SVM',
}

export enum LIBRARY {
  ETHEREUM_VIEM = 'viem',
  SOLANA_WEB3JS = 'solana-web3js',
}

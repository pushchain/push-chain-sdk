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
  PUSH_TESTNET = 'eip155:42101',
  PUSH_TESTNET_DONUT = PUSH_TESTNET,
  PUSH_LOCALNET = 'eip155:9001',

  // Ethereum
  ETHEREUM_MAINNET = 'eip155:1',
  ETHEREUM_SEPOLIA = 'eip155:11155111',
  ARBITRUM_SEPOLIA = 'eip155:421614',
  BASE_SEPOLIA = 'eip155:84532',
  BNB_TESTNET = 'eip155:97',

  // Solana
  SOLANA_MAINNET = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
  SOLANA_TESTNET = 'solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z',
  SOLANA_DEVNET = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
}

/**
 * Read-only destination exposed with the OG `CHAIN.WEB2` spelling without
 * widening the blockchain enum type accepted by transaction APIs.
 */
// eslint-disable-next-line @typescript-eslint/no-namespace -- declaration merging keeps Web2 out of the transaction enum union
export namespace CHAIN {
  export const WEB2 = 'web2:https' as const;
}
// Namespace properties are normally enumerable after TypeScript emits them.
// Keep blockchain enumeration (`Object.values(CHAIN)`) blockchain-only.
Object.defineProperty(CHAIN, 'WEB2', { value: CHAIN.WEB2, enumerable: false });

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
  ETHEREUM_ETHERSV6 = 'ethers-v6',
}

/**
 * Specifies the Push Chain environment the SDK will connect to.
 * Determines the RPC endpoints, contract addresses, and network context
 * for interacting with Push Chain.
 */
export enum ENV {
  MAINNET = 'MAINNET',
  TESTNET = 'TESTNET',
  LOCAL = 'LOCAL',
}

/**
 * Supported Chains
 */
export enum CHAIN {
  // Push
  PUSH_MAINNET = 'PUSH_MAINNET',
  PUSH_TESTNET = 'PUSH_TESTNET',

  // Ethereum
  ETHEREUM_MAINNET = 'ETHEREUM_MAINNET',
  ETHEREUM_SEPOLIA = 'ETHEREUM_SEPOLIA',

  // Solana
  SOLANA_MAINNET = 'SOLANA_MAINNET',
  SOLANA_TESTNET = 'SOLANA_TESTNET',
  SOLANA_DEVNET = 'SOLANA_DEVNET',
}

/**
 * Represents the virtual machine or execution environment for a chain.
 */
export enum VM {
  EVM = 'EVM',
  SVM = 'SVM',
}

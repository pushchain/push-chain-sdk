/**
 * Specifies the Push Chain environment the SDK will connect to.
 * Determines the RPC endpoints, contract addresses, and network context
 * for interacting with Push Chain.
 */
export enum PUSH_NETWORK {
  MAINNET = 'MAINNET',
  TESTNET_DONUT = 'TESTNET_DONUT',
  LOCALNET = 'LOCALNET',
}

/**
 * Supported Chains
 */
export enum CHAIN {
  // Push
  PUSH_MAINNET = 'PUSH_MAINNET',
  PUSH_TESTNET_DONUT = 'PUSH_TESTNET_DONUT',
  PUSH_LOCALNET = 'PUSH_LOCALNET',

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

export enum LIBRARY {
  ETHEREUM_VIEM = 'viem',
  SOLANA_WEB3 = 'solana-web3',
}

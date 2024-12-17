export enum PushChainEnvironment {
  mainnet,
  devnet,
  testnet,
  local,
}

/**
 * Chain types
 */
export enum Chain {
  Push = 'Push Chain',
  Solana = 'Solana',
  Evm = 'EVM',
}

export const CONSTANTS = {
  PushChainEnvironment,
  Chain: {
    Push: {
      mainnet: { name: Chain.Push, chainId: 'mainnet' },
      devnet: { name: Chain.Push, chainId: 'devnet' },
    },
    Solana: {
      devnet: {
        name: Chain.Solana,
        chainId: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
      },
    },
    Ethereum: {
      mainnet: { name: Chain.Evm, chainId: '1' },
      sepolia: { name: Chain.Evm, chainId: '11155111' },
    },
  },
};

export enum Order {
  ASC = 'ASC',
  DESC = 'DESC',
}

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

interface ChainInfo<T extends Chain, U extends string> {
  name: T;
  chainId: U;
}

export enum PushChainId {
  mainnet = 'mainnet',
  devnet = 'devnet',
}

export enum SolanaChainId {
  devnet = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
}

export enum EvmChainId {
  mainnet = '1',
  sepolia = '11155111',
}

export type ConstantsChain = {
  Push: {
    mainnet: ChainInfo<Chain.Push, PushChainId.mainnet>;
    devnet: ChainInfo<Chain.Push, PushChainId.devnet>;
  };
  Solana: {
    devnet: ChainInfo<Chain.Solana, SolanaChainId.devnet>;
  };
  Ethereum: {
    mainnet: ChainInfo<Chain.Evm, EvmChainId.mainnet>;
    sepolia: ChainInfo<Chain.Evm, EvmChainId.sepolia>;
  };
};

export const CONSTANTS = {
  PushChainEnvironment,
  Chain: {
    Push: {
      mainnet: { name: Chain.Push, chainId: PushChainId.mainnet },
      devnet: { name: Chain.Push, chainId: PushChainId.devnet },
    },
    Solana: {
      devnet: {
        name: Chain.Solana,
        chainId: SolanaChainId.devnet,
      },
    },
    Ethereum: {
      mainnet: { name: Chain.Evm, chainId: EvmChainId.mainnet },
      sepolia: { name: Chain.Evm, chainId: EvmChainId.sepolia },
    },
  } as ConstantsChain,
};

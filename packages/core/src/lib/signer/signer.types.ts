import { CHAIN, CHAIN_ID } from '../constants';

type PushChainObject = (typeof CHAIN_ID)[CHAIN.PUSH]; // { MAINNET: 'MAINNET'; DEVNET: 'DEVNET'; }
export type PushChainId = PushChainObject[keyof PushChainObject]; // Get the union of its property values: "MAINNET" | "DEVNET"

type SolanaChainObject = (typeof CHAIN_ID)[CHAIN.SOLANA];
export type SolanaChainId = SolanaChainObject[keyof SolanaChainObject];

type EthereumObject = (typeof CHAIN_ID)[CHAIN.ETHEREUM];
export type EthereumChainId = EthereumObject[keyof EthereumObject];

export type UniversalAccount =
  | {
      chain: CHAIN.PUSH;
      chainId: PushChainId;
      address: string;
    }
  | {
      chain: CHAIN.SOLANA;
      chainId: SolanaChainId;
      address: string;
    }
  | {
      chain: CHAIN.ETHEREUM;
      chainId: EthereumChainId;
      address: string;
    }
  | {
      chain: string;
      chainId: string;
      address: string;
    };

// Framework-dependent
export type UniversalSigner = UniversalAccount & {
  signMessage: (data: Uint8Array) => Promise<Uint8Array>;
};

// Framework-agnostic
export type ValidatedUniversalSigner = UniversalAccount & {
  signMessage: (data: Uint8Array) => Promise<Uint8Array>;
};

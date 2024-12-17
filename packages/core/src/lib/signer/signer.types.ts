import { Chain, EvmChainId, PushChainId, SolanaChainId } from '../constants';

export type UniversalAccount =
  | {
      chain: Chain.Push;
      chainId: PushChainId;
      account: string;
    }
  | {
      chain: Chain.Solana;
      chainId: SolanaChainId;
      account: string;
    }
  | {
      chain: Chain.Evm;
      chainId: EvmChainId;
      account: string;
    };

export type UniversalSigner = UniversalAccount & {
  signMessage: (data: Uint8Array) => Promise<Uint8Array>;
};

export type ValidatedUniversalSigner = UniversalAccount & {
  signMessage: (data: Uint8Array) => Promise<Uint8Array>;
};

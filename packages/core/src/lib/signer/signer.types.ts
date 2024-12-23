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
    }
  | {
      chain: string;
      chainId: string;
      account: string;
    };

// export type UniversalSigner = UniversalAccount & {
//   signMessage: (
//     data:
//       | Uint8Array
//       | string
//       | { message: string | { raw: `0x${string}` | Uint8Array } }
//   ) => Promise<Uint8Array | string>;
// };

// Framework-dependent
export type UniversalSigner = UniversalAccount & {
  signMessage: (data: Uint8Array) => Promise<Uint8Array>;
};

// Framework-agnostic
export type ValidatedUniversalSigner = UniversalAccount & {
  signMessage: (data: Uint8Array) => Promise<Uint8Array>;
};

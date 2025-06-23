import { TypedData, TypedDataDomain } from '../constants';
import { CHAIN } from '../constants/enums';

/**
 * A chain-agnostic account representation.
 * Used to represent a wallet address along with its chain context.
 */
export interface UniversalAccount {
  /**
   * Fully qualified chain (e.g., CHAIN.ETHEREUM_SEPOLIA, CHAIN.SOLANA_DEVNET)
   */
  chain: CHAIN;

  /**
   * The address on the respective chain (EVM: checksummed, Solana: base58, etc.)
   */
  address: string;
}

export type ViemSignerType = {
  signTypedData: (args: {
    account: any;
    domain: any;
    types: any;
    primaryType: any;
    message: any;
  }) => Promise<`0x${string}`>;
  getChainId: () => Promise<number>;
  signMessage: (args: {
    message: any;
    account: any;
    [key: string]: any;
  }) => Promise<`0x${string}`>;
  account: { [key: string]: any };
  sendTransaction: (transaction: any) => Promise<any>;
  provider?: any;
};

export interface EthersV5SignerType {
  _signTypedData: (
    domain: TypedDataDomain,
    types: Record<string, Array<any>>,
    value: Record<string, any>
  ) => Promise<string>;
  getAddress: () => Promise<string>;
  signMessage: (message: Uint8Array | string) => Promise<string>;
  sendTransaction: (transaction: any) => Promise<any>;
  provider?: any;
}

export interface EthersV6SignerType {
  getAddress: () => Promise<string>;
  signMessage: (message: Uint8Array | string) => Promise<string>;
  sendTransaction: (tx: any) => Promise<any>;
  signTypedData: (
    domain: TypedDataDomain,
    types: Record<string, Array<any>>,
    value: Record<string, any>
  ) => Promise<string>;
  provider?: any;
}

/**
 * A signer capable of signing messages for a specific chain.
 * Used to abstract away signing across multiple VM types.
 */
export interface UniversalSigner {
  account: UniversalAccount;

  /**
   * Signs an arbitrary data, provided as binary data.
   *
   * If data is a **string**, you MUST UTF-8 encode it before calling this method.
   * @param data - The message to sign, as a Uint8Array.
   * @returns A Promise that resolves to the signature (as a Uint8Array).
   *
   * @example
   * const encoded = new TextEncoder().encode("hello world");
   * const signature = await signer.signMessage(encoded);
   */
  signMessage: (data: Uint8Array) => Promise<Uint8Array>;

  /**
   * Signs a typed data, provided as binary data.
   * @dev !! Only Required for Evm Signers !!
   *
   * @param data - The message to sign, as a Uint8Array.
   * @returns A Promise that resolves to the signature (as a Uint8Array).
   */
  signTypedData?: ({
    domain,
    types,
    primaryType,
    message,
  }: {
    domain: TypedDataDomain;
    types: TypedData;
    primaryType: string;
    message: Record<string, any>;
  }) => Promise<Uint8Array>;

  /**
   * Signs and sends a transaction (unsigned tx bytes).
   * Used for sending on-chain transactions.
   */
  signAndSendTransaction: (unsignedTx: Uint8Array) => Promise<Uint8Array>;
}

export interface UniversalSignerSkeleton {
  signerId: string;
  account: UniversalAccount;
  signMessage: (data: Uint8Array) => Promise<Uint8Array>;
  signAndSendTransaction: (unsignedTx: Uint8Array) => Promise<Uint8Array>;
  signTypedData?: ({
    domain,
    types,
    primaryType,
    message,
  }: {
    domain: TypedDataDomain;
    types: TypedData;
    primaryType: string;
    message: Record<string, any>;
  }) => Promise<Uint8Array>;
}

import { TypedData, TypedDataDomain } from 'viem';
import { CHAIN } from '../constants/enums';
import { Keypair } from '@solana/web3.js';

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

export interface CustomUniversalSigner {
  signerId: 'custom_generated_signer';
  account: UniversalAccount;
  signMessage: (data: Uint8Array) => Promise<Uint8Array>;
  signTransaction: (unsignedTx: Uint8Array) => Promise<Uint8Array>;
  signTypedData: ({
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

export interface MetamaskSigner {
  signMessage: (data: Uint8Array) => Promise<Uint8Array>;
  signTransaction: (unsignedTx: Uint8Array) => Promise<Uint8Array>;
  signTypedData: ({
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

export interface ViemSigner {
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
  privateKey?: string;
  provider?: any;
}

// export type ViemSigner = viem.WalletClient;
export type SolanaWeb3jsSigner = Keypair;

// TODO: create PushChain.signer.construct({signMessage, signTransaction, signTypedData, address, chain, UID='custom'}) returns a CustomUniversalSigner.

// TODO: Create new interface for `Signer`. Used for when we don't have the library yet to create signMesssage signTransaction signTypedData for the user.

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
   * Signs an typed data, provided as binary data.
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
   * Signs a transaction (unsigned tx bytes).
   * Used for sending on-chain transactions.
   */
  signTransaction: (unsignedTx: Uint8Array) => Promise<Uint8Array>;
}

export interface UniversalSignerSkeleton {
  signerId: 'CustomGeneratedSigner';
  account: UniversalAccount;
  signMessage: (data: Uint8Array) => Promise<Uint8Array>;
  signTransaction: (unsignedTx: Uint8Array) => Promise<Uint8Array>;
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

import {
  AccessListish,
  AuthorizationLike,
  BigNumberish,
  BlobLike,
  BlockTag,
  KzgLibraryLike,
} from 'ethers';
import { AddressLike } from 'ethers';
import { TypedData, TypedDataDomain } from '../constants';
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

export type TypedDataField = {
  name: string;
  type: string;
};

export type TransactionRequest = {
  /**
   *  The transaction type.
   */
  type?: null | number;

  /**
   *  The target of the transaction.
   */
  to?: null | AddressLike;

  /**
   *  The sender of the transaction.
   */
  from?: null | AddressLike;

  /**
   *  The nonce of the transaction, used to prevent replay attacks.
   */
  nonce?: null | number;

  /**
   *  The maximum amount of gas to allow this transaction to consume.
   */
  gasLimit?: null | BigNumberish;

  /**
   *  The gas price to use for legacy transactions or transactions on
   *  legacy networks.
   *
   *  Most of the time the ``max*FeePerGas`` is preferred.
   */
  gasPrice?: null | BigNumberish;

  /**
   *  The [[link-eip-1559]] maximum priority fee to pay per gas.
   */
  maxPriorityFeePerGas?: null | BigNumberish;

  /**
   *  The [[link-eip-1559]] maximum total fee to pay per gas. The actual
   *  value used is protocol enforced to be the block's base fee.
   */
  maxFeePerGas?: null | BigNumberish;

  /**
   *  The transaction data.
   */
  data?: null | string;

  /**
   *  The transaction value (in wei).
   */
  value?: null | BigNumberish;

  /**
   *  The chain ID for the network this transaction is valid on.
   */
  chainId?: null | BigNumberish;

  /**
   *  The [[link-eip-2930]] access list. Storage slots included in the access
   *  list are //warmed// by pre-loading them, so their initial cost to
   *  fetch is guaranteed, but then each additional access is cheaper.
   */
  accessList?: null | AccessListish;

  /**
   *  A custom object, which can be passed along for network-specific
   *  values.
   */
  customData?: any;

  // Only meaningful when used for call

  /**
   *  When using ``call`` or ``estimateGas``, this allows a specific
   *  block to be queried. Many backends do not support this and when
   *  unsupported errors are silently squelched and ``"latest"`` is used.
   */
  blockTag?: BlockTag;

  /**
   *  When using ``call``, this enables CCIP-read, which permits the
   *  provider to be redirected to web-based content during execution,
   *  which is then further validated by the contract.
   *
   *  There are potential security implications allowing CCIP-read, as
   *  it could be used to expose the IP address or user activity during
   *  the fetch to unexpected parties.
   */
  enableCcipRead?: boolean;

  /**
   *  The blob versioned hashes (see [[link-eip-4844]]).
   */
  blobVersionedHashes?: null | Array<string>;

  /**
   *  The maximum fee per blob gas (see [[link-eip-4844]]).
   */
  maxFeePerBlobGas?: null | BigNumberish;

  /**
   *  Any blobs to include in the transaction (see [[link-eip-4844]]).
   */
  blobs?: null | Array<BlobLike>;

  /**
   *  An external library for computing the KZG commitments and
   *  proofs necessary for EIP-4844 transactions (see [[link-eip-4844]]).
   *
   *  This is generally ``null``, unless you are creating BLOb
   *  transactions.
   */
  kzg?: null | KzgLibraryLike;

  /**
   *  The [[link-eip-7702]] authorizations (if any).
   */
  authorizationList?: null | Array<AuthorizationLike>;

  // Todo?
  //gasMultiplier?: number;
};

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

export interface EthersV5SignerType {
  _signTypedData: (
    domain: TypedDataDomain,
    types: Record<string, Array<TypedDataField>>,
    value: Record<string, any>
  ) => Promise<string>
  getAddress: () => Promise<string>
  signMessage: (message: Uint8Array | string) => Promise<string>
  signTransaction: (transaction: TransactionRequest) => Promise<string>
  provider?: any
}

export interface EthersV6SignerType {
  getAddress: () => Promise<string>;
  signMessage: (message: Uint8Array | string) => Promise<string>;
  signTransaction: (tx: TransactionRequest) => Promise<string>;
  signTypedData: (
    domain: TypedDataDomain,
    types: Record<string, Array<TypedDataField>>,
    value: Record<string, any>
  ) => Promise<string>;
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
  signerId: string;
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

import { TypedData, TypedDataDomain } from 'viem';
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

/**
 * A signer capable of signing messages for a specific chain.
 * Used to abstract away signing across multiple VM types.
 */
export interface UniversalSigner extends UniversalAccount {
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

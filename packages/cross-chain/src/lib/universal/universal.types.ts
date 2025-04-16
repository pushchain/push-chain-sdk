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
   * Asynchronous function that takes binary data and returns a signed Uint8Array.
   * Must be implemented by the end-developer using the SDK.
   */
  signMessage: (data: Uint8Array) => Promise<Uint8Array>;
}

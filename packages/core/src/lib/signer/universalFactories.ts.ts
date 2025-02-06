import { CONSTANTS } from '../constants';
import { UniversalAccount, UniversalSigner } from './signer.types';

/**
 * Creates a UniversalAccount object with default chain and chainId values if not provided.
 *
 * @param {Partial<UniversalAccount> & { address: string }} params - Configuration object.
 * @param {string} [params.chain=CONSTANTS.CHAIN.ETHEREUM] - The blockchain name (e.g., "ETHEREUM", "SOLANA").
 * @param {string} [params.chainId=CONSTANTS.CHAIN_ID.ETHEREUM.SEPOLIA] - The chain/network identifier (e.g., "SEPOLIA").
 * @param {string} params.address - The address of the account (e.g., "0x123...").
 * @returns {UniversalAccount} A UniversalAccount with sensible defaults for chain and chainId.
 *
 * @example
 * // Creates an Ethereum Sepolia account with a provided address
 * const account = createUniversalAccount({ address: "0xabc..." });
 * console.log(account);
 * // => {
 * //      chain: "ETHEREUM",
 * //      chainId: "11155111", // or your constant for Sepolia
 * //      address: "0xabc..."
 * //    }
 *
 * @example
 * // Overrides the defaults with a custom chain and chainId
 * const account = createUniversalAccount({
 *   chain: "SOLANA",
 *   chainId: "MAINNET",
 *   address: "solanaAddress123"
 * });
 */
export function createUniversalAccount({
  chain = CONSTANTS.CHAIN.ETHEREUM,
  chainId = CONSTANTS.CHAIN_ID.ETHEREUM.SEPOLIA,
  address,
}: Partial<UniversalAccount> & { address: string }): UniversalAccount {
  return {
    chain,
    chainId,
    address,
  };
}

/**
 * Creates a UniversalSigner object with default chain and chainId values if not provided.
 * Requires the caller to supply an address and a signMessage function.
 *
 * @param {Partial<UniversalSigner> & { address: string, signMessage: (data: Uint8Array) => Promise<Uint8Array> }} params - Configuration object.
 * @param {string} [params.chain=CONSTANTS.CHAIN.ETHEREUM] - The blockchain name (e.g., "ETHEREUM", "SOLANA").
 * @param {string} [params.chainId=CONSTANTS.CHAIN_ID.ETHEREUM.SEPOLIA] - The chain/network identifier (e.g., "SEPOLIA").
 * @param {string} params.address - The address of the signer (e.g., "0x123...").
 * @param {(data: Uint8Array) => Promise<Uint8Array>} params.signMessage - Function to sign a message. Receives data as Uint8Array, returns a signature as Uint8Array.
 * @returns {UniversalSigner} A UniversalSigner with sensible defaults for chain and chainId.
 *
 * @example
 * // Creates an Ethereum Sepolia signer with a provided address and signMessage function
 * const signer = createUniversalSigner({
 *   address: "0xabc...",
 *   signMessage: async (data) => {
 *     // Implementation for signing
 *     return new Uint8Array([1,2,3]);
 *   }
 * });
 * console.log(signer);
 * // => {
 * //      chain: "ETHEREUM",
 * //      chainId: "11155111", // or your constant for Sepolia
 * //      address: "0xabc...",
 * //      signMessage: [Function: async]
 * //    }
 *
 * @example
 * // Overriding the defaults
 * const signer = createUniversalSigner({
 *   chain: "SOLANA",
 *   chainId: "MAINNET",
 *   address: "solanaAddress123",
 *   signMessage: async (data) => { ... }
 * });
 */
export function createUniversalSigner({
  chain = CONSTANTS.CHAIN.ETHEREUM,
  chainId = CONSTANTS.CHAIN_ID.ETHEREUM.SEPOLIA,
  address,
  signMessage,
}: Partial<UniversalSigner> & {
  address: string;
  signMessage: (data: Uint8Array) => Promise<Uint8Array>;
}): UniversalSigner {
  return {
    chain,
    chainId,
    address,
    signMessage,
  };
}

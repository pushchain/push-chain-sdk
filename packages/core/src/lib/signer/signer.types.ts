import { CHAIN, CHAIN_ID } from '../constants';

type PushChainObject = (typeof CHAIN_ID)[CHAIN.PUSH]; // { MAINNET: 'MAINNET'; DEVNET: 'DEVNET'; }
export type PushChainId = PushChainObject[keyof PushChainObject]; // Get the union of its property values: "MAINNET" | "DEVNET"

type SolanaChainObject = (typeof CHAIN_ID)[CHAIN.SOLANA];
export type SolanaChainId = SolanaChainObject[keyof SolanaChainObject];

type EthereumObject = (typeof CHAIN_ID)[CHAIN.ETHEREUM];
export type EthereumChainId = EthereumObject[keyof EthereumObject];

/**
 * Represents a universal account that can exist on multiple blockchains.
 *
 * @property {string} chain - The blockchain name (e.g., `CONSTANTS.CHAIN.ETHEREUM`, `CONSTANTS.CHAIN.SOLANA`, `CONSTANTS.CHAIN.PUSH`).
 * @property {string} chainId - The chain/network identifier (e.g., `CONSTANTS.CHAIN_ID.ETHEREUM.SEPOLIA`, `CONSTANTS.CHAIN_ID.SOLANA.MAINNET`, `CONSTANTS.CHAIN_ID.PUSH.MAINNET`).
 * @property {string} address - The address of the account.
 *
 * @example
 * // Create a UniversalAccount using the factory function
 * const account = createUniversalAccount({ address: "0xabc..." });
 * console.log(account);
 * // => {
 * //      chain: "ETHEREUM",
 * //      chainId: "11155111", // Defaults to Sepolia
 * //      address: "0xabc..."
 * //    }
 *
 * @example
 * // Create a UniversalAccount without using the factory function
 * const account: UniversalAccount = {
 *   chain: CONSTANTS.CHAIN.ETHEREUM,
 *   chainId: CONSTANTS.CHAIN_ID.ETHEREUM.MAINNET,
 *   address: "0xabc..."
 * };
 * console.log(account);
 * // => {
 * //      chain: "ETHEREUM",
 * //      chainId: "1",
 * //      address: "0xabc..."
 * //    }
 */
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

/**
 * Represents a universal signer that can sign messages on multiple blockchains.
 *
 * @extends {UniversalAccount}
 * @property {(data: Uint8Array) => Promise<Uint8Array>} signMessage - Function to sign a message.
 *
 * @example
 * // Create a UniversalSigner using the factory function
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
 * //      chainId: "11155111", // Defaults to Sepolia
 * //      address: "0xabc...",
 * //      signMessage: [Function: async]
 * //    }
 *
 * @example
 * // Create a UniversalSigner without using the factory function
 * const manualSigner: UniversalSigner = {
 *   chain: CONSTANTS.CHAIN.ETHEREUM,
 *   chainId: CONSTANTS.CHAIN_ID.ETHEREUM.MAINNET,
 *   address: "0xabc...",
 *   signMessage: async (data) => {
 *     // Implementation for signing
 *     return new Uint8Array([1,2,3]);
 *   }
 * };
 * console.log(manualSigner);
 * // => {
 * //      chain: "ETHEREUM",
 * //      chainId: "1",
 * //      address: "0xabc...",
 * //      signMessage: [Function: async]
 * //    }
 *
 * @example
 * // Create a UniversalSigner using viem
 * const privateKey = "your-private-key";
 * const account = privateKeyToAccount(privateKey);
 * const viemSigner: UniversalSigner = {
 *   chain: CONSTANTS.CHAIN.ETHEREUM,
 *   chainId: CONSTANTS.CHAIN_ID.ETHEREUM.MAINNET,
 *   address: account.address,
 *   signMessage: async (data) => {
 *     const signature = await account.signMessage({ message: { raw: data } });
 *     return hexToBytes(signature);
 *   }
 * };
 * console.log(viemSigner);
 * // => {
 * //      chain: "ETHEREUM",
 * //      chainId: "1",
 * //      address: account.address,
 * //      signMessage: [Function: async]
 * //    }
 */
export type UniversalSigner = UniversalAccount & {
  signMessage: (data: Uint8Array) => Promise<Uint8Array>;
};

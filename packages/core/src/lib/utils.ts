import {
  convertOriginToExecutor,
  fromChainAgnostic,
  toChainAgnostic,
  toUniversal,
} from './universal/account';
import {
  construct,
  toUniversal as toUniversalSigner,
  toUniversalFromKeypair,
} from './universal/signer';
import { CHAIN } from './constants/enums';

/**
 * @dev - THESE UTILS ARE EXPORTED TO SDK CONSUMER
 * @dev - Make sure each exported fn has good comments to help out sdk consumer
 */

/**
 * Utility class for handling CAIP-10 chain-agnostic address formatting
 * and universal account conversions.
 */
export class Utils {
  static account = {
    /**
     * Converts a UniversalAccount into a CAIP-10 style address string.
     *
     * Format: `namespace:chainId:address`
     * Namespace is derived from the chain's VM type using VM_NAMESPACE.
     *
     * @param {UniversalAccount} account - The account to convert.
     * @returns {string} A CAIP-10 formatted string.
     *
     * @example
     * Utils.account.toChainAgnostic({
     *   chain: CHAIN.ETHEREUM_SEPOLIA,
     *   address: '0xabc'
     * })
     * // → 'eip155:11155111:0xabc'
     */
    toChainAgnostic,

    toUniversal,

    /**
     * Converts a CAIP-10 formatted string into a UniversalAccount.
     *
     * @param {string} caip - A CAIP-10 address string (e.g., 'eip155:1:0xabc...').
     * @returns {UniversalAccount} The resolved account.
     * @throws {Error} If the CAIP string is invalid or unsupported.
     *
     * @example
     * Utils.account.fromChainAgnostic('eip155:11155111:0xabc...')
     * // → { chain: CHAIN.ETHEREUM_SEPOLIA, address: '0xabc...' }
     */
    fromChainAgnostic,

    convertOriginToExecutor,
  };

  static signer = {
    /**
     * Converts various signer types (viem, ethers v6, Solana) into a UniversalSigner.
     */
    toUniversalFromKeypair,
    /**
     * Constructs a UniversalSignerSkeleton from raw signing functions.
     */
    construct,
    /**
     * Converts a UniversalSignerSkeleton to a UniversalSigner.
     */
    toUniversal: toUniversalSigner,
  };

  static helpers = {
    getChainName: (chainNamespace: string) => {
      const chainEntries = Object.entries(CHAIN);
      const foundEntry = chainEntries.find(
        ([_, value]) => value === chainNamespace
      );

      if (!foundEntry) {
        throw new Error(
          `Chain value '${chainNamespace}' not found in CHAIN enum`
        );
      }

      return foundEntry[0];
    },
  };
}

import { toChainAgnostic, toUniversal } from './account.utils';

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

    /**
     * Converts a CAIP-10 formatted string into a UniversalAccount.
     *
     * @param {string} caip - A CAIP-10 address string (e.g., 'eip155:1:0xabc...').
     * @returns {UniversalAccount} The resolved account.
     * @throws {Error} If the CAIP string is invalid or unsupported.
     *
     * @example
     * Utils.account.toUniversal('eip155:11155111:0xabc...')
     * // → { chain: CHAIN.ETHEREUM_SEPOLIA, address: '0xabc...' }
     */
    toUniversal,
  };
}

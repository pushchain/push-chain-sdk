import { CHAIN } from '../constants/enums';
import { UniversalAccount, UniversalSigner } from './universal.types';
import { formatAddress } from '../utils/account.utils';

/**
 * Creates a `UniversalAccount` object for working with SDK.
 * Useful for signing or tracking account-specific state in a cross-chain context.
 *
 * @param {Object} params - The account configuration object.
 * @param {string} params.address - The account address.
 * @param {CHAIN} [params.chain=CHAIN.ETHEREUM_SEPOLIA] - The chain the account is associated with.
 * @returns {UniversalAccount} A normalized account object with chain and chainId set.
 *
 * @example
 * const account = createUniversalAccount({ address: "0xabc..." });
 * // → { chain: "ETHEREUM_SEPOLIA", chainId: "11155111", address: "0xAbC..." }
 *
 * @example
 * const solanaAcc = createUniversalAccount({
 *   address: "solana123",
 *   chain: CHAIN.SOLANA_TESTNET
 * });
 * // → { chain: "SOLANA_TESTNET", chainId: "...", address: "solana123" }
 */
export function createUniversalAccount({
  chain = CHAIN.ETHEREUM_SEPOLIA,
  address,
}: Partial<UniversalAccount> & { address: string }): UniversalAccount {
  return {
    chain,
    address: formatAddress(chain, address),
  };
}

/**
 * Creates a `UniversalSigner` object for signing messages on any supported chain.
 *
 * @param {Object} params - The signer configuration object.
 * @param {string} params.address - The signer's address.
 * @param {(data: Uint8Array) => Promise<Uint8Array>} params.signMessage - Message signing function.
 * @param {CHAIN} [params.chain=CHAIN.ETHEREUM_SEPOLIA] - The chain this signer will operate on.
 * @returns {UniversalSigner} A signer object with chain metadata.
 *
 * @example
 * const signer = createUniversalSigner({
 *   address: "0xabc...",
 *   signMessage: async (data) => sign(data)
 * });
 *
 * @example
 * const solSigner = createUniversalSigner({
 *   address: "solanaPubkey123",
 *   chain: CHAIN.SOLANA_DEVNET,
 *   signMessage: async (data) => new Uint8Array([1, 2, 3])
 * });
 */
export function createUniversalSigner({
  chain = CHAIN.ETHEREUM_SEPOLIA,
  address,
  signMessage,
}: Partial<UniversalSigner> & {
  address: string;
  signMessage: (data: Uint8Array) => Promise<Uint8Array>;
}): UniversalSigner {
  return {
    chain,
    address: formatAddress(chain, address),
    signMessage,
  };
}

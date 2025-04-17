import { getAddress } from 'viem';
import { CHAIN_INFO, VM_NAMESPACE } from '../../constants/chain';
import { CHAIN, VM } from '../../constants/enums';
import { UniversalAccount } from '../universal.types';

/**
 * Formats a blockchain address based on the virtual machine type of the provided chain.
 *
 * - For EVM chains, it converts the address to its checksummed format.
 * - For non-EVM chains (e.g., Solana), the original address is returned as-is. - Can be changed in future
 * @param {CHAIN} chain - A fully qualified chain identifier (e.g., CHAIN.ETHEREUM_MAINNET).
 * @param {string} address - The raw address string to normalize.
 * @returns {string} - A VM-compliant formatted address.
 *
 * @throws {Error} If an invalid EVM address is provided.
 *
 * @example
 * // EVM address gets checksummed
 * formatAddress(CHAIN.ETHEREUM_SEPOLIA, "0xabcd...") // → "0xAbCd..."
 *
 * @example
 * // Non-EVM address is returned as-is
 * formatAddress(CHAIN.SOLANA_DEVNET, "solanaAddress123") // → "solanaAddress123"
 */
function formatAddress(chain: CHAIN, address: string): string {
  if (CHAIN_INFO[chain].vm === VM.EVM) {
    try {
      return getAddress(address.toLowerCase());
    } catch {
      throw new Error('Invalid EVM address format');
    }
  }
  return address;
}

/**
 * Creates a `UniversalAccount` object for working with SDK.
 * Useful for signing or tracking account-specific state in a cross-chain context.
 *
 * @param {Object} params - The account configuration object.
 * @param {string} params.address - The account address.
 * @param {CHAIN} params.chain - The chain the account is associated with.
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
  chain,
  address,
}: UniversalAccount): UniversalAccount {
  return {
    chain,
    address: formatAddress(chain, address),
  };
}

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
export function toChainAgnostic(account: UniversalAccount): string {
  const { chain, address } = account;

  const chainMeta = CHAIN_INFO[chain];
  if (!chainMeta) {
    throw new Error(`Unrecognized chain: ${chain}`);
  }

  const { chainId, vm } = chainMeta;
  const namespace = VM_NAMESPACE[vm];

  return `${namespace}:${chainId}:${formatAddress(chain, address)}`;
}

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
export function toUniversal(caip: string): UniversalAccount {
  const [namespace, chainId, rawAddress] = caip.split(':');

  const chain = (Object.entries(CHAIN_INFO).find(
    ([, info]) =>
      info.chainId === chainId && VM_NAMESPACE[info.vm] === namespace
  )?.[0] ?? null) as CHAIN | null;

  if (!chain) {
    throw new Error(`Unsupported or unknown CAIP address: ${caip}`);
  }

  return {
    chain,
    address: formatAddress(chain, rawAddress),
  };
}

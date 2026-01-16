import {
  convertOriginToExecutor,
  fromChainAgnostic,
  convertExecutorToOriginAccount,
  toChainAgnostic,
  toUniversal,
} from './universal/account';
import {
  construct,
  toUniversal as toUniversalSigner,
  toUniversalFromKeypair,
} from './universal/signer';
import { CHAIN, PUSH_NETWORK } from './constants/enums';
import {
  MOVEABLE_TOKENS,
  PAYABLE_TOKENS,
  type MoveableToken,
} from './constants/tokens';
import { SYNTHETIC_PUSH_ERC20 } from './constants/chain';
import { UniversalAccount } from './universal/universal.types';
import type { PushChain } from './push-chain/push-chain';
import { ethers } from 'ethers';

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
    /*
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

    convertExecutorToOriginAccount,
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

  static chains = {
    /**
     * Returns the list of supported chains for a given Push network.
     * Future-proofed to return an object with a `chains` array.
     *
     * @param {PUSH_NETWORK} network - The Push network environment.
     * @returns {{ chains: CHAIN[] }} Object containing supported chains.
     *
     * @example
     * Utils.chains.getSupportedChains(PushChain.CONSTANTS.PUSH_NETWORK.TESTNET)
     * // => { chains: [CHAIN.ETHEREUM_SEPOLIA, CHAIN.SOLANA_DEVNET] }
     *
     * @example
     * Utils.chains.getSupportedChains(PushChain.CONSTANTS.PUSH_NETWORK.MAINNET)
     * // => { chains: [] }
     */
    getSupportedChains: (
      network: PUSH_NETWORK
    ): {
      chains: CHAIN[];
    } => {
      // Current support: expose test/dev chains; mainnet returns empty until GA
      const mapping: Record<PUSH_NETWORK, CHAIN[]> = {
        [PUSH_NETWORK.MAINNET]: [],
        [PUSH_NETWORK.TESTNET]: [
          CHAIN.ETHEREUM_SEPOLIA,
          CHAIN.ARBITRUM_SEPOLIA,
          CHAIN.BASE_SEPOLIA,
          CHAIN.BNB_TESTNET,
          CHAIN.SOLANA_DEVNET,
        ],
        [PUSH_NETWORK.TESTNET_DONUT]: [
          CHAIN.ETHEREUM_SEPOLIA,
          CHAIN.ARBITRUM_SEPOLIA,
          CHAIN.BASE_SEPOLIA,
          CHAIN.BNB_TESTNET,
          CHAIN.SOLANA_DEVNET,
        ],
        [PUSH_NETWORK.LOCALNET]: [
          CHAIN.ETHEREUM_SEPOLIA,
          CHAIN.ARBITRUM_SEPOLIA,
          CHAIN.BASE_SEPOLIA,
          CHAIN.BNB_TESTNET,
          CHAIN.SOLANA_DEVNET,
        ],
      };

      return { chains: mapping[network] ?? [] };
    },

    getChainName: (chainNamespace: string): string | undefined => {
      // Special case: prefer PUSH_TESTNET_DONUT over PUSH_TESTNET for 'eip155:42101'
      if (chainNamespace === 'eip155:42101') {
        return 'PUSH_TESTNET_DONUT';
      }

      const chainEntries = Object.entries(CHAIN);
      const foundEntry = chainEntries.find(
        (entry) => entry[1] === chainNamespace
      );

      if (!foundEntry) {
        return undefined;
      }

      return foundEntry[0];
    },

    /**
     * Returns the chain namespace (e.g., 'eip155:11155111') for a given chain name.
     * Reverse of getChainName. If input is already a namespace, it is returned.
     *
     * @param {string} chainName - The CHAIN key name (e.g., 'ETHEREUM_SEPOLIA' or 'PUSH_TESTNET_DONUT')
     *                             or an existing namespace (e.g., 'eip155:11155111').
     * @returns {string | undefined} The chain namespace, or undefined if unsupported.
     */
    getChainNamespace: (chainName: string): string | undefined => {
      // If already a valid namespace value, return as-is
      const namespaceValues = Object.values(CHAIN) as string[];
      if (namespaceValues.includes(chainName)) {
        return chainName;
      }

      // Map enum key -> value
      const namespace = (CHAIN as Record<string, string | number>)[chainName];
      if (typeof namespace === 'string') {
        return namespace;
      }

      return undefined;
    },
  };

  static helpers = {
    /**
     * @deprecated Use PushChain.utils.chains.getChainNamespace(chainName) instead.
     * Alias maintained for backwards compatibility. Logs a deprecation warning
     * and delegates to Utils.chains.getChainNamespace.
     */
    getChainName: (chainName: string): string | undefined => {
      // Emit deprecation warning on every call to surface migration need
      // Note: Keeping message explicit for SDK consumers
      console.warn(
        '[DEPRECATED] PushChain.utils.helper.getChainName is deprecated. ' +
          'Use PushChain.utils.chains.getChainNamespace(chainName) instead.'
      );
      return Utils.chains.getChainName(chainName);
    },
    encodeTxData({
      abi,
      functionName,
      args = [],
    }: {
      abi: any[];
      functionName: string;
      args?: any[];
    }): `0x${string}` {
      // Validate inputs
      if (!Array.isArray(abi)) {
        throw new Error('ABI must be an array');
      }

      if (!Array.isArray(args)) {
        throw new Error('Arguments must be an array');
      }

      // Find the function in the ABI
      const functionAbi = abi.find((f: any) => f.name === functionName);
      if (!functionAbi) {
        throw new Error(`Function '${functionName}' not found in ABI`);
      }

      try {
        // Create ethers Interface and encode the function data
        const abiInterface = new ethers.Interface(abi);
        const data = abiInterface.encodeFunctionData(functionName, args);
        return data as `0x${string}`;
      } catch (error) {
        throw new Error(
          `Failed to encode function '${functionName}': ${
            error instanceof Error ? error.message : 'Unknown error'
          }`
        );
      }
    },

    /**
     * Multiplies a string representation of a number by a given exponent of base 10 (10^exponent).
     *
     * This is commonly used for converting human-readable token amounts to their on-chain representation.
     * For example, converting "1.5" ETH to wei (18 decimals) would be parseUnits("1.5", 18).
     *
     * @param {string} value - The string representation of the number to multiply.
     * @param {number | {decimals: number}} exponent - The exponent (number of decimal places) or an object with decimals property.
     * @returns {bigint} The result as a bigint.
     *
     * @example
     * Utils.helpers.parseUnits('420', 9)
     * // → 420000000000n
     *
     * @example
     * Utils.helpers.parseUnits('1.5', 18)
     * // → 1500000000000000000n
     *
     * @example
     * Utils.helpers.parseUnits('1.5', {decimals: 18})
     * // → 1500000000000000000n
     */
    parseUnits(value: string, exponent: number | { decimals: number }): bigint {
      // Validate inputs
      if (typeof value !== 'string') {
        throw new Error('Value must be a string');
      }

      // Extract the actual exponent value from either number or object
      let actualExponent: number;
      if (typeof exponent === 'number') {
        actualExponent = exponent;
      } else if (
        typeof exponent === 'object' &&
        exponent !== null &&
        'decimals' in exponent
      ) {
        actualExponent = exponent.decimals;
      } else {
        throw new Error(
          'Exponent must be a number or an object with decimals property'
        );
      }

      if (typeof actualExponent !== 'number') {
        throw new Error('Exponent must be a number');
      }

      if (!Number.isInteger(actualExponent)) {
        throw new Error('Exponent must be an integer');
      }

      if (actualExponent < 0) {
        throw new Error('Exponent must be non-negative');
      }

      // Handle empty string
      if (value.trim() === '') {
        throw new Error('Value cannot be empty');
      }

      // Remove any whitespace
      const trimmedValue = value.trim();

      // Check for valid number format
      if (!/^-?\d*\.?\d*$/.test(trimmedValue)) {
        throw new Error('Value must be a valid number string');
      }

      // Handle case where value is just a decimal point
      if (
        trimmedValue === '.' ||
        trimmedValue === '-.' ||
        trimmedValue === ''
      ) {
        throw new Error('Value must be a valid number string');
      }

      try {
        // Split on decimal point to handle fractional values
        const parts = trimmedValue.split('.');
        const integerPart = parts[0] || '0';
        const fractionalPart = parts[1] || '';

        // Check if fractional part has more digits than the exponent allows
        if (fractionalPart.length > actualExponent) {
          throw new Error(
            `Value has more decimal places (${fractionalPart.length}) than exponent allows (${actualExponent})`
          );
        }

        // Pad fractional part with zeros to match exponent
        const paddedFractionalPart = fractionalPart.padEnd(actualExponent, '0');

        // Combine integer and fractional parts
        const combinedValue = integerPart + paddedFractionalPart;

        // Convert to bigint
        return BigInt(combinedValue);
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes('decimal places')
        ) {
          throw error;
        }
        throw new Error(
          `Failed to parse value '${value}': ${
            error instanceof Error ? error.message : 'Invalid number format'
          }`
        );
      }
    },

    /**
     * Formats a value from smallest units to human-readable string.
     *
     * Supports both EVM-style (like ethers/viem) and Push-style (options object) usage patterns.
     * Always returns a string for UI safety.
     *
     * @param {bigint | string} value - The value in smallest units (e.g., "1500000" or 1500000000000000000n).
     * @param {number | {decimals: number; precision?: number}} decimalsOrOptions - Token decimals or options object.
     * @returns {string} Human-readable string (e.g., "1.5").
     *
     * @example
     * // EVM-style usage
     * Utils.helpers.formatUnits(1500000000000000000n, 18)
     * // → "1.5"
     *
     * @example
     * // Push-style usage
     * Utils.helpers.formatUnits("1500000", { decimals: 6 })
     * // → "1.5"
     *
     * @example
     * // With precision (truncate after 2 decimals)
     * Utils.helpers.formatUnits("1234567", { decimals: 6, precision: 2 })
     * // → "1.23"
     */
    formatUnits(
      value: bigint | string,
      decimalsOrOptions: number | { decimals: number; precision?: number }
    ): string {
      // Validate inputs
      if (typeof value !== 'bigint' && typeof value !== 'string') {
        throw new Error('Value must be a bigint or string');
      }

      // Extract decimals and precision from the second parameter
      let decimals: number;
      let precision: number | undefined;

      if (typeof decimalsOrOptions === 'number') {
        // EVM-style: formatUnits(value, decimals)
        decimals = decimalsOrOptions;
      } else if (
        typeof decimalsOrOptions === 'object' &&
        decimalsOrOptions !== null &&
        'decimals' in decimalsOrOptions
      ) {
        // Push-style: formatUnits(value, { decimals, precision? })
        decimals = decimalsOrOptions.decimals;
        precision = decimalsOrOptions.precision;
      } else {
        throw new Error(
          'Second parameter must be a number (decimals) or an object with decimals property'
        );
      }

      // Validate decimals
      if (typeof decimals !== 'number') {
        throw new Error('Decimals must be a number');
      }

      if (!Number.isInteger(decimals)) {
        throw new Error('Decimals must be an integer');
      }

      if (decimals < 0) {
        throw new Error('Decimals must be non-negative');
      }

      // Validate precision if provided
      if (precision !== undefined) {
        if (typeof precision !== 'number') {
          throw new Error('Precision must be a number');
        }

        if (!Number.isInteger(precision)) {
          throw new Error('Precision must be an integer');
        }

        if (precision < 0) {
          throw new Error('Precision must be non-negative');
        }
      }

      try {
        // Convert string to bigint if needed
        const bigintValue = typeof value === 'string' ? BigInt(value) : value;

        // Use ethers to format the units
        const formatted = ethers.formatUnits(bigintValue, decimals);

        // Apply precision if specified
        if (precision !== undefined) {
          const num = parseFloat(formatted);
          const factor = Math.pow(10, precision);
          const truncated = Math.floor(num * factor) / factor;
          return truncated.toString();
        }

        return formatted;
      } catch (error) {
        throw new Error(
          `Failed to format units: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`
        );
      }
    },
  };

  static conversion = {
    /**
     * Calculates the minimum amount out after applying slippage.
     *
     * Given an input amount and slippage in basis points, returns the minimum amount
     * that should be received after accounting for slippage.
     *
     * @param {string} amount - The input amount in smallest units (e.g., "100000000" for 100 USDC with 6 decimals)
     * @param {object} options - Configuration options
     * @param {number} options.slippageBps - Slippage in basis points (100 = 1%, 50 = 0.5%)
     * @returns {string} The minimum amount out in smallest units
     *
     * @example
     * // Calculate minimum amount for 100 USDC with 1% slippage
     * const amount = PushChain.utils.helpers.parseUnits("100", 6); // "100000000"
     * const minOut = PushChain.utils.conversion.slippageToMinAmount(amount, {
     *   slippageBps: 100, // 1%
     * });
     * // => "99000000" (99 USDC in smallest units)
     *
     * @example
     * // Simple case with whole numbers
     * const minOut = PushChain.utils.conversion.slippageToMinAmount("100", {
     *   slippageBps: 100, // 1%
     * });
     * // => "99"
     */
    slippageToMinAmount(
      amount: string,
      options: {
        slippageBps: number; // 100 = 1%
      }
    ): string {
      // Validate inputs
      if (typeof amount !== 'string') {
        throw new Error('Amount must be a string');
      }

      if (typeof options.slippageBps !== 'number') {
        throw new Error('slippageBps must be a number');
      }

      if (!Number.isInteger(options.slippageBps)) {
        throw new Error('slippageBps must be an integer');
      }

      if (options.slippageBps < 0) {
        throw new Error('slippageBps must be non-negative');
      }

      if (options.slippageBps > 10000) {
        throw new Error('slippageBps cannot exceed 10000 (100%)');
      }

      // Handle empty string
      if (amount.trim() === '') {
        throw new Error('Amount cannot be empty');
      }

      try {
        // Convert amount to BigInt for precise calculation
        const amountBigInt = BigInt(amount);

        // Calculate slippage factor: (10000 - slippageBps) / 10000
        // For 1% slippage (100 bps): (10000 - 100) / 10000 = 0.99
        const slippageFactor = BigInt(10000 - options.slippageBps);

        // Calculate minimum amount: amount * slippageFactor / 10000
        const minAmountBigInt = (amountBigInt * slippageFactor) / BigInt(10000);

        return minAmountBigInt.toString();
      } catch (error) {
        throw new Error(
          `Failed to calculate slippage: ${
            error instanceof Error ? error.message : 'Invalid amount format'
          }`
        );
      }
    },
  };

  static tokens = {
    /**
     * Returns supported moveable tokens as a flat list with chain info.
     * - If a specific chain or a PushChain client is passed, returns only that chain's tokens
     * - Otherwise returns tokens across all chains
     */
    getMoveableTokens(chainOrClient?: CHAIN | PushChain): {
      tokens: Array<{
        chain: CHAIN;
        symbol: string;
        decimals: number;
        address: string;
        mechanism: 'approve' | 'permit2' | 'native';
      }>;
    } {
      const chain: CHAIN | undefined =
        Utils.resolveChainFromInput(chainOrClient);

      if (chain) {
        const list = MOVEABLE_TOKENS[chain] ?? [];
        return {
          tokens: list.map((t) => ({
            chain,
            symbol: t.symbol,
            decimals: t.decimals,
            address: t.address,
            mechanism: t.mechanism,
          })),
        };
      }

      const tokens: Array<{
        chain: CHAIN;
        symbol: string;
        decimals: number;
        address: string;
        mechanism: 'approve' | 'permit2' | 'native';
      }> = [];

      for (const [key, list] of Object.entries(MOVEABLE_TOKENS)) {
        const k = key as CHAIN;
        for (const t of list ?? []) {
          tokens.push({
            chain: k,
            symbol: t.symbol,
            decimals: t.decimals,
            address: t.address,
            mechanism: t.mechanism,
          });
        }
      }

      return { tokens };
    },

    /**
     * Returns supported payable tokens as a flat list with chain info.
     * - If a specific chain or a PushChain client is passed, returns only that chain's tokens
     * - Otherwise returns tokens across all chains
     */
    getPayableTokens(chainOrClient?: CHAIN | PushChain): {
      tokens: Array<{
        chain: CHAIN;
        symbol: string;
        decimals: number;
        address: string;
        mechanism: 'approve' | 'permit2' | 'native';
      }>;
    } {
      const chain: CHAIN | undefined =
        Utils.resolveChainFromInput(chainOrClient);

      if (chain) {
        const list = PAYABLE_TOKENS[chain] ?? [];
        return {
          tokens: list.map((t) => ({
            chain,
            symbol: t.symbol,
            decimals: t.decimals,
            address: t.address,
            mechanism: t.mechanism,
          })),
        };
      }

      const tokens: Array<{
        chain: CHAIN;
        symbol: string;
        decimals: number;
        address: string;
        mechanism: 'approve' | 'permit2' | 'native';
      }> = [];

      for (const [key, list] of Object.entries(PAYABLE_TOKENS)) {
        const k = key as CHAIN;
        for (const t of list ?? []) {
          tokens.push({
            chain: k,
            symbol: t.symbol,
            decimals: t.decimals,
            address: t.address,
            mechanism: t.mechanism,
          });
        }
      }

      return { tokens };
    },

    /**
     * Convert any supported origin-chain token into its mapped PRC20 token address on Push Chain.
     *
     * @param token - Either a MoveableToken from `pushChainClient.moveable.token.*`
     * or an object with the origin chain and token address.
     * @returns {`0x${string}`} The synthetic asset address on Push Chain.
     *
     * @example
     * ```jsx
     * PushChain.utils.tokens.getPRC20Address(
     *   token: MoveableToken | {
     *     chain: CONSTANTS.CHAIN.ETHEREUM_SEPOLIA;
     *     address: `0x${string}`;
     *   }
     * );
     * // → `0x...`
     * ```
     */
    getPRC20Address(
      token: MoveableToken | { chain: string; address: string }
    ): `0x${string}` {
      // Infer origin chain and symbol by matching against the MOVEABLE_TOKENS registry
      let originChain: CHAIN | undefined;
      let tokenSymbol: string | undefined;

      if ('symbol' in token) {
        // MoveableToken path: infer chain by symbol + address
        for (const [key, list] of Object.entries(MOVEABLE_TOKENS)) {
          const k = key as CHAIN;
          const found = (list ?? []).some(
            (t) => t.symbol === token.symbol && t.address === token.address
          );
          if (found) {
            originChain = k;
            tokenSymbol = token.symbol;
            break;
          }
        }
      } else {
        // { chain, address } path: trust the provided chain and resolve symbol via registry
        originChain = token.chain as CHAIN;
        const list = MOVEABLE_TOKENS[originChain] ?? [];
        const match = (list ?? []).find((t) => t.address === token.address);
        if (match) {
          tokenSymbol = match.symbol;
        }
      }

      if (!originChain || !tokenSymbol) {
        throw new Error(
          'Unable to infer origin chain or token symbol for token'
        );
      }

      // Select Push network mapping (tests/use-cases use TESTNET_DONUT; identical to TESTNET here)
      const network = PUSH_NETWORK.TESTNET_DONUT;
      const map = SYNTHETIC_PUSH_ERC20[network];

      // Map token → synthetic key by origin chain family
      const isEthFamily =
        originChain === CHAIN.ETHEREUM_MAINNET ||
        originChain === CHAIN.ETHEREUM_SEPOLIA;
      const isArbFamily = originChain === CHAIN.ARBITRUM_SEPOLIA;
      const isBaseFamily = originChain === CHAIN.BASE_SEPOLIA;
      const isBnbFamily = originChain === CHAIN.BNB_TESTNET;
      const isSolFamily = originChain === CHAIN.SOLANA_DEVNET;

      let key:
        | 'pETH'
        | 'pETH_ARB'
        | 'pETH_BASE'
        | 'pETH_BNB'
        | 'pSOL'
        | 'USDT_ETH'
        | 'USDT_ARB'
        | 'USDT_SOL'
        | 'USDT_BNB'
        | 'USDT_BASE';

      switch (tokenSymbol) {
        case 'ETH': {
          if (isEthFamily) key = 'pETH';
          else if (isArbFamily) key = 'pETH_ARB';
          else if (isBaseFamily) key = 'pETH_BASE';
          else if (isBnbFamily) key = 'pETH_BNB';
          else
            throw new Error(
              'Unsupported ETH origin chain for synthetic mapping'
            );
          break;
        }
        case 'SOL': {
          if (!isSolFamily)
            throw new Error('SOL token provided but origin is not Solana');
          key = 'pSOL';
          break;
        }
        case 'USDT': {
          if (isEthFamily) key = 'USDT_ETH';
          else if (isArbFamily) key = 'USDT_ARB';
          else if (isBaseFamily) key = 'USDT_BASE';
          else if (isBnbFamily) key = 'USDT_BNB';
          else if (isSolFamily) key = 'USDT_SOL';
          else
            throw new Error(
              'Unsupported USDT origin chain for synthetic mapping'
            );
          break;
        }
        default:
          throw new Error(`Unsupported token symbol: ${tokenSymbol}`);
      }

      return map[key];
    },
  };

  /**
   * Internal: resolves a CHAIN enum from either a CHAIN value or a PushChain client instance.
   */
  private static resolveChainFromInput(
    chainOrClient?: CHAIN | PushChain
  ): CHAIN | undefined {
    if (!chainOrClient) return undefined;
    if (typeof chainOrClient === 'string') return chainOrClient as CHAIN;
    // PushChain client → get origin chain from signer account
    try {
      const originAccount = (chainOrClient as PushChain).universal?.origin as
        | UniversalAccount
        | undefined;
      if (originAccount && originAccount.chain) return originAccount.chain;
    } catch {
      // ignore
    }
    return undefined;
  }
}

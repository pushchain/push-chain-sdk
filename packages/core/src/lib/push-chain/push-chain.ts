import { CONSTANTS } from '../constants';
import { CHAIN, PUSH_NETWORK, VM } from '../constants/enums';
import { CHAIN_INFO } from '../constants/chain';
import { Orchestrator } from '../orchestrator/orchestrator';
import { createUniversalSigner } from '../universal/signer';
import {
  UniversalAccount,
  UniversalSigner,
} from '../universal/universal.types';
import { Utils } from '../utils';
import { utils } from '@coral-xyz/anchor';
import { Abi, bytesToHex, parseAbi, TypedData, TypedDataDomain } from 'viem';
import { ProgressEvent } from '../progress-hook/progress-hook.types';
import { EvmClient } from '../vm-client/evm-client';
import {
  MOVEABLE_TOKENS,
  PAYABLE_TOKENS,
  MoveableToken,
  PayableToken,
  ConversionQuote,
  MoveableTokenAccessor,
  PayableTokenAccessor,
} from '../constants/tokens';

/**
 * @class PushChain
 *
 * Entry point to interact with Push Chain in your application.
 * Provides access to cross-chain execution, utilities, and signer abstraction.
 */
export class PushChain {
  /**
   * @static
   * Constants for the PushChain SDK.
   */
  public static CONSTANTS = CONSTANTS;

  /**
   * @static
   * Utility functions for encoding, hashing, and data formatting.
   */
  public static utils = Utils;

  /**
   * Helper function to check if input is UniversalAccount (read-only) or UniversalSigner
   */
  private static isUniversalAccount(
    input: UniversalSigner | UniversalAccount
  ): input is UniversalAccount {
    return !('signMessage' in input) && !('signAndSendTransaction' in input);
  }

  /**
   * Universal namespace containing core transaction and address computation methods
   */
  universal: {
    // pushChainClient.universal.origin. not a function, just a property. => Return UOA wallet address. If from Push chain, both returns above will match. Else, it will tell from which chian it comes from.
    get origin(): ReturnType<Orchestrator['getUOA']>;
    // pushChainClient.universal.account. not a function, just a property. => Return UEA (wallet from push chain). If on push, return Push Chain wallet itself.
    get account(): ReturnType<Orchestrator['computeUEAOffchain']>;
    /**
     * Executes a transaction on Push Chain
     */
    sendTransaction: Orchestrator['execute'];
    /**
     * Signs an arbitrary message
     */
    signMessage: (data: Uint8Array) => Promise<string>;
    /**
     * Signs EIP-712 typed data
     */
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
    }) => Promise<string>;
  };

  explorer: {
    getTransactionUrl: (txHash: string) => string;
    listUrls: () => { urls: string[] };
  };

  /**
   * Moveable and payable token registries exposed on the client instance.
   * These are derived from the origin chain and only include tokens available for that chain.
   */
  moveable: { token: MoveableTokenAccessor };
  payable: { token: PayableTokenAccessor };

  funds: {
    getConversionQuote: (
      amountIn: bigint,
      options: {
        from: PayableToken | undefined;
        to: MoveableToken | undefined;
      }
    ) => Promise<ConversionQuote>;
  };

  private constructor(
    private orchestrator: Orchestrator,
    private universalSigner: UniversalSigner,
    private blockExplorers: Partial<Record<CHAIN, string[]>>,
    public isReadMode: boolean
  ) {
    this.orchestrator = orchestrator;

    this.universal = {
      get origin() {
        return orchestrator.getUOA();
      },
      get account() {
        return orchestrator.computeUEAOffchain();
      },
      sendTransaction: (...args) => {
        if (this.isReadMode) {
          throw new Error(
            'Read only mode cannot call sendTransaction function'
          );
        }
        return orchestrator.execute.bind(orchestrator)(...args);
      },
      signMessage: async (data: Uint8Array) => {
        if (this.isReadMode) {
          throw new Error('Read only mode cannot call signMessage function');
        }
        const sigBytes = await universalSigner.signMessage(data);
        const chain = universalSigner.account.chain;
        if (CHAIN_INFO[chain].vm === VM.EVM) {
          return bytesToHex(sigBytes);
        } else if (CHAIN_INFO[chain].vm === VM.SVM) {
          return utils.bytes.bs58.encode(sigBytes);
        }
        return bytesToHex(sigBytes);
      },
      signTypedData: async (...args) => {
        if (typeof universalSigner.signTypedData !== 'function') {
          throw new Error('Typed data signing not supported');
        }
        const signBytes = await universalSigner.signTypedData(...args);
        return bytesToHex(signBytes);
      },
    };

    this.explorer = {
      getTransactionUrl: (txHash: string) => {
        return `https://donut.push.network/tx/${txHash}`;
      },
      listUrls: () => {
        return { urls: blockExplorers[CHAIN.PUSH_TESTNET_DONUT] ?? [] };
      },
    };

    // Derive moveable/payable tokens for the current origin chain
    const originChain = universalSigner.account.chain;
    const toTokenMap = <T extends { symbol: string }>(arr: T[] | undefined) =>
      (arr ?? []).reduce<Record<string, T>>((acc, t) => {
        acc[t.symbol] = t;
        return acc;
      }, {});

    const moveableList =
      MOVEABLE_TOKENS[originChain] ??
      MOVEABLE_TOKENS[CHAIN.ETHEREUM_MAINNET] ??
      MOVEABLE_TOKENS[CHAIN.ETHEREUM_SEPOLIA] ??
      [];
    const payableList =
      PAYABLE_TOKENS[originChain] ??
      PAYABLE_TOKENS[CHAIN.ETHEREUM_MAINNET] ??
      PAYABLE_TOKENS[CHAIN.ETHEREUM_SEPOLIA] ??
      [];

    this.moveable = {
      token: new MoveableTokenAccessor(
        toTokenMap(moveableList) as Record<string, MoveableToken>
      ),
    };
    this.payable = {
      token: new PayableTokenAccessor(
        toTokenMap(payableList) as Record<string, PayableToken>
      ),
    };

    this.funds = {
      getConversionQuote: async (
        amountIn: bigint,
        {
          from,
          to,
        }: {
          from: PayableToken | undefined;
          to: MoveableToken | undefined;
        }
      ): Promise<ConversionQuote> => {
        const originChain = universalSigner.account.chain;
        if (originChain !== CHAIN.ETHEREUM_SEPOLIA) {
          throw new Error(
            'getConversionQuote is only supported on Ethereum Sepolia for now'
          );
        }

        if (!from) {
          throw new Error('from token is required');
        }

        if (!to) {
          throw new Error('to token is required');
        }

        // Resolve RPCs from client config, falling back to defaults
        const rpcUrls =
          orchestrator.getRpcUrls()[originChain] ||
          CHAIN_INFO[originChain].defaultRPC;

        const evm = new EvmClient({ rpcUrls });

        // Minimal ABIs and Uniswap V3 addresses sourced from chain config
        const factoryFromConfig = CHAIN_INFO[originChain].dex?.uniV3Factory;
        const quoterFromConfig = CHAIN_INFO[originChain].dex?.uniV3QuoterV2;
        if (!factoryFromConfig || !quoterFromConfig) {
          throw new Error('Uniswap V3 addresses not configured for this chain');
        }
        const UNISWAP_V3_FACTORY = factoryFromConfig as `0x${string}`;
        const UNISWAP_V3_QUOTER_V2 = quoterFromConfig as `0x${string}`;

        const factoryAbi: Abi = parseAbi([
          'function getPool(address tokenA, address tokenB, uint24 fee) view returns (address)',
        ]);
        const quoterAbi: Abi = parseAbi([
          'function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
        ]);
        const poolAbi: Abi = parseAbi([
          'function liquidity() view returns (uint128)',
        ]);

        const feeTiers: number[] = [100, 500, 3000, 10000];

        let bestAmountOut = BigInt(0);
        let bestFee: number | null = null;

        for (const fee of feeTiers) {
          // Find pool address for this fee tier
          const poolAddress = await evm.readContract<string>({
            abi: factoryAbi,
            address: UNISWAP_V3_FACTORY,
            functionName: 'getPool',
            args: [from.address, to.address, fee],
          });

          const isZero =
            !poolAddress ||
            poolAddress.toLowerCase() ===
              '0x0000000000000000000000000000000000000000';
          if (isZero) continue;

          // Skip uninitialized/empty pools to avoid Quoter reverts
          try {
            const liquidity = await evm.readContract<bigint>({
              abi: poolAbi,
              address: poolAddress as `0x${string}`,
              functionName: 'liquidity',
              args: [],
            });
            if (!liquidity || liquidity === BigInt(0)) {
              continue;
            }
          } catch {
            // If we can't read liquidity, skip this pool/fee tier
            continue;
          }

          // Quote exact input single for this fee tier; catch reverts due to empty/uninitialized pools
          try {
            const result = await evm.readContract<
              [bigint, bigint, number, bigint]
            >({
              abi: quoterAbi,
              address: UNISWAP_V3_QUOTER_V2,
              functionName: 'quoteExactInputSingle',
              args: [
                {
                  tokenIn: from.address,
                  tokenOut: to.address,
                  amountIn,
                  fee,
                  sqrtPriceLimitX96: BigInt(0),
                },
              ],
            });

            const amountOut = result?.[0] ?? BigInt(0);
            if (amountOut > bestAmountOut) {
              bestAmountOut = amountOut;
              bestFee = fee;
            }
          } catch {
            // try next fee
          }
        }

        if (!bestFee) {
          throw new Error(
            'No direct Uniswap V3 pool found for the given token pair on common fee tiers'
          );
        }

        // Compute normalized rate: tokenOut per tokenIn
        const amountInHuman = parseFloat(
          Utils.helpers.formatUnits(amountIn, { decimals: from.decimals })
        );
        const amountOutHuman = parseFloat(
          Utils.helpers.formatUnits(bestAmountOut, { decimals: to.decimals })
        );
        const rate = amountInHuman > 0 ? amountOutHuman / amountInHuman : 0;

        return {
          amountIn: amountIn.toString(),
          amountOut: bestAmountOut.toString(),
          rate,
          route: [from.symbol, to.symbol],
          timestamp: Date.now(),
        };
      },
    };
  }

  /**
   * @private
   * Internal method to create a PushChain instance with the given parameters.
   * Used by both initialize and reinitialize methods to avoid code duplication.
   */
  private static async createInstance(
    universalSigner: UniversalSigner | UniversalAccount,
    options?: {
      network: PUSH_NETWORK;
      rpcUrls?: Partial<Record<CHAIN, string[]>>;
      blockExplorers?: Partial<Record<CHAIN, string[]>>;
      printTraces?: boolean;
      progressHook?: (progress: ProgressEvent) => void;
    }
  ): Promise<PushChain> {
    const isReadOnly = PushChain.isUniversalAccount(universalSigner);

    // If it's a UniversalAccount (read-only), create a dummy signer for the orchestrator
    const validatedUniversalSigner = isReadOnly
      ? createUniversalSigner({
          account: universalSigner,
          signMessage: async () => {
            throw new Error('Read only mode cannot call signMessage function');
          },
          signAndSendTransaction: async () => {
            throw new Error(
              'Read only mode cannot call signAndSendTransaction function'
            );
          },
        })
      : createUniversalSigner(universalSigner as UniversalSigner);

    const blockExplorers = options?.blockExplorers ?? {
      [CHAIN.PUSH_TESTNET_DONUT]: ['https://donut.push.network'],
    };
    const orchestrator = new Orchestrator(
      /**
       * Ensures the signer conforms to the UniversalSigner interface.
       */
      validatedUniversalSigner,
      options?.network ?? PUSH_NETWORK.TESTNET_DONUT,
      options?.rpcUrls ?? {},
      options?.printTraces ?? false,
      options?.progressHook
    );
    return new PushChain(
      orchestrator,
      validatedUniversalSigner,
      blockExplorers,
      isReadOnly
    );
  }

  /**
   * @method initialize
   * Initializes the PushChain SDK with a universal signer and optional config.
   *
   * @param universalSigner
   * @param options - Optional settings to configure the SDK instance.
   *   - network: PushChain network to target (e.g., TESTNET_DONUT, MAINNET).
   *   - rpcUrls: Custom RPC URLs mapped by chain IDs.
   *   - printTraces: Whether to print internal trace logs for debugging.
   *
   * @returns An initialized instance of PushChain.
   */
  static initialize = async (
    universalSigner: UniversalSigner | UniversalAccount,
    options?: {
      network: PUSH_NETWORK;
      rpcUrls?: Partial<Record<CHAIN, string[]>>;
      blockExplorers?: Partial<Record<CHAIN, string[]>>;
      printTraces?: boolean;
      progressHook?: (progress: ProgressEvent) => void;
    }
  ): Promise<PushChain> => {
    return PushChain.createInstance(universalSigner, options);
  };

  /**
   * @method reinitialize
   * Reinitializes the PushChain SDK with a new universal signer and optional config.
   *
   * @param universalSigner
   * @param options - Optional settings to configure the SDK instance.
   *   - network: PushChain network to target (e.g., TESTNET_DONUT, MAINNET).
   *   - rpcUrls: Custom RPC URLs mapped by chain IDs.
   *   - printTraces: Whether to print internal trace logs for debugging.
   *
   * @returns A new initialized instance of PushChain.
   */
  reinitialize = async (
    universalSigner: UniversalSigner | UniversalAccount,
    options?: {
      network: PUSH_NETWORK;
      rpcUrls?: Partial<Record<CHAIN, string[]>>;
      blockExplorers?: Partial<Record<CHAIN, string[]>>;
      printTraces?: boolean;
      progressHook?: (progress: ProgressEvent) => void;
    }
  ): Promise<PushChain> => {
    const mergedOptions = {
      network: options?.network ?? this.orchestrator.getNetwork(),
      rpcUrls: options?.rpcUrls ?? this.orchestrator.getRpcUrls(),
      blockExplorers: options?.blockExplorers ?? this.blockExplorers,
      printTraces: options?.printTraces ?? this.orchestrator.getPrintTraces(),
      progressHook:
        options?.progressHook ?? this.orchestrator.getProgressHook(),
    } as {
      network: PUSH_NETWORK;
      rpcUrls?: Partial<Record<CHAIN, string[]>>;
      blockExplorers?: Partial<Record<CHAIN, string[]>>;
      printTraces?: boolean;
      progressHook?: (progress: ProgressEvent) => void;
    };
    return PushChain.createInstance(universalSigner, mergedOptions);
  };
}

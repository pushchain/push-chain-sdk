import { CONSTANTS } from '../constants';
import { CHAIN, PUSH_NETWORK, VM } from '../constants/enums';
import {
  CHAIN_INFO,
  CHAIN_EXPLORERS,
  getExplorerTxUrl,
} from '../constants/chain';
import { Orchestrator } from '../orchestrator/orchestrator';
import { createUniversalSigner } from '../universal/signer';
import {
  UniversalAccount,
  UniversalSigner,
} from '../universal/universal.types';
import { Utils } from '../utils';
import { bs58 } from '../internal/bs58';
import { Abi, bytesToHex, parseAbi, TypedData, TypedDataDomain } from 'viem';
import { ProgressEvent } from '../progress-hook/progress-hook.types';
import type { AccountStatus } from '../orchestrator/orchestrator.types';
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
import type {
  UniversalExecuteParams,
  PreparedUniversalTx,
  CascadedTransactionBuilder,
  UniversalTxResponse,
  RescueFundsParams,
} from '../orchestrator/orchestrator.types';

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
     * Executes a transaction with automatic route detection.
     *
     * Supports both simple Push Chain transactions and multi-chain routing:
     * - Route 1 (UOA_TO_PUSH): `to` is a simple address string → executes on Push Chain
     * - Route 2 (UOA_TO_CEA): `to` is `{ address, chain }` → executes on external chain via CEA
     * - Route 3 (CEA_TO_PUSH): `from.chain` specified, targeting Push Chain
     * - Route 4 (CEA_TO_CEA): `from.chain` specified, targeting external chain
     *
     * @example
     * // Route 1: Simple Push Chain transaction
     * await client.universal.sendTransaction({ to: '0x...', value: parseEther('0.01') });
     *
     * @example
     * // Route 2: Cross-chain to external chain
     * await client.universal.sendTransaction({
     *   to: { address: '0x...', chain: CHAIN.BNB_TESTNET },
     *   value: parseEther('0.001')
     * });
     */
    sendTransaction: Orchestrator['execute'];
    /**
     * Prepare a universal transaction without executing it.
     * Returns a PreparedUniversalTx that can be chained with thenOn() or sent.
     */
    prepareTransaction: Orchestrator['prepareTransaction'];
    /**
     * Execute multiple transactions in sequence across chains.
     * Accepts PreparedUniversalTx (from prepareTransaction) and returns
     * a CascadedTransactionBuilder that supports .thenOn() for chaining.
     */
    executeTransactions: (
      firstTx: PreparedUniversalTx
    ) => CascadedTransactionBuilder;
    /**
     * Tracks a transaction by hash on Push Chain
     */
    trackTransaction: Orchestrator['trackTransaction'];
    /**
     * Migrate the CEA contract on an external chain to the latest version.
     * Sends a MIGRATION_SELECTOR payload to trigger CEA upgrade.
     *
     * @param chain - The external chain where the CEA should be migrated
     */
    migrateCEA: Orchestrator['migrateCEA'];
    /**
     * Rescue stuck funds on a source chain.
     * When a CEA-to-Push inbound tx fails, tokens get locked in the Vault.
     * This triggers a manual revert via TSS to release those funds.
     */
    rescueFunds: Orchestrator['rescueFunds'];
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
    getTransactionUrl: (
      txHash: string,
      options?: { chain?: CHAIN }
    ) => string;
    listUrls: (options?: { chain?: CHAIN }) => {
      explorers: Array<{
        chain: string;
        chainName: string;
        urls: string[];
      }>;
    };
    listAllUrls: () => {
      explorers: Array<{
        chain: string;
        chainName: string;
        urls: string[];
      }>;
    };
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

  /**
   * Account status including UEA deployment state and version info.
   * Initially unloaded — call getAccountStatus() to populate.
   */
  accountStatus: AccountStatus;

  /**
   * Promise for the background account status fetch started during initialize().
   * Await this if you need to ensure account status is loaded before proceeding.
   * Resolves to void (result is stored in accountStatus).
   */
  accountStatusReady: Promise<void>;

  private constructor(
    private orchestrator: Orchestrator,
    private universalSigner: UniversalSigner,
    private blockExplorers: Partial<Record<CHAIN, string[]>>,
    public isReadMode: boolean
  ) {
    this.orchestrator = orchestrator;

    this.accountStatus = {
      mode: isReadMode ? 'read-only' : 'signer',
      uea: {
        loaded: false,
        deployed: false,
        version: '',
        minRequiredVersion: '',
        requiresUpgrade: false,
      },
    };

    // Default — overwritten in createInstance() with the background fetch
    this.accountStatusReady = Promise.resolve();

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
      prepareTransaction: (params: UniversalExecuteParams) => {
        if (this.isReadMode) {
          throw new Error(
            'Read only mode cannot call prepareTransaction function'
          );
        }
        return orchestrator.prepareTransaction.bind(orchestrator)(params);
      },
      executeTransactions: (firstTx: PreparedUniversalTx) => {
        if (this.isReadMode) {
          throw new Error(
            'Read only mode cannot call executeTransactions function'
          );
        }
        return orchestrator.createCascadedBuilder([firstTx]);
      },
      trackTransaction: (txHash: string, options?: import('../orchestrator/orchestrator.types').TrackTransactionOptions) => {
        return orchestrator.trackTransaction.bind(orchestrator)(txHash, options);
      },
      migrateCEA: (chain: CHAIN) => {
        if (this.isReadMode) {
          throw new Error('Read only mode cannot call migrateCEA function');
        }
        return orchestrator.migrateCEA.bind(orchestrator)(chain);
      },
      rescueFunds: (params: RescueFundsParams) => {
        if (this.isReadMode) {
          throw new Error('Read only mode cannot call rescueFunds function');
        }
        return orchestrator.rescueFunds.bind(orchestrator)(params);
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
          return bs58.encode(Buffer.from(sigBytes));
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

    const network =
      orchestrator.getNetwork() === PUSH_NETWORK.MAINNET
        ? 'mainnet'
        : 'testnet';

    this.explorer = {
      getTransactionUrl: (
        txHash: string,
        options?: { chain?: CHAIN }
      ): string => {
        if (options?.chain) {
          // Use user-provided block explorers first, then fall back to built-in
          const userUrls = blockExplorers[options.chain];
          if (userUrls?.length) {
            return `${userUrls[0]}/tx/${txHash}`;
          }
          const builtInUrl = getExplorerTxUrl(txHash, options.chain, network);
          if (builtInUrl) return builtInUrl;
        }
        // Default: Push Chain explorer
        const pushUrls = blockExplorers[CHAIN.PUSH_TESTNET_DONUT];
        if (pushUrls?.length) {
          return `${pushUrls[0]}/tx/${txHash}`;
        }
        return `https://donut.push.network/tx/${txHash}`;
      },

      listUrls: (options?: { chain?: CHAIN }) => {
        const targetChain = options?.chain ?? CHAIN.PUSH_TESTNET_DONUT;

        // Check user-provided block explorers first
        const userUrls = blockExplorers[targetChain];
        if (userUrls?.length) {
          return {
            explorers: [
              {
                chain: targetChain,
                chainName: Utils.chains.getChainName(targetChain) ?? targetChain,
                urls: userUrls,
              },
            ],
          };
        }

        // Fall back to built-in CHAIN_EXPLORERS
        const explorers = CHAIN_EXPLORERS[targetChain];
        const builtInUrls =
          network === 'mainnet' ? explorers?.mainnet : explorers?.testnet;

        return {
          explorers: [
            {
              chain: targetChain,
              chainName: Utils.chains.getChainName(targetChain) ?? targetChain,
              urls: builtInUrls ?? [],
            },
          ],
        };
      },

      listAllUrls: () => {
        const result: Array<{
          chain: string;
          chainName: string;
          urls: string[];
        }> = [];

        // Collect all chains from both built-in and user-provided explorers
        const allChains = new Set<CHAIN>([
          ...(Object.keys(CHAIN_EXPLORERS) as CHAIN[]),
          ...(Object.keys(blockExplorers) as CHAIN[]),
        ]);

        for (const chain of allChains) {
          // User overrides take precedence
          const userUrls = blockExplorers[chain];
          if (userUrls?.length) {
            result.push({
              chain,
              chainName: Utils.chains.getChainName(chain) ?? chain,
              urls: userUrls,
            });
            continue;
          }

          // Built-in CHAIN_EXPLORERS
          const explorers = CHAIN_EXPLORERS[chain];
          const builtInUrls =
            network === 'mainnet' ? explorers?.mainnet : explorers?.testnet;
          if (builtInUrls?.length) {
            result.push({
              chain,
              chainName: Utils.chains.getChainName(chain) ?? chain,
              urls: builtInUrls,
            });
          }
        }

        return { explorers: result };
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
   * Fetches the account status including UEA deployment state and version info.
   * Results are cached — pass forceRefresh to bypass cache.
   */
  async getAccountStatus(
    options?: { forceRefresh?: boolean }
  ): Promise<AccountStatus> {
    const status = await this.orchestrator.getAccountStatus(options);
    this.accountStatus = status;
    return status;
  }

  /**
   * Upgrades the UEA to the latest implementation version.
   * This is a gasless operation that updates the UEA proxy on Push Chain.
   *
   * @throws Error if called in read-only mode
   */
  async upgradeAccount(
    options?: { progressHook?: (progress: ProgressEvent) => void }
  ): Promise<void> {
    if (this.isReadMode) {
      throw new Error('Read only mode cannot call upgradeAccount function');
    }
    await this.orchestrator.upgradeAccount(options);
    // Refresh local accountStatus after upgrade
    this.accountStatus = await this.orchestrator.getAccountStatus({
      forceRefresh: true,
    });
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
    const instance = new PushChain(
      orchestrator,
      validatedUniversalSigner,
      blockExplorers,
      isReadOnly
    );

    // Background fetch account status (non-blocking, 30s timeout)
    // Stored on instance so consumers can await it if needed: await client.accountStatusReady
    const ACCOUNT_STATUS_TIMEOUT = 30_000;
    instance.accountStatusReady = Promise.race([
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      instance.getAccountStatus().then(() => {}),
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error('Account status fetch timed out')), ACCOUNT_STATUS_TIMEOUT)
      ),
    ]).catch(() => {
      // Silently ignore — lazy check in execute() will retry if needed
    });

    // Let execute() await the background fetch instead of re-fetching
    orchestrator.accountStatusReadyPromise = instance.accountStatusReady;

    return instance;
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

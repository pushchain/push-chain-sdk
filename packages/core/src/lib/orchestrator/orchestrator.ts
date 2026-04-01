import { TransactionReceipt } from 'viem';
import { CHAIN_INFO } from '../constants/chain';
import { CHAIN, PUSH_NETWORK } from '../constants/enums';
import {
  ConversionQuote,
  MoveableToken,
  PayableToken,
} from '../constants/tokens';
import type { AccountStatus, UniversalTxResponse } from './orchestrator.types';
import { PROGRESS_HOOK, ProgressEvent } from '../progress-hook/progress-hook.types';
import { PushClient } from '../push-client/push-client';
import type { UniversalAccount, UniversalSigner } from '../universal/universal.types';
import {
  ExecuteParams,
  UniversalExecuteParams,
  PreparedUniversalTx,
  CascadedTransactionBuilder,
  CascadeHopInfo,
  RescueFundsParams,
} from './orchestrator.types';
import { isChainTarget } from './route-detector';
import {
  type OrchestratorContext,
  printLog as _printLog, fireProgressHook as _fireProgressHook,
  transformToUniversalTxReceipt as _transformToUniversalTxReceipt,
  computeUEAOffchain as _computeUEAOffchain, computeUEA as _computeUEA,
  waitForOutboundTx as _waitForOutboundTx, waitForAllOutboundTxsV2 as _waitForAllOutboundTxsV2,
  OUTBOUND_INITIAL_WAIT_MS, OUTBOUND_POLL_INTERVAL_MS, OUTBOUND_MAX_TIMEOUT_MS,
  quoteExactOutput as _quoteExactOutput,
  getAccountStatus as _getAccountStatus, upgradeAccount as _upgradeAccount, migrateCEA as _migrateCEA,
  trackTransaction as _trackTransaction, transformToUniversalTxResponse as _transformToUniversalTxResponse,
  type ResponseBuilderCallbacks,
  prepareTransaction as _prepareTransaction,
  createCascadedBuilder as _createCascadedBuilder,
  type CascadeCallbacks,
  rescueFunds as _rescueFunds,
  executeFundsOnly as _executeFundsOnly,
  executeFundsWithPayload as _executeFundsWithPayload,
  executeStandardPayload as _executeStandardPayload,
  executeMultiChain as _executeMultiChain,
  queryOutboundGasFee as _queryOutboundGasFee,
  extractUniversalSubTxIdFromTx as _extractUniversalSubTxIdFromTx,
  extractAllUniversalSubTxIds as _extractAllUniversalSubTxIds,
} from './internals';

export class Orchestrator {
  // These fields are accessed via `this.ctx` (OrchestratorContext cast) by internal modules
  private _pushClient: PushClient | null = null;
  private _pushClientOptions: { rpcUrls: string[]; network: PUSH_NETWORK } | null = null;
  /* @internal */ get pushClient(): PushClient {
    if (!this._pushClient) {
      this._pushClient = new PushClient(this._pushClientOptions!);
    }
    return this._pushClient;
  }
  /* @internal */ accountStatusCache: AccountStatus | null = null;

  private get ctx(): OrchestratorContext { return this as unknown as OrchestratorContext; }
  private _getResponseCallbacks(): ResponseBuilderCallbacks {
    return {
      trackTransaction: this.trackTransaction.bind(this),
      waitForOutboundTx: (hash: string, opts?: any) => _waitForOutboundTx(this.ctx, hash, opts),
      transformToUniversalTxReceipt: (receipt: TransactionReceipt, resp: UniversalTxResponse) => _transformToUniversalTxReceipt(receipt, resp),
      printLog: (msg: string) => _printLog(this.ctx, msg),
      outboundConstants: { initialWaitMs: OUTBOUND_INITIAL_WAIT_MS, pollingIntervalMs: OUTBOUND_POLL_INTERVAL_MS, maxTimeoutMs: OUTBOUND_MAX_TIMEOUT_MS },
    };
  }

  private _getCascadeCallbacks(): CascadeCallbacks {
    return {
      executeFn: this.execute.bind(this),
      waitForOutboundTxFn: (hash: string, opts?: any) => _waitForOutboundTx(this.ctx, hash, opts),
      waitForAllOutboundTxsFn: (hash: string, hops: CascadeHopInfo[], opts: any) => _waitForAllOutboundTxsV2(this.ctx, hash, hops, opts),
    };
  }

  constructor(
    private readonly universalSigner: UniversalSigner,
    private pushNetwork: PUSH_NETWORK,
    private readonly rpcUrls: Partial<Record<CHAIN, string[]>> = {},
    private readonly printTraces = false,
    private progressHook?: (progress: ProgressEvent) => void
  ) {
    let pushChain: CHAIN;
    if (pushNetwork === PUSH_NETWORK.MAINNET) {
      pushChain = CHAIN.PUSH_MAINNET;
    } else if (
      pushNetwork === PUSH_NETWORK.TESTNET_DONUT ||
      pushNetwork === PUSH_NETWORK.TESTNET
    ) {
      pushChain = CHAIN.PUSH_TESTNET_DONUT;
    } else {
      pushChain = CHAIN.PUSH_LOCALNET;
    }

    const pushChainRPCs: string[] =
      this.rpcUrls[pushChain] || CHAIN_INFO[pushChain].defaultRPC;

    this._pushClientOptions = {
      rpcUrls: pushChainRPCs,
      network: pushNetwork,
    };
  }

  /**
   * Read-only accessors for current Orchestrator configuration
   */
  public getNetwork(): PUSH_NETWORK {
    return this.pushNetwork;
  }

  public getRpcUrls(): Partial<Record<CHAIN, string[]>> {
    return this.rpcUrls;
  }

  public getPrintTraces(): boolean {
    return this.printTraces;
  }

  public getProgressHook(): ((progress: ProgressEvent) => void) | undefined {
    return this.progressHook;
  }

  // =========================================================================
  // Account Status & UEA Upgrade
  // =========================================================================

  /**
   * Fetches account status including UEA deployment state and version info.
   * Results are cached — pass forceRefresh to bypass cache.
   */
  async getAccountStatus(
    options?: { forceRefresh?: boolean }
  ): Promise<AccountStatus> {
    return _getAccountStatus(this.ctx, options);
  }

  /**
   * Upgrades the UEA to the latest implementation version.
   * Sends MsgMigrateUEA Cosmos message with EIP-712 signed MigrationPayload.
   * The UEA contract delegates to the UEAMigration contract to update implementation.
   */
  async upgradeAccount(
    options?: { progressHook?: (progress: ProgressEvent) => void }
  ): Promise<void> {
    return _upgradeAccount(this.ctx, options);
  }



  /**
   * Migrate the CEA contract on an external chain to the latest version.
   * Sends a MIGRATION_SELECTOR payload via Route 2 to trigger CEA upgrade.
   *
   * @param chain - The external chain where the CEA should be migrated
   * @returns Transaction response
   */
  async migrateCEA(chain: CHAIN): Promise<UniversalTxResponse> {
    return _migrateCEA(this.ctx, chain, this.execute.bind(this));
  }

  /**
   * Rescue stuck funds on a source chain.
   * When a CEA-to-Push inbound transaction fails, tokens get locked in the
   * Vault on the source chain. This triggers a manual revert via TSS to
   * release those funds back to the user.
   *
   * @param params - RescueFundsParams with universalTxId and prc20 token
   * @returns Transaction response
   */
  async rescueFunds(params: RescueFundsParams): Promise<UniversalTxResponse> {
    return _rescueFunds(this.ctx, params, this.execute.bind(this));
  }

  /**
   * Executes a transaction with automatic route detection.
   * Routes 2-4 (multi-chain) delegate to prepareTransaction().send().
   * Route 1 (Push Chain) dispatches to extracted sub-flow modules.
   */
  async execute(
    params: ExecuteParams | UniversalExecuteParams
  ): Promise<UniversalTxResponse> {
    // Lazy UEA upgrade check
    try {
      if (!this.accountStatusCache || !this.accountStatusCache.uea.loaded) {
        await this.getAccountStatus();
      }
      if (
        this.accountStatusCache?.uea.deployed &&
        this.accountStatusCache?.uea.requiresUpgrade
      ) {
        await this.upgradeAccount({ progressHook: this.progressHook });
      }
    } catch (err) {
      _printLog(this.ctx, `Lazy UEA upgrade check failed: ${err instanceof Error ? err.message : String(err)}. Proceeding with transaction.`);
    }

    // Check if this is a multi-chain request (has ChainTarget or from.chain)
    const isMultiChain =
      isChainTarget(params.to) || ('from' in params && params.from?.chain);

    if (isMultiChain) {
      return _executeMultiChain(this.ctx, params as UniversalExecuteParams, this.execute.bind(this));
    }

    // Standard Push Chain execution (Route 1)
    const execute = params as ExecuteParams;
    const eventBuffer: ProgressEvent[] = [];
    const originalHook = this.progressHook;
    this.progressHook = (event: ProgressEvent) => {
      eventBuffer.push(event);
      if (originalHook) originalHook(event);
    };

    try {
      const rcb = () => this._getResponseCallbacks();
      if (execute.funds) {
        return (!execute.data || execute.data === '0x')
          ? await _executeFundsOnly(this.ctx, execute, eventBuffer, rcb)
          : await _executeFundsWithPayload(this.ctx, execute, eventBuffer, rcb);
      }
      return await _executeStandardPayload(this.ctx, execute, eventBuffer, rcb);
    } catch (err) {
      const errMessage =
        err instanceof Error
          ? err.message
          : typeof err === 'string'
          ? err
          : (() => {
              try {
                return JSON.stringify(err);
              } catch {
                return 'Unknown error';
              }
            })();
      _fireProgressHook(this.ctx, PROGRESS_HOOK.SEND_TX_99_02, errMessage);
      throw err;
    } finally {
      // Restore original progressHook
      this.progressHook = originalHook;
    }
  }

  /**
   * Prepare a universal transaction without executing it.
   * Returns a PreparedUniversalTx that can be chained with thenOn() or sent with send().
   *
   * @param params - Universal execution parameters
   * @returns PreparedUniversalTx with chaining capabilities
   */
  async prepareTransaction(
    params: UniversalExecuteParams
  ): Promise<PreparedUniversalTx> {
    return _prepareTransaction(this.ctx, params, this._getCascadeCallbacks());
  }


  /**
   * Creates a cascaded transaction builder for nested multi-chain execution.
   * The cascade composes all hops bottom-to-top into a single Push Chain tx.
   *
   * @param preparedTxs - Array of prepared transactions
   * @returns CascadedTransactionBuilder
   */
  createCascadedBuilder(
    preparedTxs: PreparedUniversalTx[]
  ): CascadedTransactionBuilder {
    return _createCascadedBuilder(this.ctx, preparedTxs, this._getCascadeCallbacks());
  }

  /**
   * Queries gas fee for an outbound transaction from the UniversalCore contract.
   */
  async queryOutboundGasFee(
    prc20Token: `0x${string}`,
    gasLimit: bigint
  ): Promise<{ gasToken: `0x${string}`; gasFee: bigint; protocolFee: bigint; nativeValueForGas: bigint; gasPrice: bigint }> {
    return _queryOutboundGasFee(this.ctx, prc20Token, gasLimit);
  }

/**
   * Extracts the first universal sub-tx ID from a Push Chain transaction's Cosmos events.
   */
  async extractUniversalSubTxIdFromTx(
    pushChainTxHash: string
  ): Promise<string | null> {
    return _extractUniversalSubTxIdFromTx(this.ctx, pushChainTxHash);
  }

  /**
   * Extracts all universal sub-tx IDs from a cascaded Push Chain transaction.
   */
  async extractAllUniversalSubTxIds(
    pushChainTxHash: string
  ): Promise<string[]> {
    return _extractAllUniversalSubTxIds(this.ctx, pushChainTxHash);
  }

  /**
   * Tracks a transaction by hash on Push Chain and returns UniversalTxResponse.
   * Reconstructs and replays SEND-TX-* progress events for completed transactions.
   *
   * @param txHash - Transaction hash to track (Push Chain tx hash)
   * @param options - Tracking options (chain, progressHook, waitForCompletion, advanced config)
   * @returns Promise resolving to UniversalTxResponse with wait() and progressHook() methods
   */
  async trackTransaction(
    txHash: string,
    options?: import('./orchestrator.types').TrackTransactionOptions
  ): Promise<UniversalTxResponse> {
    return _trackTransaction(this.ctx, txHash, options, this._getResponseCallbacks());
  }


  /**
   * Computes UEA for given UniversalAccount
   * @dev - This fn calls a view fn of Factory Contract
   * @dev - Don't use this fn in production - only used for testing
   * @returns UEA Address with Deployment Status
   */
  async computeUEA(): Promise<{
    address: `0x${string}`;
    deployed: boolean;
  }> {
    return _computeUEA(this.ctx);
  }

  computeUEAOffchain(): `0x${string}` {
    return _computeUEAOffchain(this.ctx);
  }

  // TODO: Fix this fn - It needs to get UOA for a given UEA
  getUOA(): UniversalAccount {
    return {
      chain: this.universalSigner.account.chain,
      address: this.universalSigner.account.address,
    };
  }

  /**
   * Quotes exact-output on Uniswap V3 for EVM origin chains using QuoterV2.
   * Returns the minimum required input (amountIn) to receive the target amountOut.
   */
  public async _quoteExactOutput(
    amountOut: bigint,
    {
      from,
      to,
    }: {
      from: PayableToken | undefined;
      to: MoveableToken | undefined;
    }
  ): Promise<ConversionQuote> {
    return _quoteExactOutput(this.ctx, amountOut, { from, to });
  }

}

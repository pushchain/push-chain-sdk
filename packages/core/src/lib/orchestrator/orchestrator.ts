import { utils } from '@coral-xyz/anchor';
import { Connection, PublicKey, SystemProgram } from '@solana/web3.js';
import { Any } from 'cosmjs-types/google/protobuf/any';
import {
  Abi,
  bytesToHex,
  decodeAbiParameters,
  decodeEventLog,
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  getAddress,
  getCreate2Address,
  hexToBytes,
  keccak256,
  parseAbi,
  sha256,
  stringToBytes,
  toBytes,
  TransactionReceipt,
  zeroAddress,
} from 'viem';
import {
  ERC20_EVM,
  FACTORY_V1,
  SVM_GATEWAY_IDL,
  UEA_SVM,
  UNIVERSAL_GATEWAY_V0,
  UNIVERSAL_GATEWAY_PC,
  UNIVERSAL_CORE_EVM,
  UNIVERSAL_GATEWAY_V1_SEND,
} from '../constants/abi';
import { UEA_EVM } from '../constants/abi/uea.evm';
import { CHAIN_INFO, UEA_PROXY, UEA_FACTORY, UEA_MIGRATION, VM_NAMESPACE, SYNTHETIC_PUSH_ERC20, UNIVERSAL_GATEWAY_ADDRESSES } from '../constants/chain';
import { UEA_FACTORY_ABI } from '../constants/abi/uea-factory';
import { CHAIN, PUSH_NETWORK, VM } from '../constants/enums';
import {
  ConversionQuote,
  MOVEABLE_TOKENS,
  MoveableToken,
  PAYABLE_TOKENS,
  PayableToken,
} from '../constants/tokens';
import { UniversalTx, UniversalTxStatus } from '../generated/uexecutor/v1/types';
import { UniversalTxV2, OutboundStatus } from '../generated/uexecutor/v2/types';
import {
  OutboundSyncProgress,
  AccountStatus,
  parseUEAVersion,
} from './orchestrator.types';
import {
  UniversalAccountId,
  UniversalPayload,
  VerificationType,
} from '../generated/v1/tx';
import { PriceFetch } from '../price-fetch/price-fetch';
import PROGRESS_HOOKS from '../progress-hook/progress-hook';
import {
  PROGRESS_HOOK,
  ProgressEvent,
} from '../progress-hook/progress-hook.types';
import { PushChain } from '../push-chain/push-chain';
import { Utils } from '../utils';
import { PushClient } from '../push-client/push-client';
import {
  UniversalAccount,
  UniversalSigner,
} from '../universal/universal.types';
import { EvmClient } from '../vm-client/evm-client';
import { SvmClient } from '../vm-client/svm-client';
import { TxResponse } from '../vm-client/vm-client.types';
import {
  ChainTarget,
  ExecuteParams,
  MultiCall,
  Signature,
  UniversalExecuteParams,
  UniversalOutboundTxRequest,
  UniversalTokenTxRequest,
  UniversalTokenTxRequestV1,
  UniversalTxReceipt,
  UniversalTxRequest,
  UniversalTxRequestV1,
  UniversalTxResponse,
  PreparedUniversalTx,
  ChainedTransactionBuilder,
  MultiChainTxResponse,
  HopDescriptor,
  CascadeSegment,
  CascadeSegmentType,
  CascadedTransactionBuilder,
  CascadedTxResponse,
  CascadeHopInfo,
  CascadeCompletionResult,
  CascadeTrackOptions,
} from './orchestrator.types';
import {
  buildExecuteMulticall,
  buildCeaMulticallPayload,
  buildInboundUniversalPayload,
  buildOutboundRequest,
  buildSendUniversalTxToUEA,
  buildApproveAndInteract,
  buildOutboundApprovalAndCall,
  buildMigrationPayload,
  isSvmChain,
  isValidSolanaHexAddress,
  encodeSvmExecutePayload,
  encodeSvmCeaToUeaPayload,
} from './payload-builders';
import {
  TransactionRoute,
  detectRoute,
  validateRouteParams,
  isChainTarget,
  isSupportedExternalChain,
} from './route-detector';
import {
  getCEAAddress,
  chainSupportsCEA,
  chainSupportsOutbound,
  getCEAFactoryAddress,
} from './cea-utils';
import { DEFAULT_OUTBOUND_GAS_LIMIT, ZERO_ADDRESS, MIGRATION_SELECTOR } from '../constants/selectors';

export class Orchestrator {
  private pushClient: PushClient;
  private ueaVersionCache?: string;
  private accountStatusCache: AccountStatus | null = null;
  /**
   * Per-chain cache for detected gateway version (v0 or v1).
   * Populated on first successful gateway tx per chain via try-V1-then-V0 fallback.
   * TODO: Remove this cache + fallback logic once all chains are upgraded to V1.
   */
  private gatewayVersionCache: Map<CHAIN, 'v0' | 'v1'> = new Map();

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

    this.pushClient = new PushClient({
      rpcUrls: pushChainRPCs,
      network: pushNetwork,
    });

    // BNB is already upgraded to V1 — pre-seed the cache so it never falls back to V0.
    // TODO: Remove these entries once all chains are upgraded to V1.
    this.gatewayVersionCache.set(CHAIN.BNB_TESTNET, 'v1');
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
    if (this.accountStatusCache && !options?.forceRefresh) {
      return this.accountStatusCache;
    }

    const chain = this.universalSigner.account.chain;
    const { vm } = CHAIN_INFO[chain];
    const isReadOnly = false; // This is called from Orchestrator which always has a signer

    const { deployed } = await this.getUeaStatusAndNonce();

    if (!deployed) {
      const status: AccountStatus = {
        mode: 'signer',
        uea: {
          loaded: true,
          deployed: false,
          version: '',
          minRequiredVersion: '',
          requiresUpgrade: false,
        },
      };
      this.accountStatusCache = status;
      return status;
    }

    // Fetch current version and latest version from factory in parallel
    const [currentVersion, minRequiredVersion] = await Promise.all([
      this.fetchUEAVersion(),
      this.fetchLatestUEAVersion(vm),
    ]);

    const requiresUpgrade =
      parseUEAVersion(currentVersion) < parseUEAVersion(minRequiredVersion);

    const status: AccountStatus = {
      mode: 'signer',
      uea: {
        loaded: true,
        deployed: true,
        version: currentVersion,
        minRequiredVersion,
        requiresUpgrade,
      },
    };
    this.accountStatusCache = status;
    return status;
  }

  /**
   * Upgrades the UEA to the latest implementation version.
   * Sends MsgMigrateUEA Cosmos message with EIP-712 signed MigrationPayload.
   * The UEA contract delegates to the UEAMigration contract to update implementation.
   */
  async upgradeAccount(
    options?: { progressHook?: (progress: ProgressEvent) => void }
  ): Promise<void> {
    const hook = options?.progressHook || this.progressHook;
    const fireHook = (hookId: string, ...args: any[]) => {
      const hookEntry = PROGRESS_HOOKS[hookId];
      if (hookEntry && hook) {
        hook(hookEntry(...args));
      }
    };

    // Step 1: Check status
    fireHook(PROGRESS_HOOK.UEA_MIG_01);
    const status = await this.getAccountStatus({ forceRefresh: true });

    if (!status.uea.requiresUpgrade) {
      fireHook(PROGRESS_HOOK.UEA_MIG_9903);
      return;
    }

    // Step 2: Awaiting signature
    fireHook(PROGRESS_HOOK.UEA_MIG_02);

    try {
      const { chain, address } = this.universalSigner.account;
      const { vm, chainId } = CHAIN_INFO[chain];
      const ueaAddress = this.computeUEAOffchain();
      const migrationContractAddress = UEA_MIGRATION[this.pushNetwork];

      if (!migrationContractAddress || migrationContractAddress === '0xTBD') {
        throw new Error('UEA migration contract address not configured');
      }

      // Read UEA nonce
      const { nonce } = await this.getUeaStatusAndNonce();
      const deadline = BigInt(9999999999);
      const ueaVersion = status.uea.version || '0.1.0';

      // Sign MigrationPayload
      const signatureBytes = await this.signMigrationPayload({
        migrationContractAddress,
        nonce,
        deadline,
        ueaVersion,
        ueaAddress,
      });

      const signature = bytesToHex(signatureBytes);

      // Build Cosmos message
      fireHook(PROGRESS_HOOK.UEA_MIG_03);

      const universalAccountId: UniversalAccountId = {
        chainNamespace: VM_NAMESPACE[vm],
        chainId,
        owner:
          vm === VM.EVM
            ? address
            : vm === VM.SVM
            ? bytesToHex(new Uint8Array(utils.bytes.bs58.decode(address)))
            : address,
      };

      const { cosmosAddress: signer } = this.pushClient.getSignerAddress();

      const msg = this.pushClient.createMsgMigrateUEA({
        signer,
        universalAccountId,
        migrationPayload: {
          migration: migrationContractAddress,
          nonce: nonce.toString(),
          deadline: deadline.toString(),
        },
        signature,
      });

      const txBody = await this.pushClient.createCosmosTxBody([msg]);
      const txRaw = await this.pushClient.signCosmosTx(txBody);
      const tx = await this.pushClient.broadcastCosmosTx(txRaw);

      if (tx.code !== 0) {
        throw new Error(tx.rawLog || 'UEA migration transaction failed');
      }

      // Clear version cache so next read picks up new version
      this.ueaVersionCache = undefined;

      // Refresh account status
      const updated = await this.getAccountStatus({ forceRefresh: true });
      fireHook(PROGRESS_HOOK.UEA_MIG_9901, updated.uea.version);
    } catch (err) {
      fireHook(PROGRESS_HOOK.UEA_MIG_9902);
      throw err;
    }
  }

  /**
   * Fetches the latest UEA version from UEAFactory contract.
   * This is the version of the newest registered implementation — used as minRequiredVersion.
   * Returns empty string if factory is unavailable.
   */
  private async fetchLatestUEAVersion(vm: VM): Promise<string> {
    const factoryAddress = UEA_FACTORY[this.pushNetwork];
    if (!factoryAddress || factoryAddress === '0xTBD') {
      return '';
    }

    try {
      const vmHash =
        vm === VM.EVM
          ? keccak256(encodeAbiParameters([{ type: 'string' }], ['EVM']))
          : keccak256(encodeAbiParameters([{ type: 'string' }], ['SVM']));

      return await this.pushClient.readContract<string>({
        address: factoryAddress,
        abi: UEA_FACTORY_ABI as unknown as Abi,
        functionName: 'UEA_VERSION',
        args: [vmHash],
      });
    } catch {
      return '';
    }
  }

  /**
   * Migrate the CEA contract on an external chain to the latest version.
   * Sends a MIGRATION_SELECTOR payload via Route 2 to trigger CEA upgrade.
   *
   * @param chain - The external chain where the CEA should be migrated
   * @returns Transaction response
   */
  async migrateCEA(chain: CHAIN): Promise<UniversalTxResponse> {
    if (this.isPushChain(chain)) {
      throw new Error('Cannot migrate CEA on Push Chain');
    }
    if (!chainSupportsCEA(chain)) {
      throw new Error(`Chain ${chain} does not support CEA`);
    }

    const ueaAddress = this.computeUEAOffchain();
    const { cea, isDeployed } = await getCEAAddress(
      ueaAddress,
      chain,
      this.rpcUrls[chain]?.[0]
    );
    if (!isDeployed) {
      throw new Error(
        `CEA not deployed on chain ${chain}. Deploy CEA first.`
      );
    }

    return this.execute({
      to: { address: cea, chain },
      migration: true,
    });
  }

  /**
   * Executes a transaction with automatic route detection.
   *
   * Supports both simple Push Chain transactions and multi-chain routing:
   * - Route 1 (UOA_TO_PUSH): `to` is a simple address string
   * - Route 2 (UOA_TO_CEA): `to` is `{ address, chain }` targeting external chain
   * - Route 3 (CEA_TO_PUSH): `from.chain` specified, targeting Push Chain
   * - Route 4 (CEA_TO_CEA): `from.chain` specified, targeting external chain
   *
   * @param params - ExecuteParams or UniversalExecuteParams
   * @returns Transaction response
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
      this.printLog(`Lazy UEA upgrade check failed: ${err instanceof Error ? err.message : String(err)}. Proceeding with transaction.`);
    }

    // Check if this is a multi-chain request (has ChainTarget or from.chain)
    const isMultiChain =
      isChainTarget(params.to) || ('from' in params && params.from?.chain);

    if (isMultiChain) {
      // sendTransaction delegates to prepareTransaction().send() for multi-chain routes
      const prepared = await this.prepareTransaction(params as UniversalExecuteParams);
      return prepared.send();
    }

    // Standard Push Chain execution (Route 1)
    const execute = params as ExecuteParams;
    // Create buffer to collect events during execution for tx.progressHook() replay
    const eventBuffer: ProgressEvent[] = [];

    // Store original progressHook and wrap to collect events
    const originalHook = this.progressHook;
    this.progressHook = (event: ProgressEvent) => {
      eventBuffer.push(event);
      if (originalHook) originalHook(event);
    };

    try {
      if (execute.funds) {
        if (!execute.data || execute.data === '0x') {
          const chain = this.universalSigner.account.chain;
          const { vm } = CHAIN_INFO[chain];
          if (
            !(
              chain === CHAIN.ETHEREUM_SEPOLIA ||
              chain === CHAIN.ARBITRUM_SEPOLIA ||
              chain === CHAIN.BASE_SEPOLIA ||
              chain === CHAIN.BNB_TESTNET ||
              chain === CHAIN.SOLANA_DEVNET
            )
          ) {
            throw new Error(
              'Funds bridging is only supported on Ethereum Sepolia, Arbitrum Sepolia, Base Sepolia, BNB Testnet, and Solana Devnet for now'
            );
          }

          // Progress: Origin chain detected
          this.executeProgressHook(
            PROGRESS_HOOK.SEND_TX_01,
            chain,
            this.universalSigner.account.address
          );

          const { defaultRPC, lockerContract } = CHAIN_INFO[chain];
          const rpcUrls: string[] = this.rpcUrls[chain] || defaultRPC;

          // Resolve token: default to native token based on VM (ETH for EVM, SOL for SVM)
          if (!execute.funds.token) {
            const available: MoveableToken[] =
              (MOVEABLE_TOKENS[chain] as MoveableToken[] | undefined) || [];
            const vm = CHAIN_INFO[chain].vm;
            const preferredSymbol =
              vm === VM.EVM ? 'ETH' : vm === VM.SVM ? 'SOL' : undefined;
            const nativeToken = preferredSymbol
              ? available.find((t) => t.symbol === preferredSymbol)
              : undefined;
            if (!nativeToken) {
              throw new Error('Native token not configured for this chain');
            }
            execute.funds.token = nativeToken;
          }

          const amount = execute.funds.amount;
          const symbol = execute.funds.token.symbol;

          const bridgeAmount = amount;

          const revertCFG = {
            fundRecipient: this.universalSigner.account
              .address as `0x${string}`,
            revertMsg: '0x',
          } as unknown as never; // typed by viem via ABI

          if (vm === VM.EVM) {
            const evmClient = new EvmClient({ rpcUrls });
            const gatewayAddress = lockerContract as `0x${string}`;
            const tokenAddr = execute.funds.token.address as `0x${string}`;
            const recipient = execute.to; // funds to recipient on Push Chain
            const isNative = execute.funds.token.mechanism === 'native';
            const bridgeToken =
              execute.funds.token.mechanism === 'approve'
                ? tokenAddr
                : ('0x0000000000000000000000000000000000000000' as `0x${string}`);
            const { nonce, deployed } = await this.getUeaStatusAndNonce();
            const { payload: universalPayload, req } =
              await this.buildGatewayPayloadAndGas(
                execute,
                nonce,
                'sendFunds',
                bridgeAmount
              );

            const ueaAddress = this.computeUEAOffchain();

            this.printLog('sendFunds — buildGatewayPayloadAndGas result: ' + JSON.stringify({
              recipient: execute.to,
              ueaAddress,
              isSelfBridge: execute.to.toLowerCase() === ueaAddress.toLowerCase(),
              bridgeAmount: bridgeAmount.toString(),
              bridgeToken,
              isNative,
              tokenAddr,
              nonce: nonce.toString(),
              deployed,
            }, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));

            // Compute minimal native amount to deposit for gas on Push Chain
            const ueaBalanceForGas = await this.pushClient.getBalance(
              ueaAddress
            );

            const nativeAmount = await this.calculateNativeAmountForDeposit(
              chain,
              BigInt(0),
              ueaBalanceForGas
            );
            this.printLog(`sendFunds — nativeAmount: ${nativeAmount.toString()}, ueaBalanceForGas: ${ueaBalanceForGas.toString()}`);

            // We log the SEND_TX_03_01 here because the progress hook for gas estimation should arrive before the resolving of UEA.
            this.executeProgressHook(PROGRESS_HOOK.SEND_TX_03_01);
            this.executeProgressHook(
              PROGRESS_HOOK.SEND_TX_03_02,
              ueaAddress,
              deployed
            );
            this.printLog(`UEA resolved: ${ueaAddress}, deployed: ${deployed}`);

            this.executeProgressHook(
              PROGRESS_HOOK.SEND_TX_06_01,
              amount,
              execute.funds.token.decimals,
              symbol
            );

            if (vm === VM.EVM) {
              const evmClient = new EvmClient({ rpcUrls });
              const gatewayAddress = lockerContract as `0x${string}`;
              const tokenAddr = execute.funds.token.address as `0x${string}`;
              // Approve gateway to pull tokens if ERC-20 (not native sentinel)
              if (execute.funds.token.mechanism === 'approve') {
                await this.ensureErc20Allowance(
                  evmClient,
                  tokenAddr,
                  gatewayAddress,
                  amount
                );
              } else if (execute.funds.token.mechanism === 'permit2') {
                throw new Error('Permit2 is not supported yet');
              } else if (execute.funds.token.mechanism === 'native') {
                // Native flow uses msg.value == bridgeAmount and bridgeToken = address(0)
              }
            }

            let txHash: `0x${string}`;
            try {
              // FUNDS ONLY SELF
              if (execute.to.toLowerCase() === ueaAddress.toLowerCase()) {
                // const payloadBytes = this.encodeUniversalPayload(
                //   universalPayload as unknown as UniversalPayload
                // );
                // const req = this._buildUniversalTxRequest({
                //   recipient: zeroAddress,
                //   token: bridgeToken,
                //   amount: bridgeAmount,
                //   payload: '0x',
                // });
                // const req: UniversalTxRequest = {
                //   recipient: zeroAddress,
                //   token: bridgeToken,
                //   amount: bridgeAmount,
                //   payload: '0x',
                //   // payload: payloadBytes,
                //   revertInstruction: revertCFG,
                //   signatureData: '0x',
                // } as unknown as never;

                this.printLog('FUNDS ONLY SELF — gateway call payload: ' + JSON.stringify({
                  gatewayAddress, functionName: 'sendUniversalTx', req,
                  value: (isNative ? nativeAmount + bridgeAmount : nativeAmount).toString(),
                  isNative, bridgeAmount: bridgeAmount.toString(),
                  nativeAmount: nativeAmount.toString(), bridgeToken,
                }, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));

                txHash = await this.sendGatewayTxWithFallback(
                  evmClient,
                  gatewayAddress,
                  req,
                  this.universalSigner,
                  isNative ? nativeAmount + bridgeAmount : nativeAmount,
                );
              } else {
                // FUNDS ONLY OTHER
                // const payloadBytes = this.encodeUniversalPayload(
                //   universalPayload as unknown as UniversalPayload
                // );
                // const req: UniversalTxRequest = {
                //   recipient,
                //   token: bridgeToken,
                //   amount: bridgeAmount,
                //   payload: payloadBytes,
                //   revertInstruction: revertCFG,
                //   signatureData: '0x',
                // } as unknown as never;

                this.printLog('FUNDS ONLY OTHER — gateway call payload: ' + JSON.stringify({
                  gatewayAddress, functionName: 'sendUniversalTx', req,
                  value: nativeAmount.toString(),
                  isNative, bridgeAmount: bridgeAmount.toString(),
                  nativeAmount: nativeAmount.toString(), bridgeToken,
                }, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));

                txHash = await this.sendGatewayTxWithFallback(
                  evmClient,
                  gatewayAddress,
                  req,
                  this.universalSigner,
                  isNative ? nativeAmount + bridgeAmount : nativeAmount,
                );
              }
            } catch (err) {
              this.executeProgressHook(PROGRESS_HOOK.SEND_TX_04_04);
              throw err;
            }

            const originTx = await this.fetchOriginChainTransactionForProgress(
              chain,
              txHash,
              txHash
            );
            this.executeProgressHook(
              PROGRESS_HOOK.SEND_TX_06_02,
              txHash,
              bridgeAmount,
              execute.funds.token.decimals,
              symbol,
              originTx
            );

            await this.waitForEvmConfirmationsWithCountdown(
              evmClient,
              txHash,
              CHAIN_INFO[chain].confirmations,
              CHAIN_INFO[chain].timeout
            );

            // Funds Confirmed - emit immediately after confirmations
            this.executeProgressHook(PROGRESS_HOOK.SEND_TX_06_04);
            // Syncing with Push Chain - emit before query
            this.executeProgressHook(PROGRESS_HOOK.SEND_TX_06_05);

            this.printLog('sendFunds — querying Push Chain status: ' + JSON.stringify({
              txHash,
              evmGatewayMethod: execute.to === ueaAddress ? 'sendFunds' : 'sendTxWithFunds',
            }));

            const pushChainUniversalTx =
              await this.queryUniversalTxStatusFromGatewayTx(
                evmClient,
                gatewayAddress,
                txHash,
                execute.to === ueaAddress ? 'sendFunds' : 'sendTxWithFunds'
              );

            if (!pushChainUniversalTx?.pcTx?.length) {
              throw new Error(
                `Failed to retrieve Push Chain transaction status for gateway tx: ${txHash}. ` +
                  `The transaction may have failed on Push Chain or not been indexed yet.`
              );
            }
            // For sendFunds operations, MintPC (first) succeeds and executeUniversalTx (second) may fail
            // Always use the last pcTx entry as it represents the final execution result
            const lastPcTransaction = pushChainUniversalTx.pcTx.at(-1);
            this.printLog('sendFunds — pushChainUniversalTx pcTx: ' + JSON.stringify(
              pushChainUniversalTx?.pcTx?.map((p: any) => ({ txHash: p.txHash, status: p.status, errorMsg: p.errorMsg })),
              null, 2));
            this.printLog('sendFunds — using lastPcTransaction: ' + JSON.stringify(lastPcTransaction, null, 2));
            if (!lastPcTransaction?.txHash) {
              // Check for error messages in failed entries
              const failedPcTx = pushChainUniversalTx.pcTx.find(
                (pcTx: { status?: string; errorMsg?: string }) =>
                  pcTx.status === 'FAILED' && pcTx.errorMsg
              );
              const errorDetails = failedPcTx?.errorMsg
                ? `: ${failedPcTx.errorMsg}`
                : '';
              throw new Error(
                `No transaction hash found in Push Chain response for gateway tx: ${txHash}${errorDetails}`
              );
            }
            const tx = await this.pushClient.getTransaction(
              lastPcTransaction.txHash as `0x${string}`
            );
            const response = await this.transformToUniversalTxResponse(tx, eventBuffer);
            // Funds Flow: Funds credited on Push Chain
            this.executeProgressHook(
              PROGRESS_HOOK.SEND_TX_06_06,
              bridgeAmount,
              execute.funds.token.decimals,
              symbol
            );
            this.executeProgressHook(PROGRESS_HOOK.SEND_TX_99_01, [response]);
            return response;
          } else {
            // SVM path (Solana Devnet)
            const svmClient = new SvmClient({ rpcUrls });
            const programId = new PublicKey(SVM_GATEWAY_IDL.address);
            const [configPda] = PublicKey.findProgramAddressSync(
              [stringToBytes('config')],
              programId
            );
            const [vaultPda] = PublicKey.findProgramAddressSync(
              [stringToBytes('vault')],
              programId
            );
            const { feeVaultPda, protocolFeeLamports } =
              await this._getSvmProtocolFee(svmClient, programId);
            const [rateLimitConfigPda] = PublicKey.findProgramAddressSync(
              [stringToBytes('rate_limit_config')],
              programId
            );

            const userPk = new PublicKey(this.universalSigner.account.address);
            const priceUpdatePk = new PublicKey(
              '7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE'
            );

            // pay-with-token gas abstraction is not supported on Solana
            if (execute.payGasWith !== undefined) {
              throw new Error('Pay-with token is not supported on Solana');
            }

            let txSignature: string;
            // New gateway expects EVM recipient as [u8; 20]
            const recipientEvm20: number[] = Array.from(
              Buffer.from(
                (execute.to as `0x${string}`).slice(2).padStart(40, '0'),
                'hex'
              ).subarray(0, 20)
            );
            this.executeProgressHook(PROGRESS_HOOK.SEND_TX_03_01);
            const ueaAddress = this.computeUEAOffchain();
            const { nonce, deployed } = await this.getUeaStatusAndNonce();
            this.executeProgressHook(
              PROGRESS_HOOK.SEND_TX_03_02,
              ueaAddress,
              deployed
            );
            if (execute.funds.token.mechanism === 'native') {
              // Native SOL funds-only
              const [tokenRateLimitPda] = PublicKey.findProgramAddressSync(
                [stringToBytes('rate_limit'), PublicKey.default.toBuffer()],
                programId
              );

              const reqNative = this._buildSvmUniversalTxRequest({
                recipient: recipientEvm20,
                token: PublicKey.default,
                amount: bridgeAmount,
                payload: '0x',
                revertRecipient: userPk,
                signatureData: '0x',
              });

              txSignature = await svmClient.writeContract({
                abi: SVM_GATEWAY_IDL,
                address: programId.toBase58(),
                functionName: 'sendUniversalTx',
                args: [reqNative, bridgeAmount + protocolFeeLamports],
                signer: this.universalSigner,
                accounts: {
                  config: configPda,
                  vault: vaultPda,
                  feeVault: feeVaultPda,
                  userTokenAccount: vaultPda,
                  gatewayTokenAccount: vaultPda,
                  user: userPk,
                  priceUpdate: priceUpdatePk,
                  rateLimitConfig: rateLimitConfigPda,
                  tokenRateLimit: tokenRateLimitPda,
                  tokenProgram: new PublicKey(
                    'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
                  ),
                  systemProgram: SystemProgram.programId,
                },
              });
            } else if (execute.funds.token.mechanism === 'approve') {
              // SPL token funds-only (requires pre-existing ATAs)
              const mintPk = new PublicKey(execute.funds.token.address);
              // Associated Token Accounts
              const TOKEN_PROGRAM_ID = new PublicKey(
                'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
              );
              const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
                'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'
              );
              const userAta = PublicKey.findProgramAddressSync(
                [
                  userPk.toBuffer(),
                  TOKEN_PROGRAM_ID.toBuffer(),
                  mintPk.toBuffer(),
                ],
                ASSOCIATED_TOKEN_PROGRAM_ID
              )[0];
              const vaultAta = PublicKey.findProgramAddressSync(
                [
                  vaultPda.toBuffer(),
                  TOKEN_PROGRAM_ID.toBuffer(),
                  mintPk.toBuffer(),
                ],
                ASSOCIATED_TOKEN_PROGRAM_ID
              )[0];

              const [tokenRateLimitPda] = PublicKey.findProgramAddressSync(
                [stringToBytes('rate_limit'), mintPk.toBuffer()],
                programId
              );

              if (execute.to === ueaAddress) {
                const reqSpl = this._buildSvmUniversalTxRequest({
                  recipient: recipientEvm20,
                  token: mintPk,
                  amount: bridgeAmount,
                  payload: '0x',
                  revertRecipient: userPk,
                  signatureData: '0x',
                });

                txSignature = await svmClient.writeContract({
                  abi: SVM_GATEWAY_IDL,
                  address: programId.toBase58(),
                  functionName: 'sendUniversalTx',
                  args: [reqSpl, protocolFeeLamports],
                  signer: this.universalSigner,
                  accounts: {
                    config: configPda,
                    vault: vaultPda,
                    feeVault: feeVaultPda,
                    userTokenAccount: userAta,
                    gatewayTokenAccount: vaultAta,
                    user: userPk,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    priceUpdate: priceUpdatePk,
                    rateLimitConfig: rateLimitConfigPda,
                    tokenRateLimit: tokenRateLimitPda,
                    systemProgram: SystemProgram.programId,
                  },
                });
              } else {
                const recipientSpl = recipientEvm20;
                // vitalik
                const reqSpl = this._buildSvmUniversalTxRequest({
                  recipient: recipientSpl,
                  token: mintPk,
                  amount: bridgeAmount,
                  payload: '0x',
                  revertRecipient: userPk,
                  signatureData: '0x',
                });

                txSignature = await svmClient.writeContract({
                  abi: SVM_GATEWAY_IDL,
                  address: programId.toBase58(),
                  functionName: 'sendUniversalTx',
                  args: [reqSpl, protocolFeeLamports],
                  signer: this.universalSigner,
                  accounts: {
                    config: configPda,
                    vault: vaultPda,
                    feeVault: feeVaultPda,
                    userTokenAccount: userAta,
                    gatewayTokenAccount: vaultAta,
                    user: userPk,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    priceUpdate: priceUpdatePk,
                    rateLimitConfig: rateLimitConfigPda,
                    tokenRateLimit: tokenRateLimitPda,
                    systemProgram: SystemProgram.programId,
                  },
                });
              }
            } else {
              throw new Error('Unsupported token mechanism on Solana');
            }

            const originTx = await this.fetchOriginChainTransactionForProgress(
              chain,
              '0x',
              txSignature
            );
            this.executeProgressHook(
              PROGRESS_HOOK.SEND_TX_06_02,
              txSignature,
              bridgeAmount,
              execute.funds.token.decimals,
              symbol,
              originTx
            );

            await this.waitForSvmConfirmationsWithCountdown(
              svmClient,
              txSignature,
              CHAIN_INFO[chain].confirmations,
              CHAIN_INFO[chain].timeout
            );

            // Funds Confirmed - emit immediately after confirmations
            this.executeProgressHook(PROGRESS_HOOK.SEND_TX_06_04);
            // Syncing with Push Chain - emit before query
            this.executeProgressHook(PROGRESS_HOOK.SEND_TX_06_05);

            // After origin confirmations, query Push Chain for UniversalTx status (SVM)
            const pushChainUniversalTx =
              await this.queryUniversalTxStatusFromGatewayTx(
                undefined,
                undefined,
                txSignature,
                'sendFunds'
              );

            if (!pushChainUniversalTx?.pcTx?.length) {
              throw new Error(
                `Failed to retrieve Push Chain transaction status for gateway tx: ${txSignature}. ` +
                  `The transaction may have failed on Push Chain or not been indexed yet.`
              );
            }
            // Always use the last pcTx entry as it represents the final execution result
            const lastPcTransaction = pushChainUniversalTx.pcTx.at(-1);
            if (!lastPcTransaction?.txHash) {
              const failedPcTx = pushChainUniversalTx.pcTx.find(
                (pcTx: { status?: string; errorMsg?: string }) =>
                  pcTx.status === 'FAILED' && pcTx.errorMsg
              );
              const errorDetails = failedPcTx?.errorMsg
                ? `: ${failedPcTx.errorMsg}`
                : '';
              throw new Error(
                `No transaction hash found in Push Chain response for gateway tx: ${txSignature}${errorDetails}`
              );
            }
            const tx = await this.pushClient.getTransaction(
              lastPcTransaction.txHash as `0x${string}`
            );
            const response = await this.transformToUniversalTxResponse(tx, eventBuffer);
            // Funds Flow: Funds credited on Push Chain
            this.executeProgressHook(
              PROGRESS_HOOK.SEND_TX_06_06,
              bridgeAmount,
              execute.funds.token.decimals,
              symbol
            );
            this.executeProgressHook(PROGRESS_HOOK.SEND_TX_99_01, [response]);
            return response;
          }
        } else {
          // Bridge funds + execute payload. Support:
          // - EVM (Sepolia): ERC-20 approve path + native gas via msg.value
          // - SVM (Solana Devnet): SPL or native SOL with gas_amount
          const { chain, evmClient, gatewayAddress } =
            this.getOriginGatewayContext();

          this.executeProgressHook(
            PROGRESS_HOOK.SEND_TX_01,
            chain,
            this.universalSigner.account.address
          );

          // Default token to native ETH if none provided
          if (!execute.funds.token) {
            const available: MoveableToken[] =
              (MOVEABLE_TOKENS[chain] as MoveableToken[] | undefined) || [];
            const vm = CHAIN_INFO[chain].vm;
            const preferredSymbol =
              vm === VM.EVM ? 'ETH' : vm === VM.SVM ? 'SOL' : undefined;
            const nativeToken = preferredSymbol
              ? available.find((t) => t.symbol === preferredSymbol)
              : undefined;
            if (!nativeToken) {
              throw new Error('Native token not configured for this chain');
            }
            execute.funds.token = nativeToken;
          }

          const mechanism = execute.funds.token.mechanism;

          const { deployed, nonce } = await this.getUeaStatusAndNonce();
          const { payload: universalPayload, req } =
            await this.buildGatewayPayloadAndGas(
              execute,
              nonce,
              'sendTxWithFunds',
              execute.funds.amount
            );

          this.executeProgressHook(PROGRESS_HOOK.SEND_TX_02_01);

          // Compute required gas funding on Push Chain and current UEA balance
          const gasEstimate = execute.gasLimit || BigInt(1e7);
          const gasPrice = await this.pushClient.getGasPrice();
          const requiredGasFee = gasEstimate * gasPrice;
          const payloadValue = execute.value ?? BigInt(0);
          const requiredFunds = requiredGasFee + payloadValue;

          const ueaAddress = this.computeUEAOffchain();
          const [ueaBalance] = await Promise.all([
            this.pushClient.getBalance(ueaAddress),
          ]);

          // UEA resolved (address, deployment status, balance, nonce)
          this.executeProgressHook(
            PROGRESS_HOOK.SEND_TX_03_02,
            ueaAddress,
            deployed
          );

          // Determine USD to deposit via gateway (8 decimals) with caps: min=$1, max=$10
          const oneUsd = Utils.helpers.parseUnits('1', 8);
          const tenUsd = Utils.helpers.parseUnits('10', 8);
          const deficit =
            requiredFunds > ueaBalance ? requiredFunds - ueaBalance : BigInt(0);
          let depositUsd =
            deficit > BigInt(0) ? this.pushClient.pushToUSDC(deficit) : oneUsd;

          if (depositUsd < oneUsd) depositUsd = oneUsd;
          if (depositUsd > tenUsd)
            throw new Error(
              'Deposit value exceeds max $10 worth of native token'
            );

          this.executeProgressHook(PROGRESS_HOOK.SEND_TX_02_02, depositUsd);

          // If SVM, clamp depositUsd to on-chain Config caps
          if (CHAIN_INFO[chain].vm === VM.SVM) {
            const svmClient = new SvmClient({
              rpcUrls:
                this.rpcUrls[CHAIN.SOLANA_DEVNET] ||
                CHAIN_INFO[CHAIN.SOLANA_DEVNET].defaultRPC,
            });
            const programId = new PublicKey(SVM_GATEWAY_IDL.address);
            const [configPda] = PublicKey.findProgramAddressSync(
              [stringToBytes('config')],
              programId
            );
            try {
              const cfg: any = await svmClient.readContract({
                abi: SVM_GATEWAY_IDL,
                address: SVM_GATEWAY_IDL.address,
                functionName: 'config',
                args: [configPda.toBase58()],
              });
              const minField =
                cfg.minCapUniversalTxUsd ?? cfg.min_cap_universal_tx_usd;
              const maxField =
                cfg.maxCapUniversalTxUsd ?? cfg.max_cap_universal_tx_usd;
              const minCapUsd = BigInt(minField.toString());
              const maxCapUsd = BigInt(maxField.toString());
              if (depositUsd < minCapUsd) depositUsd = minCapUsd;
              // Add 20% safety margin to avoid BelowMinCap due to price drift
              const withMargin = (minCapUsd * BigInt(12)) / BigInt(10);
              if (depositUsd < withMargin) depositUsd = withMargin;
              if (depositUsd > maxCapUsd) depositUsd = maxCapUsd;
            } catch {
              // best-effort; fallback to previous bounds if read fails
            }
          }

          // Convert USD(8) -> native units using pricing path
          const nativeTokenUsdPrice = await new PriceFetch(
            this.rpcUrls
          ).getPrice(chain); // 8 decimals
          const nativeDecimals = CHAIN_INFO[chain].vm === VM.SVM ? 9 : 18;
          const oneNativeUnit = Utils.helpers.parseUnits(
            '1',
            nativeDecimals
          );
          // Ceil division to avoid rounding below min USD on-chain
          let nativeAmount =
            (depositUsd * oneNativeUnit + (nativeTokenUsdPrice - BigInt(1))) /
            nativeTokenUsdPrice;
          // Add 1 unit safety to avoid BelowMinCap from rounding differences
          nativeAmount = nativeAmount + BigInt(1);

          const revertCFG = {
            fundRecipient: this.universalSigner.account
              .address as `0x${string}`,
            revertMsg: '0x',
          } as unknown as never;

          const bridgeAmount = execute.funds.amount;
          const symbol = execute.funds.token.symbol;

          // Funds Flow: Preparing funds transfer
          this.executeProgressHook(
            PROGRESS_HOOK.SEND_TX_06_01,
            bridgeAmount,
            execute.funds.token.decimals,
            symbol
          );

          if (CHAIN_INFO[this.universalSigner.account.chain].vm === VM.EVM) {
            const tokenAddr = execute.funds.token.address as `0x${string}`;
            if (mechanism === 'approve') {
              // ERC-20 tokens: ensure gateway has approval
              const evmClientEvm = evmClient as EvmClient;
              const gatewayAddressEvm = gatewayAddress as `0x${string}`;
              await this.ensureErc20Allowance(
                evmClientEvm,
                tokenAddr,
                gatewayAddressEvm,
                bridgeAmount
              );
            } else if (mechanism === 'permit2') {
              throw new Error('Permit2 is not supported yet');
            }
            // Native tokens (mechanism === 'native') don't need approval - handled via msg.value
          }

          let txHash: `0x${string}` | string;
          try {
            if (CHAIN_INFO[this.universalSigner.account.chain].vm === VM.EVM) {
              const tokenAddr = execute.funds.token.address as `0x${string}`;
              this.executeProgressHook(PROGRESS_HOOK.SEND_TX_03_01);
              const ueaAddress = this.computeUEAOffchain();
              this.executeProgressHook(
                PROGRESS_HOOK.SEND_TX_03_02,
                ueaAddress,
                deployed
              );

              this.executeProgressHook(PROGRESS_HOOK.SEND_TX_04_01);
              this.executeProgressHook(PROGRESS_HOOK.SEND_TX_04_02);
              this.executeProgressHook(PROGRESS_HOOK.SEND_TX_04_03);
              const evmClientEvm = evmClient as EvmClient;
              const gatewayAddressEvm = gatewayAddress as `0x${string}`;
              const payloadBytes = this.encodeUniversalPayload(
                universalPayload as unknown as UniversalPayload
              );
              // New behavior: if user provided a gasTokenAddress, pay gas in that token via Uniswap quote
              // Determine pay-with token address, min-out and slippage
              const payWith = execute.payGasWith;
              const gasTokenAddress = payWith?.token?.address as
                | `0x${string}`
                | undefined;

              if (gasTokenAddress) {
                if (chain !== CHAIN.ETHEREUM_SEPOLIA) {
                  throw new Error(
                    `Only ${PushChain.utils.chains.getChainName(
                      CHAIN.ETHEREUM_SEPOLIA
                    )} is supported for paying gas fees with ERC-20 tokens`
                  );
                }
                let amountOutMinETH =
                  payWith?.minAmountOut !== undefined
                    ? BigInt(payWith.minAmountOut)
                    : nativeAmount;

                const slippageBps = payWith?.slippageBps ?? 100;
                amountOutMinETH = BigInt(
                  PushChain.utils.conversion.slippageToMinAmount(
                    amountOutMinETH.toString(),
                    { slippageBps }
                  )
                );

                const { gasAmount } =
                  await this.calculateGasAmountFromAmountOutMinETH(
                    gasTokenAddress as `0x${string}`,
                    amountOutMinETH
                  );
                const deadline = BigInt(0);

                // Ensure caller has enough balance of the gas token to cover fees
                const ownerAddress = this.universalSigner.account
                  .address as `0x${string}`;
                const gasTokenBalance = await evmClientEvm.getErc20Balance({
                  tokenAddress: gasTokenAddress as `0x${string}`,
                  ownerAddress,
                });
                if (gasTokenBalance < gasAmount) {
                  const sym = payWith?.token?.symbol ?? 'gas token';
                  const decimals = payWith?.token?.decimals ?? 18;
                  const needFmt = Utils.helpers.formatUnits(
                    gasAmount,
                    decimals
                  );
                  const haveFmt = Utils.helpers.formatUnits(
                    gasTokenBalance,
                    decimals
                  );
                  throw new Error(
                    `Insufficient ${sym} balance to cover gas fees: need ${needFmt}, have ${haveFmt}`
                  );
                }

                // Approve gas token to gateway
                await this.ensureErc20Allowance(
                  evmClientEvm,
                  gasTokenAddress,
                  gatewayAddressEvm,
                  gasAmount
                );

                // Approve bridge token already done above; now call new gateway signature (nonpayable)
                // const reqToken: UniversalTokenTxRequest = {
                //   recipient: zeroAddress,
                //   token: tokenAddr,
                //   amount: bridgeAmount,
                //   gasToken: gasTokenAddress,
                //   gasAmount,
                //   payload: payloadBytes,
                //   revertInstruction: revertCFG,
                //   signatureData: '0x',
                //   amountOutMinETH,
                //   deadline,
                // } as unknown as never;
                const reqToken: UniversalTokenTxRequest = {
                  ...req,
                  gasToken: gasTokenAddress,
                  gasAmount,
                  amountOutMinETH,
                  deadline,
                };

                txHash = await this.sendGatewayTokenTxWithFallback(
                  evmClientEvm,
                  gatewayAddressEvm,
                  reqToken,
                  this.universalSigner,
                );
              } else {
                // Existing native-ETH value path
                // const req: UniversalTxRequest = {
                //   recipient: zeroAddress,
                //   token: tokenAddr,
                //   amount: bridgeAmount,
                //   payload: payloadBytes,
                //   revertInstruction: revertCFG,
                //   signatureData: '0x',
                // };
                // const req = this._buildUniversalTxRequest({
                //   recipient: zeroAddress,
                //   token: tokenAddr,
                //   amount: bridgeAmount,
                //   payload: this.encodeUniversalPayload(universalPayload),
                // });

                // VALUE + PAYLOAD + FUNDS && PAYLOAD + FUNDS
                // For native tokens: msg.value = gas amount + bridge amount
                // For ERC-20 tokens: msg.value = gas amount only (bridge handled via token transfer)
                const isNativeToken = mechanism === 'native';
                const totalValue = isNativeToken
                  ? nativeAmount + bridgeAmount
                  : nativeAmount;

                txHash = await this.sendGatewayTxWithFallback(
                  evmClientEvm,
                  gatewayAddressEvm,
                  req,
                  this.universalSigner,
                  totalValue,
                );
              }
            } else {
              txHash = await this._sendSVMTxWithFunds({
                execute,
                mechanism,
                universalPayload,
                bridgeAmount,
                nativeAmount,
                req,
              });
            }
          } catch (err) {
            this.executeProgressHook(PROGRESS_HOOK.SEND_TX_04_04);
            throw err;
          }

          // Payload Flow: Verification Success
          this.executeProgressHook(PROGRESS_HOOK.SEND_TX_04_03);

          // Funds Flow: Funds lock submitted
          this.executeProgressHook(
            PROGRESS_HOOK.SEND_TX_06_02,
            txHash,
            bridgeAmount,
            execute.funds.token.decimals,
            symbol
          );

          // Awaiting confirmations
          const signerChain = this.universalSigner.account.chain;
          if (CHAIN_INFO[signerChain].vm === VM.EVM) {
            const evmClientEvm = evmClient as EvmClient;
            await this.waitForEvmConfirmationsWithCountdown(
              evmClientEvm,
              txHash as `0x${string}`,
              CHAIN_INFO[signerChain].confirmations,
              CHAIN_INFO[signerChain].timeout
            );
          } else {
            const svmClient = new SvmClient({
              rpcUrls:
                this.rpcUrls[CHAIN.SOLANA_DEVNET] ||
                CHAIN_INFO[CHAIN.SOLANA_DEVNET].defaultRPC,
            });
            await this.waitForSvmConfirmationsWithCountdown(
              svmClient,
              txHash as string,
              CHAIN_INFO[signerChain].confirmations,
              CHAIN_INFO[signerChain].timeout
            );
          }

          // Funds Flow: Confirmed on origin
          let feeLockTxHash = txHash;
          if (CHAIN_INFO[this.universalSigner.account.chain].vm === VM.SVM) {
            if (feeLockTxHash && !feeLockTxHash.startsWith('0x')) {
              // decode svm base58
              const decoded = utils.bytes.bs58.decode(feeLockTxHash);
              feeLockTxHash = bytesToHex(new Uint8Array(decoded));
            }
          }

          // if (
          //   chain === CHAIN.SOLANA_DEVNET ||
          //   chain === CHAIN.SOLANA_TESTNET ||
          //   chain === CHAIN.SOLANA_MAINNET
          // ) {
          //   await this.sendUniversalTx(deployed, feeLockTxHash);
          // }

          // Funds Confirmed - emit immediately after confirmations
          this.executeProgressHook(PROGRESS_HOOK.SEND_TX_06_04);
          // Syncing with Push Chain - emit before query
          this.executeProgressHook(PROGRESS_HOOK.SEND_TX_06_05);

          // After sending Cosmos tx to Push Chain, query UniversalTx status
          let pushChainUniversalTx: UniversalTx | undefined;
          if (CHAIN_INFO[this.universalSigner.account.chain].vm === VM.EVM) {
            const evmClientEvm = evmClient as EvmClient;
            const gatewayAddressEvm = gatewayAddress as `0x${string}`;
            pushChainUniversalTx =
              await this.queryUniversalTxStatusFromGatewayTx(
                evmClientEvm,
                gatewayAddressEvm,
                txHash as `0x${string}`,
                'sendTxWithFunds'
              );
          } else {
            pushChainUniversalTx =
              await this.queryUniversalTxStatusFromGatewayTx(
                undefined,
                undefined,
                txHash as string,
                'sendTxWithFunds'
              );
          }

          if (!pushChainUniversalTx?.pcTx?.length) {
            throw new Error(
              `Failed to retrieve Push Chain transaction status for gateway tx: ${txHash}. ` +
                `The transaction may have failed on Push Chain or not been indexed yet.`
            );
          }
          // Always use the last pcTx entry as it represents the final execution result
          const lastPcTransaction = pushChainUniversalTx.pcTx.at(-1);
          if (!lastPcTransaction?.txHash) {
            const failedPcTx = pushChainUniversalTx.pcTx.find(
              (pcTx: { status?: string; errorMsg?: string }) =>
                pcTx.status === 'FAILED' && pcTx.errorMsg
            );
            const errorDetails = failedPcTx?.errorMsg
              ? `: ${failedPcTx.errorMsg}`
              : '';
            throw new Error(
              `No transaction hash found in Push Chain response for gateway tx: ${txHash}${errorDetails}`
            );
          }
          const tx = await this.pushClient.getTransaction(
            lastPcTransaction.txHash as `0x${string}`
          );
          const response = await this.transformToUniversalTxResponse(tx, eventBuffer);
          // Funds Flow: Funds credited on Push Chain
          this.executeProgressHook(
            PROGRESS_HOOK.SEND_TX_06_06,
            bridgeAmount,
            execute.funds.token.decimals,
            symbol
          );
          this.executeProgressHook(PROGRESS_HOOK.SEND_TX_99_01, [response]);
          return response;
        }
      }

      // Set default value for value if undefined
      if (execute.value === undefined) {
        execute.value = BigInt(0);
      }

      const chain = this.universalSigner.account.chain;
      this.executeProgressHook(
        PROGRESS_HOOK.SEND_TX_01,
        chain,
        this.universalSigner.account.address
      );
      this.validateMainnetConnection(chain);
      /**
       * Push to Push Tx
       */
      if (this.isPushChain(chain)) {
        this.executeProgressHook(PROGRESS_HOOK.SEND_TX_07);
        const tx = await this.sendPushTx(execute, eventBuffer);
        this.executeProgressHook(PROGRESS_HOOK.SEND_TX_99_01, [tx]);
        return tx;
      }
      /**
       * Fetch Gas details and estimate cost of execution
       */
      this.executeProgressHook(PROGRESS_HOOK.SEND_TX_02_01);
      const gasEstimate = execute.gasLimit || BigInt(1e7);
      const gasPrice = await this.pushClient.getGasPrice();
      const requiredGasFee = gasEstimate * gasPrice;
      const requiredFunds = requiredGasFee + execute.value;
      this.executeProgressHook(PROGRESS_HOOK.SEND_TX_02_02, requiredFunds);
      /**
       * Fetch UEA Details (or use pre-fetched status if available)
       */
      const UEA = this.computeUEAOffchain();
      let isUEADeployed: boolean;
      let nonce: bigint;
      let funds: bigint;

      if (execute._ueaStatus) {
        // Use pre-fetched UEA status (from executeUoaToCea)
        isUEADeployed = execute._ueaStatus.isDeployed;
        nonce = execute._ueaStatus.nonce;
        funds = execute._ueaStatus.balance;
        this.executeProgressHook(PROGRESS_HOOK.SEND_TX_03_01);
        this.executeProgressHook(PROGRESS_HOOK.SEND_TX_03_02, UEA, isUEADeployed);
      } else {
        // Fetch UEA status from Push Chain RPC
        this.executeProgressHook(PROGRESS_HOOK.SEND_TX_03_01);
        const [code, balance] = await Promise.all([
          this.pushClient.publicClient.getCode({ address: UEA }),
          this.pushClient.getBalance(UEA),
        ]);
        isUEADeployed = code !== undefined;
        nonce = isUEADeployed ? await this.getUEANonce(UEA) : BigInt(0);
        funds = balance;
        this.executeProgressHook(PROGRESS_HOOK.SEND_TX_03_02, UEA, isUEADeployed);
      }
      /**
       * Compute Universal Payload Hash
       */
      let feeLockTxHash: string | undefined = execute.feeLockTxHash;
      if (feeLockTxHash && !feeLockTxHash.startsWith('0x')) {
        // decode svm base58
        const decoded = utils.bytes.bs58.decode(feeLockTxHash);
        feeLockTxHash = bytesToHex(new Uint8Array(decoded));
      }
      // Fee locking is required if UEA is not deployed OR insufficient funds.
      // Skip for outbound flows (UEA→CEA) — those execute on Push Chain and
      // don't need external-chain fee locking.
      const feeLockingRequired =
        !execute._skipFeeLocking &&
        (!isUEADeployed || funds < requiredFunds) && !feeLockTxHash;

      // Support multicall payload encoding when execute.data is an array
      let payloadData: `0x${string}`;
      let payloadTo: `0x${string}`;
      let req: UniversalTxRequest;
      // Here is only value and payload. No funds here
      if (Array.isArray(execute.data)) {
        // payloadData = this._buildMulticallPayloadData(execute.to, execute.data);
        // Normal multicall. We replace the `to` to zeroAddress. Then console.warn to let user know that it should be
        // passed as zeroAddress in the future.
        // execute.to = zeroAddress;
        payloadTo = zeroAddress;
        console.warn(`Multicalls should have execute.to as ${zeroAddress}`);
        payloadData = this._buildMulticallPayloadData(
          execute.to,
          buildExecuteMulticall({ execute, ueaAddress: UEA })
        );
        req = this._buildUniversalTxRequest({
          recipient: zeroAddress,
          token: zeroAddress,
          amount: BigInt(0),
          payload: payloadData,
        });
      } else {
        if (execute.to.toLowerCase() !== UEA.toLowerCase()) {
          // For Payload + Value we don't do multicall anymore.
          // Multicall is only when Payload + Value;
          // Payload + Value + Funds -> Multicall
          // TODO: Check but I beleive this code section is never reached.
          if (execute.funds) {
            payloadTo = zeroAddress;
            payloadData = this._buildMulticallPayloadData(
              execute.to,
              buildExecuteMulticall({ execute, ueaAddress: UEA })
            );
            req = this._buildUniversalTxRequest({
              recipient: zeroAddress,
              token: zeroAddress,
              amount: BigInt(0),
              payload: payloadData,
            });
          } else {
            // VALUE ONLY OTHER
            // VALUE + PAYLOAD ONLY OTHER
            payloadTo = execute.to;
            payloadData = execute.data || '0x';
            const reqData = this._buildMulticallPayloadData(
              execute.to,
              buildExecuteMulticall({ execute, ueaAddress: UEA })
            );
            const universalPayload = JSON.parse(
              JSON.stringify(
                {
                  to: zeroAddress,
                  value: execute.value,
                  data: reqData,
                  gasLimit: execute.gasLimit || BigInt(5e7),
                  maxFeePerGas: execute.maxFeePerGas || BigInt(1e10),
                  maxPriorityFeePerGas:
                    execute.maxPriorityFeePerGas || BigInt(0),
                  nonce,
                  deadline: execute.deadline || BigInt(9999999999),
                  vType: feeLockingRequired
                    ? VerificationType.universalTxVerification
                    : VerificationType.signedVerification,
                },
                this.bigintReplacer
              )
            ) as UniversalPayload;
            req = this._buildUniversalTxRequest({
              recipient: zeroAddress,
              token: zeroAddress,
              amount: BigInt(0),
              payload: this.encodeUniversalPayload(universalPayload),
            });
          }
        } else {
          // For value only we don't check below. Only if there is payload to be executed
          // if (execute.data && execute.to.toLowerCase() === UEA.toLowerCase()) {
          //   throw new Error(`You can't execute data on the UEA address`);
          // }
          // VALUE ONLY SELF - using multicall for consistency
          payloadTo = execute.to;
          payloadData = execute.data || '0x';
          const reqData = this._buildMulticallPayloadData(
            execute.to,
            buildExecuteMulticall({ execute, ueaAddress: UEA })
          );
          const universalPayloadSelf = JSON.parse(
            JSON.stringify(
              {
                to: zeroAddress,
                value: execute.value,
                data: reqData,
                gasLimit: execute.gasLimit || BigInt(5e7),
                maxFeePerGas: execute.maxFeePerGas || BigInt(1e10),
                maxPriorityFeePerGas: execute.maxPriorityFeePerGas || BigInt(0),
                nonce,
                deadline: execute.deadline || BigInt(9999999999),
                vType: feeLockingRequired
                  ? VerificationType.universalTxVerification
                  : VerificationType.signedVerification,
              },
              this.bigintReplacer
            )
          ) as UniversalPayload;
          req = this._buildUniversalTxRequest({
            recipient: zeroAddress,
            token: zeroAddress,
            amount: BigInt(0),
            payload: this.encodeUniversalPayload(universalPayloadSelf),
          });
        }
      }

      const universalPayload = JSON.parse(
        JSON.stringify(
          {
            to: payloadTo,
            value: execute.value,
            data: payloadData,
            gasLimit: execute.gasLimit || BigInt(5e7),
            maxFeePerGas: execute.maxFeePerGas || BigInt(1e10),
            maxPriorityFeePerGas: execute.maxPriorityFeePerGas || BigInt(0),
            nonce,
            deadline: execute.deadline || BigInt(9999999999),
            vType: feeLockingRequired
              ? VerificationType.universalTxVerification
              : VerificationType.signedVerification,
          },
          this.bigintReplacer
        )
      ) as UniversalPayload;
      /**
       * Prepare verification data by either signature or fund locking
       */
      let verificationData: `0x${string}`;
      /**
       * 1. UEA deployed + sufficient funds: No fee locking needed
       * 2. UEA deployed + insufficient funds: Lock requiredFunds
       * 3. UEA not deployed + sufficient funds: Lock 0.001 PC (for deployment)
       * 4. UEA not deployed + insufficient funds: Lock requiredFunds
       */
      if (!feeLockingRequired) {
        const ueaVersion = await this.fetchUEAVersion();
        /**
         * Sign Universal Payload
         */
        this.executeProgressHook(PROGRESS_HOOK.SEND_TX_04_02);
        const signature = await this.signUniversalPayload(
          universalPayload,
          UEA,
          ueaVersion
        );
        verificationData = bytesToHex(signature);
        this.executeProgressHook(PROGRESS_HOOK.SEND_TX_04_03);
      } else {
        /**
         * Fee Locking - For all chains, EVM and Solana
         */
        const fundDifference = requiredFunds - funds;
        const fixedPushAmount = Utils.helpers.parseUnits('0.001', 18); // Minimum lock 0.001 Push tokens
        const lockAmount =
          funds < requiredFunds ? fundDifference : fixedPushAmount;
        const lockAmountInUSD = this.pushClient.pushToUSDC(lockAmount);

        const feeLockTxHashBytes = await this.lockFee(
          lockAmountInUSD,
          universalPayload,
          req
        );
        feeLockTxHash = bytesToHex(feeLockTxHashBytes);
        verificationData = bytesToHex(feeLockTxHashBytes);

        const { vm } = CHAIN_INFO[chain];
        const feeLockTxHashDisplay =
          vm === VM.SVM
            ? utils.bytes.bs58.encode(feeLockTxHashBytes)
            : feeLockTxHash;

        // Gas Flow: Gas funding in progress (with full origin tx when available)
        const originTx = await this.fetchOriginChainTransactionForProgress(
          chain,
          feeLockTxHash,
          feeLockTxHashDisplay
        );
        this.executeProgressHook(
          PROGRESS_HOOK.SEND_TX_05_01,
          feeLockTxHashDisplay,
          originTx
        );

        // Waiting for blocks confirmations
        await this.waitForLockerFeeConfirmation(feeLockTxHashBytes);
        // Gas Flow: Gas funding confirmed
        this.executeProgressHook(PROGRESS_HOOK.SEND_TX_05_02);

        // Query nodes via gRPC for Push Chain transaction
        const { defaultRPC, lockerContract } = CHAIN_INFO[chain];
        const pushChainUniversalTx =
          await this.queryUniversalTxStatusFromGatewayTx(
            new EvmClient({ rpcUrls: this.rpcUrls[chain] || defaultRPC }),
            lockerContract as `0x${string}`,
            feeLockTxHash,
            'sendTxWithGas'
          );

        /**
         * Return response directly (skip sendUniversalTx for sendTxWithGas flow)
         * Note: queryTx may be undefined since validators don't recognize new UniversalTx event yet
         */

        // Transform to UniversalTxResponse (follow sendFunds pattern)
        if (!pushChainUniversalTx?.pcTx?.length) {
          throw new Error(
            `Failed to retrieve Push Chain transaction status for gateway tx: ${feeLockTxHash}. ` +
              `The transaction may have failed on Push Chain or not been indexed yet.`
          );
        }
        // Always use the last pcTx entry as it represents the final execution result
        const lastPcTransaction = pushChainUniversalTx.pcTx.at(-1);
        if (!lastPcTransaction?.txHash) {
          const failedPcTx = pushChainUniversalTx.pcTx.find(
            (pcTx: { status?: string; errorMsg?: string }) =>
              pcTx.status === 'FAILED' && pcTx.errorMsg
          );
          const errorDetails = failedPcTx?.errorMsg
            ? `: ${failedPcTx.errorMsg}`
            : '';
          throw new Error(
            `No transaction hash found in Push Chain response for gateway tx: ${feeLockTxHash}${errorDetails}`
          );
        }
        const tx = await this.pushClient.getTransaction(
          lastPcTransaction.txHash as `0x${string}`
        );
        const response = await this.transformToUniversalTxResponse(tx, eventBuffer);
        this.executeProgressHook(PROGRESS_HOOK.SEND_TX_99_01, [response]);
        return response;
      }
      /**
       * Non-fee-locking path: Broadcasting Tx to PC via sendUniversalTx
       */
      this.executeProgressHook(PROGRESS_HOOK.SEND_TX_07);
      // We don't need to query via gRPC the PC transaction since it's getting returned it here already.
      const transactions = await this.sendUniversalTx(
        isUEADeployed,
        feeLockTxHash,
        universalPayload,
        verificationData,
        eventBuffer
      );
      this.executeProgressHook(PROGRESS_HOOK.SEND_TX_99_01, transactions);
      return transactions[transactions.length - 1];
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
      this.executeProgressHook(PROGRESS_HOOK.SEND_TX_99_02, errMessage);
      throw err;
    } finally {
      // Restore original progressHook
      this.progressHook = originalHook;
    }
  }

  // ============================================================================
  // Multi-Chain Universal Transaction Methods
  // ============================================================================

  /**
   * Executes a universal transaction with multi-chain routing support.
   * Supports 4 routes:
   * - Route 1: UOA → Push Chain (existing behavior)
   * - Route 2: UOA → CEA (outbound to external chain)
   * - Route 3: CEA → Push Chain (inbound from external chain)
   * - Route 4: CEA → CEA (external chain to external chain via Push)
   *
   * @param params - Universal execution parameters with optional chain targets
   * @returns UniversalTxResponse with chain information
   */
  /**
   * Internal method for multi-chain transaction routing.
   * Called by execute() when ChainTarget or from.chain is detected.
   */
  private async executeMultiChain(
    params: UniversalExecuteParams
  ): Promise<UniversalTxResponse> {
    // Validate route parameters
    validateRouteParams(params, {
      clientChain: this.universalSigner.account.chain,
    });

    // Detect the transaction route
    const route = detectRoute(params);

    this.printLog(
      `executeMultiChain — detected route: ${route}, params: ${JSON.stringify(
        {
          to:
            typeof params.to === 'string'
              ? params.to
              : { address: params.to.address, chain: params.to.chain },
          from: params.from,
          hasValue: params.value !== undefined,
          hasData: params.data !== undefined,
          hasFunds: params.funds !== undefined,
        },
        null,
        2
      )}`
    );

    let response: UniversalTxResponse;

    switch (route) {
      case TransactionRoute.UOA_TO_PUSH:
        // Route 1: Standard Push Chain execution
        response = await this.execute(this.toExecuteParams(params));
        break;

      case TransactionRoute.UOA_TO_CEA:
        // Route 2: Outbound to external chain via CEA
        response = await this.executeUoaToCea(params);
        break;

      case TransactionRoute.CEA_TO_PUSH:
        // Route 3: Inbound from CEA to Push Chain
        response = await this.executeCeaToPush(params);
        break;

      case TransactionRoute.CEA_TO_CEA:
        // Route 4: CEA to CEA via Push Chain
        response = await this.executeCeaToCea(params);
        break;

      default:
        throw new Error(`Unknown transaction route: ${route}`);
    }

    // Set the route on the response for .wait() to use
    response.route = route;

    return response;
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
    validateRouteParams(params, {
      clientChain: this.universalSigner.account.chain,
    });
    const route = detectRoute(params);

    const { nonce, deployed } = await this.getUeaStatusAndNonce();
    const ueaAddress = this.computeUEAOffchain();

    // Build the payload based on route
    const { payload, gatewayRequest } = await this.buildPayloadForRoute(
      params,
      route,
      nonce
    );

    const gasEstimate = params.gasLimit || DEFAULT_OUTBOUND_GAS_LIMIT;
    const deadline = params.deadline || BigInt(Math.floor(Date.now() / 1000) + 3600);

    // Build the HopDescriptor with all metadata needed for cascade nesting
    const hop = await this.buildHopDescriptor(params, route, ueaAddress);

    const prepared: PreparedUniversalTx = {
      route,
      payload,
      gatewayRequest,
      estimatedGas: gasEstimate,
      nonce,
      deadline,
      _hop: hop,
      thenOn: (nextTx: PreparedUniversalTx) =>
        this.createCascadedBuilder([prepared, nextTx]),
      send: () => this.executeMultiChain(params),
    };

    return prepared;
  }

  /**
   * Build a HopDescriptor for a prepared transaction.
   * Resolves CEA addresses, queries gas fees, and builds multicall arrays.
   *
   * @param params - Original user params
   * @param route - Detected route
   * @param ueaAddress - UEA address
   * @returns HopDescriptor with all metadata
   */
  private async buildHopDescriptor(
    params: UniversalExecuteParams,
    route: TransactionRoute,
    ueaAddress: `0x${string}`
  ): Promise<HopDescriptor> {
    // Pass 0 when user omits gasLimit → contract uses per-chain baseGasLimitByChainNamespace
    const gasLimit = params.gasLimit ?? BigInt(0);
    const routeStr = route as unknown as string;

    const baseDescriptor: HopDescriptor = {
      params,
      route: routeStr as HopDescriptor['route'],
      gasLimit,
      ueaAddress,
      revertRecipient: ueaAddress,
    };

    switch (route) {
      case TransactionRoute.UOA_TO_PUSH: {
        // Route 1: Build Push Chain multicalls
        const executeParams = this.toExecuteParams(params);
        const pushMulticalls = buildExecuteMulticall({
          execute: executeParams,
          ueaAddress,
        });

        return {
          ...baseDescriptor,
          pushMulticalls,
        };
      }

      case TransactionRoute.UOA_TO_CEA: {
        // Route 2: Build outbound metadata
        const target = params.to as ChainTarget;
        const targetChain = target.chain;

        // Branch: SVM vs EVM
        if (isSvmChain(targetChain)) {
          // SVM path: no CEA lookup, build SVM payload
          const hasSvmExecute = !!params.svmExecute;
          let svmPayload: `0x${string}` = '0x';

          if (hasSvmExecute) {
            const exec = params.svmExecute!;
            svmPayload = encodeSvmExecutePayload({
              targetProgram: exec.targetProgram,
              accounts: exec.accounts,
              ixData: exec.ixData,
              instructionId: 2,
            });
          }

          let prc20Token: `0x${string}` = ZERO_ADDRESS as `0x${string}`;
          let burnAmount = BigInt(0);
          if (params.funds?.amount) {
            const token = (params.funds as { token: MoveableToken }).token;
            if (token) {
              prc20Token = PushChain.utils.tokens.getPRC20Address(token);
              burnAmount = params.funds.amount;
            }
          } else if (params.value && params.value > BigInt(0)) {
            prc20Token = this.getNativePRC20ForChain(targetChain);
            burnAmount = params.value;
          } else if (hasSvmExecute) {
            prc20Token = this.getNativePRC20ForChain(targetChain);
            burnAmount = BigInt(1);
          }

          let gasToken: `0x${string}` = ZERO_ADDRESS as `0x${string}`;
          let gasFee = BigInt(0);
          if (prc20Token !== (ZERO_ADDRESS as `0x${string}`)) {
            const result = await this.queryOutboundGasFee(prc20Token, gasLimit);
            gasToken = result.gasToken;
            gasFee = result.gasFee;
          }

          return {
            ...baseDescriptor,
            targetChain,
            isSvmTarget: true,
            svmPayload,
            prc20Token,
            burnAmount,
            gasToken,
            gasFee,
          };
        }

        // EVM path: Resolve CEA address + build CEA multicalls
        const { cea: ceaAddress } = await getCEAAddress(
          ueaAddress,
          targetChain,
          this.rpcUrls[targetChain]?.[0]
        );

        // Migration path: raw MIGRATION_SELECTOR payload, no multicall wrapping
        if (params.migration) {
          const prc20Token = this.getNativePRC20ForChain(targetChain);
          const burnAmount = BigInt(0); // Migration is logic-only — no funds. CEA rejects msg.value != 0.
          let gasToken: `0x${string}` = ZERO_ADDRESS as `0x${string}`;
          let gasFee = BigInt(0);
          if (prc20Token !== (ZERO_ADDRESS as `0x${string}`)) {
            const result = await this.queryOutboundGasFee(prc20Token, gasLimit);
            gasToken = result.gasToken;
            gasFee = result.gasFee;
          }
          return {
            ...baseDescriptor,
            targetChain,
            ceaAddress,
            ceaMulticalls: [],
            prc20Token,
            burnAmount,
            gasToken,
            gasFee,
            isMigration: true,
          };
        }

        // Build CEA multicalls
        const ceaMulticalls: MultiCall[] = [];
        if (params.data) {
          if (Array.isArray(params.data)) {
            ceaMulticalls.push(...(params.data as MultiCall[]));
          } else {
            // When ERC-20 funds are provided with a single payload, auto-prepend a
            // transfer() call so the tokens minted to the CEA are forwarded to the
            // target address. This mirrors the Route 1 behavior in buildExecuteMulticall.
            if (params.funds?.amount) {
              const token = (params.funds as { token: MoveableToken }).token;
              if (token && token.mechanism !== 'native') {
                const erc20Transfer = encodeFunctionData({
                  abi: ERC20_EVM,
                  functionName: 'transfer',
                  args: [target.address, params.funds.amount],
                });
                ceaMulticalls.push({
                  to: token.address as `0x${string}`,
                  value: BigInt(0),
                  data: erc20Transfer,
                });
              }
            }
            // Single call with data. Forward native value (if any) so the target
            // contract receives it alongside the payload call. The vault deposits
            // native value to the CEA, and the multicall forwards it to the target.
            ceaMulticalls.push({
              to: target.address,
              value: params.value ?? BigInt(0),
              data: params.data as `0x${string}`,
            });
          }
        } else if (params.value) {
          // Skip multicall when sending native value to own CEA — gateway deposits directly.
          // Self-call with value would revert (CEA._handleMulticall rejects it).
          if (target.address.toLowerCase() !== ceaAddress.toLowerCase()) {
            ceaMulticalls.push({
              to: target.address,
              value: params.value,
              data: '0x',
            });
          }
        }

        // Determine PRC-20 token and burn amount
        let prc20Token: `0x${string}` = ZERO_ADDRESS as `0x${string}`;
        let burnAmount = BigInt(0);
        if (params.funds?.amount) {
          const token = (params.funds as { token: MoveableToken }).token;
          if (token) {
            prc20Token = PushChain.utils.tokens.getPRC20Address(token);
            burnAmount = params.funds.amount;
          }
        } else if (params.value && params.value > BigInt(0)) {
          prc20Token = this.getNativePRC20ForChain(targetChain);
          burnAmount = params.value;
        } else if (params.data) {
          prc20Token = this.getNativePRC20ForChain(targetChain);
          burnAmount = BigInt(1); // Minimum for precompile
        }

        // Query gas fee
        let gasToken: `0x${string}` = ZERO_ADDRESS as `0x${string}`;
        let gasFee = BigInt(0);
        if (prc20Token !== (ZERO_ADDRESS as `0x${string}`)) {
          const result = await this.queryOutboundGasFee(prc20Token, gasLimit);
          gasToken = result.gasToken;
          gasFee = result.gasFee;
        }

        return {
          ...baseDescriptor,
          targetChain,
          ceaAddress,
          ceaMulticalls,
          prc20Token,
          burnAmount,
          gasToken,
          gasFee,
        };
      }

      case TransactionRoute.CEA_TO_PUSH: {
        // Route 3: Build CEA multicalls for sendUniversalTxFromCEA
        const sourceChain = params.from!.chain;

        // SVM chains use PDA-based CEA, not factory-deployed CEA
        if (isSvmChain(sourceChain)) {
          const lockerContract = CHAIN_INFO[sourceChain].lockerContract;
          if (!lockerContract) {
            throw new Error(`No SVM gateway program configured for chain ${sourceChain}`);
          }
          const programPk = new PublicKey(lockerContract);
          const gatewayProgramHex = ('0x' + Buffer.from(programPk.toBytes()).toString('hex')) as `0x${string}`;

          // Derive CEA PDA
          const ueaBytes = Buffer.from(ueaAddress.slice(2), 'hex');
          const [ceaPda] = PublicKey.findProgramAddressSync(
            [Buffer.from('push_identity'), ueaBytes],
            programPk
          );
          const ceaPdaHex = ('0x' + Buffer.from(ceaPda.toBytes()).toString('hex')) as `0x${string}`;

          let amount = BigInt(0);
          let prc20Token: `0x${string}`;
          if (params.funds?.amount && params.funds.amount > BigInt(0)) {
            amount = params.funds.amount;
            const token = (params.funds as { token: MoveableToken }).token;
            if (token && token.address) {
              prc20Token = PushChain.utils.tokens.getPRC20Address(token);
            } else {
              prc20Token = this.getNativePRC20ForChain(sourceChain);
            }
          } else if (params.value && params.value > BigInt(0)) {
            amount = params.value;
            prc20Token = this.getNativePRC20ForChain(sourceChain);
          } else {
            // Payload-only Route 3 SVM
            prc20Token = this.getNativePRC20ForChain(sourceChain);
          }

          let gasToken: `0x${string}` = ZERO_ADDRESS as `0x${string}`;
          let gasFee = BigInt(0);
          if (prc20Token !== (ZERO_ADDRESS as `0x${string}`)) {
            const result = await this.queryOutboundGasFee(prc20Token, gasLimit);
            gasToken = result.gasToken;
            gasFee = result.gasFee;
          }

          return {
            ...baseDescriptor,
            sourceChain,
            ceaAddress: ceaPdaHex,
            isSvmTarget: true,
            prc20Token,
            burnAmount: amount > BigInt(0) ? amount : BigInt(1),
            gasToken,
            gasFee,
          };
        }

        const { cea: ceaAddress, isDeployed } = await getCEAAddress(
          ueaAddress,
          sourceChain,
          this.rpcUrls[sourceChain]?.[0]
        );

        // Determine token/amount for the inbound
        let tokenAddress: `0x${string}` = ZERO_ADDRESS as `0x${string}`;
        let amount = BigInt(0);
        let nativeValue = BigInt(0);
        if (params.funds?.amount) {
          const token = (params.funds as { token: MoveableToken }).token;
          if (token) {
            if (token.mechanism === 'native') {
              amount = params.funds.amount;
              nativeValue = params.funds.amount;
            } else {
              tokenAddress = token.address as `0x${string}`;
              amount = params.funds.amount;
            }
          }
        } else if (params.value && params.value > BigInt(0)) {
          amount = params.value;
          nativeValue = params.value;
        }

        // The PRC-20 for the outbound wrapper (Route 2 to source chain)
        const prc20Token = this.getNativePRC20ForChain(sourceChain);
        let gasToken: `0x${string}` = ZERO_ADDRESS as `0x${string}`;
        let gasFee = BigInt(0);
        if (prc20Token !== (ZERO_ADDRESS as `0x${string}`)) {
          const result = await this.queryOutboundGasFee(prc20Token, gasLimit);
          gasToken = result.gasToken;
          gasFee = result.gasFee;
        }

        return {
          ...baseDescriptor,
          sourceChain,
          ceaAddress,
          prc20Token,
          burnAmount: amount > BigInt(0) ? amount : BigInt(1),
          gasToken,
          gasFee,
        };
      }

      default:
        return baseDescriptor;
    }
  }

  /**
   * Query outbound gas fee from UniversalCore contract.
   * Extracted from executeUoaToCea for reuse.
   *
   * @param prc20Token - PRC-20 token address
   * @param gasLimit - Gas limit for the outbound
   * @returns gasToken address and gasFee amount
   */
  async queryOutboundGasFee(
    prc20Token: `0x${string}`,
    gasLimit: bigint
  ): Promise<{ gasToken: `0x${string}`; gasFee: bigint; protocolFee: bigint; nativeValueForGas: bigint; gasPrice: bigint }> {
    const gatewayPcAddress = this.getUniversalGatewayPCAddress();
    const pushChain = this.getPushChainForNetwork();
    const rpcUrl = CHAIN_INFO[pushChain]?.defaultRPC?.[0] || 'unknown';

    this.printLog(
      `queryOutboundGasFee — [step 1] inputs: gateway=${gatewayPcAddress}, prc20Token=${prc20Token}, gasLimit=${gasLimit}, pushNetwork=${this.pushNetwork}, rpcUrl=${rpcUrl}`
    );

    // Step 2: Get UNIVERSAL_CORE address from gateway
    let universalCoreAddress: `0x${string}`;
    try {
      const gatewayCallData = encodeFunctionData({
        abi: UNIVERSAL_GATEWAY_PC,
        functionName: 'UNIVERSAL_CORE',
        args: [],
      });
      this.printLog(
        `queryOutboundGasFee — [step 2] reading UNIVERSAL_CORE from ${gatewayPcAddress}, callData=${gatewayCallData}`
      );
      universalCoreAddress = await this.pushClient.readContract<`0x${string}`>({
        address: gatewayPcAddress,
        abi: UNIVERSAL_GATEWAY_PC,
        functionName: 'UNIVERSAL_CORE',
        args: [],
      });
      this.printLog(
        `queryOutboundGasFee — [step 2] UNIVERSAL_CORE resolved to: ${universalCoreAddress}`
      );
    } catch (err) {
      this.printLog(
        `queryOutboundGasFee — [step 2] FAILED to read UNIVERSAL_CORE: ${err instanceof Error ? err.message : String(err)}`
      );
      throw err;
    }

    // Step 3: Call getOutboundTxGasAndFees on UNIVERSAL_CORE
    const callData = encodeFunctionData({
      abi: UNIVERSAL_CORE_EVM,
      functionName: 'getOutboundTxGasAndFees',
      args: [prc20Token, gasLimit],
    });
    this.printLog(
      `queryOutboundGasFee — [step 3] calling getOutboundTxGasAndFees on ${universalCoreAddress}`
    );
    this.printLog(
      `queryOutboundGasFee — [step 3] eth_call: {"method":"eth_call","params":[{"to":"${universalCoreAddress}","data":"${callData}"},"latest"]}`
    );

    let gasToken: `0x${string}`;
    let gasFee: bigint;
    let protocolFee: bigint;
    let gasPrice: bigint = BigInt(0);
    try {
      const result = await this.pushClient.readContract<[`0x${string}`, bigint, bigint, bigint, string]>({
        address: universalCoreAddress,
        abi: UNIVERSAL_CORE_EVM,
        functionName: 'getOutboundTxGasAndFees',
        args: [prc20Token, gasLimit],
      });
      gasToken = result[0];
      gasFee = result[1];
      protocolFee = result[2];
      gasPrice = result[3];
      this.printLog(
        `queryOutboundGasFee — [step 4] success: gasToken=${gasToken}, gasFee=${gasFee}, protocolFee=${protocolFee}, gasPrice=${gasPrice}`
      );
    } catch (err) {
      this.printLog(
        `queryOutboundGasFee — [step 3] FAILED: ${err instanceof Error ? err.message : String(err)}`
      );
      throw err;
    }

    // gasFee is in gas token units — exchange rate to PC is unknown without quoter.
    // Use 1000000x buffer; excess is refunded by swapAndBurnGas to the UEA.
    const nativeValueForGas = protocolFee + (gasFee * BigInt(1000000));
    this.printLog(
      `queryOutboundGasFee — [step 5] using 1000000x buffer: nativeValueForGas=${nativeValueForGas}`
    );

    return { gasToken, gasFee, protocolFee, nativeValueForGas, gasPrice };
  }

  // ============================================================================
  // Cascade Composition (Advance Hopping)
  // ============================================================================

  /**
   * Classify hops into segments for cascade composition.
   * Consecutive same-type/same-chain hops are merged.
   *
   * @param hops - Array of HopDescriptors from prepared transactions
   * @returns Array of CascadeSegments
   */
  classifyIntoSegments(hops: HopDescriptor[]): CascadeSegment[] {
    if (hops.length === 0) return [];

    const segments: CascadeSegment[] = [];
    let currentSegment: CascadeSegment | null = null;

    for (const hop of hops) {
      const segType = this.getSegmentType(hop.route);
      const chain = hop.targetChain || hop.sourceChain;

      const canMerge =
        currentSegment &&
        currentSegment.type === segType &&
        // Same-chain merging for OUTBOUND_TO_CEA (EVM only — SVM hops are atomic)
        (segType === 'OUTBOUND_TO_CEA'
          ? currentSegment.targetChain === hop.targetChain &&
            !hop.isSvmTarget
          : segType === 'PUSH_EXECUTION');

      if (canMerge && currentSegment) {
        // Merge into current segment
        currentSegment.hops.push(hop);

        if (segType === 'OUTBOUND_TO_CEA') {
          currentSegment.mergedCeaMulticalls = [
            ...(currentSegment.mergedCeaMulticalls || []),
            ...(hop.ceaMulticalls || []),
          ];
          currentSegment.totalBurnAmount =
            (currentSegment.totalBurnAmount || BigInt(0)) +
            (hop.burnAmount || BigInt(0));
          // Gas fee: take the max gasLimit across merged hops
          if (hop.gasLimit > (currentSegment.gasLimit || BigInt(0))) {
            currentSegment.gasLimit = hop.gasLimit;
          }
          // Accumulate gas fees
          currentSegment.gasFee =
            (currentSegment.gasFee || BigInt(0)) +
            (hop.gasFee || BigInt(0));
        } else if (segType === 'PUSH_EXECUTION') {
          currentSegment.mergedPushMulticalls = [
            ...(currentSegment.mergedPushMulticalls || []),
            ...(hop.pushMulticalls || []),
          ];
        }
      } else {
        // Start a new segment
        currentSegment = {
          type: segType,
          hops: [hop],
          targetChain: hop.targetChain,
          sourceChain: hop.sourceChain,
          mergedCeaMulticalls:
            segType === 'OUTBOUND_TO_CEA' ? [...(hop.ceaMulticalls || [])] : undefined,
          mergedPushMulticalls:
            segType === 'PUSH_EXECUTION' ? [...(hop.pushMulticalls || [])] : undefined,
          totalBurnAmount: hop.burnAmount,
          prc20Token: hop.prc20Token,
          gasToken: hop.gasToken,
          gasFee: hop.gasFee,
          gasLimit: hop.gasLimit,
        };
        segments.push(currentSegment);
      }
    }

    return segments;
  }

  /**
   * Map route to segment type
   */
  private getSegmentType(route: string): CascadeSegmentType {
    switch (route) {
      case 'UOA_TO_PUSH':
        return 'PUSH_EXECUTION';
      case 'UOA_TO_CEA':
        return 'OUTBOUND_TO_CEA';
      case 'CEA_TO_PUSH':
        return 'INBOUND_FROM_CEA';
      default:
        return 'PUSH_EXECUTION';
    }
  }

  /**
   * Compose cascade from segments using bottom-to-top nesting.
   * Processes segments in reverse order, building nested payloads.
   *
   * @param segments - Classified segments from classifyIntoSegments()
   * @param ueaAddress - UEA address
   * @returns Final MultiCall[] to execute as the initial UEA multicall
   */
  composeCascade(
    segments: CascadeSegment[],
    ueaAddress: `0x${string}`,
    ueaBalance?: bigint,
    ueaNonce?: bigint
  ): MultiCall[] {
    let accumulatedPushMulticalls: MultiCall[] = [];
    const gatewayPcAddress = this.getUniversalGatewayPCAddress();

    // Compute per-outbound nativeValueForGas from UEA balance
    // Each outbound segment needs native value for the gas swap on the destination chain.
    // The contract refunds excess, so over-allocating is safe.
    const numOutbounds = segments.filter(s => s.type !== 'PUSH_EXECUTION').length;
    const CASCADE_GAS_RESERVE = BigInt(3e18); // 3 PC reserve for gas costs
    let perOutboundNativeValue: bigint | undefined;
    if (ueaBalance && numOutbounds > 0 && ueaBalance > CASCADE_GAS_RESERVE) {
      perOutboundNativeValue = (ueaBalance - CASCADE_GAS_RESERVE) / BigInt(numOutbounds);
    }

    for (let i = segments.length - 1; i >= 0; i--) {
      const segment = segments[i];

      switch (segment.type) {
        case 'PUSH_EXECUTION': {
          // Prepend Push Chain multicalls to accumulated
          accumulatedPushMulticalls = [
            ...(segment.mergedPushMulticalls || []),
            ...accumulatedPushMulticalls,
          ];
          break;
        }

        case 'OUTBOUND_TO_CEA': {
          const firstHop = segment.hops[0];
          const isSvmSegment = firstHop?.isSvmTarget === true;

          let outboundPayload: `0x${string}`;
          let targetForOutbound: `0x${string}`;

          const isMigration = firstHop?.isMigration === true;

          if (isSvmSegment) {
            // SVM: use the pre-built SVM payload from the hop descriptor
            outboundPayload = firstHop.svmPayload ?? '0x';
            // For SVM, target is the recipient/program from the hop params
            const svmTarget = firstHop.params.to as ChainTarget;
            targetForOutbound = firstHop.params.svmExecute?.targetProgram ?? svmTarget.address;
          } else if (isMigration) {
            // Migration: use raw 4-byte MIGRATION_SELECTOR, no multicall wrapping
            outboundPayload = buildMigrationPayload();
            targetForOutbound = firstHop?.ceaAddress || ueaAddress;
          } else {
            // EVM: build CEA payload from merged multicalls
            outboundPayload = buildCeaMulticallPayload(
              segment.mergedCeaMulticalls || []
            );
            // Get CEA address from the first hop
            targetForOutbound = firstHop?.ceaAddress || ueaAddress;
          }

          // Build outbound request
          const outboundReq = buildOutboundRequest(
            targetForOutbound,
            segment.prc20Token || (ZERO_ADDRESS as `0x${string}`),
            segment.totalBurnAmount || BigInt(0),
            segment.gasLimit ?? BigInt(0),
            outboundPayload,
            ueaAddress
          );

          // Build approval + outbound multicalls
          const segGasFee = segment.gasFee || BigInt(0);
          const outboundMulticalls = buildOutboundApprovalAndCall({
            prc20Token: segment.prc20Token || (ZERO_ADDRESS as `0x${string}`),
            gasToken: segment.gasToken || (ZERO_ADDRESS as `0x${string}`),
            burnAmount: segment.totalBurnAmount || BigInt(0),
            gasFee: segGasFee,
            nativeValueForGas: perOutboundNativeValue ?? segGasFee * BigInt(1000),
            gatewayPcAddress,
            outboundRequest: outboundReq,
          });

          // Prepend to accumulated
          accumulatedPushMulticalls = [
            ...outboundMulticalls,
            ...accumulatedPushMulticalls,
          ];
          break;
        }

        case 'INBOUND_FROM_CEA': {
          // The accumulated multicalls = what runs on Push Chain AFTER inbound arrives.
          // Wrap in UniversalPayload struct with correct UEA nonce for the relay.

          // Build push multicalls from this hop's own data (e.g., counter.increment())
          // This is the Route 3 hop's payload that executes on Push Chain after inbound.
          const hop0 = segment.hops[0];
          if (hop0?.params?.data) {
            const hopPushMulticalls = buildExecuteMulticall({
              execute: {
                to: hop0.params.to as `0x${string}`,
                value: hop0.params.value,
                data: hop0.params.data,
              },
              ueaAddress,
            });
            // Prepend the Route 3's own push calls before subsequent hops
            accumulatedPushMulticalls = [
              ...hopPushMulticalls,
              ...accumulatedPushMulticalls,
            ];
          }

          let intermediatePayload: `0x${string}` = '0x';
          if (accumulatedPushMulticalls.length > 0) {
            const multicallPayload = this._buildMulticallPayloadData(
              ueaAddress,
              accumulatedPushMulticalls
            );
            // +1: the outbound tx consumes one nonce via execute()
            intermediatePayload = buildInboundUniversalPayload(multicallPayload, { nonce: (ueaNonce ?? BigInt(0)) + BigInt(1) });
          }

          const hop = segment.hops[0];
          const sourceChain = hop.sourceChain!;
          const ceaAddress = hop.ceaAddress || ueaAddress;

          // SVM chains: build SVM CPI payload instead of EVM CEA multicall
          if (isSvmChain(sourceChain)) {
            const lockerContract = CHAIN_INFO[sourceChain].lockerContract;
            if (!lockerContract) {
              throw new Error(`No SVM gateway program configured for chain ${sourceChain}`);
            }
            const programPk = new PublicKey(lockerContract);
            const gatewayProgramHex = ('0x' + Buffer.from(programPk.toBytes()).toString('hex')) as `0x${string}`;

            let drainAmount = BigInt(0);
            let tokenMintHex: `0x${string}` | undefined;
            const params = hop.params;
            if (params.funds?.amount && params.funds.amount > BigInt(0)) {
              drainAmount = params.funds.amount;
              const token = (params.funds as { token: MoveableToken }).token;
              if (token && token.address) {
                const mintPk = new PublicKey(token.address);
                tokenMintHex = ('0x' + Buffer.from(mintPk.toBytes()).toString('hex')) as `0x${string}`;
              }
            } else if (params.value && params.value > BigInt(0)) {
              drainAmount = params.value;
            }

            // Derive CEA PDA as revert recipient
            const ueaBytes = Buffer.from(ueaAddress.slice(2), 'hex');
            const [ceaPda] = PublicKey.findProgramAddressSync(
              [Buffer.from('push_identity'), ueaBytes],
              programPk
            );
            const ceaPdaHex = ('0x' + Buffer.from(ceaPda.toBytes()).toString('hex')) as `0x${string}`;

            // Build SVM payload with intermediate Push Chain payload embedded
            const svmPayload = encodeSvmCeaToUeaPayload({
              gatewayProgramHex,
              drainAmount,
              tokenMintHex,
              revertRecipientHex: ceaPdaHex,
              extraPayload: intermediatePayload !== '0x'
                ? new Uint8Array(Buffer.from(intermediatePayload.slice(2), 'hex'))
                : undefined,
            });

            const burnAmount = BigInt(1);
            const outboundReq = buildOutboundRequest(
              gatewayProgramHex,
              segment.prc20Token || this.getNativePRC20ForChain(sourceChain),
              burnAmount,
              segment.gasLimit ?? BigInt(0),
              svmPayload,
              ueaAddress
            );

            const inboundGasFee = segment.gasFee || BigInt(0);
            const outboundMulticalls = buildOutboundApprovalAndCall({
              prc20Token:
                segment.prc20Token || this.getNativePRC20ForChain(sourceChain),
              gasToken: segment.gasToken || (ZERO_ADDRESS as `0x${string}`),
              burnAmount,
              gasFee: inboundGasFee,
              nativeValueForGas: perOutboundNativeValue ?? inboundGasFee * BigInt(1000),
              gatewayPcAddress,
              outboundRequest: outboundReq,
            });

            accumulatedPushMulticalls = [...outboundMulticalls];
            break;
          }

          // EVM path: Build CEA multicall: [approve?, sendUniversalTxFromCEA(payload)]
          const ceaMulticalls: MultiCall[] = [];

          // Add hop's own CEA operations if any
          // (e.g., approve + swap before bridging back)
          if (hop.ceaMulticalls && hop.ceaMulticalls.length > 0) {
            ceaMulticalls.push(...hop.ceaMulticalls);
          }

          // Determine token/amount for inbound
          let tokenAddress: `0x${string}` = ZERO_ADDRESS as `0x${string}`;
          let amount = BigInt(0);
          const params = hop.params;
          if (params.funds?.amount) {
            const token = (params.funds as { token: MoveableToken }).token;
            if (token) {
              if (token.mechanism === 'native') {
                amount = params.funds.amount;
              } else {
                tokenAddress = token.address as `0x${string}`;
                amount = params.funds.amount;
                // Add approve for ERC20 (CEA approves gateway)
                const gatewayAddr = UNIVERSAL_GATEWAY_ADDRESSES[sourceChain];
                if (!gatewayAddr) {
                  throw new Error(`No UniversalGateway address configured for chain ${sourceChain}`);
                }
                const approveData = encodeFunctionData({
                  abi: ERC20_EVM,
                  functionName: 'approve',
                  args: [gatewayAddr, amount],
                });
                ceaMulticalls.push({
                  to: tokenAddress,
                  value: BigInt(0),
                  data: approveData,
                });
              }
            }
          } else if (params.value && params.value > BigInt(0)) {
            amount = params.value;
          }

          // Build sendUniversalTxToUEA self-call on CEA (to=CEA, value=0)
          const sendCall = buildSendUniversalTxToUEA(
            ceaAddress,
            tokenAddress,
            amount,
            intermediatePayload,
            ceaAddress
          );
          ceaMulticalls.push(sendCall);

          // Wrap CEA multicall in outbound from Push Chain
          const ceaPayload = buildCeaMulticallPayload(ceaMulticalls);

          const outboundReq = buildOutboundRequest(
            ceaAddress,
            segment.prc20Token || this.getNativePRC20ForChain(sourceChain),
            segment.totalBurnAmount || BigInt(1),
            segment.gasLimit ?? BigInt(0),
            ceaPayload,
            ueaAddress
          );

          const inboundGasFee = segment.gasFee || BigInt(0);
          const outboundMulticalls = buildOutboundApprovalAndCall({
            prc20Token:
              segment.prc20Token || this.getNativePRC20ForChain(sourceChain),
            gasToken: segment.gasToken || (ZERO_ADDRESS as `0x${string}`),
            burnAmount: segment.totalBurnAmount || BigInt(1),
            gasFee: inboundGasFee,
            nativeValueForGas: perOutboundNativeValue ?? inboundGasFee * BigInt(1000),
            gatewayPcAddress,
            outboundRequest: outboundReq,
          });

          // Reset accumulated -- everything is now inside this outbound
          accumulatedPushMulticalls = [...outboundMulticalls];
          break;
        }
      }
    }

    return accumulatedPushMulticalls;
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
    return {
      thenOn: (nextTx: PreparedUniversalTx) =>
        this.createCascadedBuilder([...preparedTxs, nextTx]),

      send: async (): Promise<CascadedTxResponse> => {
        const ueaAddress = this.computeUEAOffchain();

        // Extract HopDescriptors
        const hops = preparedTxs.map((tx) => tx._hop);

        // Classify into segments
        const segments = this.classifyIntoSegments(hops);

        // Check if this is a single-hop Route 1 (no composition needed)
        if (
          preparedTxs.length === 1 &&
          preparedTxs[0].route === 'UOA_TO_PUSH'
        ) {
          const response = await this.executeMultiChain(hops[0].params);
          const singleRoute1Result: CascadedTxResponse = {
            initialTxHash: response.hash,
            initialTxResponse: response,
            hops: [
              {
                hopIndex: 0,
                route: hops[0].route,
                executionChain: CHAIN.PUSH_TESTNET_DONUT,
                status: 'confirmed',
                txHash: response.hash,
              },
            ],
            hopCount: 1,
            waitForAll: async () => ({
              success: true,
              hops: [
                {
                  hopIndex: 0,
                  route: hops[0].route,
                  executionChain: CHAIN.PUSH_TESTNET_DONUT,
                  status: 'confirmed' as const,
                  txHash: response.hash,
                },
              ],
            }),
            wait: async (opts) => singleRoute1Result.waitForAll(opts),
          };
          return singleRoute1Result;
        }

        // Check if single-hop Route 2 (just execute directly)
        if (
          preparedTxs.length === 1 &&
          preparedTxs[0].route === 'UOA_TO_CEA'
        ) {
          const response = await this.executeMultiChain(hops[0].params);
          const targetChain = hops[0].targetChain || CHAIN.PUSH_TESTNET_DONUT;
          const singleRoute2Result: CascadedTxResponse = {
            initialTxHash: response.hash,
            initialTxResponse: response,
            hops: [
              {
                hopIndex: 0,
                route: hops[0].route,
                executionChain: targetChain,
                status: 'confirmed',
                txHash: response.hash,
              },
            ],
            hopCount: 1,
            waitForAll: async () => ({
              success: true,
              hops: [
                {
                  hopIndex: 0,
                  route: hops[0].route,
                  executionChain: targetChain,
                  status: 'confirmed' as const,
                  txHash: response.hash,
                },
              ],
            }),
            wait: async (opts) => singleRoute2Result.waitForAll(opts),
          };
          return singleRoute2Result;
        }

        // Multi-hop: compose cascade bottom-to-top
        // Fetch UEA balance + nonce so composeCascade can allocate native value and build inbound payloads
        const ueaBalance = await this.pushClient.getBalance(ueaAddress);
        const ueaCodeCascade = await this.pushClient.publicClient.getCode({ address: ueaAddress });
        const ueaNonceCascade = ueaCodeCascade !== undefined ? await this.getUEANonce(ueaAddress) : BigInt(0);
        const composedMulticalls = this.composeCascade(segments, ueaAddress, ueaBalance, ueaNonceCascade);

        // Execute the composed multicall as a single Push Chain tx
        const executeParams: ExecuteParams = {
          to: ueaAddress,
          data: composedMulticalls,
        };

        const response = await this.execute(executeParams);

        // Build hop info for tracking
        const hopInfos: CascadeHopInfo[] = hops.map((hop, index) => ({
          hopIndex: index,
          route: hop.route,
          executionChain:
            hop.targetChain || hop.sourceChain || CHAIN.PUSH_TESTNET_DONUT,
          status: 'pending' as const,
        }));

        // Mark first hop as submitted
        if (hopInfos.length > 0) {
          hopInfos[0].status = 'submitted';
          hopInfos[0].txHash = response.hash;
        }

        const cascadeResponse: CascadedTxResponse = {
          initialTxHash: response.hash,
          initialTxResponse: response,
          hops: hopInfos,
          hopCount: hops.length,
          waitForAll: async (
            opts?: CascadeTrackOptions
          ): Promise<CascadeCompletionResult> => {
            const {
              pollingIntervalMs = 10000,
              timeout = 300000,
              progressHook: cascadeProgressHook,
            } = opts || {};
            const startTime = Date.now();

            try {
              // 1. Wait for initial Push Chain tx confirmation
              cascadeProgressHook?.({
                hopIndex: 0,
                route: hopInfos[0]?.route || 'UOA_TO_PUSH',
                chain: CHAIN.PUSH_TESTNET_DONUT,
                status: 'waiting',
                elapsed: Date.now() - startTime,
              });

              await response.wait();

              // Mark all Push Chain (Route 1) hops as confirmed
              for (const hop of hopInfos) {
                if (hop.route === 'UOA_TO_PUSH') {
                  hop.status = 'confirmed';
                  hop.txHash = response.hash;
                  cascadeProgressHook?.({
                    hopIndex: hop.hopIndex,
                    route: hop.route,
                    chain: CHAIN.PUSH_TESTNET_DONUT,
                    status: 'confirmed',
                    txHash: response.hash,
                    elapsed: Date.now() - startTime,
                  });
                }
              }

              // 2. Track outbound hops (Route 2: UOA_TO_CEA)
              // Hops after a CEA_TO_PUSH are "child outbounds" — they execute inside
              // the inbound payload on Push Chain and live under a DIFFERENT utx_id
              // (the inbound UTX, not the parent). We can't track them via the parent
              // utx_id polling, so we auto-confirm them.
              const ceaToPushIndex = hopInfos.findIndex(
                (h) => h.route === 'CEA_TO_PUSH'
              );
              const outboundHops = hopInfos.filter((h, i) => {
                if (h.route !== 'UOA_TO_CEA') return false;
                // Child outbounds (after CEA_TO_PUSH) live under the inbound UTX,
                // not the parent — auto-confirm since we can't poll them here.
                if (ceaToPushIndex >= 0 && i > ceaToPushIndex) {
                  h.status = 'confirmed';
                  cascadeProgressHook?.({
                    hopIndex: h.hopIndex,
                    route: h.route,
                    chain: h.executionChain,
                    status: 'confirmed',
                    elapsed: Date.now() - startTime,
                  });
                  return false;
                }
                return true;
              });

              if (outboundHops.length > 0) {
                if (outboundHops.length === 1) {
                  // Single direct outbound hop: use the existing V1-based tracking
                  const hop = outboundHops[0];
                  const remainingTimeout = timeout - (Date.now() - startTime);
                  if (remainingTimeout <= 0) {
                    hop.status = 'failed';
                    cascadeProgressHook?.({
                      hopIndex: hop.hopIndex,
                      route: hop.route,
                      chain: hop.executionChain,
                      status: 'timeout',
                      elapsed: Date.now() - startTime,
                    });
                    return { success: false, hops: hopInfos, failedAt: hop.hopIndex };
                  }

                  cascadeProgressHook?.({
                    hopIndex: hop.hopIndex,
                    route: hop.route,
                    chain: hop.executionChain,
                    status: 'polling',
                    elapsed: Date.now() - startTime,
                  });

                  try {
                    const outboundDetails = await this.waitForOutboundTx(response.hash, {
                      initialWaitMs: Math.min(60000, remainingTimeout),
                      pollingIntervalMs,
                      timeout: remainingTimeout,
                      progressHook: (event) => {
                        cascadeProgressHook?.({
                          hopIndex: hop.hopIndex,
                          route: hop.route,
                          chain: hop.executionChain,
                          status: event.status as 'waiting' | 'polling' | 'found' | 'confirmed' | 'failed' | 'timeout',
                          elapsed: Date.now() - startTime,
                        });
                      },
                    });
                    hop.status = 'confirmed';
                    hop.txHash = outboundDetails.externalTxHash;
                    hop.outboundDetails = outboundDetails;
                    cascadeProgressHook?.({
                      hopIndex: hop.hopIndex,
                      route: hop.route,
                      chain: hop.executionChain,
                      status: 'confirmed',
                      txHash: outboundDetails.externalTxHash,
                      elapsed: Date.now() - startTime,
                    });
                  } catch (err) {
                    hop.status = 'failed';
                    cascadeProgressHook?.({
                      hopIndex: hop.hopIndex,
                      route: hop.route,
                      chain: hop.executionChain,
                      status: 'failed',
                      elapsed: Date.now() - startTime,
                    });
                    return { success: false, hops: hopInfos, failedAt: hop.hopIndex };
                  }
                } else {
                  // Multiple outbound hops: use V2 API which returns outboundTx[]
                  const allOutboundDetails = await this.waitForAllOutboundTxsV2(
                    response.hash,
                    outboundHops,
                    {
                      initialWaitMs: Math.min(60000, timeout - (Date.now() - startTime)),
                      pollingIntervalMs,
                      timeout: timeout - (Date.now() - startTime),
                      progressHook: (event) => {
                        cascadeProgressHook?.({
                          hopIndex: event.hopIndex,
                          route: event.route,
                          chain: event.chain,
                          status: event.status as 'waiting' | 'polling' | 'found' | 'confirmed' | 'failed' | 'timeout',
                          txHash: event.txHash,
                          elapsed: Date.now() - startTime,
                        });
                      },
                    }
                  );

                  if (!allOutboundDetails.success) {
                    return {
                      success: false,
                      hops: hopInfos,
                      failedAt: allOutboundDetails.failedAt,
                    };
                  }
                }
              }

              // 3. Route 3 (CEA_TO_PUSH) tracking - mark as submitted
              const inboundHops = hopInfos.filter(
                (h) => h.route === 'CEA_TO_PUSH'
              );
              for (const inboundHop of inboundHops) {
                inboundHop.status = 'submitted';
                cascadeProgressHook?.({
                  hopIndex: inboundHop.hopIndex,
                  route: inboundHop.route,
                  chain: inboundHop.executionChain,
                  status: 'waiting',
                  elapsed: Date.now() - startTime,
                });
              }

              return { success: true, hops: hopInfos };
            } catch (err) {
              const failedIdx = hopInfos.findIndex(
                (h) => h.status !== 'confirmed'
              );
              return {
                success: false,
                hops: hopInfos,
                failedAt: failedIdx >= 0 ? failedIdx : 0,
              };
            }
          },
          wait: async (opts?: CascadeTrackOptions) => cascadeResponse.waitForAll(opts),
        };

        return cascadeResponse;
      },
    };
  }

  /**
   * @deprecated Use createCascadedBuilder instead.
   * Creates a chained transaction builder for sequential multi-chain execution.
   *
   * @param transactions - Array of transactions to execute in sequence
   * @returns ChainedTransactionBuilder
   */
  createChainedBuilder(
    transactions: UniversalExecuteParams[]
  ): ChainedTransactionBuilder {
    return {
      thenOn: (nextTx: UniversalExecuteParams) =>
        this.createChainedBuilder([...transactions, nextTx]),
      send: async (): Promise<MultiChainTxResponse> => {
        const responses: UniversalTxResponse[] = [];

        for (let i = 0; i < transactions.length; i++) {
          const response = await this.execute(transactions[i]);
          response.hopIndex = i;

          if (i > 0 && responses[i - 1]) {
            response.parentTxHash = responses[i - 1].hash;
            responses[i - 1].childTxHash = response.hash;
          }

          responses.push(response);
        }

        return {
          transactions: responses,
          chains: responses.map((r) => ({
            chain: r.chain || CHAIN.PUSH_TESTNET_DONUT,
            hash: r.hash,
            blockNumber: r.blockNumber,
            status: 'confirmed' as const,
          })),
        };
      },
    };
  }

  /**
   * Route 2: Execute outbound transaction from Push Chain to external CEA
   *
   * This method builds a multicall that executes on Push Chain (from UEA context):
   * 1. Approves the gateway to spend PRC-20 tokens (if needed)
   * 2. Calls sendUniversalTxOutbound on UniversalGatewayPC precompile
   *
   * The multicall is executed through the normal execute() flow which handles
   * fee-locking on the origin chain and signature verification.
   *
   * @param params - Universal execution parameters with ChainTarget
   * @returns UniversalTxResponse
   */
  private async executeUoaToCea(
    params: UniversalExecuteParams
  ): Promise<UniversalTxResponse> {
    const target = params.to as ChainTarget;
    const targetChain = target.chain;
    const targetAddress = target.address;
    const isSvm = isSvmChain(targetChain);

    // Validate target address based on VM type
    if (isSvm) {
      // SVM: 32-byte hex address
      if (!isValidSolanaHexAddress(targetAddress)) {
        throw new Error(
          `Invalid Solana address: ${targetAddress}. ` +
            `Expected 0x + 64 hex chars (32 bytes).`
        );
      }
      const ZERO_32 = ('0x' + '0'.repeat(64)) as `0x${string}`;
      if (targetAddress.toLowerCase() === ZERO_32.toLowerCase()) {
        throw new Error(
          `Cannot send to zero address on Solana. ` +
            `This would result in permanent loss of funds.`
        );
      }
    } else {
      // EVM: 20-byte hex address
      // Zero address is allowed for multicall (data is array) — the actual targets are in the data entries.
      const isMulticall = Array.isArray(params.data);
      if (targetAddress.toLowerCase() === ZERO_ADDRESS.toLowerCase() && !isMulticall) {
        throw new Error(
          `Cannot send to zero address (0x0000...0000). ` +
            `This would result in permanent loss of funds.`
        );
      }
    }

    // Validate chain supports outbound operations
    if (!chainSupportsOutbound(targetChain)) {
      throw new Error(
        `Chain ${targetChain} does not support outbound operations. ` +
          `Supported chains: BNB_TESTNET, ETHEREUM_SEPOLIA, SOLANA_DEVNET, etc.`
      );
    }

    // Branch based on VM type
    if (isSvm) {
      return this.executeUoaToCeaSvm(params, target);
    }

    // ===== EVM path (existing logic) =====

    // Get UEA address
    const ueaAddress = this.computeUEAOffchain();

    this.printLog(
      `executeUoaToCea — target chain: ${targetChain}, target address: ${targetAddress}, UEA: ${ueaAddress}`
    );

    // Get CEA address for this UEA on target chain
    const { cea: ceaAddress, isDeployed: ceaDeployed } = await getCEAAddress(
      ueaAddress,
      targetChain,
      this.rpcUrls[targetChain]?.[0]
    );

    this.printLog(
      `executeUoaToCea — CEA address: ${ceaAddress}, deployed: ${ceaDeployed}`
    );

    // Migration path: raw MIGRATION_SELECTOR payload, no multicall wrapping
    let ceaPayload: `0x${string}`;
    let prc20Token: `0x${string}` = ZERO_ADDRESS as `0x${string}`;
    let burnAmount = BigInt(0);

    if (params.migration) {
      ceaPayload = buildMigrationPayload();
      prc20Token = this.getNativePRC20ForChain(targetChain);
      burnAmount = BigInt(0); // Migration is logic-only — no funds. CEA rejects msg.value != 0.
      this.printLog(
        `executeUoaToCea — MIGRATION: using raw MIGRATION_SELECTOR payload (${ceaPayload}), native PRC-20 ${prc20Token}`
      );
    } else {
      // Build multicall for CEA execution on target chain
      const ceaMulticalls: MultiCall[] = [];

      // If there's data to execute on target
      if (params.data) {
        if (Array.isArray(params.data)) {
          // User provided explicit multicall array
          ceaMulticalls.push(...(params.data as MultiCall[]));
        } else {
          // When ERC-20 funds are provided with a single payload, auto-prepend a
          // transfer() call so the tokens minted to the CEA are forwarded to the
          // target address. This mirrors the Route 1 behavior in buildExecuteMulticall.
          if (params.funds?.amount) {
            const token = (params.funds as { token: MoveableToken }).token;
            if (token && token.mechanism !== 'native') {
              const erc20Transfer = encodeFunctionData({
                abi: ERC20_EVM,
                functionName: 'transfer',
                args: [targetAddress, params.funds.amount],
              });
              ceaMulticalls.push({
                to: token.address as `0x${string}`,
                value: BigInt(0),
                data: erc20Transfer,
              });
            }
          }
          // Single call with data. Forward native value (if any) so the target
          // contract receives it alongside the payload call. The vault deposits
          // native value to the CEA, and the multicall forwards it to the target.
          ceaMulticalls.push({
            to: targetAddress,
            value: params.value ?? BigInt(0),
            data: params.data as `0x${string}`,
          });
        }
      } else if (params.value) {
        // Native value transfer only.
        // If sending to the CEA itself, skip the multicall — the gateway deposits native
        // value directly to CEA. A self-call with value would revert (CEA._handleMulticall
        // rejects value-bearing self-calls).
        if (targetAddress.toLowerCase() !== ceaAddress.toLowerCase()) {
          ceaMulticalls.push({
            to: targetAddress,
            value: params.value,
            data: '0x',
          });
        }
      }

      // Build CEA multicall payload (this is what gets executed on the external chain)
      ceaPayload = buildCeaMulticallPayload(ceaMulticalls);

      // Determine token to burn on Push Chain
      // NOTE: Even for PAYLOAD-only (no value), we need a valid PRC-20 token to:
      // 1. Look up the target chain namespace in the gateway
      // 2. Query and pay gas fees for the relay
      if (params.funds?.amount) {
        // User explicitly specified funds with token
        const token = (params.funds as { token: MoveableToken }).token;
        if (token) {
          prc20Token = PushChain.utils.tokens.getPRC20Address(token);
          burnAmount = params.funds.amount;
        }
      } else if (params.value && params.value > BigInt(0)) {
        // Native value transfer: auto-select the PRC-20 token for target chain
        prc20Token = this.getNativePRC20ForChain(targetChain);
        burnAmount = params.value;
        this.printLog(
          `executeUoaToCea — auto-selected native PRC-20 ${prc20Token} for chain ${targetChain}, amount: ${burnAmount.toString()}`
        );
      } else if (params.data) {
        // PAYLOAD-only (no value transfer): still need native token for chain namespace + gas fees
        prc20Token = this.getNativePRC20ForChain(targetChain);
        burnAmount = BigInt(0);
        this.printLog(
          `executeUoaToCea — PAYLOAD-only: using native PRC-20 ${prc20Token} for chain ${targetChain} with zero burn amount`
        );
      }
    }

    // Build outbound request struct for the gateway
    // NOTE: `target` is a LEGACY/DUMMY parameter for contract compatibility.
    // The deployed UniversalGatewayPC still expects this field, but the relay does NOT use it
    // to determine the actual destination. The relay determines destination from the PRC-20 token's
    // SOURCE_CHAIN_NAMESPACE. We pass the CEA address as a non-zero placeholder.
    // This field will be removed in future contract upgrades.
    const targetBytes = ceaAddress; // Dummy value - any non-zero address works

    const outboundReq: UniversalOutboundTxRequest = buildOutboundRequest(
      targetBytes,
      prc20Token,
      burnAmount,
      params.gasLimit ?? BigInt(0),
      ceaPayload,
      ueaAddress // revert recipient is the UEA
    );

    this.printLog(
      `executeUoaToCea — outbound request: ${JSON.stringify(
        {
          target: outboundReq.target,
          token: outboundReq.token,
          amount: outboundReq.amount.toString(),
          gasLimit: outboundReq.gasLimit.toString(),
          payloadLength: outboundReq.payload.length,
          revertRecipient: outboundReq.revertRecipient,
        },
        null,
        2
      )}`
    );

    // Get UniversalGatewayPC address
    const gatewayPcAddress = this.getUniversalGatewayPCAddress();

    // Pre-fetch UEA status early — balance is needed for gas value calculation
    const [ueaCode, ueaBalance] = await Promise.all([
      this.pushClient.publicClient.getCode({ address: ueaAddress }),
      this.pushClient.getBalance(ueaAddress),
    ]);
    const isUEADeployed = ueaCode !== undefined;
    if (!isUEADeployed) {
      throw new Error(
        'UEA is not deployed. Please send an inbound transaction to Push Chain first ' +
        '(e.g. sendTransaction with value) to deploy your Universal Execution Account before using outbound transfers.'
      );
    }
    const ueaNonce = await this.getUEANonce(ueaAddress);

    // Build the multicall that will execute ON Push Chain from UEA context
    // This includes: 1) approve PRC-20 (if needed), 2) call sendUniversalTxOutbound
    const pushChainMulticalls: MultiCall[] = [];

    // Query gas fee from UniversalCore contract (needed for approval amount)
    let gasFee = BigInt(0);
    let nativeValueForGas = BigInt(0);
    let gasToken: `0x${string}` = ZERO_ADDRESS as `0x${string}`;
    if (prc20Token !== (ZERO_ADDRESS as `0x${string}`)) {
      try {
        const result = await this.queryOutboundGasFee(prc20Token, outboundReq.gasLimit);
        gasFee = result.gasFee;
        gasToken = result.gasToken;
        nativeValueForGas = result.nativeValueForGas;
        this.printLog(
          `executeUoaToCea — queried gas fee: ${gasFee.toString()}, gasToken: ${gasToken}, nativeValueForGas: ${nativeValueForGas.toString()}`
        );
      } catch (err) {
        throw new Error(`Failed to query outbound gas fee: ${err}`);
      }
    }

    // Adjust nativeValueForGas: the 1Mx multiplier from queryOutboundGasFee produces
    // a value far too low for the actual WPC/gasToken swap price. Set it to 200 UPC
    // (capped by balance) — enough for the swap, but avoids draining thin pools.
    // The contract's swapAndBurnGas does exactOutputSingle and refunds excess PC.
    const EVM_NATIVE_VALUE_TARGET = BigInt(200e18); // 200 UPC
    const EVM_GAS_RESERVE = BigInt(3e18); // 3 UPC for tx overhead
    const currentBalance = await this.pushClient.getBalance(ueaAddress);

    let adjustedValue: bigint;
    if (currentBalance > EVM_NATIVE_VALUE_TARGET + EVM_GAS_RESERVE) {
      // Enough balance: use 200 UPC target
      adjustedValue = EVM_NATIVE_VALUE_TARGET;
    } else if (currentBalance > EVM_GAS_RESERVE) {
      // Low balance: use what's available minus reserve
      adjustedValue = currentBalance - EVM_GAS_RESERVE;
    } else {
      // Very low balance: use original query value as-is
      adjustedValue = nativeValueForGas;
    }

    if (adjustedValue !== nativeValueForGas) {
      this.printLog(
        `executeUoaToCea — adjusting nativeValueForGas from ${nativeValueForGas.toString()} to ${adjustedValue.toString()} (UEA balance: ${currentBalance.toString()})`
      );
      nativeValueForGas = adjustedValue;
    }

    // Build outbound multicalls (approve burn + sendUniversalTxOutbound with native value)
    const outboundMulticalls = buildOutboundApprovalAndCall({
      prc20Token,
      gasToken,
      burnAmount,
      gasFee,
      nativeValueForGas,
      gatewayPcAddress,
      outboundRequest: outboundReq,
    });
    pushChainMulticalls.push(...outboundMulticalls);

    this.printLog(
      `executeUoaToCea — Push Chain multicall has ${pushChainMulticalls.length} operations`
    );

    // TODO: Enable pre-flight balance checks once outbound flow is stable
    // if (burnAmount > BigInt(0)) {
    //   const prc20Balance = await this.pushClient.publicClient.readContract({
    //     address: prc20Token,
    //     abi: [{ name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] }],
    //     functionName: 'balanceOf',
    //     args: [ueaAddress],
    //   }) as bigint;
    //   if (prc20Balance < burnAmount) {
    //     throw new Error(
    //       `Insufficient PRC-20 token balance on UEA. ` +
    //       `Required: ${burnAmount.toString()}, Available: ${prc20Balance.toString()}, ` +
    //       `Token: ${prc20Token}, UEA: ${ueaAddress}. ` +
    //       `Please bridge tokens to Push Chain first.`
    //     );
    //   }
    // }
    // const currentUeaBalance = await this.pushClient.getBalance(ueaAddress);
    // if (currentUeaBalance < nativeValueForGas) {
    //   throw new Error(
    //     `Insufficient native balance on UEA for outbound gas. ` +
    //     `Required: ${nativeValueForGas.toString()} wei, Available: ${currentUeaBalance.toString()} wei, ` +
    //     `UEA: ${ueaAddress}. Please send UPC to your UEA first.`
    //   );
    // }

    // Execute through the normal execute() flow
    // This handles fee-locking on origin chain and executes the multicall from UEA context
    // Sum native values from multicall entries for proper fee calculation
    const multicallNativeValue = pushChainMulticalls.reduce(
      (sum, mc) => sum + (mc.value ?? BigInt(0)),
      BigInt(0)
    );

    const executeParams: ExecuteParams = {
      to: ueaAddress, // multicall executes from UEA
      value: multicallNativeValue, // ensures correct requiredFunds calculation
      data: pushChainMulticalls, // array triggers multicall mode
      _ueaStatus: {
        isDeployed: isUEADeployed,
        nonce: ueaNonce,
        balance: ueaBalance,
      },
      _skipFeeLocking: true, // outbound executes on Push Chain, no external fee locking
    };

    const response = await this.execute(executeParams);

    // Add chain info to response
    response.chain = targetChain;
    response.chainNamespace = this.getChainNamespace(targetChain);

    return response;
  }

  /**
   * Route 2 for SVM targets: Outbound from Push Chain to Solana.
   *
   * Three cases:
   * 1. Withdraw SOL: Burn pSOL on Push Chain, recipient gets native SOL
   * 2. Withdraw SPL: Burn PRC-20 on Push Chain, recipient gets SPL token
   * 3. Execute (CPI): Burn pSOL + execute CPI on target Solana program
   *
   * @param params - Universal execution parameters
   * @param target - ChainTarget with Solana chain and hex address
   * @returns UniversalTxResponse
   */
  private async executeUoaToCeaSvm(
    params: UniversalExecuteParams,
    target: ChainTarget
  ): Promise<UniversalTxResponse> {
    const targetChain = target.chain;
    const targetAddress = target.address; // 0x-prefixed, 32 bytes
    const ueaAddress = this.computeUEAOffchain();
    const hasSvmExecute = !!params.svmExecute;

    this.printLog(
      `executeUoaToCeaSvm — target: ${targetAddress}, chain: ${targetChain}, ` +
        `hasSvmExecute: ${hasSvmExecute}, value: ${params.value?.toString() ?? '0'}`
    );

    // --- Build SVM payload ---
    let svmPayload: `0x${string}` = '0x'; // empty for withdraw (SOL/SPL)

    if (hasSvmExecute) {
      // Execute case: encode the CPI payload
      const exec = params.svmExecute!;
      svmPayload = encodeSvmExecutePayload({
        targetProgram: exec.targetProgram,
        accounts: exec.accounts,
        ixData: exec.ixData,
        instructionId: 2,
      });

      this.printLog(
        `executeUoaToCeaSvm — encoded execute payload: ${(svmPayload.length - 2) / 2} bytes, ` +
          `${exec.accounts.length} accounts`
      );
    }

    // --- Determine PRC-20 token and burn amount ---
    let prc20Token: `0x${string}` = ZERO_ADDRESS as `0x${string}`;
    let burnAmount = BigInt(0);

    if (params.funds?.amount) {
      // User explicitly specified funds with token
      const token = (params.funds as { token: MoveableToken }).token;
      if (token) {
        prc20Token = PushChain.utils.tokens.getPRC20Address(token);
        burnAmount = params.funds.amount;
      }
    } else if (params.value && params.value > BigInt(0)) {
      // Native value transfer: auto-select pSOL for Solana chains
      prc20Token = this.getNativePRC20ForChain(targetChain);
      burnAmount = params.value;
      this.printLog(
        `executeUoaToCeaSvm — auto-selected native PRC-20 ${prc20Token} for chain ${targetChain}, amount: ${burnAmount.toString()}`
      );
    } else if (hasSvmExecute) {
      // Execute-only (no value): check if user specified an SPL token context
      const token = params.funds && (params.funds as { token: MoveableToken }).token;
      if (token) {
        prc20Token = PushChain.utils.tokens.getPRC20Address(token);
      } else {
        prc20Token = this.getNativePRC20ForChain(targetChain);
      }
      burnAmount = BigInt(0);
      this.printLog(
        `executeUoaToCeaSvm — EXECUTE-only: using PRC-20 ${prc20Token} with zero burn amount`
      );
    }

    // --- Determine target bytes ---
    // For withdraw: target is the Solana recipient pubkey
    // For execute: target is the target Solana program
    const targetBytes = hasSvmExecute
      ? params.svmExecute!.targetProgram
      : targetAddress;

    // --- Build outbound request ---
    const outboundReq: UniversalOutboundTxRequest = buildOutboundRequest(
      targetBytes,
      prc20Token,
      burnAmount,
      params.gasLimit ?? BigInt(0),
      svmPayload,
      ueaAddress // revert recipient is the UEA
    );

    this.printLog(
      `executeUoaToCeaSvm — outbound request: ${JSON.stringify(
        {
          target: outboundReq.target,
          token: outboundReq.token,
          amount: outboundReq.amount.toString(),
          gasLimit: outboundReq.gasLimit.toString(),
          payloadLength: (outboundReq.payload.length - 2) / 2,
          revertRecipient: outboundReq.revertRecipient,
        },
        null,
        2
      )}`
    );

    // --- Pre-fetch UEA status early — balance is needed for gas value calculation ---
    const gatewayPcAddress = this.getUniversalGatewayPCAddress();
    const [ueaCode, ueaBalance] = await Promise.all([
      this.pushClient.publicClient.getCode({ address: ueaAddress }),
      this.pushClient.getBalance(ueaAddress),
    ]);
    const isUEADeployed = ueaCode !== undefined;
    if (!isUEADeployed) {
      throw new Error(
        'UEA is not deployed. Please send an inbound transaction to Push Chain first ' +
        '(e.g. sendTransaction with value) to deploy your Universal Execution Account before using outbound transfers.'
      );
    }
    const ueaNonce = await this.getUEANonce(ueaAddress);

    // --- Query gas fee (identical to EVM path) ---
    let gasFee = BigInt(0);
    let gasToken: `0x${string}` = ZERO_ADDRESS as `0x${string}`;

    let nativeValueForGas = BigInt(0);
    if (prc20Token !== (ZERO_ADDRESS as `0x${string}`)) {
      const gasLimit = outboundReq.gasLimit;
      try {
        const result = await this.queryOutboundGasFee(prc20Token, gasLimit);
        gasFee = result.gasFee;
        gasToken = result.gasToken;
        nativeValueForGas = result.nativeValueForGas;
        // When user omits gasLimit (sent as 0), the contract computes fees using its internal
        // baseGasLimitByChainNamespace. But the relay reads the stored gasLimit=0 from the
        // on-chain outbound record and uses it as the Solana compute budget — 0 CU means the
        // relay cannot execute the tx. Derive the effective limit from gasFee/gasPrice so
        // the stored record has a non-zero compute budget the relay can use.
        if (!params.gasLimit && result.gasPrice > BigInt(0)) {
          outboundReq.gasLimit = result.gasFee / result.gasPrice;
          this.printLog(
            `executeUoaToCeaSvm — derived effectiveGasLimit: ${outboundReq.gasLimit} (gasFee=${result.gasFee} / gasPrice=${result.gasPrice})`
          );
        }
        this.printLog(
          `executeUoaToCeaSvm — queried gas fee: ${gasFee.toString()}, gasToken: ${gasToken}, nativeValueForGas: ${nativeValueForGas.toString()}`
        );
      } catch (err) {
        throw new Error(`Failed to query outbound gas fee: ${err}`);
      }
    }

    // Adjust nativeValueForGas: the 1Mx multiplier from queryOutboundGasFee produces
    // a value far too low for the actual WPC/gasToken swap price. Set it to 200 UPC
    // (capped by balance) — enough for the swap, but avoids draining thin pools.
    // The contract's swapAndBurnGas does exactOutputSingle and refunds excess PC.
    const SVM_NATIVE_VALUE_TARGET = BigInt(200e18); // 200 UPC
    const SVM_GAS_RESERVE = BigInt(3e18); // 3 UPC for tx overhead
    const currentBalance = await this.pushClient.getBalance(ueaAddress);

    let adjustedValue: bigint;
    if (currentBalance > SVM_NATIVE_VALUE_TARGET + SVM_GAS_RESERVE) {
      // Enough balance: use 200 UPC target
      adjustedValue = SVM_NATIVE_VALUE_TARGET;
    } else if (currentBalance > SVM_GAS_RESERVE) {
      // Low balance: use what's available minus reserve
      adjustedValue = currentBalance - SVM_GAS_RESERVE;
    } else {
      // Very low balance: use original query value as-is
      adjustedValue = nativeValueForGas;
    }

    if (adjustedValue !== nativeValueForGas) {
      this.printLog(
        `executeUoaToCeaSvm — adjusting nativeValueForGas from ${nativeValueForGas.toString()} to ${adjustedValue.toString()} (UEA balance: ${currentBalance.toString()})`
      );
      nativeValueForGas = adjustedValue;
    }

    // --- Build Push Chain multicalls (approve + sendUniversalTxOutbound) ---
    // Reuse the same builder as EVM — this part is identical
    const pushChainMulticalls: MultiCall[] = buildOutboundApprovalAndCall({
      prc20Token,
      gasToken,
      burnAmount,
      gasFee,
      nativeValueForGas,
      gatewayPcAddress,
      outboundRequest: outboundReq,
    });

    this.printLog(
      `executeUoaToCeaSvm — Push Chain multicall has ${pushChainMulticalls.length} operations`
    );

    // Sum native values from multicall entries for proper fee calculation
    const multicallNativeValue = pushChainMulticalls.reduce(
      (sum, mc) => sum + (mc.value ?? BigInt(0)),
      BigInt(0)
    );

    const executeParams: ExecuteParams = {
      to: ueaAddress,
      value: multicallNativeValue, // ensures correct requiredFunds calculation
      data: pushChainMulticalls,
      _ueaStatus: {
        isDeployed: isUEADeployed,
        nonce: ueaNonce,
        balance: ueaBalance,
      },
      _skipFeeLocking: true, // outbound executes on Push Chain, no external fee locking
    };

    const response = await this.execute(executeParams);

    // Add chain info to response
    response.chain = targetChain;
    response.chainNamespace = this.getChainNamespace(targetChain);

    return response;
  }

  /**
   * Route 3: Execute inbound transaction from CEA to Push Chain
   *
   * This route instructs CEA on an external chain to call sendUniversalTxFromCEA,
   * bridging funds/payloads back to Push Chain.
   *
   * Flow:
   * 1. Build multicall for CEA: [approve Gateway (if ERC20), sendUniversalTxFromCEA]
   * 2. Execute via Route 2 (UOA → CEA) with PAYLOAD-only (CEA uses its own funds)
   * 3. CEA executes multicall, Gateway locks funds, relayer mints PRC-20 on Push Chain
   *
   * @param params - Universal execution parameters with from.chain specified
   * @returns UniversalTxResponse
   */
  private async executeCeaToPush(
    params: UniversalExecuteParams
  ): Promise<UniversalTxResponse> {
    // 1. Validate and extract source chain
    if (!params.from?.chain) {
      throw new Error('Route 3 (CEA → Push) requires from.chain to specify the source CEA chain');
    }
    const sourceChain = params.from.chain;

    // SVM chains use a fundamentally different flow (gateway self-call, not CEA multicall)
    if (isSvmChain(sourceChain)) {
      return this.executeCeaToPushSvm(params, sourceChain);
    }

    // 2. Extract destination on Push Chain
    // For Route 3, 'to' is a Push Chain address (string), not a ChainTarget
    const pushDestination = params.to as `0x${string}`;
    if (typeof params.to !== 'string') {
      throw new Error('Route 3 (CEA → Push): to must be a Push Chain address (string), not a ChainTarget');
    }

    // 3. Get UEA address (will be recipient on Push Chain from CEA's perspective)
    const ueaAddress = this.computeUEAOffchain();

    // 4. Get CEA address on source chain
    const { cea: ceaAddress, isDeployed: ceaDeployed } = await getCEAAddress(
      ueaAddress,
      sourceChain,
      this.rpcUrls[sourceChain]?.[0]
    );

    this.printLog(`executeCeaToPush — sourceChain: ${sourceChain}, CEA: ${ceaAddress}, deployed: ${ceaDeployed}`);

    if (!ceaDeployed) {
      throw new Error(
        `CEA not deployed on ${sourceChain}. ` +
          `Deploy CEA first using Route 2 (UOA → CEA) before using Route 3.`
      );
    }

    // 5. Get UniversalGateway address on source chain
    const gatewayAddress = UNIVERSAL_GATEWAY_ADDRESSES[sourceChain];
    if (!gatewayAddress) {
      throw new Error(`No UniversalGateway address configured for chain ${sourceChain}`);
    }

    // 6. Build multicall for CEA to execute on source chain (self-calls via sendUniversalTxToUEA)
    const ceaMulticalls: MultiCall[] = [];

    // Determine token and amount for sendUniversalTxToUEA
    let tokenAddress: `0x${string}` = ZERO_ADDRESS as `0x${string}`;
    let amount = BigInt(0);

    if (params.funds?.amount) {
      // ERC20 token transfer from CEA
      const token = (params.funds as { token: MoveableToken }).token;
      if (token) {
        if (token.mechanism === 'native') {
          // Native token (e.g., BNB on BSC)
          tokenAddress = ZERO_ADDRESS as `0x${string}`;
          amount = params.funds.amount;
        } else {
          // ERC20 token - need approval for gateway before sendUniversalTxToUEA
          tokenAddress = token.address as `0x${string}`;
          amount = params.funds.amount;
        }
      }
    } else if (params.value && params.value > BigInt(0)) {
      // Native value transfer (e.g., BNB, ETH)
      tokenAddress = ZERO_ADDRESS as `0x${string}`;
      amount = params.value;
    }

    // bridgeAmount = only the burn amount (what the Vault will actually deposit to CEA).
    // Previously this included ceaExistingBalance (CEA's pre-existing balance on the
    // external chain), but that approach is racy: the balance can change between the SDK
    // query and relay execution, causing sendUniversalTxToUEA to revert with
    // InsufficientBalance. Pre-existing CEA funds remain parked and can be swept separately.
    let bridgeAmount = amount;
    // Note: CEA contract may reject amount=0 in sendUniversalTxToUEA.
    // Keeping bridgeAmount as-is (0) for payload-only to test precompile behavior.

    // For ERC20 tokens, add approve call for the bridge amount
    // (CEA approves gateway to spend the Vault-deposited amount)
    if (tokenAddress !== (ZERO_ADDRESS as `0x${string}`) && bridgeAmount > BigInt(0)) {
      const approveData = encodeFunctionData({
        abi: ERC20_EVM,
        functionName: 'approve',
        args: [gatewayAddress, bridgeAmount],
      });
      ceaMulticalls.push({
        to: tokenAddress,
        value: BigInt(0),
        data: approveData,
      });
    }

    // Pre-fetch UEA nonce — needed for the inbound UniversalPayload struct
    const ueaCode = await this.pushClient.publicClient.getCode({ address: ueaAddress });
    const isUEADeployed = ueaCode !== undefined;
    const ueaNonce = isUEADeployed ? await this.getUEANonce(ueaAddress) : BigInt(0);

    // Build payload for Push Chain execution (if any)
    // This is what happens AFTER funds arrive on Push Chain.
    // The relay expects a full UniversalPayload struct (to, value, data, gasLimit, ...),
    // where `data` contains the multicall payload (with UEA_MULTICALL_SELECTOR prefix).
    let pushPayload: `0x${string}` = '0x';
    if (params.data) {
      const multicallData = buildExecuteMulticall({
        execute: {
          to: pushDestination,
          value: params.value,
          data: params.data,
        },
        ueaAddress,
      });
      const multicallPayload = this._buildMulticallPayloadData(pushDestination, multicallData);
      // Use ueaNonce + 1: the outbound tx itself consumes one nonce via execute(),
      // so the inbound will arrive when the UEA nonce is already incremented.
      pushPayload = buildInboundUniversalPayload(multicallPayload, { nonce: ueaNonce + BigInt(1) });
    }

    // Build sendUniversalTxToUEA self-call on CEA
    // CEA multicall: to=CEA (self-call), value=0
    // CEA internally calls gateway.sendUniversalTxFromCEA(...)
    // Uses bridgeAmount (= burn amount deposited by Vault)
    const sendUniversalTxCall = buildSendUniversalTxToUEA(
      ceaAddress,     // to: CEA address (self-call)
      tokenAddress,   // token: address(0) for native, ERC20 address otherwise
      bridgeAmount,   // amount: burn amount only (Vault-deposited)
      pushPayload,    // payload: Push Chain execution payload
      ueaAddress      // revertRecipient: UEA on Push Chain (receives refund if inbound fails)
    );
    ceaMulticalls.push(sendUniversalTxCall);

    // 7. Encode CEA multicalls into outbound payload
    // CEA will self-execute this multicall (to=CEA, value=0)
    const ceaPayload = buildCeaMulticallPayload(ceaMulticalls);

    this.printLog(
      `executeCeaToPush — CEA payload (first 100 chars): ${ceaPayload.slice(0, 100)}...`
    );

    // 8. Determine PRC-20 token for the outbound burn on Push Chain.
    // For ERC20 flows (params.funds with token), use the token's PRC-20 (e.g. pUSDT)
    // so the Vault deposits ERC20 to CEA. For native flows, use the chain's native PRC-20 (e.g. pBNB).
    let prc20Token: `0x${string}`;
    if (params.funds?.amount && (params.funds as { token: MoveableToken }).token) {
      const token = (params.funds as { token: MoveableToken }).token;
      prc20Token = PushChain.utils.tokens.getPRC20Address(token);
    } else {
      prc20Token = this.getNativePRC20ForChain(sourceChain);
    }
    // burnAmount = PRC20 to burn on Push Chain (NOT the bridge amount).
    // Vault deposits burnAmount to CEA. CEA uses burnAmount + pre-existing balance for the bridge.
    const burnAmount = amount;

    this.printLog(
      `executeCeaToPush — prc20Token: ${prc20Token}, burnAmount: ${burnAmount.toString()}`
    );

    // 9. Build outbound request (same structure as Route 2)
    // target = CEA address (for self-execution), value = 0 in payload
    const outboundReq: UniversalOutboundTxRequest = buildOutboundRequest(
      ceaAddress,              // target: CEA address (to=CEA for self-execution)
      prc20Token,              // token: native PRC-20 for source chain (for namespace lookup)
      burnAmount,              // amount: 1 wei (precompile workaround)
      params.gasLimit ?? BigInt(0),
      ceaPayload,              // payload: ABI-encoded CEA multicall
      ueaAddress               // revertRecipient: UEA
    );

    this.printLog(
      `executeCeaToPush — outbound request: ${JSON.stringify(
        {
          target: outboundReq.target,
          token: outboundReq.token,
          amount: outboundReq.amount.toString(),
          gasLimit: outboundReq.gasLimit.toString(),
          payloadLength: outboundReq.payload.length,
          revertRecipient: outboundReq.revertRecipient,
        },
        null,
        2
      )}`
    );

    // 10. Fetch UEA balance — needed for gas value calculation
    // (UEA code + nonce already fetched above for the inbound UniversalPayload)
    const gatewayPcAddress = this.getUniversalGatewayPCAddress();
    const ueaBalance = await this.pushClient.getBalance(ueaAddress);

    // 11. Query gas fees from UniversalCore
    let gasFee = BigInt(0);
    let nativeValueForGas = BigInt(0);
    let gasToken: `0x${string}` = ZERO_ADDRESS as `0x${string}`;
    if (prc20Token !== (ZERO_ADDRESS as `0x${string}`)) {
      const gasLimit = outboundReq.gasLimit;
      try {
        const result = await this.queryOutboundGasFee(prc20Token, gasLimit);
        gasToken = result.gasToken;
        gasFee = result.gasFee;
        nativeValueForGas = result.nativeValueForGas;
        this.printLog(
          `executeCeaToPush — queried gas fee: ${gasFee.toString()}, gasToken: ${gasToken}, nativeValueForGas: ${nativeValueForGas.toString()}`
        );
      } catch (err) {
        throw new Error(`Failed to query outbound gas fee for Route 3: ${err}`);
      }
    }

    // Adjust nativeValueForGas using UEA balance (contract refunds excess)
    // Re-fetch balance to minimize staleness from gas fee query RPC roundtrips
    const currentBalance = await this.pushClient.getBalance(ueaAddress);
    // Cosmos-EVM tx overhead costs ~1 PC per operation; 3 PC covers approve(s) + buffer.
    const OUTBOUND_GAS_RESERVE_R3 = BigInt(3e18);
    if (currentBalance > OUTBOUND_GAS_RESERVE_R3 && currentBalance - OUTBOUND_GAS_RESERVE_R3 > nativeValueForGas) {
      const adjustedValue = currentBalance - OUTBOUND_GAS_RESERVE_R3;
      this.printLog(
        `executeCeaToPush — adjusting nativeValueForGas from ${nativeValueForGas.toString()} to ${adjustedValue.toString()} (UEA balance: ${currentBalance.toString()})`
      );
      nativeValueForGas = adjustedValue;
    }

    // 12. Build Push Chain multicalls (approvals + sendUniversalTxOutbound)
    const pushChainMulticalls: MultiCall[] = buildOutboundApprovalAndCall({
      prc20Token,
      gasToken,
      burnAmount,
      gasFee,
      nativeValueForGas,
      gatewayPcAddress,
      outboundRequest: outboundReq,
    });

    this.printLog(
      `executeCeaToPush — Push Chain multicall has ${pushChainMulticalls.length} operations`
    );

    // Sum native values from multicall entries for proper fee calculation
    const multicallNativeValue = pushChainMulticalls.reduce(
      (sum, mc) => sum + (mc.value ?? BigInt(0)),
      BigInt(0)
    );

    // 13. Execute through the normal execute() flow
    const executeParams: ExecuteParams = {
      to: ueaAddress,
      value: multicallNativeValue, // ensures correct requiredFunds calculation
      data: pushChainMulticalls,
      _ueaStatus: {
        isDeployed: isUEADeployed,
        nonce: ueaNonce,
        balance: ueaBalance,
      },
      _skipFeeLocking: true, // outbound executes on Push Chain, no external fee locking
    };

    const response = await this.execute(executeParams);

    // Add Route 3 context to response
    response.chain = sourceChain;
    const chainInfo = CHAIN_INFO[sourceChain];
    response.chainNamespace = `${VM_NAMESPACE[chainInfo.vm]}:${chainInfo.chainId}`;

    return response;
  }

  /**
   * Route 3 SVM: Execute CEA-to-Push for Solana chains.
   *
   * Unlike EVM Route 3 which builds CEA multicalls, SVM Route 3 encodes a
   * `send_universal_tx_to_uea` instruction as an execute payload targeting
   * the SVM gateway program (self-call). The drain amount is embedded in
   * the instruction data, not in the outbound request amount.
   */
  private async executeCeaToPushSvm(
    params: UniversalExecuteParams,
    sourceChain: CHAIN
  ): Promise<UniversalTxResponse> {
    if (typeof params.to !== 'string') {
      throw new Error('Route 3 SVM (CEA → Push): to must be a Push Chain address (string), not a ChainTarget');
    }

    const ueaAddress = this.computeUEAOffchain();

    // Get gateway program ID from chain config and convert to 0x-hex 32 bytes
    const lockerContract = CHAIN_INFO[sourceChain].lockerContract;
    if (!lockerContract) {
      throw new Error(`No SVM gateway program configured for chain ${sourceChain}`);
    }
    const programPk = new PublicKey(lockerContract);
    const gatewayProgramHex = ('0x' + Buffer.from(programPk.toBytes()).toString('hex')) as `0x${string}`;

    this.printLog(`executeCeaToPushSvm — sourceChain: ${sourceChain}, gateway: ${lockerContract}`);

    // Determine drain amount and token
    let drainAmount = BigInt(0);
    let tokenMintHex: `0x${string}` | undefined;
    let prc20Token: `0x${string}`;

    if (params.funds?.amount && params.funds.amount > BigInt(0)) {
      // SPL token drain
      drainAmount = params.funds.amount;
      const token = (params.funds as { token: MoveableToken }).token;
      if (token && token.address) {
        // Convert SPL mint address to 32-byte hex
        const mintPk = new PublicKey(token.address);
        tokenMintHex = ('0x' + Buffer.from(mintPk.toBytes()).toString('hex')) as `0x${string}`;
        prc20Token = PushChain.utils.tokens.getPRC20Address(token);
      } else {
        prc20Token = this.getNativePRC20ForChain(sourceChain);
      }
    } else if (params.value && params.value > BigInt(0)) {
      // Native SOL drain
      drainAmount = params.value;
      prc20Token = this.getNativePRC20ForChain(sourceChain);
    } else {
      // Payload-only Route 3 SVM: no funds to drain, just execute data on Push Chain
      drainAmount = BigInt(0);
      prc20Token = this.getNativePRC20ForChain(sourceChain);
    }

    // Build the SVM CPI payload (send_universal_tx_to_uea wrapped in execute)
    // If params.data is provided, pass it as extraPayload for Push Chain execution
    let extraPayload: Uint8Array | undefined;
    if (params.data && typeof params.data === 'string') {
      extraPayload = hexToBytes(params.data as `0x${string}`);
    }

    // Derive CEA PDA as revert recipient: ["push_identity", ueaAddress_20_bytes]
    const ueaBytes = Buffer.from(ueaAddress.slice(2), 'hex'); // 20 bytes
    const [ceaPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('push_identity'), ueaBytes],
      programPk
    );
    const ceaPdaHex = ('0x' + Buffer.from(ceaPda.toBytes()).toString('hex')) as `0x${string}`;

    const svmPayload = encodeSvmCeaToUeaPayload({
      gatewayProgramHex,
      drainAmount,
      tokenMintHex,
      extraPayload,
      revertRecipientHex: ceaPdaHex,
    });

    this.printLog(
      `executeCeaToPushSvm — drainAmount: ${drainAmount.toString()}, payload length: ${(svmPayload.length - 2) / 2} bytes`
    );

    // burnAmount = 1 (minimum for precompile; drain amount lives inside the ixData)
    // The precompile rejects amount=0, so we use BigInt(1) as a workaround.
    const burnAmount = BigInt(1);

    // Build outbound request: target = gateway program (self-call)
    const outboundReq: UniversalOutboundTxRequest = buildOutboundRequest(
      gatewayProgramHex,
      prc20Token,
      burnAmount,
      params.gasLimit ?? BigInt(0),
      svmPayload,
      ueaAddress
    );

    this.printLog(
      `executeCeaToPushSvm — outbound request: target=${outboundReq.target.slice(0, 20)}..., token=${outboundReq.token}`
    );

    // Pre-fetch UEA status early — balance is needed for gas value calculation
    const gatewayPcAddress = this.getUniversalGatewayPCAddress();
    const [ueaCode, ueaBalance] = await Promise.all([
      this.pushClient.publicClient.getCode({ address: ueaAddress }),
      this.pushClient.getBalance(ueaAddress),
    ]);
    const isUEADeployed = ueaCode !== undefined;
    const ueaNonce = isUEADeployed ? await this.getUEANonce(ueaAddress) : BigInt(0);

    // Query gas fees
    let gasFee = BigInt(0);
    let nativeValueForGas = BigInt(0);
    let gasToken: `0x${string}` = ZERO_ADDRESS as `0x${string}`;
    if (prc20Token !== (ZERO_ADDRESS as `0x${string}`)) {
      try {
        const result = await this.queryOutboundGasFee(prc20Token, outboundReq.gasLimit);
        gasToken = result.gasToken;
        gasFee = result.gasFee;
        nativeValueForGas = result.nativeValueForGas;
        this.printLog(`executeCeaToPushSvm — gasFee: ${gasFee.toString()}, gasToken: ${gasToken}, nativeValueForGas: ${nativeValueForGas.toString()}`);
      } catch (err) {
        throw new Error(`Failed to query outbound gas fee for SVM Route 3: ${err}`);
      }
    }

    // Adjust nativeValueForGas using UEA balance (contract refunds excess)
    // Re-fetch balance to minimize staleness from gas fee query RPC roundtrips
    const currentBalance = await this.pushClient.getBalance(ueaAddress);
    // Cosmos-EVM tx overhead costs ~1 PC per operation; 3 PC covers approve(s) + buffer.
    const OUTBOUND_GAS_RESERVE_R3_SVM = BigInt(3e18);
    if (currentBalance > OUTBOUND_GAS_RESERVE_R3_SVM && currentBalance - OUTBOUND_GAS_RESERVE_R3_SVM > nativeValueForGas) {
      const adjustedValue = currentBalance - OUTBOUND_GAS_RESERVE_R3_SVM;
      this.printLog(
        `executeCeaToPushSvm — adjusting nativeValueForGas from ${nativeValueForGas.toString()} to ${adjustedValue.toString()} (UEA balance: ${currentBalance.toString()})`
      );
      nativeValueForGas = adjustedValue;
    }

    // Build Push Chain multicalls (approvals + sendUniversalTxOutbound)
    const pushChainMulticalls: MultiCall[] = buildOutboundApprovalAndCall({
      prc20Token,
      gasToken,
      burnAmount,
      gasFee,
      nativeValueForGas,
      gatewayPcAddress,
      outboundRequest: outboundReq,
    });

    // Sum native values from multicall entries for proper fee calculation
    const multicallNativeValue = pushChainMulticalls.reduce(
      (sum, mc) => sum + (mc.value ?? BigInt(0)),
      BigInt(0)
    );

    // Execute through the normal execute() flow
    const executeParams: ExecuteParams = {
      to: ueaAddress,
      value: multicallNativeValue, // ensures correct requiredFunds calculation
      data: pushChainMulticalls,
      _ueaStatus: {
        isDeployed: isUEADeployed,
        nonce: ueaNonce,
        balance: ueaBalance,
      },
      _skipFeeLocking: true, // outbound executes on Push Chain, no external fee locking
    };

    const response = await this.execute(executeParams);

    // Add Route 3 SVM context to response
    response.chain = sourceChain;
    const chainInfo = CHAIN_INFO[sourceChain];
    response.chainNamespace = `${VM_NAMESPACE[chainInfo.vm]}:${chainInfo.chainId}`;

    return response;
  }

  /**
   * Route 4: Execute CEA to CEA transaction via Push Chain
   *
   * @param params - Universal execution parameters with from.chain and to.chain
   * @returns UniversalTxResponse
   */
  private async executeCeaToCea(
    params: UniversalExecuteParams
  ): Promise<UniversalTxResponse> {
    // CEA → CEA requires chaining Route 3 (CEA → Push) and Route 2 (Push → CEA)
    // This is a complex flow that requires coordination
    throw new Error(
      'CEA → CEA transactions are not yet fully implemented. ' +
        'Use prepareTransaction().thenOn() to chain Route 3 → Route 2 manually.'
    );
  }

  /**
   * Build payload for a specific route
   */
  private async buildPayloadForRoute(
    params: UniversalExecuteParams,
    route: TransactionRoute,
    nonce: bigint
  ): Promise<{
    payload: `0x${string}`;
    gatewayRequest: UniversalTxRequest | UniversalOutboundTxRequest;
  }> {
    const ueaAddress = this.computeUEAOffchain();

    switch (route) {
      case TransactionRoute.UOA_TO_PUSH: {
        // Build standard Push Chain payload
        const executeParams = this.toExecuteParams(params);
        const multicallData = buildExecuteMulticall({
          execute: executeParams,
          ueaAddress,
        });
        const payload = this._buildMulticallPayloadData(
          executeParams.to,
          multicallData
        );
        const req = this._buildUniversalTxRequest({
          recipient: zeroAddress,
          token: zeroAddress,
          amount: BigInt(0),
          payload,
        });
        return { payload, gatewayRequest: req };
      }

      case TransactionRoute.UOA_TO_CEA: {
        const target = params.to as ChainTarget;

        // Branch: SVM vs EVM
        if (isSvmChain(target.chain)) {
          // SVM: build SVM payload (binary or empty for withdraw)
          let payload: `0x${string}` = '0x';
          if (params.svmExecute) {
            payload = encodeSvmExecutePayload({
              targetProgram: params.svmExecute.targetProgram,
              accounts: params.svmExecute.accounts,
              ixData: params.svmExecute.ixData,
              instructionId: 2,
            });
          }

          const targetBytes = params.svmExecute?.targetProgram ?? target.address;

          let prc20Token: `0x${string}` = ZERO_ADDRESS as `0x${string}`;
          let burnAmount = BigInt(0);
          if (params.funds?.amount) {
            const token = (params.funds as { token: MoveableToken }).token;
            if (token) {
              prc20Token = PushChain.utils.tokens.getPRC20Address(token);
              burnAmount = params.funds.amount;
            }
          } else if (params.value && params.value > BigInt(0)) {
            prc20Token = this.getNativePRC20ForChain(target.chain);
            burnAmount = params.value;
          } else if (params.svmExecute) {
            prc20Token = this.getNativePRC20ForChain(target.chain);
            burnAmount = BigInt(1);
          }

          const outboundReq = buildOutboundRequest(
            targetBytes,
            prc20Token,
            burnAmount,
            params.gasLimit ?? BigInt(0),
            payload,
            ueaAddress
          );

          return { payload, gatewayRequest: outboundReq };
        }

        // EVM path: Resolve CEA address first (needed for self-transfer check)
        const { cea: ceaAddress } = await getCEAAddress(
          ueaAddress,
          target.chain,
          this.rpcUrls[target.chain]?.[0]
        );

        // Build CEA outbound payload
        const multicalls: MultiCall[] = [];

        if (params.data) {
          if (Array.isArray(params.data)) {
            multicalls.push(...(params.data as MultiCall[]));
          } else {
            // Single call with data. Native value (if any) is already delivered to
            // CEA by the Vault via executeUniversalTx{value: amount}(). Attaching
            // value to the call would revert if the target function is not payable.
            // To call a payable function with value, use explicit multicalls.
            multicalls.push({
              to: target.address,
              value: BigInt(0),
              data: params.data as `0x${string}`,
            });
          }
        } else if (params.value) {
          // Skip multicall when sending native value to own CEA — gateway deposits directly.
          // Self-call with value would revert (CEA._handleMulticall rejects it).
          if (target.address.toLowerCase() !== ceaAddress.toLowerCase()) {
            multicalls.push({
              to: target.address,
              value: params.value,
              data: '0x',
            });
          }
        }

        const payload = buildCeaMulticallPayload(multicalls);

        let prc20Token: `0x${string}` = ZERO_ADDRESS as `0x${string}`;
        let burnAmount = BigInt(0);
        if (params.funds?.amount) {
          const token = (params.funds as { token: MoveableToken }).token;
          if (token) {
            prc20Token = PushChain.utils.tokens.getPRC20Address(token);
            burnAmount = params.funds.amount;
          }
        }

        const targetBytes = ceaAddress;

        const outboundReq = buildOutboundRequest(
          targetBytes,
          prc20Token,
          burnAmount,
          params.gasLimit ?? BigInt(0),
          payload,
          ueaAddress
        );

        return { payload, gatewayRequest: outboundReq };
      }

      case TransactionRoute.CEA_TO_PUSH: {
        // Route 3: CEA → Push Chain
        // Build CEA multicall (approve + sendUniversalTxFromCEA) and wrap in outbound
        if (!params.from?.chain) {
          throw new Error('Route 3 (CEA → Push) requires from.chain');
        }
        const sourceChain = params.from.chain;
        const pushDestination = params.to as `0x${string}`;

        // SVM chains use gateway self-call, not CEA multicall
        if (isSvmChain(sourceChain)) {
          const lockerContract = CHAIN_INFO[sourceChain].lockerContract;
          if (!lockerContract) {
            throw new Error(`No SVM gateway program configured for chain ${sourceChain}`);
          }
          const programPk = new PublicKey(lockerContract);
          const gatewayProgramHex = ('0x' + Buffer.from(programPk.toBytes()).toString('hex')) as `0x${string}`;

          let drainAmount = BigInt(0);
          let tokenMintHex: `0x${string}` | undefined;
          let prc20Token: `0x${string}`;

          if (params.funds?.amount && params.funds.amount > BigInt(0)) {
            drainAmount = params.funds.amount;
            const token = (params.funds as { token: MoveableToken }).token;
            if (token && token.address) {
              const mintPk = new PublicKey(token.address);
              tokenMintHex = ('0x' + Buffer.from(mintPk.toBytes()).toString('hex')) as `0x${string}`;
              prc20Token = PushChain.utils.tokens.getPRC20Address(token);
            } else {
              prc20Token = this.getNativePRC20ForChain(sourceChain);
            }
          } else if (params.value && params.value > BigInt(0)) {
            drainAmount = params.value;
            prc20Token = this.getNativePRC20ForChain(sourceChain);
          } else {
            // Payload-only Route 3 SVM: no funds to drain, just execute data on Push Chain
            drainAmount = BigInt(0);
            prc20Token = this.getNativePRC20ForChain(sourceChain);
          }

          // Derive CEA PDA as revert recipient
          const ueaBytes2 = Buffer.from(ueaAddress.slice(2), 'hex');
          const [ceaPda2] = PublicKey.findProgramAddressSync(
            [Buffer.from('push_identity'), ueaBytes2],
            programPk
          );
          const ceaPdaHex2 = ('0x' + Buffer.from(ceaPda2.toBytes()).toString('hex')) as `0x${string}`;

          const svmPayload = encodeSvmCeaToUeaPayload({
            gatewayProgramHex,
            drainAmount,
            tokenMintHex,
            revertRecipientHex: ceaPdaHex2,
          });

          // burnAmount = 1 (minimum for precompile; drain amount lives inside the ixData)
          const burnAmount = BigInt(1);
          const outboundReq = buildOutboundRequest(
            gatewayProgramHex,
            prc20Token,
            burnAmount,
            params.gasLimit ?? BigInt(0),
            svmPayload,
            ueaAddress
          );

          return { payload: svmPayload, gatewayRequest: outboundReq };
        }

        const { cea: ceaAddress } = await getCEAAddress(
          ueaAddress,
          sourceChain,
          this.rpcUrls[sourceChain]?.[0]
        );

        const gatewayAddr = UNIVERSAL_GATEWAY_ADDRESSES[sourceChain];
        if (!gatewayAddr) {
          throw new Error(`No UniversalGateway address configured for chain ${sourceChain}`);
        }

        // Build CEA multicalls (self-calls via sendUniversalTxToUEA)
        const ceaMulticalls: MultiCall[] = [];
        let tokenAddress: `0x${string}` = ZERO_ADDRESS as `0x${string}`;
        let amount = BigInt(0);

        if (params.funds?.amount) {
          const token = (params.funds as { token: MoveableToken }).token;
          if (token) {
            if (token.mechanism === 'native') {
              tokenAddress = ZERO_ADDRESS as `0x${string}`;
              amount = params.funds.amount;
            } else {
              tokenAddress = token.address as `0x${string}`;
              amount = params.funds.amount;
              // Approve gateway for ERC20 (CEA self-call, value=0)
              const approveData = encodeFunctionData({
                abi: ERC20_EVM,
                functionName: 'approve',
                args: [gatewayAddr, amount],
              });
              ceaMulticalls.push({
                to: tokenAddress,
                value: BigInt(0),
                data: approveData,
              });
            }
          }
        } else if (params.value && params.value > BigInt(0)) {
          tokenAddress = ZERO_ADDRESS as `0x${string}`;
          amount = params.value;
        }

        // Fetch UEA nonce for inbound UniversalPayload
        const ueaCodeHop = await this.pushClient.publicClient.getCode({ address: ueaAddress });
        const ueaNonceHop = ueaCodeHop !== undefined ? await this.getUEANonce(ueaAddress) : BigInt(0);

        // Build Push Chain payload (what executes after inbound arrives)
        // Wrap in UniversalPayload struct for the relay.
        let pushPayload: `0x${string}` = '0x';
        if (params.data) {
          const multicallData = buildExecuteMulticall({
            execute: {
              to: pushDestination,
              value: params.value,
              data: params.data,
            },
            ueaAddress,
          });
          const multicallPayload = this._buildMulticallPayloadData(pushDestination, multicallData);
          pushPayload = buildInboundUniversalPayload(multicallPayload, { nonce: ueaNonceHop + BigInt(1) });
        }

        // Build sendUniversalTxToUEA self-call on CEA (to=CEA, value=0)
        const sendCall = buildSendUniversalTxToUEA(
          ceaAddress,
          tokenAddress,
          amount,
          pushPayload,
          ceaAddress
        );
        ceaMulticalls.push(sendCall);

        const ceaPayload = buildCeaMulticallPayload(ceaMulticalls);
        const prc20Token = this.getNativePRC20ForChain(sourceChain);
        // burnAmount = actual amount needed by CEA. Vault deposits this as msg.value.
        // Fallback to BigInt(1) for payload-only outbound (precompile rejects amount=0).
        const burnAmount = amount > BigInt(0) ? amount : BigInt(1);

        const outboundReq = buildOutboundRequest(
          ceaAddress,
          prc20Token,
          burnAmount,
          params.gasLimit ?? BigInt(0),
          ceaPayload,
          ueaAddress
        );

        return { payload: ceaPayload, gatewayRequest: outboundReq };
      }

      default:
        throw new Error(`Cannot build payload for route: ${route}`);
    }
  }

  /**
   * Convert UniversalExecuteParams to ExecuteParams for backwards compatibility
   */
  private toExecuteParams(params: UniversalExecuteParams): ExecuteParams {
    // Extract address from ChainTarget if needed
    const to =
      typeof params.to === 'string'
        ? params.to
        : (params.to as ChainTarget).address;

    return {
      to,
      value: params.value,
      data: params.data,
      funds: params.funds,
      gasLimit: params.gasLimit,
      maxFeePerGas: params.maxFeePerGas,
      maxPriorityFeePerGas: params.maxPriorityFeePerGas,
      deadline: params.deadline,
      payGasWith: params.payGasWith,
      feeLockTxHash: params.feeLockTxHash,
    };
  }

  /**
   * Get the UniversalGatewayPC address for the current Push network
   */
  private getUniversalGatewayPCAddress(): `0x${string}` {
    // UniversalGatewayPC is a precompile at a fixed address on Push Chain
    // Address: 0x00000000000000000000000000000000000000C1
    return '0x00000000000000000000000000000000000000C1';
  }

  /**
   * Get the native PRC-20 token address on Push Chain for a target external chain.
   * Maps chains to their native asset representations on Push Chain.
   *
   * @param targetChain - The target external chain
   * @returns PRC-20 token address on Push Chain
   */
  private getNativePRC20ForChain(targetChain: CHAIN): `0x${string}` {
    const synthetics = SYNTHETIC_PUSH_ERC20[this.pushNetwork];

    switch (targetChain) {
      case CHAIN.ETHEREUM_SEPOLIA:
      case CHAIN.ETHEREUM_MAINNET:
        return synthetics.pETH;
      case CHAIN.ARBITRUM_SEPOLIA:
        return synthetics.pETH_ARB;
      case CHAIN.BASE_SEPOLIA:
        return synthetics.pETH_BASE;
      case CHAIN.BNB_TESTNET:
        return synthetics.pETH_BNB;
      case CHAIN.SOLANA_DEVNET:
      case CHAIN.SOLANA_TESTNET:
      case CHAIN.SOLANA_MAINNET:
        return synthetics.pSOL;
      default:
        throw new Error(
          `No native PRC-20 token mapping for chain ${targetChain}. ` +
            `Use 'funds' parameter to specify the token explicitly.`
        );
    }
  }

  /**
   * Get CAIP-2 chain namespace for a chain
   */
  private getChainNamespace(chain: CHAIN): string {
    const { vm, chainId } = CHAIN_INFO[chain];
    const namespace = VM_NAMESPACE[vm];
    return `${namespace}:${chainId}`;
  }

  /**
   * Locks a fee on the origin chain by interacting with the chain's fee-locker contract.
   *
   * @param amount - Fee amount in USDC (8 Decimals)
   * @param executionHash - Optional execution payload hash (default: zeroHash)
   * @returns Transaction hash bytes
   */
  private async lockFee(
    amount: bigint, // USD with 8 decimals
    universalPayload: UniversalPayload,
    req: UniversalTxRequest
  ): Promise<Uint8Array> {
    const chain = this.universalSigner.account.chain;
    const { lockerContract, vm, defaultRPC } = CHAIN_INFO[chain];

    if (!lockerContract) {
      throw new Error(`Locker contract not configured for chain: ${chain}`);
    }

    const rpcUrls: string[] = this.rpcUrls[chain] || defaultRPC;

    switch (vm) {
      case VM.EVM: {
        // Run price fetching and client creation in parallel
        const [nativeTokenUsdPrice, evmClient] = await Promise.all([
          new PriceFetch(this.rpcUrls).getPrice(chain), // 8 decimals
          Promise.resolve(new EvmClient({ rpcUrls })),
        ]);

        const nativeDecimals = 18; // ETH, MATIC, etc.
        // Ensure deposit respects gateway USD caps (min $1, max $10) and avoid rounding below min
        const oneUsd = Utils.helpers.parseUnits('1', 8);
        const tenUsd = Utils.helpers.parseUnits('10', 8);
        let depositUsd = amount < oneUsd ? oneUsd : amount;
        if (depositUsd > tenUsd) depositUsd = tenUsd;
        // Ceil division to avoid falling below on-chain min due to rounding, then add 1 wei safety
        let nativeAmount =
          (depositUsd * BigInt(10 ** nativeDecimals) +
            (nativeTokenUsdPrice - BigInt(1))) /
          nativeTokenUsdPrice;
        nativeAmount = nativeAmount + BigInt(1);

        const txHash: `0x${string}` = await this.sendGatewayTxWithFallback(
          evmClient,
          lockerContract as `0x${string}`,
          req,
          this.universalSigner,
          nativeAmount,
        );
        return hexToBytes(txHash);
      }

      case VM.SVM: {
        // Run price fetching and client creation in parallel
        const [nativeTokenUsdPrice, svmClient] = await Promise.all([
          new PriceFetch(this.rpcUrls).getPrice(chain), // 8 decimals
          Promise.resolve(new SvmClient({ rpcUrls })),
        ]);
        // Ensure deposit respects gateway USD caps (min $1, max $10) and avoid rounding below min
        const nativeDecimals = 9; // SOL lamports
        const oneUsd = Utils.helpers.parseUnits('1', 8);
        const tenUsd = Utils.helpers.parseUnits('10', 8);
        let depositUsd = amount < oneUsd ? oneUsd : amount;
        if (depositUsd > tenUsd) depositUsd = tenUsd;
        // Ceil division to avoid falling below on-chain min due to rounding, then add 1 lamport safety
        let nativeAmount =
          (depositUsd * BigInt(10 ** nativeDecimals) +
            (nativeTokenUsdPrice - BigInt(1))) /
          nativeTokenUsdPrice;
        nativeAmount = nativeAmount + BigInt(1);

        // Program & PDAs
        const programId = new PublicKey(SVM_GATEWAY_IDL.address);
        const [configPda] = PublicKey.findProgramAddressSync(
          [stringToBytes('config')],
          programId
        );
        const [vaultPda] = PublicKey.findProgramAddressSync(
          [stringToBytes('vault')],
          programId
        );
        const [rateLimitConfigPda] = PublicKey.findProgramAddressSync(
          [stringToBytes('rate_limit_config')],
          programId
        );
        const [tokenRateLimitPda] = PublicKey.findProgramAddressSync(
          [stringToBytes('rate_limit'), PublicKey.default.toBuffer()],
          programId
        );

        const userPk = new PublicKey(this.universalSigner.account.address);
        const { feeVaultPda, protocolFeeLamports } =
          await this._getSvmProtocolFee(svmClient, programId);

        const gasReq = this._buildSvmUniversalTxRequestFromReq(req, userPk);

        try {
          const txHash = await svmClient.writeContract({
            abi: SVM_GATEWAY_IDL,
            address: programId.toBase58(),
            functionName: 'sendUniversalTx',
            args: [gasReq, nativeAmount + protocolFeeLamports],
            signer: this.universalSigner,
            accounts: {
              config: configPda,
              vault: vaultPda,
              feeVault: feeVaultPda,
              userTokenAccount: vaultPda,
              gatewayTokenAccount: vaultPda,
              user: userPk,
              priceUpdate: new PublicKey(
                '7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE'
              ),
              rateLimitConfig: rateLimitConfigPda,
              tokenRateLimit: tokenRateLimitPda,
              tokenProgram: new PublicKey(
                'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
              ),
              systemProgram: SystemProgram.programId,
            },
          });
          return new Uint8Array(utils.bytes.bs58.decode(txHash));
        } catch (error) {
          console.error('Error sending UniversalTx:', error);
          throw error;
        }
      }

      default:
        throw new Error(`Unsupported VM type: ${vm}`);
    }
  }

  private _buildUniversalTxRequest({
    recipient,
    token,
    amount,
    payload,
  }: {
    recipient: `0x${string}`;
    token: `0x${string}`;
    amount: bigint;
    payload: `0x${string}`;
  }): UniversalTxRequest {
    const revertInstruction = {
      fundRecipient: this.universalSigner.account.address as `0x${string}`,
      revertMsg: '0x' as `0x${string}`,
    };
    return {
      recipient,
      token,
      amount,
      payload,
      revertInstruction,
      signatureData: '0x',
    };
  }

  /**
   * Returns the resolved gateway version for the current origin chain.
   * Checks the per-chain runtime cache first, then falls back to static config.
   * TODO: Remove V0 fallback once all chains are upgraded to V1.
   */
  private getGatewayVersion(): 'v0' | 'v1' {
    const chain = this.universalSigner.account.chain;
    // 1. Check runtime cache (set after a successful tx)
    const cached = this.gatewayVersionCache.get(chain);
    if (cached) return cached;
    // 2. Fall back to static config
    return CHAIN_INFO[chain].gatewayVersion ?? 'v0';
  }

  /**
   * Returns true if the current origin chain uses the V1 gateway (revertRecipient address).
   */
  private isV1Gateway(): boolean {
    return this.getGatewayVersion() === 'v1';
  }

  /**
   * Returns the correct gateway ABI for the given version.
   */
  private getGatewayAbiForVersion(version: 'v0' | 'v1'): unknown[] {
    return version === 'v1'
      ? (UNIVERSAL_GATEWAY_V1_SEND as unknown as unknown[])
      : (UNIVERSAL_GATEWAY_V0 as unknown as unknown[]);
  }

  /**
   * Returns the correct gateway ABI based on the origin chain's gateway version.
   */
  private getGatewayAbi(): unknown[] {
    return this.getGatewayAbiForVersion(this.getGatewayVersion());
  }

  /**
   * Converts a V0 UniversalTxRequest to V1 format.
   */
  private toGatewayRequestV1(
    req: UniversalTxRequest
  ): UniversalTxRequestV1 {
    return {
      recipient: req.recipient,
      token: req.token,
      amount: req.amount,
      payload: req.payload,
      revertRecipient: req.revertInstruction.fundRecipient,
      signatureData: req.signatureData,
    };
  }

  /**
   * Converts a V0 UniversalTxRequest to the correct format based on gateway version.
   */
  private toGatewayRequest(
    req: UniversalTxRequest
  ): UniversalTxRequest | UniversalTxRequestV1 {
    if (!this.isV1Gateway()) return req;
    return this.toGatewayRequestV1(req);
  }

  /**
   * Converts a V0 UniversalTokenTxRequest to V1 format.
   */
  private toGatewayTokenRequestV1(
    req: UniversalTokenTxRequest
  ): UniversalTokenTxRequestV1 {
    return {
      recipient: req.recipient,
      token: req.token,
      amount: req.amount,
      gasToken: req.gasToken,
      gasAmount: req.gasAmount,
      payload: req.payload,
      revertRecipient: req.revertInstruction.fundRecipient,
      signatureData: req.signatureData,
      amountOutMinETH: req.amountOutMinETH,
      deadline: req.deadline,
    };
  }

  /**
   * Converts a V0 UniversalTokenTxRequest to the correct format based on gateway version.
   */
  private toGatewayTokenRequest(
    req: UniversalTokenTxRequest
  ): UniversalTokenTxRequest | UniversalTokenTxRequestV1 {
    if (!this.isV1Gateway()) return req;
    return this.toGatewayTokenRequestV1(req);
  }

  /**
   * Sends a gateway transaction with V1-first, V0-fallback strategy.
   *
   * Strategy:
   *   1. Try V1 (revertRecipient address format) first.
   *   2. If V1 fails (contract not yet upgraded), retry with V0 (revertInstruction struct).
   *   3. Cache the working version per chain so subsequent calls skip the fallback.
   *
   * TODO: Remove V0 fallback once all chains are upgraded to V1. After that,
   *       delete this method and call writeContract directly with V1 ABI.
   */
  private async sendGatewayTxWithFallback(
    evmClient: EvmClient,
    address: `0x${string}`,
    req: UniversalTxRequest,
    signer: UniversalSigner,
    value: bigint
  ): Promise<`0x${string}`> {
    const chain = this.universalSigner.account.chain;
    const currentVersion = this.getGatewayVersion();

    // If we already know the version (from cache or config), use it directly — no fallback needed.
    if (this.gatewayVersionCache.has(chain)) {
      return evmClient.writeContract({
        abi: this.getGatewayAbiForVersion(currentVersion) as Abi,
        address,
        functionName: 'sendUniversalTx',
        args: [currentVersion === 'v1' ? this.toGatewayRequestV1(req) : req],
        signer,
        value,
      });
    }

    // No cached version yet — try V1 first, fall back to V0.
    // TODO: Remove this try/catch block once all chains are on V1.
    try {
      this.printLog(`[Gateway] Trying V1 format for chain ${chain}...`);
      const txHash = await evmClient.writeContract({
        abi: this.getGatewayAbiForVersion('v1') as Abi,
        address,
        functionName: 'sendUniversalTx',
        args: [this.toGatewayRequestV1(req)],
        signer,
        value,
      });
      // V1 succeeded — cache it
      this.gatewayVersionCache.set(chain, 'v1');
      this.printLog(`[Gateway] V1 succeeded for chain ${chain}, cached.`);
      return txHash;
    } catch (v1Error) {
      this.printLog(`[Gateway] V1 failed for chain ${chain}, falling back to V0... Error: ${v1Error}`);
    }

    // V0 fallback — contract not yet upgraded on this chain
    // TODO: Remove this block once all chains are upgraded to V1.
    try {
      const txHash = await evmClient.writeContract({
        abi: this.getGatewayAbiForVersion('v0') as Abi,
        address,
        functionName: 'sendUniversalTx',
        args: [req],
        signer,
        value,
      });
      // V0 succeeded — cache it
      this.gatewayVersionCache.set(chain, 'v0');
      this.printLog(`[Gateway] V0 succeeded for chain ${chain}, cached.`);
      return txHash;
    } catch (v0Error) {
      // Both versions failed — throw the V0 error (more likely to be the real issue on non-upgraded chains)
      throw v0Error;
    }
  }

  /**
   * Sends a gateway token transaction with V1-first, V0-fallback strategy.
   * Same as sendGatewayTxWithFallback but for UniversalTokenTxRequest (gas token path).
   *
   * TODO: Remove V0 fallback once all chains are upgraded to V1.
   */
  private async sendGatewayTokenTxWithFallback(
    evmClient: EvmClient,
    address: `0x${string}`,
    req: UniversalTokenTxRequest,
    signer: UniversalSigner,
    value?: bigint
  ): Promise<`0x${string}`> {
    const chain = this.universalSigner.account.chain;
    const currentVersion = this.getGatewayVersion();

    // If we already know the version (from cache or config), use it directly.
    if (this.gatewayVersionCache.has(chain)) {
      return evmClient.writeContract({
        abi: this.getGatewayAbiForVersion(currentVersion) as Abi,
        address,
        functionName: 'sendUniversalTx',
        args: [currentVersion === 'v1' ? this.toGatewayTokenRequestV1(req) : req],
        signer,
        ...(value !== undefined && { value }),
      });
    }

    // No cached version yet — try V1 first, fall back to V0.
    // TODO: Remove this try/catch block once all chains are on V1.
    try {
      this.printLog(`[Gateway] Trying V1 token format for chain ${chain}...`);
      const txHash = await evmClient.writeContract({
        abi: this.getGatewayAbiForVersion('v1') as Abi,
        address,
        functionName: 'sendUniversalTx',
        args: [this.toGatewayTokenRequestV1(req)],
        signer,
        ...(value !== undefined && { value }),
      });
      this.gatewayVersionCache.set(chain, 'v1');
      this.printLog(`[Gateway] V1 token tx succeeded for chain ${chain}, cached.`);
      return txHash;
    } catch (v1Error) {
      this.printLog(`[Gateway] V1 token tx failed for chain ${chain}, falling back to V0... Error: ${v1Error}`);
    }

    // V0 fallback
    // TODO: Remove this block once all chains are upgraded to V1.
    try {
      const txHash = await evmClient.writeContract({
        abi: this.getGatewayAbiForVersion('v0') as Abi,
        address,
        functionName: 'sendUniversalTx',
        args: [req],
        signer,
        ...(value !== undefined && { value }),
      });
      this.gatewayVersionCache.set(chain, 'v0');
      this.printLog(`[Gateway] V0 token tx succeeded for chain ${chain}, cached.`);
      return txHash;
    } catch (v0Error) {
      throw v0Error;
    }
  }

  /**
   * Builds the SVM UniversalTxRequest object from an existing EVM-style UniversalTxRequest.
   * This allows reusing the same request shape for both EVM and SVM while only translating
   * field encodings (addresses, bytes) to the Solana program format.
   */
  private _buildSvmUniversalTxRequestFromReq(
    req: UniversalTxRequest,
    revertRecipient: PublicKey,
    signatureDataOverride?: Uint8Array | `0x${string}`
  ) {
    // recipient in EVM is a 20-byte address; the SVM gateway expects this as [u8; 20]
    const recipientBytes = hexToBytes(req.recipient);
    const recipient: number[] = Array.from(recipientBytes.subarray(0, 20));

    // token in EVM is a 20-byte address. For zeroAddress or the Solana-native sentinel we map to
    // PublicKey.default (all zeros), which mirrors the existing behavior for native SOL paths.
    // For non-zero addresses we embed the 20-byte value into a 32-byte buffer (left-padded with
    // zeros) to obtain a deterministic PublicKey representation.
    const tokenAddress = req.token as string;
    let token: PublicKey;
    if (tokenAddress === zeroAddress || tokenAddress === 'solana-native') {
      // Native SOL on SVM is represented by a sentinel string `solana-native` in token metadata.
      // The SVM gateway expects the "native" token to be encoded as the default (all-zero) Pubkey.
      token = PublicKey.default;
    } else {
      if (!tokenAddress.startsWith('0x')) {
        throw new Error(
          'Unsupported token format for SVM UniversalTxRequest: ' + tokenAddress
        );
      }
      const token20 = hexToBytes(tokenAddress as `0x${string}`);
      const token32 = new Uint8Array(32);
      token32.set(token20, 12);
      token = new PublicKey(token32);
    }

    return this._buildSvmUniversalTxRequest({
      recipient,
      token,
      amount: req.amount,
      payload: req.payload,
      revertRecipient,
      signatureData: signatureDataOverride ?? req.signatureData,
    });
  }

  /**
   * Builds the SVM UniversalTxRequest object expected by the Solana gateway program.
   * Shape mirrors the request used in `svm-gateway` tests.
   */
  private _buildSvmUniversalTxRequest({
    recipient,
    token,
    amount,
    payload,
    revertRecipient,
    signatureData,
  }: {
    recipient: number[];
    token: PublicKey;
    amount: bigint;
    payload: `0x${string}` | Uint8Array;
    revertRecipient: PublicKey;
    signatureData?: Uint8Array | `0x${string}`;
  }) {
    const payloadBuf =
      typeof payload === 'string' && payload.startsWith('0x')
        ? (() => {
            const hex = payload.slice(2);
            if (!hex.length) return Buffer.alloc(0);
            const normalized = hex.length % 2 === 1 ? `0${hex}` : hex;
            return Buffer.from(normalized, 'hex');
          })()
        : Buffer.from(payload);

    let signatureBuf: Buffer;
    if (!signatureData) {
      signatureBuf = Buffer.alloc(0);
    } else if (
      typeof signatureData === 'string' &&
      signatureData.startsWith('0x')
    ) {
      const hex = signatureData.slice(2);
      if (!hex.length) {
        signatureBuf = Buffer.alloc(0);
      } else {
        const normalized = hex.length % 2 === 1 ? `0${hex}` : hex;
        signatureBuf = Buffer.from(normalized, 'hex');
      }
    } else {
      // vitalik
      // I'm testing to see if it's possible to pass 0x as signature, the same way we did for EVM.
      // @@@@
      signatureBuf = Buffer.from(signatureData);
      // signatureBuf = Buffer.alloc(0);
    }

    return {
      recipient,
      token,
      amount,
      payload: payloadBuf,
      revertRecipient: revertRecipient,
      signatureData: signatureBuf,
    };
  }

  private async _getSvmProtocolFee(
    svmClient: { readContract: (args: any) => Promise<any> },
    programId: PublicKey
  ) {
    const [feeVaultPda] = PublicKey.findProgramAddressSync(
      [stringToBytes('fee_vault')],
      programId
    );
    try {
      const feeVault: any = await svmClient.readContract({
        abi: SVM_GATEWAY_IDL,
        address: SVM_GATEWAY_IDL.address,
        functionName: 'feeVault',
        args: [feeVaultPda.toBase58()],
      });
      const protocolFeeLamports = BigInt(
        (
          feeVault.protocolFeeLamports ?? feeVault.protocol_fee_lamports
        )?.toString() ?? '0'
      );
      return { feeVaultPda, protocolFeeLamports };
    } catch {
      return { feeVaultPda, protocolFeeLamports: BigInt(0) };
    }
  }

  private async signUniversalPayload(
    universalPayload: UniversalPayload,
    verifyingContract: `0x${string}`,
    version?: string
  ) {
    const chain = this.universalSigner.account.chain;
    const { vm, chainId } = CHAIN_INFO[chain];

    switch (vm) {
      case VM.EVM: {
        if (!this.universalSigner.signTypedData) {
          throw new Error('signTypedData is not defined');
        }
        return this.universalSigner.signTypedData({
          domain: {
            version: version || '0.1.0',
            chainId: Number(chainId),
            verifyingContract,
          },
          types: {
            UniversalPayload: [
              { name: 'to', type: 'address' },
              { name: 'value', type: 'uint256' },
              { name: 'data', type: 'bytes' },
              { name: 'gasLimit', type: 'uint256' },
              { name: 'maxFeePerGas', type: 'uint256' },
              { name: 'maxPriorityFeePerGas', type: 'uint256' },
              { name: 'nonce', type: 'uint256' },
              { name: 'deadline', type: 'uint256' },
              { name: 'vType', type: 'uint8' },
            ],
          },
          primaryType: 'UniversalPayload',
          message: universalPayload,
        });
      }

      case VM.SVM: {
        const digest = this.computeExecutionHash({
          verifyingContract,
          payload: universalPayload,
          version: version || '0.1.0',
        });
        return this.universalSigner.signMessage(stringToBytes(digest));
      }

      default: {
        throw new Error(`Unsupported VM type: ${vm}`);
      }
    }
  }

  /**
   * Signs a MigrationPayload for UEA upgrade.
   * EVM: EIP-712 signTypedData. SVM: manual hash + signMessage (same pattern as signUniversalPayload).
   */
  private async signMigrationPayload({
    migrationContractAddress,
    nonce,
    deadline,
    ueaVersion,
    ueaAddress,
  }: {
    migrationContractAddress: `0x${string}`;
    nonce: bigint;
    deadline: bigint;
    ueaVersion: string;
    ueaAddress: `0x${string}`;
  }): Promise<Uint8Array> {
    const chain = this.universalSigner.account.chain;
    const { vm, chainId } = CHAIN_INFO[chain];

    switch (vm) {
      case VM.EVM: {
        if (!this.universalSigner.signTypedData) {
          throw new Error('signTypedData is not defined');
        }
        return this.universalSigner.signTypedData({
          domain: {
            version: ueaVersion,
            chainId: Number(chainId),
            verifyingContract: ueaAddress,
          },
          types: {
            MigrationPayload: [
              { name: 'migration', type: 'address' },
              { name: 'nonce', type: 'uint256' },
              { name: 'deadline', type: 'uint256' },
            ],
          },
          primaryType: 'MigrationPayload',
          message: {
            migration: migrationContractAddress,
            nonce: nonce.toString(),
            deadline: deadline.toString(),
          },
        });
      }

      case VM.SVM: {
        const digest = this.computeMigrationHash({
          verifyingContract: ueaAddress,
          migrationContractAddress,
          nonce,
          deadline,
          version: ueaVersion,
        });
        return this.universalSigner.signMessage(stringToBytes(digest));
      }

      default:
        throw new Error(`Unsupported VM type for migration: ${vm}`);
    }
  }

  /**
   * Computes the EIP-712 struct hash for MigrationPayload (used by SVM path).
   * Mirrors computeExecutionHash but for the MigrationPayload type.
   */
  private computeMigrationHash({
    verifyingContract,
    migrationContractAddress,
    nonce,
    deadline,
    version = '0.1.0',
  }: {
    verifyingContract: `0x${string}`;
    migrationContractAddress: `0x${string}`;
    nonce: bigint;
    deadline: bigint;
    version?: string;
  }): `0x${string}` {
    const chain = this.universalSigner.account.chain;
    const { vm, chainId } = CHAIN_INFO[chain];

    // 1. Type hash
    const typeHash = keccak256(
      toBytes(
        'MigrationPayload(address migration,uint256 nonce,uint256 deadline)'
      )
    );

    // 2. Domain separator
    const domainTypeHash = keccak256(
      toBytes(
        vm === VM.EVM
          ? 'EIP712Domain(string version,uint256 chainId,address verifyingContract)'
          : 'EIP712Domain_SVM(string version,string chainId,address verifyingContract)'
      )
    );

    const domainSeparator = keccak256(
      encodeAbiParameters(
        [
          { name: 'typeHash', type: 'bytes32' },
          { name: 'version', type: 'bytes32' },
          { name: 'chainId', type: vm === VM.EVM ? 'uint256' : 'string' },
          { name: 'verifyingContract', type: 'address' },
        ],
        [
          domainTypeHash,
          keccak256(toBytes(version)),
          vm === VM.EVM ? BigInt(chainId) : chainId,
          verifyingContract,
        ]
      )
    );

    // 3. Struct hash
    const structHash = keccak256(
      encodeAbiParameters(
        [
          { name: 'typeHash', type: 'bytes32' },
          { name: 'migration', type: 'address' },
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
        ],
        [typeHash, migrationContractAddress, nonce, deadline]
      )
    );

    // 4. Final digest
    return keccak256(
      encodePacked(
        ['string', 'bytes32', 'bytes32'],
        ['\x19\x01', domainSeparator, structHash]
      )
    );
  }

  /**
   * Sends a custom Cosmos tx to Push Chain (gasless) to execute user intent.
   */
  private async sendUniversalTx(
    isUEADeployed: boolean,
    feeLockTxHash?: string,
    universalPayload?: UniversalPayload,
    verificationData?: `0x${string}`,
    eventBuffer: ProgressEvent[] = []
  ): Promise<UniversalTxResponse[]> {
    const { chain, address } = this.universalSigner.account;
    const { vm, chainId } = CHAIN_INFO[chain];

    const universalAccountId: UniversalAccountId = {
      chainNamespace: VM_NAMESPACE[vm],
      chainId: chainId,
      owner:
        vm === VM.EVM
          ? address
          : vm === VM.SVM
          ? bytesToHex(new Uint8Array(utils.bytes.bs58.decode(address)))
          : address,
    };

    const { cosmosAddress: signer } = this.pushClient.getSignerAddress();
    const msgs: Any[] = [];

    if (universalPayload && verificationData) {
      msgs.push(
        this.pushClient.createMsgExecutePayload({
          signer,
          universalAccountId,
          universalPayload,
          verificationData,
        })
      );
    }

    const txBody = await this.pushClient.createCosmosTxBody(msgs);
    const txRaw = await this.pushClient.signCosmosTx(txBody);
    const tx = await this.pushClient.broadcastCosmosTx(txRaw);

    if (tx.code !== 0) {
      // Try to extract ethereum tx hash even from failed tx
      const failedEthTxHashes = tx.events
        ?.filter((e: any) => e.type === 'ethereum_tx')
        .flatMap((e: any) =>
          e.attributes
            ?.filter((attr: any) => attr.key === 'ethereumTxHash')
            .map((attr: any) => attr.value as `0x${string}`)
        ) ?? [];

      // Print clean transaction failure summary
      console.error(`\n${'='.repeat(80)}`);
      console.error(`PUSH CHAIN TRANSACTION FAILED`);
      console.error(`${'='.repeat(80)}`);
      console.error(`\n--- TRANSACTION INFO ---`);
      console.error(`Cosmos TX Hash: ${tx.transactionHash}`);
      console.error(`Block Height: ${tx.height}`);
      console.error(`TX Code: ${tx.code} (error)`);
      console.error(`Gas Used: ${tx.gasUsed}`);
      console.error(`Gas Wanted: ${tx.gasWanted}`);
      if (failedEthTxHashes.length > 0) {
        console.error(`Ethereum TX Hash(es): ${failedEthTxHashes.join(', ')}`);
      }
      console.error(`\n--- ERROR ---`);
      console.error(`${tx.rawLog}`);
      console.error(`\n--- QUERY COMMANDS ---`);
      console.error(`# Query via Cosmos RPC:`);
      console.error(`curl -s "https://donut.rpc.push.org/tx?hash=0x${tx.transactionHash}"`);
      if (failedEthTxHashes.length > 0) {
        console.error(`\n# View on explorer:`);
        console.error(`https://explorer.push.org/tx/${failedEthTxHashes[0]}`);
      }
      console.error(`\n${'='.repeat(80)}\n`);

      throw new Error(tx.rawLog);
    }

    const ethTxHashes: `0x${string}`[] =
      tx.events
        ?.filter((e: any) => e.type === 'ethereum_tx')
        .flatMap((e: any) =>
          e.attributes
            ?.filter((attr: any) => attr.key === 'ethereumTxHash')
            .map((attr: any) => attr.value as `0x${string}`)
        ) ?? [];

    if (ethTxHashes.length === 0) {
      throw new Error('No ethereumTxHash found in transaction events');
    }

    // 🔗 Fetch all corresponding EVM transactions in parallel
    const evmTxs = await Promise.all(
      ethTxHashes.map(async (hash) => {
        return await this.pushClient.getTransaction(hash);
      })
    );

    // Pass eventBuffer only to the last transaction (which is the one returned to user)
    const responses = await Promise.all(
      evmTxs.map((tx, index) =>
        this.transformToUniversalTxResponse(
          tx,
          index === evmTxs.length - 1 ? eventBuffer : []
        )
      )
    );
    return responses;
  }

  /**
   * Sends a EVM trx on Push Chain
   * @dev - Only to be used from universal signer is on Push chain
   * @param execute
   * @returns Cosmos Tx Response for a given Evm Tx
   */
  private async sendPushTx(
    execute: ExecuteParams,
    eventBuffer: ProgressEvent[] = []
  ): Promise<UniversalTxResponse> {
    // If data is a multicall array, execute each call as a separate transaction
    // EOAs on Push Chain cannot process UEA_MULTICALL encoded data — they are not contracts
    // Nonces and gas are managed locally:
    //   - Nonces: avoids stale nonce from estimateGas simulation on Cosmos-EVM
    //   - Gas: avoids estimateGas failures when prior txs in the batch aren't committed yet
    // Each tx is confirmed before sending the next to ensure state visibility.
    if (Array.isArray(execute.data)) {
      const PUSH_CHAIN_GAS_LIMIT = BigInt(500000);
      const MAX_NONCE_RETRIES = 3;
      // Fetch nonce once before the batch using 'pending' to include mempool txs
      let nonce = await this.pushClient.publicClient.getTransactionCount({
        address: this.universalSigner.account.address as `0x${string}`,
        blockTag: 'pending',
      });
      let lastTxHash: `0x${string}` = '0x';
      const calls = execute.data as MultiCall[];
      for (let i = 0; i < calls.length; i++) {
        const call = calls[i];
        let txSent = false;
        for (let retry = 0; retry < MAX_NONCE_RETRIES && !txSent; retry++) {
          try {
            this.printLog(
              `sendPushTx — executing multicall operation ${i + 1}/${calls.length} to: ${call.to} (nonce: ${nonce})`
            );
            lastTxHash = await this.pushClient.sendTransaction({
              to: call.to as `0x${string}`,
              data: (call.data || '0x') as `0x${string}`,
              value: call.value,
              signer: this.universalSigner,
              nonce,
              gas: PUSH_CHAIN_GAS_LIMIT,
            });
            txSent = true;
          } catch (err: any) {
            const msg = err?.message || err?.details || '';
            if (msg.includes('invalid nonce') || msg.includes('invalid sequence')) {
              // Re-fetch nonce from pending state and retry
              this.printLog(
                `sendPushTx — nonce mismatch on operation ${i + 1}/${calls.length} (retry ${retry + 1}/${MAX_NONCE_RETRIES}), re-fetching nonce`
              );
              nonce = await this.pushClient.publicClient.getTransactionCount({
                address: this.universalSigner.account.address as `0x${string}`,
                blockTag: 'pending',
              });
            } else {
              throw err;
            }
          }
        }
        if (!txSent) {
          throw new Error(
            `sendPushTx — multicall operation ${i + 1}/${calls.length} failed after ${MAX_NONCE_RETRIES} nonce retries`
          );
        }

        // Wait for tx receipt and verify it succeeded before sending next tx
        const receipt = await this.pushClient.publicClient.waitForTransactionReceipt({
          hash: lastTxHash,
        });
        if (receipt.status === 'reverted') {
          throw new Error(
            `sendPushTx — multicall operation ${i + 1}/${calls.length} reverted (to: ${call.to}, txHash: ${lastTxHash})`
          );
        }
        this.printLog(
          `sendPushTx — operation ${i + 1}/${calls.length} confirmed in block ${receipt.blockNumber}`
        );
        nonce++; // increment locally for next tx
      }
      const txResponse = await this.pushClient.getTransaction(lastTxHash);
      return await this.transformToUniversalTxResponse(txResponse, eventBuffer);
    }

    const txHash = await this.pushClient.sendTransaction({
      to: execute.to,
      data: (execute.data || '0x') as `0x${string}`,
      value: execute.value,
      signer: this.universalSigner,
    });
    const txResponse = await this.pushClient.getTransaction(txHash);
    return await this.transformToUniversalTxResponse(txResponse, eventBuffer);
  }

  /**
   * Computes the EIP-712 digest hash for the UniversalPayload structure.
   * This is the message that should be signed by the user's wallet (e.g., Solana signer).
   *
   * The resulting hash is equivalent to:
   * keccak256("\x19\x01" || domainSeparator || structHash)
   *
   * @param chainId - EVM chain ID of the destination chain (Push Chain)
   * @param verifyingContract - Address of the verifying contract (i.e., the user's UEA smart wallet)
   * @param version - Optional EIP-712 domain version (default: '0.1.0')
   * @param payload - Execution details encoded into the UniversalPayload struct
   * @returns keccak256 digest to be signed by the user
   */
  private computeExecutionHash({
    verifyingContract,
    payload,
    version = '0.1.0',
  }: {
    verifyingContract: `0x${string}`;
    version?: string;
    payload: UniversalPayload;
  }): `0x${string}` {
    const chain = this.universalSigner.account.chain;
    const { vm, chainId } = CHAIN_INFO[chain];

    // 1. Type hash
    const typeHash = keccak256(
      toBytes(
        'UniversalPayload(address to,uint256 value,bytes data,uint256 gasLimit,uint256 maxFeePerGas,uint256 maxPriorityFeePerGas,uint256 nonce,uint256 deadline,uint8 vType)'
      )
    );

    // 2. Domain separator
    const domainTypeHash = keccak256(
      toBytes(
        vm === VM.EVM
          ? 'EIP712Domain(string version,uint256 chainId,address verifyingContract)'
          : 'EIP712Domain_SVM(string version,string chainId,address verifyingContract)'
      )
    );

    const domainSeparator = keccak256(
      encodeAbiParameters(
        [
          { name: 'typeHash', type: 'bytes32' },
          { name: 'version', type: 'bytes32' },
          { name: 'chainId', type: vm === VM.EVM ? 'uint256' : 'string' },
          { name: 'verifyingContract', type: 'address' },
        ],
        [
          domainTypeHash,
          keccak256(toBytes(version)),
          vm === VM.EVM ? BigInt(chainId) : chainId,
          verifyingContract,
        ]
      )
    );

    // 3. Struct hash
    const structHash = keccak256(
      encodeAbiParameters(
        [
          { name: 'typeHash', type: 'bytes32' },
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'data', type: 'bytes32' },
          { name: 'gasLimit', type: 'uint256' },
          { name: 'maxFeePerGas', type: 'uint256' },
          { name: 'maxPriorityFeePerGas', type: 'uint256' },
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
          { name: 'vType', type: 'uint8' },
        ],
        [
          typeHash,
          payload.to as `0x${string}`,
          BigInt(payload.value),
          keccak256(payload.data as `0x${string}`),
          BigInt(payload.gasLimit),
          BigInt(payload.maxFeePerGas),
          BigInt(payload.maxPriorityFeePerGas),
          BigInt(payload.nonce),
          BigInt(payload.deadline),
          payload.vType,
        ]
      )
    );

    // 4. Final digest
    return keccak256(
      encodePacked(
        ['string', 'bytes32', 'bytes32'],
        ['\x19\x01', domainSeparator, structHash]
      )
    );
  }

  /**
   * ABI-encodes a UniversalPayload struct to bytes, matching the Solidity layout.
   * This mirrors abi.encode(UniversalPayload) in the EVM contracts.
   */
  private encodeUniversalPayload(payload: UniversalPayload): `0x${string}` {
    return encodeAbiParameters(
      [
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'data', type: 'bytes' },
        { name: 'gasLimit', type: 'uint256' },
        { name: 'maxFeePerGas', type: 'uint256' },
        { name: 'maxPriorityFeePerGas', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
        { name: 'vType', type: 'uint8' },
      ],
      [
        payload.to as `0x${string}`,
        BigInt(payload.value as unknown as bigint | string),
        payload.data as `0x${string}`,
        BigInt(payload.gasLimit as unknown as bigint | string),
        BigInt(payload.maxFeePerGas as unknown as bigint | string),
        BigInt(payload.maxPriorityFeePerGas as unknown as bigint | string),
        BigInt(payload.nonce as unknown as bigint | string),
        BigInt(payload.deadline as unknown as bigint | string),
        Number(payload.vType),
      ]
    ) as `0x${string}`;
  }

  /**
   * Encodes a UniversalPayload into Borsh bytes for the SVM universal gateway.
   * Layout mirrors Rust `UniversalPayload`:
   *   to: [u8; 20],
   *   value: u64,
   *   data: Vec<u8> (u32 LE len + bytes),
   *   gas_limit: u64,
   *   max_fee_per_gas: u64,
   *   max_priority_fee_per_gas: u64,
   *   nonce: u64,
   *   deadline: i64,
   *   v_type: u8 (0 = SignedVerification, 1 = UniversalTxVerification)
   */
  private encodeUniversalPayloadSvm(payload: UniversalPayload): Buffer {
    const writeU64 = (val: bigint | number | string): Buffer => {
      const b = Buffer.alloc(8);
      const big = BigInt(val);
      b.writeBigUInt64LE(big, 0);
      return b;
    };

    const writeI64 = (val: bigint | number | string): Buffer => {
      const b = Buffer.alloc(8);
      const big = BigInt(val);
      b.writeBigInt64LE(big, 0);
      return b;
    };

    const writeVecU8 = (val: Buffer | Uint8Array | number[]): Buffer => {
      const bytes = Buffer.isBuffer(val)
        ? val
        : Buffer.from(val as Uint8Array | number[]);
      const len = Buffer.alloc(4);
      len.writeUInt32LE(bytes.length, 0);
      return Buffer.concat([len, bytes]);
    };

    const writeU8 = (val: number): Buffer => Buffer.from([val]);

    // 1. to: address (20 bytes)
    const toBytes = (() => {
      // EVM-style 0x-address string
      const to = payload.to as `0x${string}`;
      const hex = to.slice(2).padStart(40, '0');
      return Buffer.from(hex, 'hex');
    })();

    // 2. value: u64
    const valueBytes = writeU64(
      payload.value as unknown as bigint | number | string
    );

    // 3. data: bytes -> Vec<u8>
    const dataBytes = (() => {
      const data = payload.data as `0x${string}`;
      const hex = data.slice(2);
      const buf = hex.length ? Buffer.from(hex, 'hex') : Buffer.alloc(0);
      return writeVecU8(buf);
    })();

    // 4. gasLimit: u64
    const gasLimitBytes = writeU64(
      payload.gasLimit as unknown as bigint | number | string
    );

    // 5. maxFeePerGas: u64
    const maxFeePerGasBytes = writeU64(
      payload.maxFeePerGas as unknown as bigint | number | string
    );

    // 6. maxPriorityFeePerGas: u64
    const maxPriorityFeePerGasBytes = writeU64(
      payload.maxPriorityFeePerGas as unknown as bigint | number | string
    );

    // 7. nonce: u64
    const nonceBytes = writeU64(
      payload.nonce as unknown as bigint | number | string
    );

    // 8. deadline: i64
    const deadlineBytes = writeI64(
      payload.deadline as unknown as bigint | number | string
    );

    // 9. vType: u8
    const vTypeVal = (() => {
      // When coming from EVM, vType is numeric (0/1) in most paths
      const v = payload.vType as any;
      if (typeof v === 'number') return v;
      if (typeof v === 'string') return Number(v);
      // Fallback: treat anything else as SignedVerification
      return 0;
    })();
    const vTypeBytes = writeU8(vTypeVal);

    return Buffer.concat([
      toBytes,
      valueBytes,
      dataBytes,
      gasLimitBytes,
      maxFeePerGasBytes,
      maxPriorityFeePerGasBytes,
      nonceBytes,
      deadlineBytes,
      vTypeBytes,
    ]);
  }

  /**
   * Reconstructs SEND-TX-* progress events from on-chain transaction data.
   * Used by trackTransaction to replay progress for already-completed transactions.
   *
   * @param universalTxResponse - The transformed transaction response
   * @param universalTxData - Optional UniversalTx data from gRPC query (for cross-chain txs)
   * @returns Array of ProgressEvent objects to emit
   */
  private reconstructProgressEvents(
    universalTxResponse: UniversalTxResponse,
    universalTxData?: UniversalTxV2
  ): ProgressEvent[] {
    const events: ProgressEvent[] = [];

    // Parse origin from CAIP format: "eip155:11155111:0xabc..."
    const originParts = universalTxResponse.origin.split(':');
    const chainNamespace =
      originParts.length >= 2 ? `${originParts[0]}:${originParts[1]}` : originParts[0];
    const originAddress =
      originParts.length >= 3 ? originParts[2] : universalTxResponse.from;

    // SEND_TX_01: Origin Chain Detected (always emit)
    events.push(PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_01](chainNamespace, originAddress));

    // SEND_TX_02_01/02: Gas estimation (always emit for reconstructed flow)
    events.push(PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_02_01]());
    events.push(PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_02_02](universalTxResponse.gasLimit));

    // Determine if this is a cross-chain tx (non-Push origin)
    const isPushOrigin =
      chainNamespace.includes('eip155:42101') ||
      chainNamespace.includes('eip155:9') ||
      chainNamespace.includes('eip155:9001');

    // SEND_TX_03_01/02: UEA resolution (emit if origin is not Push Chain)
    if (!isPushOrigin) {
      events.push(PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_03_01]());
      events.push(
        PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_03_02](
          universalTxResponse.from as `0x${string}`,
          true // Assume deployed since tx executed
        )
      );
    }

    // Determine transaction type from universalTxData if available
    const inboundTx = universalTxData?.inboundTx;
    const hasFundsFlow = inboundTx && BigInt(inboundTx.amount || '0') > BigInt(0);

    // SEND_TX_04_02/03: Signature verification (emit for universal tx)
    if (!isPushOrigin) {
      events.push(PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_04_02]());
      events.push(PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_04_03]());
    }

    // Funds flow hooks (06-x) - only if funds were bridged
    if (hasFundsFlow && inboundTx) {
      const amount = BigInt(inboundTx.amount);
      // Determine decimals and symbol from asset - default to 18/native for now
      const decimals = 18;
      const symbol = 'TOKEN';

      events.push(
        PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_06_01](amount, decimals, symbol)
      );
      events.push(
        PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_06_02](
          inboundTx.txHash,
          amount,
          decimals,
          symbol
        )
      );

      // Confirmations - emit final state only
      const confirmations = 1;
      events.push(PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_06_03](confirmations));
      events.push(
        PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_06_03_02](confirmations, confirmations)
      );
      events.push(PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_06_04]());
      events.push(PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_06_05]());
      events.push(
        PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_06_06](amount, decimals, symbol)
      );
    }

    // SEND_TX_07: Broadcasting (always emit)
    events.push(PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_07]());

    // Determine outcome from pcTx status if available
    const pcTx = universalTxData?.pcTx?.[0];
    const isFailed = pcTx?.status === 'FAILED';

    // SEND_TX_99_01/02: Final outcome
    if (isFailed) {
      events.push(
        PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_99_02](pcTx?.errorMsg || 'Unknown error')
      );
    } else {
      events.push(PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_99_01]([universalTxResponse]));
    }

    return events;
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
    const {
      chain = this.getPushChainForNetwork(),
      progressHook,
      waitForCompletion = true,
      advanced = {},
    } = options ?? {};

    const { timeout = 300000, rpcUrls = {} } = advanced;

    // Event buffer for replay via response.progressHook()
    const eventBuffer: ProgressEvent[] = [];

    // Helper to emit progress events
    const emitProgress = (event: ProgressEvent) => {
      eventBuffer.push(event);
      this.printLog(event.message);
      // Per-transaction hook called FIRST
      if (progressHook) {
        progressHook(event);
      }
      // Orchestrator-level hook called SECOND
      if (this.progressHook) {
        this.progressHook(event);
      }
    };

    // Create client for target chain with optional RPC override
    const chainRPCs =
      rpcUrls[chain] || this.rpcUrls[chain] || CHAIN_INFO[chain].defaultRPC;
    const client = new PushClient({
      rpcUrls: chainRPCs,
      network: this.pushNetwork,
    });

    // Poll for transaction
    const start = Date.now();
    let tx: TxResponse | undefined;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        tx = await client.getTransaction(txHash as `0x${string}`);
        break; // Found transaction
      } catch (err) {
        if (!waitForCompletion) {
          throw new Error(`Transaction ${txHash} not found`);
        }

        // Check timeout
        if (Date.now() - start > timeout) {
          throw new Error(
            `Timeout: transaction ${txHash} not confirmed within ${timeout}ms`
          );
        }

        // Brief delay before retry
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    // Try to get UniversalTx data for richer progress reconstruction
    // (may not exist for direct Push Chain transactions)
    let universalTxData: UniversalTxV2 | undefined;
    try {
      // Attempt to find UniversalTx by searching pcTx entries
      // For now, we'll try to look up by the tx hash
      const utxResponse = await this.pushClient.getUniversalTxByIdV2(txHash);
      if (utxResponse?.universalTx) {
        universalTxData = utxResponse.universalTx;
      }
    } catch {
      // Ignore - direct Push Chain tx or tx not indexed yet
    }

    // Transform to UniversalTxResponse
    const universalTxResponse = await this.transformToUniversalTxResponse(
      tx,
      eventBuffer
    );

    // Reconstruct and emit SEND-TX-* progress events
    const reconstructedEvents = this.reconstructProgressEvents(
      universalTxResponse,
      universalTxData
    );
    for (const event of reconstructedEvents) {
      emitProgress(event);
    }

    return universalTxResponse;
  }

  /**
   * Returns the Push Chain enum value for the current network
   */
  private getPushChainForNetwork(): CHAIN {
    if (this.pushNetwork === PUSH_NETWORK.MAINNET) {
      return CHAIN.PUSH_MAINNET;
    } else if (
      this.pushNetwork === PUSH_NETWORK.TESTNET_DONUT ||
      this.pushNetwork === PUSH_NETWORK.TESTNET
    ) {
      return CHAIN.PUSH_TESTNET_DONUT;
    } else {
      return CHAIN.PUSH_LOCALNET;
    }
  }

  // ============================================================================
  // Outbound Transaction Tracking
  // ============================================================================

  /**
   * Compute UniversalTxId for Push Chain originated outbound transactions.
   * Formula: keccak256("eip155:{pushChainId}:{pushChainTxHash}")
   *
   * @param pushChainTxHash - The Push Chain transaction hash
   * @returns The UniversalTxId (keccak256 hash)
   */
  private computeUniversalTxId(pushChainTxHash: string): string {
    const pushChain = this.getPushChainForNetwork();
    const pushChainId = CHAIN_INFO[pushChain].chainId;
    const input = `eip155:${pushChainId}:${pushChainTxHash}`;
    return keccak256(toBytes(input));
  }

  /**
   * Extract universalsubTxId from a Push Chain transaction by fetching Cosmos events.
   * The universalsubTxId is found in the 'outbound_created' Cosmos event (attribute 'utx_id'),
   * NOT in the EVM event data.
   *
   * @param pushChainTxHash - The Push Chain transaction hash
   * @returns The universalsubTxId or null if not found
   */
  async extractUniversalSubTxIdFromTx(pushChainTxHash: string): Promise<string | null> {
    this.printLog(
      `[extractUniversalSubTxIdFromTx] Fetching Cosmos tx for: ${pushChainTxHash}`
    );

    try {
      // Query Cosmos transaction to get events
      const cosmosTx = await this.pushClient.getCosmosTx(pushChainTxHash);

      if (!cosmosTx?.events) {
        this.printLog(`[extractUniversalSubTxIdFromTx] No events in Cosmos tx`);
        return null;
      }

      // Find the 'outbound_created' event which contains utx_id
      for (const event of cosmosTx.events) {
        if (event.type === 'outbound_created') {
          // Find the utx_id attribute
          const utxIdAttr = event.attributes?.find(
            (attr: { key: string; value?: string }) => attr.key === 'utx_id'
          );
          if (utxIdAttr?.value) {
            // The utx_id is stored without 0x prefix in Cosmos events
            const universalsubTxId = utxIdAttr.value.startsWith('0x')
              ? utxIdAttr.value
              : `0x${utxIdAttr.value}`;
            this.printLog(
              `[extractUniversalSubTxIdFromTx] Found universalsubTxId from outbound_created event: ${universalsubTxId}`
            );
            return universalsubTxId;
          }
        }
      }

      this.printLog(`[extractUniversalSubTxIdFromTx] No outbound_created event found`);
      return null;
    } catch (error) {
      this.printLog(
        `[extractUniversalSubTxIdFromTx] Error: ${error instanceof Error ? error.message : String(error)}`
      );
      return null;
    }
  }

  /**
   * Extract ALL universalSubTxIds from a Push Chain transaction.
   * For cascaded transactions, a single Push Chain tx may emit multiple
   * outbound_created events, each with its own utx_id.
   *
   * @param pushChainTxHash - The Push Chain transaction hash
   * @returns Array of universalSubTxIds (may be empty)
   */
  async extractAllUniversalSubTxIds(pushChainTxHash: string): Promise<string[]> {
    this.printLog(
      `[extractAllUniversalSubTxIds] Fetching Cosmos tx for: ${pushChainTxHash}`
    );

    try {
      const cosmosTx = await this.pushClient.getCosmosTx(pushChainTxHash);

      if (!cosmosTx?.events) {
        this.printLog(`[extractAllUniversalSubTxIds] No events in Cosmos tx`);
        return [];
      }

      const subTxIds: string[] = [];
      for (const event of cosmosTx.events) {
        if (event.type === 'outbound_created') {
          const utxIdAttr = event.attributes?.find(
            (attr: { key: string; value?: string }) => attr.key === 'utx_id'
          );
          if (utxIdAttr?.value) {
            const id = utxIdAttr.value.startsWith('0x')
              ? utxIdAttr.value
              : `0x${utxIdAttr.value}`;
            subTxIds.push(id);
          }
        }
      }

      this.printLog(
        `[extractAllUniversalSubTxIds] Found ${subTxIds.length} sub-tx IDs: ${subTxIds.join(', ')}`
      );
      return subTxIds;
    } catch (error) {
      this.printLog(
        `[extractAllUniversalSubTxIds] Error: ${error instanceof Error ? error.message : String(error)}`
      );
      return [];
    }
  }

  /**
   * Convert CAIP-2 namespace (e.g., "eip155:97") to CHAIN enum
   *
   * @param namespace - CAIP-2 chain namespace string
   * @returns CHAIN enum value or null if not found
   */
  private chainFromNamespace(namespace: string): CHAIN | null {
    for (const [chainKey, info] of Object.entries(CHAIN_INFO)) {
      const expected = `${VM_NAMESPACE[info.vm]}:${info.chainId}`;
      if (expected === namespace) {
        return chainKey as CHAIN;
      }
    }
    return null;
  }

  // Outbound sync configuration constants
  private static readonly OUTBOUND_INITIAL_WAIT_MS = 30000; // 30s
  private static readonly OUTBOUND_POLL_INTERVAL_MS = 5000; // 5s
  private static readonly OUTBOUND_MAX_TIMEOUT_MS = 180000; // 180s (3 min)

  /**
   * Wait for outbound transaction to complete and return external chain details.
   * @internal Used by .wait() for outbound routes - not part of public API.
   * Uses polling with configurable initial wait, interval, and timeout.
   *
   * Default strategy: 30s initial wait, then poll every 5s, 120s total timeout.
   *
   * @param pushChainTxHash - The Push Chain transaction hash
   * @param options - Polling configuration options
   * @returns External chain tx details
   * @throws Error on timeout
   */
  private async waitForOutboundTx(
    pushChainTxHash: string,
    options: import('./orchestrator.types').WaitForOutboundOptions = {}
  ): Promise<import('./orchestrator.types').OutboundTxDetails> {
    const {
      initialWaitMs = Orchestrator.OUTBOUND_INITIAL_WAIT_MS,
      pollingIntervalMs = Orchestrator.OUTBOUND_POLL_INTERVAL_MS,
      timeout = Orchestrator.OUTBOUND_MAX_TIMEOUT_MS,
      progressHook,
      _resolvedSubTxId,
      _expectedDestinationChain,
    } = options;

    // Terminal failure states — fail fast instead of polling until timeout
    const TERMINAL_FAILURE_STATES = new Set([
      UniversalTxStatus.OUTBOUND_FAILED,
      UniversalTxStatus.PC_EXECUTED_FAILED,
      UniversalTxStatus.CANCELED,
    ]);

    const startTime = Date.now();

    this.printLog(`[waitForOutboundTx] Starting | txHash: ${pushChainTxHash} | initialWait: ${initialWaitMs}ms | pollInterval: ${pollingIntervalMs}ms | timeout: ${timeout}ms`);

    // Emit initial waiting status
    progressHook?.({ status: 'waiting', elapsed: 0 });

    // Initial wait before first poll
    this.printLog(`[waitForOutboundTx] Initial wait of ${initialWaitMs}ms...`);
    await new Promise((resolve) => setTimeout(resolve, initialWaitMs));

    // Start polling
    this.printLog(`[waitForOutboundTx] Initial wait done. Starting polling. Elapsed: ${Date.now() - startTime}ms`);
    progressHook?.({ status: 'polling', elapsed: Date.now() - startTime });

    // Cache the universalSubTxId after first extraction to avoid redundant receipt fetches.
    // If a pre-resolved ID was provided (cascade per-hop tracking), use it directly.
    let cachedUniversalSubTxId: string | undefined = _resolvedSubTxId;

    let pollCount = 0;
    while (Date.now() - startTime < timeout) {
      pollCount++;
      const pollStart = Date.now();
      this.printLog(`[waitForOutboundTx] Poll #${pollCount} | Elapsed: ${pollStart - startTime}ms / ${timeout}ms`);

      // First poll: extract the ID. Subsequent polls: reuse cached ID.
      if (!cachedUniversalSubTxId) {
        cachedUniversalSubTxId = (await this.extractUniversalSubTxIdFromTx(pushChainTxHash)) ?? undefined;
        if (!cachedUniversalSubTxId) {
          cachedUniversalSubTxId = this.computeUniversalTxId(pushChainTxHash);
        }
        this.printLog(`[waitForOutboundTx] Extracted & cached universalSubTxId: ${cachedUniversalSubTxId}`);
      }

      // Query with cached ID
      const queryId = cachedUniversalSubTxId.startsWith('0x')
        ? cachedUniversalSubTxId.slice(2)
        : cachedUniversalSubTxId;

      try {
        const utxResponse = await this.pushClient.getUniversalTxByIdV2(queryId);

        const statusNum = utxResponse?.universalTx?.universalStatus as number;
        const statusName = UniversalTxStatus[statusNum] ?? statusNum;
        const outbounds = utxResponse?.universalTx?.outboundTx || [];
        this.printLog(`[waitForOutboundTx] Poll #${pollCount} | status: ${statusNum} (${statusName}) | outboundTx count: ${outbounds.length} | first txHash: '${outbounds[0]?.observedTx?.txHash || ''}' | first dest: '${outbounds[0]?.destinationChain || ''}'`);

        // Check for terminal failure states — fail fast
        if (TERMINAL_FAILURE_STATES.has(statusNum)) {
          this.printLog(`[waitForOutboundTx] Terminal failure state: ${statusName}`);
          progressHook?.({ status: 'failed', elapsed: Date.now() - startTime });
          throw new Error(
            `Outbound transaction failed with status ${statusName}. Push Chain TX: ${pushChainTxHash}.`
          );
        }

        // Iterate V2 outbound array
        for (const ob of outbounds) {
          // Fail fast on per-outbound REVERTED status
          if (ob.outboundStatus === OutboundStatus.REVERTED) {
            this.printLog(`[waitForOutboundTx] Outbound to ${ob.destinationChain} REVERTED`);
            progressHook?.({ status: 'failed', elapsed: Date.now() - startTime });
            throw new Error(
              `Outbound to ${ob.destinationChain} reverted: ${ob.observedTx?.errorMsg || 'Unknown'}. Push Chain TX: ${pushChainTxHash}.`
            );
          }

          if (ob.observedTx?.txHash) {
            // If a destination chain filter is set, skip outbound entries that don't match
            if (_expectedDestinationChain && ob.destinationChain !== _expectedDestinationChain) {
              this.printLog(`[waitForOutboundTx] Poll #${pollCount} | outbound chain '${ob.destinationChain}' does not match expected '${_expectedDestinationChain}', skipping`);
              continue;
            }

            const chain = this.chainFromNamespace(ob.destinationChain);
            if (chain) {
              const explorerBaseUrl = CHAIN_INFO[chain]?.explorerUrl;
              const isSvm = CHAIN_INFO[chain]?.vm === VM.SVM;

              // For SVM chains, convert hex txHash to base58 and append cluster param
              let displayTxHash = ob.observedTx.txHash;
              let explorerUrl = '';
              if (isSvm && ob.observedTx.txHash.startsWith('0x')) {
                const bytes = new Uint8Array(Buffer.from(ob.observedTx.txHash.slice(2), 'hex'));
                displayTxHash = utils.bytes.bs58.encode(bytes);
                const cluster = chain === CHAIN.SOLANA_DEVNET ? '?cluster=devnet'
                  : chain === CHAIN.SOLANA_TESTNET ? '?cluster=testnet' : '';
                explorerUrl = explorerBaseUrl ? `${explorerBaseUrl}/tx/${displayTxHash}${cluster}` : '';
              } else {
                explorerUrl = explorerBaseUrl ? `${explorerBaseUrl}/tx/${ob.observedTx.txHash}` : '';
              }

              const details = {
                externalTxHash: ob.observedTx.txHash,
                destinationChain: chain,
                explorerUrl,
                recipient: ob.recipient,
                amount: ob.amount,
                assetAddr: ob.externalAssetAddr,
              };
              this.printLog(`[waitForOutboundTx] FOUND on poll #${pollCount} | elapsed: ${Date.now() - startTime}ms | externalTxHash: ${details.externalTxHash}`);
              progressHook?.({ status: 'found', elapsed: Date.now() - startTime });
              return details;
            }
          }
        }
      } catch (error) {
        // Re-throw terminal failure and reverted errors
        if (error instanceof Error && (error.message.includes('Outbound transaction failed') || error.message.includes('reverted'))) {
          throw error;
        }
        this.printLog(`[waitForOutboundTx] Poll #${pollCount} ERROR: ${error instanceof Error ? error.message : String(error)}`);
      }

      this.printLog(`[waitForOutboundTx] Poll #${pollCount} not ready yet (${Date.now() - pollStart}ms). Waiting ${pollingIntervalMs}ms...`);

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, pollingIntervalMs));
    }

    this.printLog(`[waitForOutboundTx] TIMEOUT after ${pollCount} polls | elapsed: ${Date.now() - startTime}ms`);
    progressHook?.({ status: 'timeout', elapsed: Date.now() - startTime });

    throw new Error(
      `Timeout waiting for outbound transaction. Push Chain TX: ${pushChainTxHash}. ` +
        `Timeout: ${timeout}ms. The relay may still be processing.`
    );
  }

  /**
   * Tracks ALL outbound transactions for a cascade with multiple outbound hops
   * (e.g., BNB + Solana). Uses V2 API which returns outboundTx[] with per-outbound
   * status tracking, matching each outbound to the correct hop by destination chain.
   */
  private async waitForAllOutboundTxsV2(
    pushChainTxHash: string,
    outboundHops: CascadeHopInfo[],
    options: {
      initialWaitMs: number;
      pollingIntervalMs: number;
      timeout: number;
      progressHook?: (event: {
        hopIndex: number;
        route: import('./orchestrator.types').TransactionRouteType;
        chain: CHAIN;
        status: string;
        txHash?: string;
      }) => void;
    }
  ): Promise<{ success: boolean; failedAt?: number }> {
    const { initialWaitMs, pollingIntervalMs, timeout, progressHook } = options;
    const startTime = Date.now();

    // Build a map: CAIP-2 namespace -> hop(s) for matching outbound entries
    const chainToHops = new Map<string, CascadeHopInfo[]>();
    for (const hop of outboundHops) {
      const chainInfo = CHAIN_INFO[hop.executionChain];
      if (chainInfo) {
        const namespace = `${VM_NAMESPACE[chainInfo.vm]}:${chainInfo.chainId}`;
        const existing = chainToHops.get(namespace) || [];
        existing.push(hop);
        chainToHops.set(namespace, existing);
      }
    }

    const expectedChains = [...chainToHops.keys()];
    this.printLog(`[waitForAllOutboundTxsV2] Starting | txHash: ${pushChainTxHash} | expectedChains: ${expectedChains.join(', ')} | timeout: ${timeout}ms`);

    // Emit initial waiting status for all outbound hops
    for (const hop of outboundHops) {
      progressHook?.({
        hopIndex: hop.hopIndex,
        route: hop.route,
        chain: hop.executionChain,
        status: 'waiting',
      });
    }

    // Initial wait before first poll
    const waitMs = Math.min(initialWaitMs, timeout);
    this.printLog(`[waitForAllOutboundTxsV2] Initial wait of ${waitMs}ms...`);
    await new Promise((resolve) => setTimeout(resolve, waitMs));

    // Emit polling status for all hops
    for (const hop of outboundHops) {
      progressHook?.({
        hopIndex: hop.hopIndex,
        route: hop.route,
        chain: hop.executionChain,
        status: 'polling',
      });
    }

    // Extract sub-tx ID for V2 query
    let cachedQueryId: string | undefined;

    let pollCount = 0;
    let consecutiveErrors = 0;
    const MAX_CONSECUTIVE_ERRORS = 10;
    while (Date.now() - startTime < timeout) {
      pollCount++;
      const elapsed = Date.now() - startTime;
      this.printLog(`[waitForAllOutboundTxsV2] Poll #${pollCount} | Elapsed: ${elapsed}ms / ${timeout}ms`);

      // Resolve query ID on first poll
      if (!cachedQueryId) {
        const allSubTxIds = await this.extractAllUniversalSubTxIds(pushChainTxHash);
        const subTxId = allSubTxIds.length > 0 ? allSubTxIds[0] : this.computeUniversalTxId(pushChainTxHash);
        cachedQueryId = subTxId.startsWith('0x') ? subTxId.slice(2) : subTxId;
        this.printLog(`[waitForAllOutboundTxsV2] Resolved queryId: ${cachedQueryId}`);
      }

      try {
        const v2Response = await this.pushClient.getUniversalTxByIdV2(cachedQueryId);
        consecutiveErrors = 0; // Reset on successful RPC call
        const utx = v2Response?.universalTx;
        const statusNum = utx?.universalStatus as number;
        const statusName = UniversalTxStatus[statusNum] ?? statusNum;

        this.printLog(`[waitForAllOutboundTxsV2] Poll #${pollCount} | status: ${statusNum} (${statusName}) | outboundTx count: ${utx?.outboundTx?.length ?? 0}`);

        if (utx?.outboundTx?.length) {
          for (const ob of utx.outboundTx) {
            const destChain = ob.destinationChain;
            const hopsForChain = chainToHops.get(destChain);
            if (!hopsForChain) continue;

            const unconfirmedForChain = hopsForChain.filter((h) => h.status !== 'confirmed' && h.status !== 'failed');
            if (unconfirmedForChain.length === 0) continue;

            // Fail fast on per-outbound REVERTED
            if (ob.outboundStatus === OutboundStatus.REVERTED) {
              for (const hop of unconfirmedForChain) {
                hop.status = 'failed';
                this.printLog(`[waitForAllOutboundTxsV2] Outbound to ${destChain} REVERTED | hop ${hop.hopIndex} | error: ${ob.observedTx?.errorMsg || 'Unknown'}`);
                progressHook?.({
                  hopIndex: hop.hopIndex,
                  route: hop.route,
                  chain: hop.executionChain,
                  status: 'failed',
                });
              }
              return { success: false, failedAt: unconfirmedForChain[0].hopIndex };
            }

            // Check for OBSERVED with txHash
            const externalTxHash = ob.observedTx?.txHash;
            if (externalTxHash && (ob.outboundStatus === OutboundStatus.OBSERVED || ob.outboundStatus as number === 0)) {
              const chain = this.chainFromNamespace(destChain);
              let explorerUrl = '';
              if (chain && externalTxHash) {
                const explorerBaseUrl = CHAIN_INFO[chain]?.explorerUrl;
                const isSvm = CHAIN_INFO[chain]?.vm === VM.SVM;
                if (isSvm && externalTxHash.startsWith('0x')) {
                  const bytes = new Uint8Array(Buffer.from(externalTxHash.slice(2), 'hex'));
                  const base58Hash = utils.bytes.bs58.encode(bytes);
                  const cluster = chain === CHAIN.SOLANA_DEVNET ? '?cluster=devnet'
                    : chain === CHAIN.SOLANA_TESTNET ? '?cluster=testnet' : '';
                  explorerUrl = explorerBaseUrl ? `${explorerBaseUrl}/tx/${base58Hash}${cluster}` : '';
                } else {
                  explorerUrl = explorerBaseUrl ? `${explorerBaseUrl}/tx/${externalTxHash}` : '';
                }
              }

              for (const hop of unconfirmedForChain) {
                hop.status = 'confirmed';
                hop.txHash = externalTxHash;
                hop.outboundDetails = {
                  externalTxHash,
                  destinationChain: chain || hop.executionChain,
                  explorerUrl,
                  recipient: ob.recipient,
                  amount: ob.amount,
                  assetAddr: ob.externalAssetAddr,
                };

                this.printLog(`[waitForAllOutboundTxsV2] FOUND outbound for ${destChain} | hop ${hop.hopIndex} | externalTxHash: ${externalTxHash}`);
                progressHook?.({
                  hopIndex: hop.hopIndex,
                  route: hop.route,
                  chain: hop.executionChain,
                  status: 'confirmed',
                  txHash: externalTxHash,
                });
              }
            }
          }
        }

        // Check if all hops are now confirmed
        if (outboundHops.every((h) => h.status === 'confirmed')) {
          this.printLog(`[waitForAllOutboundTxsV2] All ${outboundHops.length} hops confirmed via V2`);
          return { success: true };
        }

        // If PC_EXECUTED_SUCCESS but some hops still unresolved, check outbound status.
        // Only auto-confirm if there are NO pending outbound txs (status=1 with empty hash).
        // Pending outbounds are still in flight on the relay — keep polling for their hashes.
        if (statusNum === UniversalTxStatus.PC_EXECUTED_SUCCESS) {
          const stillUnresolved = outboundHops.filter((h) => h.status !== 'confirmed');
          if (stillUnresolved.length > 0) {
            const hasPendingOutbound = utx?.outboundTx?.some(
              (ob) =>
                ob.outboundStatus === OutboundStatus.PENDING &&
                (!ob.observedTx?.txHash || ob.observedTx.txHash === 'EMPTY')
            );

            if (!hasPendingOutbound) {
              // No pending outbounds — safe to auto-confirm remaining hops
              for (const hop of stillUnresolved) {
                hop.status = 'confirmed';
                this.printLog(`[waitForAllOutboundTxsV2] Auto-confirmed hop ${hop.hopIndex} (${hop.executionChain}) based on PC_EXECUTED_SUCCESS (no pending outbounds)`);
                progressHook?.({
                  hopIndex: hop.hopIndex,
                  route: hop.route,
                  chain: hop.executionChain,
                  status: 'confirmed',
                });
              }
              return { success: true };
            }
            // Pending outbound txs still in flight — continue polling
            this.printLog(`[waitForAllOutboundTxsV2] ${stillUnresolved.length} hop(s) unresolved, pending outbound txs in flight — continuing to poll`);
          }
        }
      } catch (error) {
        consecutiveErrors++;
        this.printLog(`[waitForAllOutboundTxsV2] Poll #${pollCount} ERROR (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}): ${error instanceof Error ? error.message : String(error)}`);
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          this.printLog(`[waitForAllOutboundTxsV2] Aborting — ${MAX_CONSECUTIVE_ERRORS} consecutive RPC errors`);
          break;
        }
      }

      await new Promise((resolve) => setTimeout(resolve, pollingIntervalMs));
    }

    // Timeout: fail any unresolved hops
    const timedOutHops = outboundHops.filter((h) => h.status !== 'confirmed');
    if (timedOutHops.length > 0) {
      this.printLog(`[waitForAllOutboundTxsV2] TIMEOUT after ${pollCount} polls | ${timedOutHops.length} hop(s) unresolved`);
      for (const hop of timedOutHops) {
        hop.status = 'failed';
        progressHook?.({
          hopIndex: hop.hopIndex,
          route: hop.route,
          chain: hop.executionChain,
          status: 'failed',
        });
      }
      return { success: false, failedAt: timedOutHops[0].hopIndex };
    }

    return { success: true };
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
    const { chain, address } = this.universalSigner.account;
    const { vm, chainId } = CHAIN_INFO[chain];

    if (this.isPushChain(chain)) {
      throw new Error('UEA cannot be computed for a Push Chain Address');
    }

    const computedAddress: `0x{string}` = await this.pushClient.readContract({
      address: this.pushClient.pushChainInfo.factoryAddress,
      abi: FACTORY_V1 as Abi,
      functionName: 'computeUEA',
      args: [
        {
          chainNamespace: VM_NAMESPACE[vm],
          chainId: chainId,
          /**
           * @dev - Owner should be in bytes
           * for eth - convert hex to bytes
           * for sol - convert base64 to bytes
           * for others - not defined yet
           */
          owner:
            vm === VM.EVM
              ? address
              : vm === VM.SVM
              ? bytesToHex(new Uint8Array(utils.bytes.bs58.decode(address)))
              : address,
        },
      ],
    });

    const byteCode = await this.pushClient.publicClient.getCode({
      address: computedAddress,
    });
    return { address: computedAddress, deployed: byteCode !== undefined };
  }

  private _buildMulticallPayloadData(
    to: `0x${string}`,
    data: MultiCall[]
  ): `0x${string}` {
    this.printLog('_buildMulticallPayloadData — input: ' + data.length + ' calls: ' + JSON.stringify(data, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));

    const allowedChains = [
      CHAIN.ETHEREUM_SEPOLIA,
      CHAIN.ARBITRUM_SEPOLIA,
      CHAIN.BASE_SEPOLIA,
      CHAIN.SOLANA_DEVNET,
      CHAIN.BNB_TESTNET,
    ];
    if (!allowedChains.includes(this.universalSigner.account.chain)) {
      throw new Error(
        'Multicall is only enabled for Ethereum Sepolia, Arbitrum Sepolia, Base Sepolia, Binance Smart Chain and Solana Devnet'
      );
    }

    // For multicall, `to` must be the executor account (UEA) of the sender
    // i.e., PushChain.universal.account
    const expectedUea = this.computeUEAOffchain();
    const toAddr = getAddress(to as `0x${string}`);
    // if (toAddr !== getAddress(expectedUea)) {
    //   throw new Error(
    //     'Multicall requires `to` to be the executor account (UEA) of the sender.'
    //   );
    // }

    // Normalize and validate calls
    const normalizedCalls = data.map((c: MultiCall) => ({
      to: getAddress(c.to),
      value: c.value,
      data: c.data,
    }));

    // bytes4(keccak256("UEA_MULTICALL")) selector, e.g., 0x4e2d2ff6-like prefix
    const selector = keccak256(toBytes('UEA_MULTICALL')).slice(
      0,
      10
    ) as `0x${string}`;

    // abi.encode(Call[]), where Call = { address to; uint256 value; bytes data; }
    const encodedCalls = encodeAbiParameters(
      [
        {
          type: 'tuple[]',
          components: [
            { name: 'to', type: 'address' },
            { name: 'value', type: 'uint256' },
            { name: 'data', type: 'bytes' },
          ],
        },
      ],
      [normalizedCalls]
    );

    // Concatenate prefix selector with encodedCalls without 0x
    return (selector + encodedCalls.slice(2)) as `0x${string}`;
  }

  private async _sendSVMTxWithFunds({
    execute,
    mechanism,
    universalPayload,
    bridgeAmount,
    nativeAmount,
    req,
  }: {
    execute: ExecuteParams;
    mechanism: 'native' | 'approve' | 'permit2' | string;
    universalPayload: UniversalPayload;
    bridgeAmount: bigint;
    nativeAmount: bigint;
    req: UniversalTxRequest;
  }): Promise<string> {
    // SVM funds+payload path
    const svmClient = new SvmClient({
      rpcUrls:
        this.rpcUrls[CHAIN.SOLANA_DEVNET] ||
        CHAIN_INFO[CHAIN.SOLANA_DEVNET].defaultRPC,
    });
    const programId = new PublicKey(SVM_GATEWAY_IDL.address);
    const [configPda] = PublicKey.findProgramAddressSync(
      [stringToBytes('config')],
      programId
    );
    const [vaultPda] = PublicKey.findProgramAddressSync(
      [stringToBytes('vault')],
      programId
    );
    const userPk = new PublicKey(this.universalSigner.account.address);
    const priceUpdatePk = new PublicKey(
      '7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE'
    );
    const [rateLimitConfigPda] = PublicKey.findProgramAddressSync(
      [stringToBytes('rate_limit_config')],
      programId
    );

    // pay-with-token gas abstraction is not supported on Solana
    if (execute.payGasWith !== undefined) {
      throw new Error('Pay-with token is not supported on Solana');
    }

    if (!execute.funds?.token?.address) {
      throw new Error('Token address is required for bridge path');
    }

    const isNative =
      mechanism === 'native' || execute.funds.token.symbol === 'SOL';
    const { feeVaultPda, protocolFeeLamports } =
      await this._getSvmProtocolFee(svmClient, programId);
    // Compute signature for universal payload on SVM
    const ueaAddressSvm = this.computeUEAOffchain();
    const ueaVersion = await this.fetchUEAVersion();
    const svmSignature = await this.signUniversalPayload(
      universalPayload,
      ueaAddressSvm,
      ueaVersion
    );
    if (isNative) {
      // Native SOL as bridge + gas
      const [tokenRateLimitPda] = PublicKey.findProgramAddressSync(
        [stringToBytes('rate_limit'), PublicKey.default.toBuffer()],
        programId
      );

      const nativeReq = this._buildSvmUniversalTxRequest({
        recipient: Array.from(Buffer.alloc(20, 0)),
        token: PublicKey.default,
        amount: bridgeAmount,
        payload: Uint8Array.from(
          this.encodeUniversalPayloadSvm(universalPayload)
        ),
        revertRecipient: userPk,
        signatureData: svmSignature,
      });

      return await svmClient.writeContract({
        abi: SVM_GATEWAY_IDL,
        address: programId.toBase58(),
        functionName: 'sendUniversalTx',
        args: [nativeReq, nativeAmount + protocolFeeLamports],
        signer: this.universalSigner,
        accounts: {
          config: configPda,
          vault: vaultPda,
          feeVault: feeVaultPda,
          userTokenAccount: vaultPda,
          gatewayTokenAccount: vaultPda,
          user: userPk,
          priceUpdate: priceUpdatePk,
          tokenProgram: new PublicKey(
            'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
          ),
          rateLimitConfig: rateLimitConfigPda,
          tokenRateLimit: tokenRateLimitPda,
          systemProgram: SystemProgram.programId,
        },
      });
    } else {
      // SPL token as bridge + native SOL lamports as gas_amount
      if (!execute.funds?.token?.address) {
        throw new Error('Token address is required for SPL bridge path');
      }
      const mintPk = new PublicKey(execute.funds.token.address);
      const TOKEN_PROGRAM_ID = new PublicKey(
        'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
      );
      const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
        'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'
      );
      const userAta = PublicKey.findProgramAddressSync(
        [userPk.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mintPk.toBuffer()],
        ASSOCIATED_TOKEN_PROGRAM_ID
      )[0];
      const vaultAta = PublicKey.findProgramAddressSync(
        [vaultPda.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mintPk.toBuffer()],
        ASSOCIATED_TOKEN_PROGRAM_ID
      )[0];

      const [tokenRateLimitPda] = PublicKey.findProgramAddressSync(
        [stringToBytes('rate_limit'), mintPk.toBuffer()],
        programId
      );

      const splReq = this._buildSvmUniversalTxRequest({
        recipient: Array.from(Buffer.alloc(20, 0)),
        token: mintPk,
        amount: bridgeAmount,
        payload: Uint8Array.from(
          this.encodeUniversalPayloadSvm(universalPayload)
        ),
        revertRecipient: userPk,
        signatureData: svmSignature,
      });

      return await svmClient.writeContract({
        abi: SVM_GATEWAY_IDL,
        address: programId.toBase58(),
        functionName: 'sendUniversalTx',
        args: [splReq, nativeAmount + protocolFeeLamports],
        signer: this.universalSigner,
        accounts: {
          config: configPda,
          vault: vaultPda,
          feeVault: feeVaultPda,
          userTokenAccount: userAta,
          gatewayTokenAccount: vaultAta,
          user: userPk,
          priceUpdate: priceUpdatePk,
          tokenProgram: TOKEN_PROGRAM_ID,
          rateLimitConfig: rateLimitConfigPda,
          tokenRateLimit: tokenRateLimitPda,
          systemProgram: SystemProgram.programId,
        },
      });
    }
  }

  computeUEAOffchain(): `0x${string}` {
    const { chain, address } = this.universalSigner.account;
    const { vm, chainId } = CHAIN_INFO[chain];

    // If already an on-chain Push EOA, just return it
    if (this.isPushChain(chain)) {
      return address as `0x${string}`;
    }

    // 1) Figure out the external‐chain ownerKey bytes
    let ownerKey: `0x${string}`;
    if (CHAIN_INFO[chain].vm === VM.EVM) {
      ownerKey = address as `0x${string}`;
    } else if (CHAIN_INFO[chain].vm === VM.SVM) {
      ownerKey = bytesToHex(new Uint8Array(utils.bytes.bs58.decode(address)));
    } else {
      throw new Error(`Unsupported VM type: ${CHAIN_INFO[chain].vm}`);
    }

    // Step 1: Recreate the salt: keccak256(abi.encode(UniversalAccount))
    const encodedAccountId = encodeAbiParameters(
      [
        {
          type: 'tuple',
          components: [
            { name: 'chainNamespace', type: 'string' },
            { name: 'chainId', type: 'string' },
            { name: 'owner', type: 'bytes' },
          ],
        },
      ],
      [{ chainNamespace: VM_NAMESPACE[vm], chainId, owner: ownerKey }]
    );

    const salt = keccak256(encodedAccountId);

    // Step 2: Clone Minimal Proxy bytecode
    const minimalProxyRuntimeCode = ('0x3d602d80600a3d3981f3' +
      '363d3d373d3d3d363d73' +
      UEA_PROXY[this.pushNetwork].toLowerCase().replace(/^0x/, '') +
      '5af43d82803e903d91602b57fd5bf3') as `0x${string}`;

    // Step 3: Get init code hash (used by CREATE2)
    const initCodeHash = keccak256(minimalProxyRuntimeCode);

    // Step 4: Predict the address using standard CREATE2 formula
    const ueaAddress = getCreate2Address({
      from: this.pushClient.pushChainInfo.factoryAddress,
      salt,
      bytecodeHash: initCodeHash,
    });

    return ueaAddress;
  }

  /**
   * @dev - Although as of now nonce var is same in evm & svm so switch conditions does not matter
   * @param address UEA address
   * @returns UEA current nonce
   */
  private async getUEANonce(address: `0x${string}`): Promise<bigint> {
    const chain = this.universalSigner.account.chain;
    const { vm } = CHAIN_INFO[chain];

    switch (vm) {
      case VM.EVM: {
        return this.pushClient.readContract({
          address,
          abi: UEA_EVM as Abi,
          functionName: 'nonce',
        });
      }

      case VM.SVM: {
        return this.pushClient.readContract({
          address,
          abi: UEA_SVM as Abi,
          functionName: 'nonce',
        });
      }

      default: {
        throw new Error(`Unsupported VM type: ${vm}`);
      }
    }
  }

  // TODO: Fix this fn - It needs to get UOA for a given UEA
  getUOA(): UniversalAccount {
    return {
      chain: this.universalSigner.account.chain,
      address: this.universalSigner.account.address,
    };
  }

  private async waitForLockerFeeConfirmation(
    txHashBytes: Uint8Array
  ): Promise<void> {
    const chain = this.universalSigner.account.chain;
    const { vm, defaultRPC, fastConfirmations, timeout } = CHAIN_INFO[chain];
    const rpcUrls = this.rpcUrls[chain] || defaultRPC;

    switch (vm) {
      case VM.EVM: {
        const evmClient = new EvmClient({ rpcUrls });
        await this.waitForEvmConfirmationsWithCountdown(
          evmClient,
          bytesToHex(txHashBytes),
          fastConfirmations,
          timeout
        );
        return;
      }

      case VM.SVM: {
        const svmClient = new SvmClient({ rpcUrls });
        await this.waitForSvmConfirmationsWithCountdown(
          svmClient,
          utils.bytes.bs58.encode(txHashBytes),
          fastConfirmations,
          timeout
        );
        return;
      }

      default:
        throw new Error(`Unsupported VM for tx confirmation: ${vm}`);
    }
  }

  /**
   * Internal helper: fetches the full origin-chain transaction for a given hash,
   * used only for progress-hook context (EVM or Solana).
   */
  private async fetchOriginChainTransactionForProgress(
    chain: CHAIN,
    txHashHex: string,
    txHashDisplay: string
  ): Promise<object | undefined> {
    const { vm, defaultRPC } = CHAIN_INFO[chain];
    const rpcUrls = this.rpcUrls[chain] || defaultRPC;

    try {
      if (vm === VM.EVM) {
        if (!txHashHex.startsWith('0x')) {
          throw new Error('EVM transaction hash must be 0x-prefixed');
        }
        const evmClient = new EvmClient({ rpcUrls });
        const tx = await evmClient.publicClient.getTransaction({
          hash: txHashHex as `0x${string}`,
        });
        return tx ?? undefined;
      }

      if (vm === VM.SVM) {
        const connection = new Connection(rpcUrls[0], 'confirmed');
        const tx = await connection.getTransaction(txHashDisplay, {
          maxSupportedTransactionVersion: 0,
          commitment: 'confirmed',
        } as any);
        return tx ?? undefined;
      }

      return undefined;
    } catch {
      return undefined;
    }
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
    const originChain = this.universalSigner.account.chain;
    if (
      originChain !== CHAIN.ETHEREUM_MAINNET &&
      originChain !== CHAIN.ETHEREUM_SEPOLIA
    ) {
      throw new Error(
        'Exact-output quoting is only supported on Ethereum Mainnet and Sepolia for now'
      );
    }

    if (!from) {
      throw new Error('from token is required');
    }
    if (!to) {
      throw new Error('to token is required');
    }

    const rpcUrls =
      this.getRpcUrls()[originChain] || CHAIN_INFO[originChain].defaultRPC;
    const evm = new EvmClient({ rpcUrls });

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
      'function quoteExactOutputSingle((address tokenIn, address tokenOut, uint256 amount, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountIn, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
    ]);
    const poolAbi: Abi = parseAbi([
      'function liquidity() view returns (uint128)',
    ]);

    const feeTiers: number[] = [100, 500, 3000, 10000];

    let bestAmountIn: bigint | null = null;
    let bestFee: number | null = null;

    for (const fee of feeTiers) {
      // Find pool address for this fee tier
      const poolAddress = await evm.readContract<string>({
        abi: factoryAbi,
        address: UNISWAP_V3_FACTORY,
        functionName: 'getPool',
        args: [from.address as `0x${string}`, to.address as `0x${string}`, fee],
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
        if (!liquidity || liquidity === BigInt(0)) continue;
      } catch {
        continue;
      }

      // Quote exact output single for this fee tier
      try {
        const result = await evm.readContract<[bigint, bigint, number, bigint]>(
          {
            abi: quoterAbi,
            address: UNISWAP_V3_QUOTER_V2,
            functionName: 'quoteExactOutputSingle',
            args: [
              {
                tokenIn: from.address as `0x${string}`,
                tokenOut: to.address as `0x${string}`,
                amount: amountOut,
                fee,
                sqrtPriceLimitX96: BigInt(0),
              },
            ],
          }
        );
        const amountIn = result?.[0] ?? BigInt(0);
        if (amountIn === BigInt(0)) continue;
        if (bestAmountIn === null || amountIn < bestAmountIn) {
          bestAmountIn = amountIn;
          bestFee = fee;
        }
      } catch {
        // try next fee
      }
    }

    if (bestAmountIn === null || bestFee === null) {
      throw new Error(
        'No direct Uniswap V3 pool found for the given token pair on common fee tiers'
      );
    }

    const amountInBig = BigInt(bestAmountIn);
    const amountInHuman = parseFloat(
      Utils.helpers.formatUnits(amountInBig, {
        decimals: from.decimals,
      })
    );
    const amountOutHuman = parseFloat(
      Utils.helpers.formatUnits(amountOut, { decimals: to.decimals })
    );
    const rate = amountInHuman > 0 ? amountOutHuman / amountInHuman : 0;

    return {
      amountIn: bestAmountIn.toString(),
      amountOut: amountOut.toString(),
      rate,
      route: [from.symbol, to.symbol],
      timestamp: Date.now(),
    };
  }

  private async ensureErc20Allowance(
    evmClient: EvmClient,
    tokenAddress: `0x${string}`,
    spender: `0x${string}`,
    requiredAmount: bigint
  ): Promise<void> {
    const chain = this.universalSigner.account.chain;
    const owner = this.universalSigner.account.address as `0x${string}`;

    const currentAllowance = await evmClient.readContract<bigint>({
      abi: ERC20_EVM as Abi,
      address: tokenAddress,
      functionName: 'allowance',
      args: [owner, spender],
    });

    if (currentAllowance >= requiredAmount) return;

    // Some ERC-20s like USDT require setting allowance to 0 before changing
    // an existing non-zero allowance to a different non-zero value.
    if (currentAllowance > BigInt(0)) {
      this.printLog(
        `Resetting existing allowance from ${currentAllowance.toString()} to 0 for spender ${spender}`
      );
      const resetTxHash = await evmClient.writeContract({
        abi: ERC20_EVM as Abi,
        address: tokenAddress,
        functionName: 'approve',
        args: [spender, BigInt(0)],
        signer: this.universalSigner,
      });
      await evmClient.waitForConfirmations({
        txHash: resetTxHash,
        confirmations: 1,
        timeoutMs: CHAIN_INFO[chain].timeout,
      });
    }

    const setTxHash = await evmClient.writeContract({
      abi: ERC20_EVM as Abi,
      address: tokenAddress,
      functionName: 'approve',
      args: [spender, requiredAmount],
      signer: this.universalSigner,
    });

    await evmClient.waitForConfirmations({
      txHash: setTxHash,
      confirmations: 1,
      timeoutMs: CHAIN_INFO[chain].timeout,
    });

    try {
      const updated = await evmClient.readContract<bigint>({
        abi: ERC20_EVM as Abi,
        address: tokenAddress,
        functionName: 'allowance',
        args: [owner, spender],
      });
      if (updated < requiredAmount) {
        this.printLog('Warning: allowance not updated yet; proceeding');
      }
    } catch {
      // ignore
    }
  }

  /**
   * Ensures we're on Sepolia, returns EVM client and gateway address.
   */
  private getOriginGatewayContext(): {
    chain: CHAIN;
    evmClient?: EvmClient;
    gatewayAddress?: `0x${string}`;
  } {
    const chain = this.universalSigner.account.chain;
    if (
      chain !== CHAIN.ETHEREUM_SEPOLIA &&
      chain !== CHAIN.ARBITRUM_SEPOLIA &&
      chain !== CHAIN.BASE_SEPOLIA &&
      chain !== CHAIN.BNB_TESTNET &&
      chain !== CHAIN.SOLANA_DEVNET
    ) {
      throw new Error(
        'Funds + payload bridging is only supported on Ethereum Sepolia, Arbitrum Sepolia, Base Sepolia, BNB Testnet, and Solana Devnet for now'
      );
    }

    // For EVM (Sepolia), return client and gateway address. For SVM (Solana Devnet), only chain is needed here.
    if (CHAIN_INFO[chain].vm === VM.EVM) {
      const { defaultRPC, lockerContract } = CHAIN_INFO[chain];
      const rpcUrls: string[] = this.rpcUrls[chain] || defaultRPC;
      const evmClient = new EvmClient({ rpcUrls });
      const gatewayAddress = lockerContract as `0x${string}`;
      if (!gatewayAddress) {
        throw new Error('Universal Gateway address not configured');
      }
      return { chain, evmClient, gatewayAddress };
    }

    // SVM path (Solana Devnet) does not require evmClient/gatewayAddress
    return { chain };
  }

  /**
   * Computes UEA and fetches its nonce if deployed; returns 0 otherwise.
   */
  private async getUeaNonceForExecution(): Promise<bigint> {
    const UEA = this.computeUEAOffchain();
    const [code] = await Promise.all([
      this.pushClient.publicClient.getCode({ address: UEA }),
    ]);
    return code !== undefined ? await this.getUEANonce(UEA) : BigInt(0);
  }

  /**
   * Returns UEA deployment status and nonce (0 if not deployed).
   */
  private async getUeaStatusAndNonce(): Promise<{
    deployed: boolean;
    nonce: bigint;
  }> {
    const UEA = this.computeUEAOffchain();
    const [code] = await Promise.all([
      this.pushClient.publicClient.getCode({ address: UEA }),
    ]);
    const deployed = code !== undefined;
    const nonce = deployed ? await this.getUEANonce(UEA) : BigInt(0);
    return { deployed, nonce };
  }

  /**
   * For sendFunds, we will call internally the sendTxWithFunds.
   */
  private async buildGatewayPayloadAndGas(
    execute: ExecuteParams,
    nonce: bigint,
    type: 'sendFunds' | 'sendTxWithFunds',
    fundsValue?: bigint
  ): Promise<{ payload: never; gasAmount: bigint; req: UniversalTxRequest }> {
    const gasEstimate = execute.gasLimit || BigInt(1e7);
    const gasAmount = execute.value ?? BigInt(0);

    if (type === 'sendTxWithFunds') {
      if (!execute.funds?.token)
        throw new Error(`Invalid ${execute.funds?.token}`);

      const multicallData: MultiCall[] = buildExecuteMulticall({
        execute,
        ueaAddress: this.computeUEAOffchain(),
      });
      // THIS ABOVE WILL CHANGE WHEN FUNDS ARE PASSED
      const universalPayload = {
        to: zeroAddress,
        value: execute.value ?? BigInt(0),
        // data: execute.data || '0x',
        data: this._buildMulticallPayloadData(execute.to, multicallData),
        gasLimit: gasEstimate,
        maxFeePerGas: execute.maxFeePerGas || BigInt(1e10),
        maxPriorityFeePerGas: execute.maxPriorityFeePerGas || BigInt(0),
        nonce,
        deadline: execute.deadline || BigInt(9999999999),
        vType: VerificationType.universalTxVerification,
      } as unknown as never;
      
      this.printLog('(universalPayload) ' + universalPayload);

      // Temporary while we don't change the native address from 0xeee... to 0x0000...
      let tokenAddress = execute.funds?.token?.address as `0x${string}`;
      if (
        execute.funds?.token?.address ===
        '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
      ) {
        tokenAddress = zeroAddress;
      }

      const req = this._buildUniversalTxRequest({
        recipient: zeroAddress,
        token: tokenAddress,
        amount: execute.funds?.amount as bigint,
        payload: this.encodeUniversalPayload(universalPayload),
      });

      return { payload: universalPayload, gasAmount, req };
    } else {
      if (!fundsValue) throw new Error('fundsValue property must not be empty');
      const multicallData: MultiCall[] = buildExecuteMulticall({
        execute,
        ueaAddress: this.computeUEAOffchain(),
      });

      // // The data will be the abi-encoded transfer function from erc-20 function. The recipient will be `execute.to`, the value
      // // will be the fundsValue property.
      // const data = encodeFunctionData({
      //   abi: ERC20_EVM,
      //   functionName: 'transfer',
      //   args: [execute.to, fundsValue],
      // });
      // const pushChainTo = PushChain.utils.tokens.getPRC20Address(
      //   execute.funds!.token as MoveableToken
      // );
      this.printLog('sendFunds — execute params: ' + JSON.stringify({
        to: execute.to,
        value: execute.value?.toString() ?? 'undefined',
        data: execute.data ?? 'undefined',
        fundsAmount: execute.funds?.amount?.toString(),
        fundsToken: execute.funds?.token?.symbol,
        tokenMechanism: execute.funds?.token?.mechanism,
        tokenAddress: execute.funds?.token?.address,
        gasLimit: execute.gasLimit?.toString() ?? 'undefined',
      }, null, 2));

      this.printLog('sendFunds — multicallData: ' + JSON.stringify(
        multicallData,
        (_, v) => typeof v === 'bigint' ? v.toString() : v,
        2
      ) + ' (length: ' + multicallData.length + ')');

      const multicallPayloadData =
         this._buildMulticallPayloadData(execute.to, multicallData)
      

      
      this.printLog('sendFunds — multicallPayloadData (first 66 chars): ' + multicallPayloadData.slice(0, 66) + ' (full length: ' + multicallPayloadData.length + ')');

     
      const universalPayload = {
        to: zeroAddress, // We can't simply do `0x` because we will get an error when eip712 signing the transaction.
        value: execute.value ?? BigInt(0),
        data: multicallPayloadData,
        // data: this._buildMulticallPayloadData(execute.to, [
        //   { to: pushChainTo, value: execute.value ?? BigInt(0), data },
        // ]),
        gasLimit: gasEstimate,
        maxFeePerGas: execute.maxFeePerGas || BigInt(1e10),
        maxPriorityFeePerGas: execute.maxPriorityFeePerGas || BigInt(0),
        nonce,
        deadline: execute.deadline || BigInt(9999999999),
        vType: VerificationType.universalTxVerification,
      } as unknown as never;

      this.printLog('sendFunds — universalPayload (pre-encode): ' + JSON.stringify({
        to: zeroAddress,
        value: (execute.value ?? BigInt(0)).toString(),
        data: multicallPayloadData,
        gasLimit: gasEstimate.toString(),
        maxFeePerGas: (execute.maxFeePerGas || BigInt(1e10)).toString(),
        maxPriorityFeePerGas: (execute.maxPriorityFeePerGas || BigInt(0)).toString(),
        nonce: nonce.toString(),
        deadline: (execute.deadline || BigInt(9999999999)).toString(),
      }, null, 2));

      // Temporary while we don't change the native address from 0xeee... to 0x0000...
      let tokenAddress = execute.funds?.token?.address as `0x${string}`;
      if (
        execute.funds?.token?.address ===
        '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
      ) {
        tokenAddress = zeroAddress;
      }

      const encodedPayload = this.encodeUniversalPayload(universalPayload);
      this.printLog('sendFunds — encodedPayload (first 66 chars): ' + encodedPayload.slice(0, 66) + ' (full length: ' + encodedPayload.length + ')');

      const req = this._buildUniversalTxRequest({
        recipient: zeroAddress,
        token: tokenAddress,
        amount: execute.funds?.amount as bigint,
        payload: encodedPayload,
      });

      this.printLog('sendFunds — final req: ' + JSON.stringify({
        recipient: zeroAddress,
        token: tokenAddress,
        amount: (execute.funds?.amount as bigint)?.toString(),
        payloadLength: encodedPayload.length,
      }, null, 2));

      return { payload: universalPayload, gasAmount, req };
    }
  }

  /********************************** HELPER FUNCTIONS **************************************************/

  /**
   * Transforms a TransactionReceipt to UniversalTxReceipt format
   */
  private transformToUniversalTxReceipt(
    receipt: TransactionReceipt, // TransactionReceipt from viem
    originalTxResponse: UniversalTxResponse
  ): UniversalTxReceipt {
    return {
      // 1. Identity
      hash: receipt.transactionHash,

      // 2. Block Info
      blockNumber: receipt.blockNumber,
      blockHash: receipt.blockHash,
      transactionIndex: receipt.transactionIndex,

      // 3. Execution Context
      from: originalTxResponse.from,
      to: originalTxResponse.to,
      contractAddress: receipt.contractAddress || null,

      // 4. Gas & Usage
      gasPrice: originalTxResponse.gasPrice || BigInt(0),
      gasUsed: receipt.gasUsed,
      cumulativeGasUsed: receipt.cumulativeGasUsed,

      // 5. Logs
      logs: receipt.logs || [],
      logsBloom: receipt.logsBloom || '0x',

      // 6. Outcome
      status: receipt.status === 'success' ? 1 : 0,

      // 7. Raw
      raw: originalTxResponse.raw || {
        from: originalTxResponse.from,
        to: originalTxResponse.to,
      },
    };
  }

  /**
   * Transforms a TxResponse to the new UniversalTxResponse format
   */
  private async transformToUniversalTxResponse(
    tx: TxResponse,
    eventBuffer: ProgressEvent[] = []
  ): Promise<UniversalTxResponse> {
    const chain = this.universalSigner.account.chain;
    const { vm, chainId } = CHAIN_INFO[chain];
    let from: `0x${string}`;
    let to: `0x${string}`;
    let value: bigint;
    let data: string;
    let rawTransactionData: {
      from: string;
      to: string;
      nonce: number;
      data: string;
      value: bigint;
    };

    const ueaOrigin =
      await PushChain.utils.account.convertExecutorToOriginAccount(
        tx.to as `0x${string}`
      );
    let originAddress: string;

    if (ueaOrigin.exists) {
      if (!ueaOrigin.account) {
        throw new Error('UEA origin account is null');
      }
      originAddress = ueaOrigin.account.address;
      from = getAddress(tx.to as `0x${string}`);

      let decoded;

      if (tx.input !== '0x') {
        decoded = decodeFunctionData({
          abi: UEA_EVM,
          data: tx.input,
        });
        if (!decoded?.args) {
          throw new Error('Failed to decode function data');
        }
        const universalPayload = decoded?.args[0] as {
          to: string;
          value: bigint;
          data: string;
          gasLimit: bigint;
          maxFeePerGas: bigint;
          maxPriorityFeePerGas: bigint;
          nonce: bigint;
          deadline: bigint;
          vType: number;
        };

        to = universalPayload.to as `0x${string}`;
        value = BigInt(universalPayload.value);
        data = universalPayload.data;

        // Extract 'to' from single-element multicall
        if (data && data.length >= 10) {
          const multicallSelector = keccak256(toBytes('UEA_MULTICALL')).slice(
            0,
            10
          );
          if (data.slice(0, 10) === multicallSelector) {
            try {
              const innerData = ('0x' + data.slice(10)) as `0x${string}`;
              const [decodedCalls] = decodeAbiParameters(
                [
                  {
                    type: 'tuple[]',
                    components: [
                      { name: 'to', type: 'address' },
                      { name: 'value', type: 'uint256' },
                      { name: 'data', type: 'bytes' },
                    ],
                  },
                ],
                innerData
              );
              // If single call, use its 'to' address
              if (decodedCalls.length === 1) {
                to = getAddress(decodedCalls[0].to) as `0x${string}`;
              }
            } catch {
              // Keep original 'to' if decoding fails
            }
          }
        }

        rawTransactionData = {
          from: getAddress(tx.from),
          to: getAddress(tx.to as `0x${string}`),
          nonce: tx.nonce,
          data: tx.input,
          value: tx.value,
        };
      } else {
        to = getAddress(tx.to as `0x${string}`);
        value = tx.value;
        data = tx.input;
        rawTransactionData = {
          from: getAddress(tx.from),
          to: getAddress(tx.to as `0x${string}`),
          nonce: tx.nonce,
          data: tx.input,
          value: tx.value,
        };
      }
    } else {
      originAddress = getAddress(tx.from);
      from = getAddress(tx.from);
      to = getAddress(tx.to as `0x${string}`);
      value = tx.value;
      data = tx.input;
      rawTransactionData = {
        from: getAddress(tx.from),
        to: getAddress(tx.to as `0x${string}`),
        nonce: tx.nonce,
        data: tx.input,
        value: tx.value,
      };
    }

    // Extract 'to' and 'from' from depositPRC20WithAutoSwap (precompile call)
    if (data && data.length >= 10) {
      const depositPRC20Selector = '0x780ad827';
      if (data.slice(0, 10) === depositPRC20Selector) {
        try {
          const decoded = decodeFunctionData({
            abi: [
              {
                name: 'depositPRC20WithAutoSwap',
                type: 'function',
                inputs: [
                  { name: 'prc20', type: 'address' },
                  { name: 'amount', type: 'uint256' },
                  { name: 'target', type: 'address' },
                  { name: 'fee', type: 'uint24' },
                  { name: 'minPCOut', type: 'uint256' },
                  { name: 'deadline', type: 'uint256' },
                ],
              },
            ] as const,
            data: data as `0x${string}`,
          });
          if (decoded.args) {
            const target = decoded.args[2] as `0x${string}`;
            to = getAddress(target);
            from = '0x0000000000000000000000000000000000000000';
          }
        } catch {
          // Keep original values if decoding fails
        }
      }
    }

    const origin = `${VM_NAMESPACE[vm]}:${chainId}:${originAddress}`;

    // Create signature from transaction r, s, v values
    let signature: Signature;
    try {
      signature = {
        r: tx.r || '0x0',
        s: tx.s || '0x0',
        v: typeof tx.v === 'bigint' ? Number(tx.v) : tx.v || 0,
        yParity: tx.yParity,
      };
    } catch {
      // Fallback signature if parsing fails
      signature = {
        r: '0x0000000000000000000000000000000000000000000000000000000000000000',
        s: '0x0000000000000000000000000000000000000000000000000000000000000000',
        v: 0,
        yParity: 0,
      };
    }

    // Determine transaction type and typeVerbose
    let type = '99'; // universal
    let typeVerbose = 'universal';

    if (tx.type !== undefined) {
      const txType = tx.type;
      if (txType === 'eip1559') {
        type = '2';
        typeVerbose = 'eip1559';
      } else if (txType === 'eip2930') {
        type = '1';
        typeVerbose = 'eip2930';
      } else if (txType === 'legacy') {
        type = '0';
        typeVerbose = 'legacy';
      } else if (txType == 'eip4844') {
        type = '3';
        typeVerbose = 'eip4844';
      }
    }

    // Storage for registered progress callback (used by progressHook method)
    let registeredProgressHook: ((event: ProgressEvent) => void) | undefined;

    const universalTxResponse: UniversalTxResponse = {
      // 1. Identity
      hash: tx.hash,
      origin,

      // 2. Block Info
      blockNumber: tx.blockNumber || BigInt(0),
      blockHash: tx.blockHash || '',
      transactionIndex: tx.transactionIndex || 0,
      chainId,

      // 3. Execution Context
      from: from, // UEA (executor) address, checksummed for EVM
      to: to || '',
      nonce: tx.nonce,

      // 4. Payload
      data, // perceived calldata (was input)
      value,

      // 5. Gas
      gasLimit: tx.gas || BigInt(0), // (was gas)
      gasPrice: tx.gasPrice,
      maxFeePerGas: tx.maxFeePerGas,
      maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
      accessList: Array.isArray(tx.accessList) ? [...tx.accessList] : [],

      // 6. Utilities
      wait: async (): Promise<UniversalTxReceipt> => {
        // Use trackTransaction with registered hook if available
        let baseReceipt: UniversalTxReceipt;
        if (registeredProgressHook) {
          const trackedResponse = await this.trackTransaction(tx.hash, {
            waitForCompletion: true,
            progressHook: registeredProgressHook,
          });
          // Get receipt from the tracked response
          const receipt = await tx.wait();
          baseReceipt = this.transformToUniversalTxReceipt(receipt, trackedResponse);
        } else {
          const receipt = await tx.wait();
          baseReceipt = this.transformToUniversalTxReceipt(receipt, universalTxResponse);
        }

        // If outbound route (Route 2: UOA → CEA, Route 3: CEA → Push), poll for external chain details
        if (
          universalTxResponse.route === TransactionRoute.UOA_TO_CEA ||
          universalTxResponse.route === TransactionRoute.CEA_TO_PUSH
        ) {
          try {
            const outboundDetails = await this.waitForOutboundTx(
              tx.hash,
              {
                initialWaitMs: Orchestrator.OUTBOUND_INITIAL_WAIT_MS,
                pollingIntervalMs: Orchestrator.OUTBOUND_POLL_INTERVAL_MS,
                timeout: Orchestrator.OUTBOUND_MAX_TIMEOUT_MS,
              }
            );
            // Merge external chain details into receipt
            baseReceipt = {
              ...baseReceipt,
              externalTxHash: outboundDetails.externalTxHash,
              externalChain: outboundDetails.destinationChain,
              externalExplorerUrl: outboundDetails.explorerUrl,
              externalRecipient: outboundDetails.recipient,
              externalAmount: outboundDetails.amount,
              externalAssetAddr: outboundDetails.assetAddr,
            };
          } catch (error) {
            // Outbound polling timed out - return partial receipt (don't throw)
            // Push Chain tx succeeded, external tracking can be retried later
            this.printLog(`[wait] External chain tracking failed: ${error instanceof Error ? error.message : String(error)}`);
          }
        }

        return baseReceipt;
      },

      progressHook: (
        callback: (event: ProgressEvent) => void
      ): void => {
        registeredProgressHook = callback;

        // Immediately replay buffered events from execution
        if (eventBuffer.length > 0) {
          for (const event of eventBuffer) {
            callback(event);
          }
        }
      },

      // 7. Metadata
      type,
      typeVerbose,
      signature,

      // 8. Raw Universal Fields
      raw: rawTransactionData,
    };

    return universalTxResponse;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private bigintReplacer(_key: string, value: any) {
    return typeof value === 'bigint'
      ? value.toString() // convert BigInt to string
      : value;
  }

  /**
   * Checks if the given chain belongs to the Push Chain ecosystem.
   * Used to differentiate logic for Push-native interactions vs external chains.
   *
   * @param chain - The chain identifier (e.g., PUSH_MAINNET, PUSH_TESTNET_DONUT)
   * @returns True if the chain is a Push chain, false otherwise.
   */
  private isPushChain(chain: CHAIN): boolean {
    return (
      chain === CHAIN.PUSH_MAINNET ||
      chain === CHAIN.PUSH_TESTNET_DONUT ||
      chain === CHAIN.PUSH_LOCALNET
    );
  }

  private validateMainnetConnection(chain: CHAIN) {
    const isMainnet = [CHAIN.ETHEREUM_MAINNET, CHAIN.SOLANA_MAINNET].includes(
      chain
    );
    if (
      isMainnet &&
      this.pushClient.pushChainInfo.chainId !==
        CHAIN_INFO[CHAIN.PUSH_MAINNET].chainId
    ) {
      throw new Error('Mainnet chains can only interact with Push Mainnet');
    }
  }

  private printLog(log: string): void {
    if (this.printTraces) {
      console.log(`[${this.constructor.name}] ${log}`);
    }
  }

  private executeProgressHook(hookId: string, ...args: any[]): void {
    const hookEntry = PROGRESS_HOOKS[hookId];
    const hookPayload: ProgressEvent = hookEntry(...args);
    this.printLog(hookPayload.message);

    if (this.progressHook) {
      this.progressHook(hookPayload);
    }
  }

  // Derive the SVM gateway log index from a Solana transaction's log messages
  private getSvmGatewayLogIndexFromTx(txResp: any): number {
    const logs: string[] = (txResp?.meta?.logMessages || []) as string[];
    if (!Array.isArray(logs) || logs.length === 0) return 0;

    const prefix = 'Program data: ';
    let matchCount = 0;
    let lastMatchIndex = -1;

    for (let i = 0; i < logs.length; i++) {
      const log = logs[i] || '';
      if (!log.startsWith(prefix)) continue;

      const base64Data = log.slice(prefix.length).trim();
      let decoded: Uint8Array | null = null;
      try {
        decoded = new Uint8Array(Buffer.from(base64Data, 'base64'));
      } catch {
        continue;
      }

      if (!decoded || decoded.length < 8) continue;
      const discriminatorHex = bytesToHex(decoded.slice(0, 8)).slice(2);

      // Skip add_funds discriminator; return the second matching Program data event
      // if (discriminatorHex === '7f1f6cffbb134644') continue;
      if (discriminatorHex === '6c9ad829b5ea1d7c') {
        matchCount++;
        lastMatchIndex = i;
        if (matchCount === 2) return i;
      }
      // return i;
    }

    // If only one match was found, keep previous behavior and return that one.
    if (lastMatchIndex !== -1) return lastMatchIndex;

    // Fallback to first log
    return 0;
  }

  // Query Push Chain for UniversalTx status given an origin gateway tx (EVM or SVM)
  private async queryUniversalTxStatusFromGatewayTx(
    evmClient: EvmClient | undefined,
    gatewayAddress: `0x${string}` | undefined,
    txHash: string,
    evmGatewayMethod: 'sendFunds' | 'sendTxWithFunds' | 'sendTxWithGas'
  ): Promise<UniversalTx | undefined> {
    try {
      const chain = this.universalSigner.account.chain;
      const { vm } = CHAIN_INFO[chain];

      let logIndexStr = '0';
      let txHashHex: `0x${string}` | string = txHash;

      if (vm === VM.EVM) {
        if (!evmClient || !gatewayAddress)
          throw new Error('Missing EVM context');
        let receipt;
        try {
          receipt = await evmClient.publicClient.getTransactionReceipt({
            hash: txHash as `0x${string}`,
          });
        } catch {
          // Receipt might not be indexed yet on this RPC; wait briefly for it
          receipt = await evmClient.publicClient.waitForTransactionReceipt({
            hash: txHash as `0x${string}`,
            confirmations: 0,
            timeout: CHAIN_INFO[chain].timeout,
          });
        }
        const gatewayLogs = (receipt.logs || []).filter(
          (l: any) =>
            (l.address || '').toLowerCase() === gatewayAddress.toLowerCase()
        );
        this.printLog(`queryUniversalTxStatus — receipt logs count: ${receipt.logs?.length}, gateway logs count: ${gatewayLogs.length}, evmGatewayMethod: ${evmGatewayMethod}`);
        this.printLog('queryUniversalTxStatus — gatewayLogs: ' + JSON.stringify(
          gatewayLogs.map((l: any) => ({ address: l.address, logIndex: l.logIndex, topics: l.topics?.[0] })),
          null, 2));
        // TEMP: use last gateway log instead of hardcoded 0/1 index
        const logIndexToUse = gatewayLogs.length - 1;
        const firstLog = (gatewayLogs[logIndexToUse] ||
          (receipt.logs || []).at(-1)) as any;
        const logIndexVal = firstLog?.logIndex ?? 0;
        this.printLog(`queryUniversalTxStatus — logIndexToUse: ${logIndexToUse}, firstLog.logIndex: ${firstLog?.logIndex}, logIndexVal: ${logIndexVal}`);
        logIndexStr =
          typeof logIndexVal === 'bigint'
            ? logIndexVal.toString()
            : String(logIndexVal);
      } else if (vm === VM.SVM) {
        // Normalize Solana signature to 0x-hex for ID composition
        let txSignature = txHash;
        if (!txHash.startsWith('0x')) {
          const decoded = utils.bytes.bs58.decode(txHash);
          txHashHex = bytesToHex(new Uint8Array(decoded));
        } else {
          // When provided as hex, convert to base58 for RPC
          const hex = txHash.slice(2);
          const bytes = Uint8Array.from(Buffer.from(hex, 'hex'));
          txSignature = utils.bytes.bs58.encode(bytes);
        }

        // Fetch transaction by initializing a Connection and calling Solana RPC
        const rpcUrls: string[] =
          this.rpcUrls[chain] || CHAIN_INFO[chain].defaultRPC;
        const connection = new Connection(rpcUrls[0], 'confirmed');
        const txResp = await connection.getTransaction(txSignature, {
          maxSupportedTransactionVersion: 0,
          commitment: 'confirmed',
        } as any);
        // Derive proper log index using discriminator matching
        const svmLogIndex = this.getSvmGatewayLogIndexFromTx(txResp);
        logIndexStr = String(svmLogIndex);
      }

      const sourceChain = `${VM_NAMESPACE[vm]}:${CHAIN_INFO[chain].chainId}`;

      // ID = sha256("${sourceChain}:${txHash}:${logIndex}") as hex string (no 0x)
      const idInput = `${sourceChain}:${txHashHex}:${logIndexStr}`;
      const idHex = sha256(stringToBytes(idInput)).slice(2);

      this.printLog('Query ID extraction: ' + JSON.stringify({
        sourceChain,
        txHashHex,
        logIndexStr,
        idInput,
        idHex,
      }, null, 2));

      // Fetch UniversalTx via gRPC with linear-then-exponential retry
      const LINEAR_ATTEMPTS = 25;
      const LINEAR_DELAY_MS = 1500;
      const EXPONENTIAL_BASE_MS = 2000;
      const MAX_ATTEMPTS = 30;

      let universalTxObj: any | undefined;
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        this.printLog(`[Sync] Attempt ${attempt + 1}/${MAX_ATTEMPTS} | Query ID: ${idHex}`);
        try {
          const universalTxResp = await this.pushClient.getUniversalTxById(
            idHex
          );
          universalTxObj = universalTxResp?.universalTx;
          if (universalTxObj) {
            break;
          }
        } catch (error) {
          // ignore and retry
        }

        // Linear delay for first N attempts, then exponential backoff
        let delay: number;
        if (attempt < LINEAR_ATTEMPTS) {
          delay = LINEAR_DELAY_MS;
        } else {
          // Exponential: 2000, 4000, 8000, 16000, ...
          const exponentialAttempt = attempt - LINEAR_ATTEMPTS;
          delay = EXPONENTIAL_BASE_MS * Math.pow(2, exponentialAttempt);
        }
        await new Promise((r) => setTimeout(r, delay));
      }

      return universalTxObj;
    } catch (err) {
      return undefined;
    }
  }

  // Emit countdown updates while waiting for EVM confirmations
  private async waitForEvmConfirmationsWithCountdown(
    evmClient: EvmClient,
    txHash: `0x${string}`,
    confirmations: number,
    timeoutMs: number
  ): Promise<void> {
    // Skip waiting if zero confirmations requested
    if (confirmations <= 0) {
      this.executeProgressHook(PROGRESS_HOOK.SEND_TX_06_03_02, 0, 0);
      return;
    }

    // initial emit
    this.executeProgressHook(PROGRESS_HOOK.SEND_TX_06_03, confirmations);
    const start = Date.now();

    // Wait for receipt to get included block
    const receipt = await evmClient.publicClient.waitForTransactionReceipt({
      hash: txHash,
    });
    const targetBlock = receipt.blockNumber + BigInt(confirmations);

    // Track last emitted confirmation to avoid duplicates
    let lastEmitted = 0;

    // Poll blocks and emit remaining confirmations
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const currentBlock = await evmClient.publicClient.getBlockNumber();

      // If already confirmed, emit progress for final confirmation
      if (currentBlock >= targetBlock) {
        // Only emit if we haven't already shown this confirmation
        if (lastEmitted < confirmations) {
          this.executeProgressHook(
            PROGRESS_HOOK.SEND_TX_06_03_02,
            confirmations,
            confirmations
          );
        }
        return;
      }

      const remaining = Number(targetBlock - currentBlock);
      const completed = Math.max(1, confirmations - remaining + 1);

      // Only emit if this is a new confirmation count
      if (completed > lastEmitted) {
        this.executeProgressHook(
          completed >= confirmations
            ? PROGRESS_HOOK.SEND_TX_06_03_02
            : PROGRESS_HOOK.SEND_TX_06_03_01,
          completed,
          confirmations
        );
        lastEmitted = completed;

        // If we've reached required confirmations, we're done
        if (completed >= confirmations) {
          return;
        }
      }

      if (Date.now() - start > timeoutMs) {
        throw new Error(
          `Timeout: transaction ${txHash} not confirmed with ${confirmations} confirmations within ${timeoutMs} ms`
        );
      }

      await new Promise((r) => setTimeout(r, 12000));
    }
  }

  // Emit countdown updates while waiting for SVM confirmations
  private async waitForSvmConfirmationsWithCountdown(
    svmClient: SvmClient,
    txSignature: string,
    confirmations: number,
    timeoutMs: number
  ): Promise<void> {
    // Skip waiting if zero confirmations requested
    if (confirmations <= 0) {
      this.executeProgressHook(PROGRESS_HOOK.SEND_TX_06_03_02, 0, 0);
      return;
    }

    // initial emit
    this.executeProgressHook(PROGRESS_HOOK.SEND_TX_06_03, confirmations);
    const start = Date.now();

    // Poll for confirmations and emit progress
    let lastConfirmed = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const connection = (svmClient as any).connections[
        (svmClient as any).currentConnectionIndex
      ];
      const { value } = await connection.getSignatureStatuses([txSignature]);
      const status = value[0];

      if (status) {
        // Surface transaction failures explicitly
        if (status.err) {
          throw new Error(
            `SVM transaction ${txSignature} failed: ${JSON.stringify(
              status.err
            )}`
          );
        }

        const rawConfirmations = status.confirmations;
        const hasNumericConfirmations = rawConfirmations != null;
        const currentConfirms = hasNumericConfirmations ? rawConfirmations : 0;

        // Align "finalized" semantics with SvmClient.waitForConfirmations:
        // treat either an explicit "finalized" status or a rooted tx
        // (confirmations === null) with no error as final.
        const isFinalized =
          status.err === null &&
          (status.confirmationStatus === 'finalized' ||
            status.confirmations === null);

        const hasEnoughConfirmations =
          hasNumericConfirmations && currentConfirms >= confirmations;

        // Emit progress only when the visible confirmation count increases.
        // We never "jump" straight to the requested confirmations unless
        // we're finalizing and haven't yet emitted a final step.
        if (currentConfirms > lastConfirmed) {
          const clamped =
            currentConfirms >= confirmations ? confirmations : currentConfirms;
          this.executeProgressHook(
            clamped >= confirmations
              ? PROGRESS_HOOK.SEND_TX_06_03_02
              : PROGRESS_HOOK.SEND_TX_06_03_01,
            Math.max(1, clamped),
            confirmations
          );
          lastConfirmed = currentConfirms;
        }

        if (hasEnoughConfirmations || isFinalized) {
          // Ensure we emit a final "all confirmations" step if we haven't yet.
          if (lastConfirmed < confirmations) {
            this.executeProgressHook(
              PROGRESS_HOOK.SEND_TX_06_03_02,
              confirmations,
              confirmations
            );
          }
          return;
        }
      }

      if (Date.now() - start > timeoutMs) {
        throw new Error(
          `Timeout: transaction ${txSignature} not confirmed with ${confirmations} confirmations within ${timeoutMs} ms`
        );
      }

      await new Promise((r) => setTimeout(r, 500));
    }
  }

  // Fetch and cache UEA version from the contract on Push Chain
  private async fetchUEAVersion(): Promise<string> {
    if (this.ueaVersionCache) return this.ueaVersionCache;
    const chain = this.universalSigner.account.chain;
    const { vm } = CHAIN_INFO[chain];
    const abi: Abi =
      vm === VM.EVM ? (UEA_EVM as unknown as Abi) : (UEA_SVM as unknown as Abi);
    const predictedUEA = this.computeUEAOffchain();
    // Only attempt to read VERSION if UEA is deployed; otherwise default to 0.1.0
    const code = await this.pushClient.publicClient.getCode({
      address: predictedUEA,
    });
    if (code === undefined) {
      this.ueaVersionCache = '0.1.0';
      return '0.1.0';
    }
    const version = await this.pushClient.readContract<string>({
      address: predictedUEA,
      abi,
      functionName: 'VERSION',
    });
    this.ueaVersionCache = version;
    return version;
  }

  // Build EVM gas payment parameters when paying gas with an ERC-20 token
  private async calculateGasAmountFromAmountOutMinETH(
    gasTokenAddress: `0x${string}`,
    amountOutMinETH: bigint | string
  ): Promise<{
    gasAmount: bigint;
  }> {
    const originChain = this.universalSigner.account.chain;
    if (
      originChain !== CHAIN.ETHEREUM_SEPOLIA &&
      originChain !== CHAIN.ARBITRUM_SEPOLIA &&
      originChain !== CHAIN.BASE_SEPOLIA
    ) {
      throw new Error(
        'Gas payment in ERC-20 is supported only on Ethereum Sepolia, Arbitrum Sepolia, and Base Sepolia for now'
      );
    }

    // Resolve WETH: prefer chain config, fallback to registry
    const WETH = CHAIN_INFO[originChain].dex?.weth;
    if (!WETH) throw new Error('WETH address not configured for this chain');

    let gasAmount: bigint;
    if (gasTokenAddress.toLowerCase() === WETH.toLowerCase()) {
      gasAmount = BigInt(amountOutMinETH);
    } else {
      // Resolve token objects from registries
      const fromList = PAYABLE_TOKENS[originChain] ?? [];
      const fromToken: PayableToken | undefined = fromList.find(
        (t) => (t.address || '').toLowerCase() === gasTokenAddress.toLowerCase()
      );
      const toList = (MOVEABLE_TOKENS[originChain] ?? []) as MoveableToken[];
      const toToken: MoveableToken | undefined = toList.find(
        (t) =>
          t.symbol === 'WETH' ||
          (t.address || '').toLowerCase() === (WETH || '').toLowerCase()
      );

      if (!fromToken || !toToken) {
        throw new Error('Token not supported for quoting');
      }

      const targetOut = BigInt(amountOutMinETH);
      const exactOutQuote = await this._quoteExactOutput(targetOut, {
        from: fromToken,
        to: toToken,
      });
      const requiredIn = BigInt(exactOutQuote.amountIn);
      gasAmount = (requiredIn * BigInt(101)) / BigInt(100); // 1% safety margin
    }

    return { gasAmount };
  }

  private async calculateNativeAmountForDeposit(
    chain: CHAIN,
    requiredFunds: bigint,
    ueaBalance: bigint
  ): Promise<bigint> {
    this.executeProgressHook(PROGRESS_HOOK.SEND_TX_02_01);

    // Determine USD to deposit via gateway (8 decimals) with caps: min=$1, max=$10
    const oneUsd = Utils.helpers.parseUnits('1', 8);
    const tenUsd = Utils.helpers.parseUnits('10', 8);
    const deficit =
      requiredFunds > ueaBalance ? requiredFunds - ueaBalance : BigInt(0);
    let depositUsd =
      deficit > BigInt(0) ? this.pushClient.pushToUSDC(deficit) : oneUsd;

    if (depositUsd < oneUsd) depositUsd = oneUsd;
    if (depositUsd > tenUsd)
      throw new Error('Deposit value exceeds max $10 worth of native token');

    // If SVM, clamp depositUsd to on-chain Config caps
    if (CHAIN_INFO[chain].vm === VM.SVM) {
      const svmClient = new SvmClient({
        rpcUrls:
          this.rpcUrls[CHAIN.SOLANA_DEVNET] ||
          CHAIN_INFO[CHAIN.SOLANA_DEVNET].defaultRPC,
      });
      const programId = new PublicKey(SVM_GATEWAY_IDL.address);
      const [configPda] = PublicKey.findProgramAddressSync(
        [stringToBytes('config')],
        programId
      );
      try {
        const cfg: any = await svmClient.readContract({
          abi: SVM_GATEWAY_IDL,
          address: SVM_GATEWAY_IDL.address,
          functionName: 'config',
          args: [configPda.toBase58()],
        });
        const minField =
          cfg.minCapUniversalTxUsd ?? cfg.min_cap_universal_tx_usd;
        const maxField =
          cfg.maxCapUniversalTxUsd ?? cfg.max_cap_universal_tx_usd;
        const minCapUsd = BigInt(minField.toString());
        const maxCapUsd = BigInt(maxField.toString());
        if (depositUsd < minCapUsd) depositUsd = minCapUsd;
        // Add 20% safety margin to avoid BelowMinCap due to price drift
        const withMargin = (minCapUsd * BigInt(12)) / BigInt(10);
        if (depositUsd < withMargin) depositUsd = withMargin;
        if (depositUsd > maxCapUsd) depositUsd = maxCapUsd;
      } catch {
        // best-effort; fallback to previous bounds if read fails
      }
    }

    // Convert USD(8) -> native units using pricing path
    const nativeTokenUsdPrice = await new PriceFetch(this.rpcUrls).getPrice(
      chain
    ); // 8 decimals
    const nativeDecimals = CHAIN_INFO[chain].vm === VM.SVM ? 9 : 18;
    const oneNativeUnit = Utils.helpers.parseUnits(
      '1',
      nativeDecimals
    );
    // Ceil division to avoid rounding below min USD on-chain
    let nativeAmount =
      (depositUsd * oneNativeUnit + (nativeTokenUsdPrice - BigInt(1))) /
      nativeTokenUsdPrice;
    // Add 1 unit safety to avoid BelowMinCap from rounding differences
    nativeAmount = nativeAmount + BigInt(1);

    this.executeProgressHook(PROGRESS_HOOK.SEND_TX_02_02, nativeAmount);

    return nativeAmount;
  }
}

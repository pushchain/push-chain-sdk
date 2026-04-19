/**
 * Response builder functions extracted from Orchestrator.
 *
 * Contains: queryUniversalTxStatusFromGatewayTx, trackTransaction,
 * transformToUniversalTxResponse, and the ResponseBuilderCallbacks interface.
 */

import { bs58 } from '../../internal/bs58';
import { Connection } from '@solana/web3.js';
import {
  bytesToHex,
  decodeAbiParameters,
  decodeFunctionData,
  getAddress,
  keccak256,
  sha256,
  stringToBytes,
  toBytes,
} from 'viem';
import { UEA_EVM } from '../../constants/abi/uea.evm';
import { CHAIN_INFO, VM_NAMESPACE } from '../../constants/chain';
import { CHAIN, VM } from '../../constants/enums';
import { UniversalTx } from '../../generated/uexecutor/v1/types';
import type { UniversalTxV2 } from '../../generated/uexecutor/v2/types';
import { PROGRESS_HOOK, ProgressEvent } from '../../progress-hook/progress-hook.types';
import PROGRESS_HOOKS from '../../progress-hook/progress-hook';
import { PushChain } from '../../push-chain/push-chain';
import { convertExecutorToOrigin } from '../../universal/account/account';
import { PushClient } from '../../push-client/push-client';
import { EvmClient } from '../../vm-client/evm-client';
import type { TxResponse } from '../../vm-client/vm-client.types';
import { TransactionRoute, getRouteInfo } from '../route-detector';
import type {
  Signature,
  UniversalTxReceipt,
  UniversalTxResponse,
  TrackTransactionOptions,
  WaitOptions,
} from '../orchestrator.types';
import type { OrchestratorContext } from './context';
import { printLog } from './context';
import { getPushChainForNetwork } from './helpers';
import { getSvmGatewayLogIndexFromTx } from './svm-helpers';
import { computeUniversalTxId, extractUniversalSubTxIdFromTx } from './outbound-tracker';
import { waitForInboundPushTx, InboundTimeoutError } from './inbound-tracker';
import {
  reconstructProgressEvents,
  detectRouteFromUniversalTxData,
} from './tx-transformer';

// ============================================================================
// Callback interface for transformToUniversalTxResponse closures
// ============================================================================

export interface ResponseBuilderCallbacks {
  trackTransaction: (hash: string, opts?: any) => Promise<UniversalTxResponse>;
  waitForOutboundTx: (hash: string, opts?: any) => Promise<any>;
  transformToUniversalTxReceipt: (receipt: any, response: any) => UniversalTxReceipt;
  printLog: (msg: string) => void;
  outboundConstants: { initialWaitMs: number; pollingIntervalMs: number; maxTimeoutMs: number };
  inboundConstants: { initialWaitMs: number; pollingIntervalMs: number; maxTimeoutMs: number };
}

import { pickWaitHooks } from './progress-route-hooks';
import { OutboundTimeoutError, OutboundFailedError } from './outbound-sync';

/**
 * Intermediate Push-success markers (199-99-99 for R3, 299-99 for R2) are
 * internal transition signals — they tell response-builder's wait-phase
 * branch that the Push leg has settled so it can skip re-emitting the
 * intermediate marker on top of a reconstructed stream. They are not part
 * of the published 1XX/2XX/3XX/4XX spec and are suppressed at the consumer
 * dispatch boundary. `printLog` still fires for these so internal traces
 * retain the transition record.
 */
const INTERMEDIATE_INTERNAL_IDS: ReadonlySet<string> = new Set([
  PROGRESS_HOOK.SEND_TX_199_99_99,
  PROGRESS_HOOK.SEND_TX_299_99,
]);

/**
 * Fan out a progress event to one or two registered callbacks, deduping
 * when both slots hold the same reference. Keeps the emission policy in a
 * single place shared by `emitProgress` (execute phase) and `emit` (wait
 * phase) — so consumers that wire the same callback at multiple levels
 * never see double-invocation. Intermediate internal markers are dropped
 * here so they never reach the consumer.
 */
function fanOut(
  event: ProgressEvent,
  primary?: (e: ProgressEvent) => void,
  secondary?: (e: ProgressEvent) => void
): void {
  if (INTERMEDIATE_INTERNAL_IDS.has(event.id)) return;
  if (primary) primary(event);
  if (secondary && secondary !== primary) secondary(event);
}

// ============================================================================
// queryUniversalTxStatusFromGatewayTx
// ============================================================================

export async function queryUniversalTxStatusFromGatewayTx(
  ctx: OrchestratorContext,
  evmClient: EvmClient | undefined,
  gatewayAddress: `0x${string}` | undefined,
  // DEBUG: section marker added
  txHash: string,
  evmGatewayMethod: 'sendFunds' | 'sendTxWithFunds' | 'sendTxWithGas'
): Promise<UniversalTx | undefined> {
  try {
    const chain = ctx.universalSigner.account.chain;
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
      printLog(ctx, `queryUniversalTxStatus — receipt logs count: ${receipt.logs?.length}, gateway logs count: ${gatewayLogs.length}, evmGatewayMethod: ${evmGatewayMethod}`);
      printLog(ctx, 'queryUniversalTxStatus — gatewayLogs: ' + JSON.stringify(
        gatewayLogs.map((l: any) => ({ address: l.address, logIndex: l.logIndex, topics: l.topics?.[0] })),
        null, 2));
      // Use the last gateway log to derive the log index
      const logIndexToUse = gatewayLogs.length - 1;
      const firstLog = (gatewayLogs[logIndexToUse] ||
        (receipt.logs || []).at(-1)) as any;
      const logIndexVal = firstLog?.logIndex ?? 0;
      printLog(ctx, `queryUniversalTxStatus — logIndexToUse: ${logIndexToUse}, firstLog.logIndex: ${firstLog?.logIndex}, logIndexVal: ${logIndexVal}`);
      logIndexStr =
        typeof logIndexVal === 'bigint'
          ? logIndexVal.toString()
          : String(logIndexVal);
    } else if (vm === VM.SVM) {
      // Normalize Solana signature to 0x-hex for ID composition
      let txSignature = txHash;
      if (!txHash.startsWith('0x')) {
        const decoded = bs58.decode(txHash);
        txHashHex = bytesToHex(new Uint8Array(decoded));
      } else {
        // When provided as hex, convert to base58 for RPC
        const hex = txHash.slice(2);
        const bytes = Uint8Array.from(Buffer.from(hex, 'hex'));
        txSignature = bs58.encode(Buffer.from(bytes));
      }

      // Fetch transaction by initializing a Connection and calling Solana RPC
      const rpcUrls: string[] =
        ctx.rpcUrls[chain] || CHAIN_INFO[chain].defaultRPC;
      const connection = new Connection(rpcUrls[0], 'confirmed');
      const txResp = await connection.getTransaction(txSignature, {
        maxSupportedTransactionVersion: 0,
        commitment: 'confirmed',
      } as any);
      // Derive proper log index using discriminator matching
      const svmLogIndex = getSvmGatewayLogIndexFromTx(txResp);
      logIndexStr = String(svmLogIndex);
    }

    const sourceChain = `${VM_NAMESPACE[vm]}:${CHAIN_INFO[chain].chainId}`;

    // ID = sha256("${sourceChain}:${txHash}:${logIndex}") as hex string (no 0x)
    const idInput = `${sourceChain}:${txHashHex}:${logIndexStr}`;
    const idHex = sha256(stringToBytes(idInput)).slice(2);

    printLog(ctx, 'Query ID extraction: ' + JSON.stringify({
      sourceChain,
      txHashHex,
      logIndexStr,
      idInput,
      idHex,
    }, null, 2));

    // Fetch UniversalTx via gRPC with linear-then-exponential retry
    const LINEAR_ATTEMPTS = 10;
    const LINEAR_DELAY_MS = 3600;
    const EXPONENTIAL_BASE_MS = 4800;
    const MAX_ATTEMPTS = 15;

    let universalTxObj: any | undefined;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      printLog(ctx, `[Sync] Attempt ${attempt + 1}/${MAX_ATTEMPTS} | Query ID: ${idHex}`);
      try {
        const universalTxResp = await ctx.pushClient.getUniversalTxById(
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
    printLog(ctx, `queryUniversalTxStatusFromGatewayTx failed: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}

// ============================================================================
// trackTransaction
// ============================================================================

export async function trackTransaction(
  ctx: OrchestratorContext,
  txHash: string,
  options?: TrackTransactionOptions,
  callbacks?: ResponseBuilderCallbacks
): Promise<UniversalTxResponse> {
  if (!callbacks) {
    throw new Error('trackTransaction requires ResponseBuilderCallbacks');
  }
  const {
    chain = getPushChainForNetwork(ctx.pushNetwork),
    progressHook,
    waitForCompletion = true,
    advanced = {},
  } = options ?? {};

  const { timeout = 300000, pollingIntervalMs = 1000, rpcUrls = {} } = advanced;

  // Event buffer for replay via response.progressHook()
  const eventBuffer: ProgressEvent[] = [];

  // Helper to emit progress events. Per-tx hook (passed to trackTransaction)
  // fires first, then the orchestrator-level hook — deduped via `fanOut` so
  // a caller that wires the same callback at both levels isn't double-fired.
  const emitProgress = (event: ProgressEvent) => {
    eventBuffer.push(event);
    printLog(ctx, event.message);
    fanOut(event, progressHook, ctx.progressHook);
  };

  // Create client for target chain with optional RPC override
  const chainRPCs =
    rpcUrls[chain] || ctx.rpcUrls[chain] || CHAIN_INFO[chain].defaultRPC;
  const client = new PushClient({
    rpcUrls: chainRPCs,
    network: ctx.pushNetwork,
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
      await new Promise((r) => setTimeout(r, pollingIntervalMs));
    }
  }

  // Try to get UniversalTx data for richer progress reconstruction
  // (may not exist for direct Push Chain transactions)
  // Three-tier lookup: direct hash → computed keccak ID → Cosmos event extraction
  let universalTxData: UniversalTxV2 | undefined;
  try {
    const utxResponse = await ctx.pushClient.getUniversalTxByIdV2(txHash);
    if (utxResponse?.universalTx) {
      universalTxData = utxResponse.universalTx;
    }
  } catch {
    // Ignore - try computed ID next
  }

  if (!universalTxData) {
    try {
      const computedId = computeUniversalTxId(ctx.pushNetwork, txHash);
      const queryId = computedId.startsWith('0x') ? computedId.slice(2) : computedId;
      const utxResponse = await ctx.pushClient.getUniversalTxByIdV2(queryId);
      if (utxResponse?.universalTx) {
        universalTxData = utxResponse.universalTx;
      }
    } catch {
      // Ignore - try Cosmos event extraction next
    }
  }

  if (!universalTxData) {
    try {
      const extractedId = await extractUniversalSubTxIdFromTx(ctx, txHash);
      if (extractedId) {
        const queryId = extractedId.startsWith('0x') ? extractedId.slice(2) : extractedId;
        const utxResponse = await ctx.pushClient.getUniversalTxByIdV2(queryId);
        if (utxResponse?.universalTx) {
          universalTxData = utxResponse.universalTx;
        }
      }
    } catch {
      // Ignore - no universal tx data available
    }
  }

  // Transform to UniversalTxResponse
  const universalTxResponse = await transformToUniversalTxResponse(
    ctx,
    tx,
    eventBuffer,
    callbacks
  );

  // Detect route from UniversalTxV2 data and set on response
  // This enables wait() to trigger outbound polling via waitForOutboundTx()
  const detectedRoute = detectRouteFromUniversalTxData(universalTxData);
  if (detectedRoute) {
    universalTxResponse.route = detectedRoute;
    // Mirror the route on the context so emission code in wait()/cascade
    // picks the correct ID range — keeps trackTransaction in lockstep with
    // sendUniversalTransaction, which sets currentRoute in execute().
    ctx.currentRoute = detectedRoute;

    // Populate the destination/source chain on the response so
    // reconstructR2/R3 (and any downstream emission that reads
    // universalTxResponse.chain) emit the proper friendly chain name
    // instead of the "external" fallback. The first outbound's destination
    // is the target chain for R2 and the source CEA chain for R3.
    const firstOutboundChain =
      universalTxData?.outboundTx?.[0]?.destinationChain;
    if (firstOutboundChain && !universalTxResponse.chain) {
      universalTxResponse.chain = firstOutboundChain as CHAIN;
      universalTxResponse.chainNamespace = firstOutboundChain;
    }

    // For R3 replays, enable inbound round-trip tracking so `.wait()` runs
    // the 310-01 → 399-01 sequence. Live execute sets this in
    // route-handlers.ts via `amount > 0n`; trackTransaction has no
    // execute-phase args, so we enable it unconditionally for CEA_TO_PUSH.
    // The inbound block tolerates no-inbound (payload-only R3) by timing
    // out — same as live behaviour when the source tx has no round-trip.
    if (detectedRoute === TransactionRoute.CEA_TO_PUSH) {
      universalTxResponse._expectsInboundRoundTrip = true;
    }
  }

  // Reconstruct and emit SEND-TX-* progress events
  const reconstructedEvents = reconstructProgressEvents(
    universalTxResponse,
    universalTxData
  );
  for (const event of reconstructedEvents) {
    emitProgress(event);
  }
  // Mark the response so the wait() closure (when later invoked) doesn't
  // call trackTransaction a second time and re-emit the same reconstructed
  // events to the user's progressHook.
  universalTxResponse._eventsReconstructed = true;

  // Auto-register the caller's per-call progressHook as the response's
  // registeredProgressHook so that tracked.wait() fires wait-phase events
  // (209-xx / 299-xx / 399-xx) to the same callback without requiring
  // tracked.progressHook(cb) to be called again. Skip replay of buffered
  // events because we just fired them above via emitProgress — calling
  // response.progressHook(cb) here would re-emit the reconstructed stream.
  if (progressHook && universalTxResponse._setProgressHookNoReplay) {
    universalTxResponse._setProgressHookNoReplay(progressHook);
  }

  return universalTxResponse;
}

// ============================================================================
// transformToUniversalTxResponse
// ============================================================================

export async function transformToUniversalTxResponse(
  ctx: OrchestratorContext,
  tx: TxResponse,
  eventBuffer: ProgressEvent[] = [],
  callbacks: ResponseBuilderCallbacks
): Promise<UniversalTxResponse> {
  const chain = ctx.universalSigner.account.chain;
  let { vm, chainId } = CHAIN_INFO[chain];
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
    await convertExecutorToOrigin(
      tx.to as `0x${string}`,
      { _internal: true }
    );
  let originAddress: string;

  if (ueaOrigin.exists) {
    if (!ueaOrigin.account) {
      throw new Error('UEA origin account is null');
    }
    originAddress = ueaOrigin.account.address;

    // Use the resolved origin chain for vm/chainId so that the `origin`
    // field reflects the transaction's actual origin, not the tracker's.
    const resolvedChainInfo = CHAIN_INFO[ueaOrigin.account.chain];
    if (resolvedChainInfo) {
      vm = resolvedChainInfo.vm;
      chainId = resolvedChainInfo.chainId;
    }

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
    } else if (txType === 'eip4844') {
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
    wait: async (waitOptions?: WaitOptions): Promise<UniversalTxReceipt> => {
      // For trackTransaction replays the tx is historical — cosmos already
      // has the full graph indexed, so the 20s/30s initial-wait buffers
      // designed for live sends are pure deadweight. Default them to 0 when
      // replaying; callers can still override via WaitOptions.
      const isReplay = universalTxResponse._eventsReconstructed === true;
      const outboundTimeoutMs =
        waitOptions?.outboundTimeoutMs ??
        callbacks.outboundConstants.maxTimeoutMs;
      const inboundTimeoutMs =
        waitOptions?.inboundTimeoutMs ??
        callbacks.inboundConstants.maxTimeoutMs;
      const outboundInitialWaitMs =
        waitOptions?.outboundInitialWaitMs ??
        (isReplay ? 0 : callbacks.outboundConstants.initialWaitMs);
      const outboundPollingIntervalMs =
        waitOptions?.outboundPollingIntervalMs ??
        callbacks.outboundConstants.pollingIntervalMs;
      const inboundInitialWaitMs = isReplay
        ? 0
        : callbacks.inboundConstants.initialWaitMs;
      // Track whether reconstruction already emitted the route's
      // intermediate Push-success marker (299-99 / 199-99-99). When it has,
      // skip re-emitting from the outbound branch below to avoid duplicates.
      // This flag is only true when `this` response was created by
      // trackTransaction() and the reconstructed stream already fired.
      const alreadyReconstructed =
        universalTxResponse._eventsReconstructed === true;
      let intermediateAlreadyEmitted = alreadyReconstructed;

      // Build the base receipt directly from this response. Any per-call
      // `tx.progressHook(cb)` already replayed buffered execute-phase events
      // to `cb` via the progressHook setter — re-running trackTransaction
      // here would duplicate the reconstructed stream on top of that replay,
      // which is exactly what broke R1 parity. Wait-phase events (209-xx /
      // 299-xx / 399-xx) still reach `registeredProgressHook` and
      // `ctx.progressHook` via the `emit` closure in the outbound branch.
      const receipt = await tx.wait();
      let baseReceipt: UniversalTxReceipt =
        callbacks.transformToUniversalTxReceipt(receipt, universalTxResponse);

      // If outbound route, poll for external chain details
      const route = universalTxResponse.route as TransactionRoute | undefined;
      const routeInfo = route ? getRouteInfo(route) : undefined;
      if (routeInfo?.isOutbound) {
        // Pick route-specific hook builders. R4 (CEA_TO_CEA) currently has
        // no spec'd IDs — pickWaitHooks returns a no-op set that yields
        // events with `id: ''`. `emit` drops those so the consumer never
        // sees placeholder events, while receipt mutation still runs.
        const hooks = pickWaitHooks(route);
        const targetChain = (universalTxResponse.chain ?? 'external') as string;
        const emit = (event: ProgressEvent) => {
          if (!event.id) return;
          fanOut(event, registeredProgressHook, ctx.progressHook);
        };

        // Intermediate INFO marker — Push Chain tx confirmed, external/inbound
        // leg still pending. Per spec, R1 keeps 199-01 as terminal; R2/R3
        // reclassify Push success as intermediate. Skip when trackTransaction
        // (called above) already reconstructed the same marker via
        // reconstructR2/R3, otherwise the consumer sees 299-99 / 199-99-99
        // twice in their stream.
        if (hooks.intermediatePushOk && !intermediateAlreadyEmitted) {
          emit(hooks.intermediatePushOk(targetChain, tx.hash));
        }

        // Awaiting relay
        emit(hooks.awaiting(targetChain));

        let lastEmittedStatus: string | undefined;
        const outboundTranslator = (event: {
          status: 'waiting' | 'polling' | 'found' | 'failed' | 'timeout';
          elapsed: number;
        }) => {
          if (event.status === 'polling' && lastEmittedStatus !== 'polling') {
            lastEmittedStatus = 'polling';
            emit(hooks.polling(targetChain, event.elapsed));
          }
        };

        try {
          const outboundDetails = await callbacks.waitForOutboundTx(
            tx.hash,
            {
              initialWaitMs: outboundInitialWaitMs,
              pollingIntervalMs: outboundPollingIntervalMs,
              timeout: outboundTimeoutMs,
              progressHook: outboundTranslator,
            }
          );
          emit(hooks.success(outboundDetails));
          // Merge external chain details into receipt
          baseReceipt = {
            ...baseReceipt,
            externalTxHash: outboundDetails.externalTxHash,
            externalChain: outboundDetails.destinationChain,
            externalExplorerUrl: outboundDetails.explorerUrl,
            externalRecipient: outboundDetails.recipient,
            externalAmount: outboundDetails.amount,
            externalAssetAddr: outboundDetails.assetAddr,
            externalStatus: 'success',
          };

          // R3 round-trip: poll Push Chain for the inbound tx that the
          // source-chain CEA's sendUniversalTxToUEA call produces. Correlate
          // via the outbound external tx hash → child UTX id → child pcTx.
          // Only run when the CEA payload actually fires sendUniversalTxToUEA;
          // payload-only R3 (no funds flowing back) has no child UTX and would
          // otherwise time out after 300s.
          if (
            route === TransactionRoute.CEA_TO_PUSH &&
            universalTxResponse._expectsInboundRoundTrip === true
          ) {
            emit(PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_310_01](targetChain));

            let inboundLastEmitted: string | undefined;
            try {
              const inbound = await waitForInboundPushTx(
                ctx,
                outboundDetails.externalTxHash,
                targetChain,
                {
                  initialWaitMs: inboundInitialWaitMs,
                  pollingIntervalMs:
                    callbacks.inboundConstants.pollingIntervalMs,
                  timeout: inboundTimeoutMs,
                  progressHook: (event) => {
                    if (
                      event.status === 'polling' &&
                      inboundLastEmitted !== 'polling'
                    ) {
                      inboundLastEmitted = 'polling';
                      emit(
                        PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_310_02](
                          targetChain,
                          event.elapsedMs
                        )
                      );
                    }
                  },
                }
              );

              if (inbound.status === 'confirmed') {
                emit(
                  PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_399_01](
                    targetChain,
                    inbound.pushTxHash,
                    baseReceipt
                  )
                );
                baseReceipt = {
                  ...baseReceipt,
                  pushInboundTxHash: inbound.pushTxHash,
                  pushInboundUtxId: inbound.childUtxId,
                  // Round-trip completed. externalStatus stays 'success'
                  // (set on the outbound-found branch above).
                };
              } else {
                // status === 'failed' (terminal failure status from chain)
                const failMsg =
                  inbound.errorMessage ??
                  'inbound execution failed on Push Chain';
                emit(PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_399_02](failMsg));
                baseReceipt = {
                  ...baseReceipt,
                  pushInboundUtxId: inbound.childUtxId,
                  pushInboundTxHash: inbound.pushTxHash || undefined,
                  externalStatus: 'failed',
                  externalError: failMsg,
                };
              }
            } catch (inboundErr) {
              const errMsg =
                inboundErr instanceof Error
                  ? inboundErr.message
                  : String(inboundErr);
              const isTimeout = inboundErr instanceof InboundTimeoutError;
              // Annotate receipt for inbound-leg outcome too.
              baseReceipt = {
                ...baseReceipt,
                externalStatus: isTimeout ? 'timeout' : 'failed',
                externalError: errMsg,
              };
              emit(
                isTimeout
                  ? PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_399_03](
                      targetChain,
                      inboundTimeoutMs
                    )
                  : PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_399_02](errMsg)
              );
              callbacks.printLog(
                `[wait] R3 inbound tracking failed: ${errMsg}`
              );
            }
          }
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          const isTimeout = error instanceof OutboundTimeoutError;
          emit(
            isTimeout
              ? hooks.timeout(targetChain, outboundTimeoutMs)
              : hooks.failed(targetChain, errMsg)
          );
          // Annotate the receipt so callers can distinguish external-leg
          // outcomes without sniffing errMsg. Push Chain leg still succeeded
          // (status stays 1); inspect `externalStatus` / `externalError` for
          // the external/inbound leg outcome. On a reverted outbound the
          // observed tx hash is carried by OutboundFailedError — expose it
          // as externalTxHash so consumers can link to the explorer.
          const failedExternalTxHash =
            error instanceof OutboundFailedError ? error.externalTxHash : undefined;
          baseReceipt = {
            ...baseReceipt,
            externalStatus: isTimeout ? 'timeout' : 'failed',
            externalError: errMsg,
            ...(failedExternalTxHash
              ? { externalTxHash: failedExternalTxHash }
              : {}),
          };
          // Outbound polling timed out or failed — return the annotated
          // receipt without throwing. Push Chain tx succeeded, external
          // tracking can be retried later.
          callbacks.printLog(
            `[wait] External chain tracking ${isTimeout ? 'timed out' : 'failed'}: ${errMsg}`
          );
        }
      }

      return baseReceipt;
    },

    // Internal: register a wait-phase progressHook without replaying
    // buffered events. Used by trackTransaction() after it has already
    // emitted the reconstructed stream to the caller's per-call hook,
    // so that tracked.wait() can deliver wait-phase events (209-xx /
    // 299-xx / 399-xx) to the same callback without duplicating replay.
    _setProgressHookNoReplay: (
      callback: (event: ProgressEvent) => void
    ): void => {
      registeredProgressHook = callback;
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

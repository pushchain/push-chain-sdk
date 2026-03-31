/**
 * Response builder functions extracted from Orchestrator.
 *
 * Contains: queryUniversalTxStatusFromGatewayTx, trackTransaction,
 * transformToUniversalTxResponse, and the ResponseBuilderCallbacks interface.
 */

import { utils } from '@coral-xyz/anchor';
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
  TransactionReceipt,
} from 'viem';
import { UEA_EVM } from '../../constants/abi/uea.evm';
import { CHAIN_INFO, VM_NAMESPACE } from '../../constants/chain';
import { CHAIN, VM } from '../../constants/enums';
import { UniversalTx } from '../../generated/uexecutor/v1/types';
import type { UniversalTxV2 } from '../../generated/uexecutor/v2/types';
import { ProgressEvent } from '../../progress-hook/progress-hook.types';
import { PushChain } from '../../push-chain/push-chain';
import { PushClient } from '../../push-client/push-client';
import { EvmClient } from '../../vm-client/evm-client';
import type { TxResponse } from '../../vm-client/vm-client.types';
import { TransactionRoute, getRouteInfo } from '../route-detector';
import type {
  Signature,
  UniversalTxReceipt,
  UniversalTxResponse,
  TrackTransactionOptions,
} from '../orchestrator.types';
import type { OrchestratorContext } from './context';
import { printLog } from './context';
import { getPushChainForNetwork, chainFromNamespace } from './helpers';
import { getSvmGatewayLogIndexFromTx } from './svm-helpers';
import { computeUniversalTxId, extractUniversalSubTxIdFromTx } from './outbound-tracker';
import {
  reconstructProgressEvents,
  detectRouteFromUniversalTxData,
  transformToUniversalTxReceipt as transformReceipt,
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
}

// ============================================================================
// queryUniversalTxStatusFromGatewayTx
// ============================================================================

export async function queryUniversalTxStatusFromGatewayTx(
  ctx: OrchestratorContext,
  evmClient: EvmClient | undefined,
  gatewayAddress: `0x${string}` | undefined,
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
      // TEMP: use last gateway log instead of hardcoded 0/1 index
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
    const LINEAR_ATTEMPTS = 25;
    const LINEAR_DELAY_MS = 1500;
    const EXPONENTIAL_BASE_MS = 2000;
    const MAX_ATTEMPTS = 30;

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
  const {
    chain = getPushChainForNetwork(ctx.pushNetwork),
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
    printLog(ctx, event.message);
    // Per-transaction hook called FIRST
    if (progressHook) {
      progressHook(event);
    }
    // Orchestrator-level hook called SECOND
    if (ctx.progressHook) {
      ctx.progressHook(event);
    }
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
      await new Promise((r) => setTimeout(r, 1000));
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
    callbacks!
  );

  // Detect route from UniversalTxV2 data and set on response
  // This enables wait() to trigger outbound polling via waitForOutboundTx()
  const detectedRoute = detectRouteFromUniversalTxData(universalTxData);
  if (detectedRoute) {
    universalTxResponse.route = detectedRoute;
  }

  // Reconstruct and emit SEND-TX-* progress events
  const reconstructedEvents = reconstructProgressEvents(
    universalTxResponse,
    universalTxData
  );
  for (const event of reconstructedEvents) {
    emitProgress(event);
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
    await PushChain.utils.account.convertExecutorToOrigin(
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
        const trackedResponse = await callbacks.trackTransaction(tx.hash, {
          waitForCompletion: true,
          progressHook: registeredProgressHook,
        });
        // Get receipt from the tracked response
        const receipt = await tx.wait();
        baseReceipt = callbacks.transformToUniversalTxReceipt(receipt, trackedResponse);
      } else {
        const receipt = await tx.wait();
        baseReceipt = callbacks.transformToUniversalTxReceipt(receipt, universalTxResponse);
      }

      // If outbound route, poll for external chain details
      const routeInfo = universalTxResponse.route
        ? getRouteInfo(universalTxResponse.route as TransactionRoute)
        : undefined;
      if (routeInfo?.isOutbound) {
        try {
          const outboundDetails = await callbacks.waitForOutboundTx(
            tx.hash,
            {
              initialWaitMs: callbacks.outboundConstants.initialWaitMs,
              pollingIntervalMs: callbacks.outboundConstants.pollingIntervalMs,
              timeout: callbacks.outboundConstants.maxTimeoutMs,
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
          callbacks.printLog(`[wait] External chain tracking failed: ${error instanceof Error ? error.message : String(error)}`);
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

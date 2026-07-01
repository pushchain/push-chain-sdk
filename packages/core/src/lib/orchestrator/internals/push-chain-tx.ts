/**
 * Push Chain transaction broadcasting — extracted from Orchestrator.
 *
 * sendPushTx:       Direct EVM tx on Push Chain (single or multicall batch)
 * sendUniversalTx:  Cosmos-wrapped EVM tx via PushClient (gasless path)
 */

import { bs58 } from '../../internal/bs58';
type Any = { typeUrl: string; value: Uint8Array };
import { bytesToHex } from 'viem';
import {
  CHAIN_INFO,
  VM_NAMESPACE,
  getBatchExecutorAddress,
} from '../../constants/chain';
import { VM } from '../../constants/enums';
import type { UniversalTx } from '../../generated/uexecutor/v1/types';
import { PROGRESS_HOOK, ProgressEvent } from '../../progress-hook/progress-hook.types';
import {
  UniversalAccountId,
  UniversalPayload,
} from '../../generated/v1/tx';
import type { TxResponse } from '../../vm-client/vm-client.types';
import { EIP7702NotSupportedError } from '../../vm-client/evm-client';
import type {
  ExecuteParams,
  MultiCall,
  UniversalTxResponse,
} from '../orchestrator.types';
import type { OrchestratorContext } from './context';
import { fireProgressHook, printLog } from './context';
import { decodeRevert, formatDecodedRevertForUser } from './error-decoder';
import { PushChainExecutionError } from './errors';
import { normalizePublicErrorMessage } from '../../formatters';

// ============================================================================
// PushChainExecutionError
// ============================================================================
// Lives in `errors.ts` so the pre-flight `InsufficientUEABalanceError` can
// extend it without creating a circular import. Re-exported here so existing
// `import { PushChainExecutionError } from './push-chain-tx'` callers
// continue to work.
export { PushChainExecutionError };

// ============================================================================
// Callback type — avoids circular dependency with response-builder
// ============================================================================

type TransformToResponseFn = (
  tx: TxResponse,
  eventBuffer: ProgressEvent[]
) => Promise<UniversalTxResponse>;

const PUSH_TX_INDEX_TIMEOUT_MS = 30000;
const PUSH_TX_INDEX_POLL_MS = 1000;
const TX_NOT_INDEXED_RE =
  /not found|TransactionNotFound|TransactionReceiptNotFound|could not be found|No transaction found/i;

async function getIndexedPushTransaction(
  ctx: OrchestratorContext,
  txHash: `0x${string}`,
  label: string
): Promise<TxResponse> {
  const startedAt = Date.now();
  let receiptWaited = false;
  let retryLogged = false;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      if (!receiptWaited) {
        await ctx.pushClient.publicClient.waitForTransactionReceipt({
          hash: txHash,
        });
        receiptWaited = true;
      }
      return await ctx.pushClient.getTransaction(txHash);
    } catch (err: any) {
      const msg = err?.shortMessage || err?.message || String(err);
      const retryable = TX_NOT_INDEXED_RE.test(msg);
      if (!retryable || Date.now() - startedAt >= PUSH_TX_INDEX_TIMEOUT_MS) {
        throw err;
      }

      if (!retryLogged) {
        printLog(
          ctx,
          `${label} — Push tx ${txHash} has a receipt but is not indexed yet; retrying transaction lookup`
        );
        retryLogged = true;
      }
      await new Promise((r) => setTimeout(r, PUSH_TX_INDEX_POLL_MS));
    }
  }
}

// ============================================================================
// sendPushTx
// ============================================================================

/**
 * Sends an EVM transaction directly on Push Chain.
 * Only used when universal signer is on Push Chain.
 *
 * For multicall arrays: executes each call as a separate transaction with
 * local nonce management and per-tx receipt confirmation.
 */
export async function sendPushTx(
  ctx: OrchestratorContext,
  execute: ExecuteParams,
  eventBuffer: ProgressEvent[],
  transformFn: TransformToResponseFn
): Promise<UniversalTxResponse> {
  if (Array.isArray(execute.data)) {
    const calls = execute.data as MultiCall[];

    // Reject a zero `to` BEFORE route selection so behaviour is identical
    // regardless of signer capability: ERC-7821 (the 7702 path) reinterprets
    // `target == 0` as the account itself, whereas the legacy loop would send to
    // the zero address. A zero target is almost always a bug — disallow it.
    if (calls.some((c) => /^0x0{40}$/i.test(c.to))) {
      throw new PushChainExecutionError(
        'A multicall entry has a zero `to` address. Use an explicit target ' +
          '(the EIP-7702 executor reinterprets a zero target as the account itself).'
      );
    }

    // Preferred path: execute the batch atomically in a single EIP-7702 type-4
    // transaction. Requires (a) a deployed PushBatchExecutor on this chain and
    // (b) a wallet that can sign a 7702 authorization. When either is missing we
    // fall back to the legacy non-atomic per-call loop below.
    const executor = getBatchExecutorAddress(
      ctx.universalSigner.account.chain
    );
    if (executor && ctx.universalSigner.signAuthorization) {
      try {
        printLog(
          ctx,
          `sendPushTx — executing ${calls.length} call(s) atomically via EIP-7702 (executor: ${executor})`
        );
        const txHash = await ctx.pushClient.sendBatch7702({
          executor,
          calls,
          signer: ctx.universalSigner,
        });
        const txResponse = await getIndexedPushTransaction(
          ctx,
          txHash,
          'sendPushTx'
        );
        return await transformFn(txResponse, eventBuffer);
      } catch (err) {
        // Only fall back when the wallet genuinely can't sign a 7702
        // authorization. This is raised before any broadcast, so falling back
        // to sequential execution cannot double-execute. Any other error
        // (e.g. a real revert) must surface.
        if (!(err instanceof EIP7702NotSupportedError)) throw err;
        printLog(
          ctx,
          `sendPushTx — wallet cannot sign EIP-7702 authorization; falling back to sequential execution`
        );
        // eslint-disable-next-line no-console
        console.warn(
          '[push-chain] Wallet cannot produce an EIP-7702 authorization — batch ' +
            'will execute as separate, non-atomic transactions (if one call reverts, ' +
            'earlier calls remain committed).'
        );
      }
    } else if (!ctx.universalSigner.signAuthorization) {
      // eslint-disable-next-line no-console
      console.warn(
        '[push-chain] Signer does not support EIP-7702 — batch will execute as ' +
          'separate, non-atomic transactions (if one call reverts, earlier calls ' +
          'remain committed).'
      );
    }

    const PUSH_CHAIN_GAS_LIMIT = BigInt(500000);
    const MAX_NONCE_RETRIES = 3;
    let nonce = await ctx.pushClient.publicClient.getTransactionCount({
      address: ctx.universalSigner.account.address as `0x${string}`,
      blockTag: 'pending',
    });
    let lastTxHash: `0x${string}` = '0x';
    for (let i = 0; i < calls.length; i++) {
      const call = calls[i];
      let txSent = false;
      for (let retry = 0; retry < MAX_NONCE_RETRIES && !txSent; retry++) {
        try {
          printLog(
            ctx,
            `sendPushTx — executing multicall operation ${i + 1}/${calls.length} to: ${call.to} (nonce: ${nonce})`
          );
          lastTxHash = await ctx.pushClient.sendTransaction({
            to: call.to as `0x${string}`,
            data: (call.data || '0x') as `0x${string}`,
            value: call.value,
            signer: ctx.universalSigner,
            nonce,
            gas: PUSH_CHAIN_GAS_LIMIT,
          });
          txSent = true;
        } catch (err: any) {
          const msg = err?.message || err?.details || '';
          if (msg.includes('invalid nonce') || msg.includes('invalid sequence')) {
            printLog(
              ctx,
              `sendPushTx — nonce mismatch on operation ${i + 1}/${calls.length} (retry ${retry + 1}/${MAX_NONCE_RETRIES}), re-fetching nonce`
            );
            nonce = await ctx.pushClient.publicClient.getTransactionCount({
              address: ctx.universalSigner.account.address as `0x${string}`,
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

      const receipt = await ctx.pushClient.publicClient.waitForTransactionReceipt({
        hash: lastTxHash,
      });
      if (receipt.status === 'reverted') {
        // Simulate the failed call to extract the revert reason
        let revertReason = 'unknown';
        try {
          await ctx.pushClient.publicClient.call({
            to: call.to as `0x${string}`,
            data: (call.data || '0x') as `0x${string}`,
            value: call.value,
            account: ctx.universalSigner.account.address as `0x${string}`,
            blockNumber: receipt.blockNumber,
          });
        } catch (simErr: any) {
          // viem decodes common revert reasons into shortMessage
          revertReason =
            simErr?.shortMessage || simErr?.cause?.reason || simErr?.cause?.message || simErr?.message || String(simErr);
          // Also log the raw revert data if available
          const revertData = simErr?.cause?.data || simErr?.data;
          if (revertData) {
            revertReason += ` [data: ${revertData}]`;
          }
        }
        printLog(
          ctx,
          `sendPushTx — multicall operation ${i + 1}/${calls.length} reverted (to: ${call.to}, txHash: ${lastTxHash}, revertReason: ${revertReason})`
        );
        throw new Error(
          `sendPushTx — multicall operation ${i + 1}/${calls.length} reverted (to: ${call.to}, txHash: ${lastTxHash}, revertReason: ${revertReason})`
        );
      }
      printLog(
        ctx,
        `sendPushTx — operation ${i + 1}/${calls.length} confirmed in block ${receipt.blockNumber}`
      );
      nonce++;
    }
    const txResponse = await getIndexedPushTransaction(
      ctx,
      lastTxHash,
      'sendPushTx'
    );
    // Sequential fallback: each call was a separate tx, so the batch is NOT
    // atomic (an earlier call can be committed while a later one reverts).
    const resp = await transformFn(txResponse, eventBuffer);
    resp.atomic = false;
    return resp;
  }

  const txHash = await ctx.pushClient.sendTransaction({
    to: execute.to,
    data: (execute.data || '0x') as `0x${string}`,
    value: execute.value,
    signer: ctx.universalSigner,
  });
  const txResponse = await getIndexedPushTransaction(
    ctx,
    txHash,
    'sendPushTx'
  );
  return await transformFn(txResponse, eventBuffer);
}

// ============================================================================
// sendUniversalTx
// ============================================================================

/**
 * UEAErrors.InvalidEVMSignature() selector. Thrown by UEA_EVM.executeUniversalTx
 * when the recovered EIP-712 signer doesn't match the UEA owner — typically
 * because UEA storage `nonce` advanced between getUEANonce() and Cosmos
 * inclusion. The retry hook re-fetches nonce, re-signs, and re-broadcasts.
 */
const INVALID_EVM_SIGNATURE_SELECTOR = '0xc7dbd31d';
const MAX_SIG_RETRIES = 2;

// Cosmos-layer sequence race: two broadcasts sign with the same account
// sequence before either lands; the node rejects the loser with
// "account sequence mismatch". Re-signing pulls a fresh sequence (signCosmosTx
// re-fetches it per call), so a simple loop-back is sufficient.
const COSMOS_SEQUENCE_MISMATCH_RE =
  /account sequence mismatch|incorrect account sequence/i;
const MAX_SEQ_RETRIES = 3;
const SEQ_RETRY_BASE_DELAY_MS = 400;

export type ResignUniversalPayloadFn = () => Promise<{
  universalPayload: UniversalPayload;
  verificationData: `0x${string}`;
}>;

/**
 * Sends a Cosmos tx to Push Chain (gasless) to execute user intent.
 * Wraps the EVM payload in a MsgExecutePayload Cosmos message.
 *
 * `resignFn` (optional): if provided, `sendUniversalTx` retries up to
 * `MAX_SIG_RETRIES` times when the Cosmos revert carries the
 * `InvalidEVMSignature()` selector. Each retry calls `resignFn` to obtain
 * a payload re-signed against the UEA's current on-chain nonce.
 */
export async function sendUniversalTx(
  ctx: OrchestratorContext,
  isUEADeployed: boolean,
  feeLockTxHash: string | undefined,
  universalPayload: UniversalPayload | undefined,
  verificationData: `0x${string}` | undefined,
  eventBuffer: ProgressEvent[],
  transformFn: TransformToResponseFn,
  resignFn?: ResignUniversalPayloadFn
): Promise<UniversalTxResponse[]> {
  const { chain, address } = ctx.universalSigner.account;
  const { vm, chainId } = CHAIN_INFO[chain];

  const universalAccountId: UniversalAccountId = {
    chainNamespace: VM_NAMESPACE[vm],
    chainId: chainId,
    owner:
      vm === VM.EVM
        ? address
        : vm === VM.SVM
        ? bytesToHex(new Uint8Array(bs58.decode(address)))
        : address,
  };

  const { cosmosAddress: signer } = ctx.pushClient.getSignerAddress();

  let currentPayload = universalPayload;
  let currentVerificationData = verificationData;
  let tx: Awaited<ReturnType<typeof ctx.pushClient.broadcastCosmosTx>> | undefined;
  let seqRetryCount = 0;

  for (let attempt = 0; attempt <= MAX_SIG_RETRIES; attempt++) {
    const msgs: Any[] = [];
    if (currentPayload && currentVerificationData) {
      msgs.push(
        ctx.pushClient.createMsgExecutePayload({
          signer,
          universalAccountId,
          universalPayload: currentPayload,
          verificationData: currentVerificationData,
        })
      );
    }

    const txBody = await ctx.pushClient.createCosmosTxBody(msgs);
    const txRaw = await ctx.pushClient.signCosmosTx(txBody);
    try {
      tx = await ctx.pushClient.broadcastCosmosTx(txRaw);
    } catch (err: any) {
      const msg = err?.message || String(err);
      if (
        COSMOS_SEQUENCE_MISMATCH_RE.test(msg) &&
        seqRetryCount < MAX_SEQ_RETRIES
      ) {
        seqRetryCount++;
        const delay = Math.round(
          SEQ_RETRY_BASE_DELAY_MS * seqRetryCount * (1 + Math.random() * 0.2)
        );
        printLog(
          ctx,
          `sendUniversalTx — Cosmos sequence mismatch on broadcast (retry ${seqRetryCount}/${MAX_SEQ_RETRIES}), sleeping ${delay}ms: ${msg}`
        );
        await new Promise((r) => setTimeout(r, delay));
        attempt--; // don't consume EVM-signature retry budget
        continue;
      }
      throw err;
    }

    if (tx.code === 0) break;

    // Cosmos sequence race: returned via tx.rawLog rather than thrown
    const isSeqMismatch =
      typeof tx.rawLog === 'string' &&
      COSMOS_SEQUENCE_MISMATCH_RE.test(tx.rawLog);
    if (isSeqMismatch && seqRetryCount < MAX_SEQ_RETRIES) {
      seqRetryCount++;
      const delay = Math.round(
        SEQ_RETRY_BASE_DELAY_MS * seqRetryCount * (1 + Math.random() * 0.2)
      );
      printLog(
        ctx,
        `sendUniversalTx — Cosmos sequence mismatch in tx.rawLog (retry ${seqRetryCount}/${MAX_SEQ_RETRIES}), sleeping ${delay}ms: ${tx.rawLog}`
      );
      await new Promise((r) => setTimeout(r, delay));
      attempt--; // don't consume EVM-signature retry budget
      continue;
    }

    // Nonce-race retry: UEA storage nonce advanced between our read and
    // tx inclusion. Re-sign with the fresh nonce and rebroadcast.
    const isSigMismatch =
      typeof tx.rawLog === 'string' &&
      tx.rawLog.includes(INVALID_EVM_SIGNATURE_SELECTOR);
    if (attempt < MAX_SIG_RETRIES && isSigMismatch && resignFn) {
      printLog(
        ctx,
        `sendUniversalTx — InvalidEVMSignature on attempt ${attempt + 1} (${tx.rawLog}); re-signing with fresh UEA nonce (retry ${attempt + 1}/${MAX_SIG_RETRIES})`
      );
      const fresh = await resignFn();
      currentPayload = fresh.universalPayload;
      currentVerificationData = fresh.verificationData;
      continue;
    }

    // Terminal failure
    const failedEthTxHashes = tx.events
      ?.filter((e: any) => e.type === 'ethereum_tx')
      .flatMap((e: any) =>
        e.attributes
          ?.filter((attr: any) => attr.key === 'ethereumTxHash')
          .map((attr: any) => attr.value as `0x${string}`)
      ) ?? [];

    // Decode known revert selectors (e.g. `ret 0xacfdb444`) from the cosmos
    // rawLog so the consumer-facing error AND the diagnostic failureSummary
    // log carry an actionable hint instead of raw 4-byte hex. Mirrors the
    // wiring in `extractPcTxAndTransform` for the post-success `pcTx FAILED`
    // path. Also feeds the structured `decodedError` payload through to the
    // terminal hook (199-02 / 299-02 / 399-02 / 999-02).
    const rawMessage = tx.rawLog ?? '';
    let publicMessage = normalizePublicErrorMessage(rawMessage);
    let decodedForPayload:
      | { name?: string; hint?: string; selector?: string; decoded?: string }
      | undefined;
    const decoded = decodeRevert(rawMessage);
    if (decoded?.kind === 'custom') {
      publicMessage = formatDecodedRevertForUser(decoded);
      decodedForPayload = {
        name: decoded.name,
        hint: decoded.hint,
        selector: decoded.selector,
      };
    } else if (decoded?.kind === 'string') {
      publicMessage = formatDecodedRevertForUser(decoded);
      decodedForPayload = {
        decoded: decoded.decoded,
        selector: decoded.selector,
      };
    } else if (decoded?.kind === 'unknown') {
      printLog(
        ctx,
        `[error-decoder] unknown selector ${decoded.selector} — consider adding to KNOWN_ERROR_SELECTORS`
      );
    }

    const failureSummary = [
      `PUSH CHAIN TRANSACTION FAILED`,
      `Cosmos TX Hash: ${tx.transactionHash}`,
      `Block Height: ${tx.height}, TX Code: ${tx.code} (error)`,
      `Gas Used: ${tx.gasUsed}, Gas Wanted: ${tx.gasWanted}`,
      ...(failedEthTxHashes.length > 0 ? [`Ethereum TX Hash(es): ${failedEthTxHashes.join(', ')}`] : []),
      `Error: ${publicMessage}`,
    ].join(' | ');
    printLog(ctx, failureSummary);

    // Throw a typed error so the orchestrator's outer catch can lift the
    // structured `decodedError` straight onto the terminal-hook payload.
    throw new PushChainExecutionError(publicMessage, {
      decodedError: decodedForPayload,
    });
  }

  if (!tx || tx.code !== 0) {
    throw new Error(
      `sendUniversalTx — unreachable: loop exited without success or throw`
    );
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

  const evmTxs = await Promise.all(
    ethTxHashes.map(async (hash) =>
      getIndexedPushTransaction(ctx, hash, 'sendUniversalTx')
    )
  );

  const responses = await Promise.all(
    evmTxs.map((tx, index) =>
      transformFn(
        tx,
        index === evmTxs.length - 1 ? eventBuffer : []
      )
    )
  );
  return responses;
}

// ============================================================================
// extractPcTxAndTransform
// ============================================================================

/**
 * Validates Push Chain tx response, extracts last pcTx, fetches EVM tx,
 * and transforms to UniversalTxResponse.
 */
export async function extractPcTxAndTransform(
  ctx: OrchestratorContext,
  pushChainUniversalTx: UniversalTx | undefined,
  gatewayTxHash: string,
  eventBuffer: ProgressEvent[],
  label: string,
  transformFn: TransformToResponseFn
): Promise<UniversalTxResponse> {
  if (!pushChainUniversalTx?.pcTx?.length) {
    throw new Error(
      `Failed to retrieve Push Chain transaction status for gateway tx: ${gatewayTxHash}. ` +
        `The transaction may have failed on Push Chain or not been indexed yet.`
    );
  }
  const lastPcTransaction = pushChainUniversalTx.pcTx.at(-1);
  printLog(ctx, `${label} — pcTx: ` + JSON.stringify(
    pushChainUniversalTx.pcTx.map((p: any) => ({ txHash: p.txHash, status: p.status, errorMsg: p.errorMsg })),
    null, 2));
  printLog(ctx, `${label} — using lastPcTransaction: ` + JSON.stringify(lastPcTransaction, null, 2));
  if (!lastPcTransaction?.txHash || lastPcTransaction.status === 'FAILED') {
    const failedPcTx = lastPcTransaction?.status === 'FAILED'
      ? lastPcTransaction
      : pushChainUniversalTx.pcTx.find(
          (pcTx: { status?: string; errorMsg?: string }) =>
            pcTx.status === 'FAILED' && pcTx.errorMsg
        );
    const rawFailedPcTxErrorMsg = failedPcTx?.errorMsg ?? '';
    let failedPcTxErrorMsg = rawFailedPcTxErrorMsg
      ? normalizePublicErrorMessage(rawFailedPcTxErrorMsg)
      : '';
    const errorDetails = failedPcTxErrorMsg ? `: ${failedPcTxErrorMsg}` : '';
    // Decode known revert selectors and ABI-encoded `Error(string)` reverts
    // into actionable hints. Unknown selectors are logged at INFO so the
    // table can grow from real reverts.
    let hint = '';
    let decodedForPayload:
      | { name?: string; hint?: string; selector?: string; decoded?: string }
      | undefined;
    const decoded = decodeRevert(rawFailedPcTxErrorMsg);
    if (decoded?.kind === 'custom') {
      failedPcTxErrorMsg = formatDecodedRevertForUser(decoded);
      hint = '';
      decodedForPayload = {
        name: decoded.name,
        hint: decoded.hint,
        selector: decoded.selector,
      };
    } else if (decoded?.kind === 'string') {
      failedPcTxErrorMsg = formatDecodedRevertForUser(decoded);
      hint = '';
      decodedForPayload = {
        decoded: decoded.decoded,
        selector: decoded.selector,
      };
    } else if (decoded?.kind === 'unknown') {
      printLog(
        ctx,
        `[error-decoder] unknown selector ${decoded.selector} — consider adding to KNOWN_ERROR_SELECTORS`
      );
    }
    const decodedErrorDetails = failedPcTxErrorMsg
      ? `: ${failedPcTxErrorMsg}`
      : errorDetails;
    const fullMessage =
      `Push Chain transaction failed for gateway tx: ${gatewayTxHash}${decodedErrorDetails}${hint}`;
    // Live-emit 199-02 before throwing so the terminal failure hook reaches
    // any caller-registered progress stream (parity with reconstructProgressEvents
    // which emits 199-02 on replay).
    fireProgressHook(
      ctx,
      PROGRESS_HOOK.SEND_TX_199_02,
      fullMessage,
      decodedForPayload,
      failedPcTx?.txHash
    );
    throw new PushChainExecutionError(fullMessage, {
      gatewayTxHash,
      decodedError: decodedForPayload,
    });
  }
  const tx = await getIndexedPushTransaction(
    ctx,
    lastPcTransaction.txHash as `0x${string}`,
    label
  );
  return transformFn(tx, eventBuffer);
}

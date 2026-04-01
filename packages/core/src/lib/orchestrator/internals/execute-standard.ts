/**
 * Standard payload execution flow (no funds) — extracted from Orchestrator.execute().
 *
 * Handles payload-only execution on Push Chain:
 * - Push-to-Push direct transactions
 * - Fee-locking path for undeployed/underfunded UEA
 * - Signed verification path for deployed UEA with funds
 */

import { bs58 } from '../../internal/bs58';
import { bytesToHex, zeroAddress } from 'viem';
import { CHAIN_INFO } from '../../constants/chain';
import { VM } from '../../constants/enums';
import {
  UniversalPayload,
  VerificationType,
} from '../../generated/v1/tx';
import {
  PROGRESS_HOOK,
  ProgressEvent,
} from '../../progress-hook/progress-hook.types';
import { Utils } from '../../utils';
import { EvmClient } from '../../vm-client/evm-client';
import type { TxResponse } from '../../vm-client/vm-client.types';
import type {
  ExecuteParams,
  UniversalTxRequest,
  UniversalTxResponse,
} from '../orchestrator.types';
import { buildExecuteMulticall } from '../payload-builders';
import type { OrchestratorContext } from './context';
import { fireProgressHook } from './context';
import {
  isPushChain,
  validateMainnetConnection,
  validateFeeLockTxHash,
  bigintReplacer,
  fetchOriginChainTransactionForProgress,
} from './helpers';
import {
  buildUniversalTxRequest,
  buildMulticallPayloadData,
} from './payload-builder';
import { encodeUniversalPayload, signUniversalPayload } from './signing';
import { computeUEAOffchain, getUEANonce, fetchUEAVersion } from './uea-manager';
import { waitForLockerFeeConfirmation } from './confirmation';
import { lockFee } from './gateway-client';
import {
  queryUniversalTxStatusFromGatewayTx,
  transformToUniversalTxResponse,
  type ResponseBuilderCallbacks,
} from './response-builder';
import { sendPushTx, sendUniversalTx, extractPcTxAndTransform } from './push-chain-tx';

export async function executeStandardPayload(
  ctx: OrchestratorContext,
  execute: ExecuteParams,
  eventBuffer: ProgressEvent[],
  getResponseCallbacks: () => ResponseBuilderCallbacks
): Promise<UniversalTxResponse> {
  const transformFn = (tx: TxResponse, buf: ProgressEvent[] = []) =>
    transformToUniversalTxResponse(ctx, tx, buf, getResponseCallbacks());

  // Set default value for value if undefined
  if (execute.value === undefined) {
    execute.value = BigInt(0);
  }

  const chain = ctx.universalSigner.account.chain;
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_01, chain, ctx.universalSigner.account.address);
  validateMainnetConnection(chain, ctx.pushClient.pushChainInfo.chainId);

  // Push to Push Tx
  if (isPushChain(chain)) {
    fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_07);
    const tx = await sendPushTx(ctx, execute, eventBuffer, transformFn);
    fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_99_01, [tx]);
    return tx;
  }

  // Fetch Gas details and estimate cost of execution
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_02_01);
  const gasEstimate = execute.gasLimit || BigInt(1e7);
  const gasPrice = await ctx.pushClient.getGasPrice();
  const requiredGasFee = gasEstimate * gasPrice;
  const requiredFunds = requiredGasFee + execute.value;
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_02_02, requiredFunds);

  // Fetch UEA Details (or use pre-fetched status if available)
  const UEA = computeUEAOffchain(ctx);
  let isUEADeployed: boolean;
  let nonce: bigint;
  let funds: bigint;

  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_03_01);
  if (execute._ueaStatus) {
    isUEADeployed = execute._ueaStatus.isDeployed;
    nonce = execute._ueaStatus.nonce;
    funds = execute._ueaStatus.balance;
  } else {
    const [code, balance] = await Promise.all([
      ctx.pushClient.publicClient.getCode({ address: UEA }),
      ctx.pushClient.getBalance(UEA),
    ]);
    isUEADeployed = code !== undefined;
    nonce = isUEADeployed ? await getUEANonce(ctx, UEA) : BigInt(0);
    funds = balance;
  }
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_03_02, UEA, isUEADeployed);

  // Validate and decode feeLockTxHash
  let feeLockTxHash: string | undefined = execute.feeLockTxHash;
  if (feeLockTxHash) {
    validateFeeLockTxHash(feeLockTxHash);
    if (!feeLockTxHash.startsWith('0x')) {
      const decoded = bs58.decode(feeLockTxHash);
      feeLockTxHash = bytesToHex(new Uint8Array(decoded));
    }
  }

  const feeLockingRequired =
    !execute._skipFeeLocking &&
    (!isUEADeployed || funds < requiredFunds) && !feeLockTxHash;

  // Support multicall payload encoding when execute.data is an array
  let payloadData: `0x${string}`;
  let payloadTo: `0x${string}`;
  let req: UniversalTxRequest;

  if (Array.isArray(execute.data)) {
    payloadTo = zeroAddress;
    payloadData = buildMulticallPayloadData(
      ctx, execute.to, buildExecuteMulticall({ execute, ueaAddress: UEA })
    );
    // Wrap in full UniversalPayload encoding for gateway req (matches non-array paths)
    const universalPayloadForReq = JSON.parse(
      JSON.stringify({
        to: zeroAddress, value: execute.value,
        data: payloadData,
        gasLimit: execute.gasLimit || BigInt(5e7),
        maxFeePerGas: execute.maxFeePerGas || BigInt(1e10),
        maxPriorityFeePerGas: execute.maxPriorityFeePerGas || BigInt(0),
        nonce, deadline: execute.deadline || BigInt(9999999999),
        vType: feeLockingRequired
          ? VerificationType.universalTxVerification
          : VerificationType.signedVerification,
      }, bigintReplacer)
    ) as UniversalPayload;
    req = buildUniversalTxRequest(ctx.universalSigner.account.address as `0x${string}`, {
      recipient: zeroAddress, token: zeroAddress, amount: BigInt(0),
      payload: encodeUniversalPayload(universalPayloadForReq),
    });
  } else {
    if (execute.to.toLowerCase() !== UEA.toLowerCase()) {
      if (execute.funds) {
        payloadTo = zeroAddress;
        payloadData = buildMulticallPayloadData(
          ctx, execute.to, buildExecuteMulticall({ execute, ueaAddress: UEA })
        );
        req = buildUniversalTxRequest(ctx.universalSigner.account.address as `0x${string}`, {
          recipient: zeroAddress, token: zeroAddress, amount: BigInt(0), payload: payloadData,
        });
      } else {
        payloadTo = execute.to;
        payloadData = execute.data || '0x';
        const reqData = buildMulticallPayloadData(
          ctx, execute.to, buildExecuteMulticall({ execute, ueaAddress: UEA })
        );
        const universalPayloadOther = JSON.parse(
          JSON.stringify({
            to: zeroAddress, value: execute.value,
            data: reqData,
            gasLimit: execute.gasLimit || BigInt(5e7),
            maxFeePerGas: execute.maxFeePerGas || BigInt(1e10),
            maxPriorityFeePerGas: execute.maxPriorityFeePerGas || BigInt(0),
            nonce, deadline: execute.deadline || BigInt(9999999999),
            vType: feeLockingRequired
              ? VerificationType.universalTxVerification
              : VerificationType.signedVerification,
          }, bigintReplacer)
        ) as UniversalPayload;
        req = buildUniversalTxRequest(ctx.universalSigner.account.address as `0x${string}`, {
          recipient: zeroAddress, token: zeroAddress, amount: BigInt(0),
          payload: encodeUniversalPayload(universalPayloadOther),
        });
      }
    } else {
      payloadTo = execute.to;
      payloadData = execute.data || '0x';
      const reqData = buildMulticallPayloadData(
        ctx, execute.to, buildExecuteMulticall({ execute, ueaAddress: UEA })
      );
      const universalPayloadSelf = JSON.parse(
        JSON.stringify({
          to: zeroAddress, value: execute.value,
          data: reqData,
          gasLimit: execute.gasLimit || BigInt(5e7),
          maxFeePerGas: execute.maxFeePerGas || BigInt(1e10),
          maxPriorityFeePerGas: execute.maxPriorityFeePerGas || BigInt(0),
          nonce, deadline: execute.deadline || BigInt(9999999999),
          vType: feeLockingRequired
            ? VerificationType.universalTxVerification
            : VerificationType.signedVerification,
        }, bigintReplacer)
      ) as UniversalPayload;
      req = buildUniversalTxRequest(ctx.universalSigner.account.address as `0x${string}`, {
        recipient: zeroAddress, token: zeroAddress, amount: BigInt(0),
        payload: encodeUniversalPayload(universalPayloadSelf),
      });
    }
  }

  const universalPayload = JSON.parse(
    JSON.stringify({
      to: payloadTo, value: execute.value, data: payloadData,
      gasLimit: execute.gasLimit || BigInt(5e7),
      maxFeePerGas: execute.maxFeePerGas || BigInt(1e10),
      maxPriorityFeePerGas: execute.maxPriorityFeePerGas || BigInt(0),
      nonce, deadline: execute.deadline || BigInt(9999999999),
      vType: feeLockingRequired
        ? VerificationType.universalTxVerification
        : VerificationType.signedVerification,
    }, bigintReplacer)
  ) as UniversalPayload;

  // Prepare verification data by either signature or fund locking
  let verificationData: `0x${string}`;

  if (!feeLockingRequired) {
    const ueaVersion = await fetchUEAVersion(ctx);
    fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_04_02);
    const signature = await signUniversalPayload(ctx, universalPayload, UEA, ueaVersion);
    verificationData = bytesToHex(signature);
    fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_04_03);
  } else {
    // Fee Locking
    const fundDifference = requiredFunds - funds;
    const fixedPushAmount = Utils.helpers.parseUnits('0.001', 18);
    const lockAmount = funds < requiredFunds ? fundDifference : fixedPushAmount;
    const lockAmountInUSD = ctx.pushClient.pushToUSDC(lockAmount);

    const feeLockTxHashBytes = await lockFee(ctx, lockAmountInUSD, universalPayload, req);
    feeLockTxHash = bytesToHex(feeLockTxHashBytes);
    verificationData = bytesToHex(feeLockTxHashBytes);

    const { vm } = CHAIN_INFO[chain];
    const feeLockTxHashDisplay = vm === VM.SVM
      ? bs58.encode(Buffer.from(feeLockTxHashBytes))
      : feeLockTxHash;

    const originTx = await fetchOriginChainTransactionForProgress(ctx, chain, feeLockTxHash, feeLockTxHashDisplay);
    fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_05_01, feeLockTxHashDisplay, originTx);

    await waitForLockerFeeConfirmation(ctx, feeLockTxHashBytes);
    fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_05_02);

    const { defaultRPC, lockerContract } = CHAIN_INFO[chain];
    const pushChainUniversalTx = await queryUniversalTxStatusFromGatewayTx(
      ctx,
      new EvmClient({ rpcUrls: ctx.rpcUrls[chain] || defaultRPC }),
      lockerContract as `0x${string}`,
      feeLockTxHash,
      'sendTxWithGas'
    );

    const response = await extractPcTxAndTransform(ctx, pushChainUniversalTx, feeLockTxHash, eventBuffer, 'sendTxWithGas', transformFn);
    fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_99_01, [response]);
    return response;
  }

  // Non-fee-locking path: Broadcasting Tx to PC via sendUniversalTx
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_07);
  const transactions = await sendUniversalTx(
    ctx, isUEADeployed, feeLockTxHash, universalPayload, verificationData, eventBuffer, transformFn
  );
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_99_01, transactions);
  return transactions[transactions.length - 1];
}

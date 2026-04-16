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
import { fireProgressHook, printLog } from './context';
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
import {
  estimateDepositFromLockedNative,
  estimateNativeForDesiredDeposit,
} from './gas-calculator';
import { getNativePRC20ForChain } from './helpers';
import { PriceFetch } from '../../price-fetch/price-fetch';

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
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_101, chain, ctx.universalSigner.account.address);
  validateMainnetConnection(chain, ctx.pushClient.pushChainInfo.chainId);

  // Push to Push Tx
  if (isPushChain(chain)) {
    fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_107);
    const tx = await sendPushTx(ctx, execute, eventBuffer, transformFn);
    fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_199_01, [tx]);
    return tx;
  }

  // Fetch Gas details and estimate cost of execution
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_102_01);
  const gasEstimate = execute.gasLimit || BigInt(1e7);
  const gasPrice = await ctx.pushClient.getGasPrice();
  const requiredGasFee = gasEstimate * gasPrice;
  const requiredFunds = requiredGasFee + execute.value;
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_102_02, requiredFunds);

  // Fetch UEA Details (or use pre-fetched status if available)
  const UEA = computeUEAOffchain(ctx);
  let isUEADeployed: boolean;
  let nonce: bigint;
  let funds: bigint;

  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_103_01);
  if (execute._ueaStatus) {
    isUEADeployed = execute._ueaStatus.isDeployed;
    nonce = execute._ueaStatus.nonce;
    funds = execute._ueaStatus.balance;
  } else {
    // Skip getCode if accountStatusCache already confirmed deployment
    const deployedHint = ctx.accountStatusCache?.uea?.deployed;
    if (deployedHint) {
      const [balance, ueaNonce] = await Promise.all([
        ctx.pushClient.getBalance(UEA),
        getUEANonce(ctx, UEA),
      ]);
      isUEADeployed = true;
      nonce = ueaNonce;
      funds = balance;
    } else {
      const [code, balance] = await Promise.all([
        ctx.pushClient.publicClient.getCode({ address: UEA }),
        ctx.pushClient.getBalance(UEA),
      ]);
      isUEADeployed = code !== undefined;
      nonce = isUEADeployed ? await getUEANonce(ctx, UEA) : BigInt(0);
      funds = balance;
    }
  }
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_103_02, UEA, isUEADeployed);

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
    fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_104_02);
    const signature = await signUniversalPayload(ctx, universalPayload, UEA, ueaVersion);
    verificationData = bytesToHex(signature);
    fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_104_03);
  } else {
    // Fee Locking
    const fundDifference = requiredFunds - funds;
    const fixedPushAmount = Utils.helpers.parseUnits('0.001', 18);
    const lockAmount = funds < requiredFunds ? fundDifference : fixedPushAmount;

    // Size the USD deposit against the REAL Uniswap pool rate (not the fixed
    // $0.10/PC SDK rate) for EVM origins. The pool typically prices PC much
    // higher than $0.10, so pushToUSDC under-provisions and the resulting
    // deposit gets clamped up to the $1 minimum, producing near-zero WPC.
    // When the quoted USD exceeds the $1000 cap the later clamp kicks in
    // (pool limit surfaces via the pre-flight capacity message).
    // Falls back to pushToUSDC if the quoter is unavailable.
    const { vm: sizingOriginVm } = CHAIN_INFO[chain];
    let lockAmountInUSD: bigint = ctx.pushClient.pushToUSDC(lockAmount);
    if (sizingOriginVm === VM.EVM && lockAmount > BigInt(0)) {
      // Target lockAmount × 1.2 so that the 10% slippage margin applied by
      // the pre-flight check (safeUPC = predictedUPC × 0.9) leaves enough
      // headroom even when Uniswap V3 exactOutput↔exactInput quotes aren't
      // perfectly symmetric (tick-math rounding).
      const targetWPC = (lockAmount * BigInt(12)) / BigInt(10);
      const originPrc20ForSizing = getNativePRC20ForChain(chain, ctx.pushNetwork);
      const requiredNative = await estimateNativeForDesiredDeposit(
        ctx,
        targetWPC,
        originPrc20ForSizing,
      );
      if (requiredNative > BigInt(0)) {
        const ethPriceForSizing = await new PriceFetch(ctx.rpcUrls).getPrice(chain);
        if (ethPriceForSizing > BigInt(0)) {
          // requiredNative (18-dec wei) × ethPrice (8-dec USD/ETH) / 1e18 = USD in 8-dec
          const poolBasedUsd = (requiredNative * ethPriceForSizing) / BigInt(1e18);
          printLog(ctx,
            `Fee-lock sizing: pushToUSDC=${lockAmountInUSD.toString()} (fixed $0.10/PC), ` +
            `poolBased=${poolBasedUsd.toString()} (pool quote for ${targetWPC.toString()} WPC) — using poolBased`
          );
          lockAmountInUSD = poolBasedUsd;
        }
      }
    }

    // Apply minimum deposit override (e.g., Route 2 needs enough UPC for outbound swap)
    const effectiveLockAmountInUSD = execute._minimumDepositUsd && execute._minimumDepositUsd > lockAmountInUSD
      ? execute._minimumDepositUsd
      : lockAmountInUSD;

    // Pre-flight: predict the actual $PC the UEA will receive after the
    // on-chain pETH → WPC swap and validate it covers requiredFunds.
    // Uses the same Uniswap V3 quoter the chain uses (execute_inbound_gas.go).
    // Mirrors the pattern in route-handlers.ts (Route 2/3).
    const { vm: originVm } = CHAIN_INFO[chain];
    if (originVm === VM.EVM) {
      try {
        // Replicate lockFee's USD → native conversion (with its $1–$1000 clamp)
        const oneUsd = Utils.helpers.parseUnits('1', 8);
        const maxUsd = Utils.helpers.parseUnits('1000', 8);
        let depositUsd = effectiveLockAmountInUSD < oneUsd ? oneUsd : effectiveLockAmountInUSD;
        if (depositUsd > maxUsd) depositUsd = maxUsd;

        const ethPrice = await new PriceFetch(ctx.rpcUrls).getPrice(chain);
        if (ethPrice > BigInt(0)) {
          const nativeAmountETH =
            (depositUsd * BigInt(1e18) + (ethPrice - BigInt(1))) / ethPrice + BigInt(1);
          const originPrc20 = getNativePRC20ForChain(chain, ctx.pushNetwork);
          const predictedUPC = await estimateDepositFromLockedNative(ctx, nativeAmountETH, originPrc20);

          if (predictedUPC > BigInt(0)) {
            // 10% slippage margin (same as route-handlers.ts)
            const safeUPC = (predictedUPC * BigInt(90)) / BigInt(100);
            const totalAvailable = safeUPC + funds;
            printLog(ctx,
              `Fee-lock pre-flight: deposit ${depositUsd.toString()} USD → ` +
              `~${nativeAmountETH.toString()} wei ETH → ~${predictedUPC.toString()} UPC ` +
              `(safe: ${safeUPC.toString()}), existing: ${funds.toString()}, ` +
              `total: ${totalAvailable.toString()}, required: ${requiredFunds.toString()}`
            );

            if (totalAvailable < requiredFunds) {
              const shortfall = requiredFunds - totalAvailable;

              // On failure only: probe pool capacity at the max cap so the
              // caller gets a readable "max transferable right now" number.
              // One extra quoter call — not run on the success path.
              let maxTransferableNote = '';
              if (depositUsd < maxUsd) {
                const maxNativeAmountETH =
                  (maxUsd * BigInt(1e18) + (ethPrice - BigInt(1))) / ethPrice + BigInt(1);
                const maxPredictedUPC = await estimateDepositFromLockedNative(
                  ctx,
                  maxNativeAmountETH,
                  originPrc20,
                );
                if (maxPredictedUPC > BigInt(0)) {
                  const maxSafeUPC = (maxPredictedUPC * BigInt(90)) / BigInt(100);
                  const gasReserve = Utils.helpers.parseUnits('0.01', 18);
                  const maxFromDeposit =
                    maxSafeUPC > gasReserve ? maxSafeUPC - gasReserve : BigInt(0);
                  const maxTransferable = funds + maxFromDeposit;
                  maxTransferableNote =
                    `Max transferable right now (at $1000 cap, pool-limited): ` +
                    `~${(Number(maxTransferable) / 1e18).toFixed(4)} $PC ` +
                    `(UEA balance ${(Number(funds) / 1e18).toFixed(4)} + ` +
                    `pool-safe deposit ${(Number(maxFromDeposit) / 1e18).toFixed(4)} − gas).`;
                  printLog(ctx, `Fee-lock capacity: ${maxTransferableNote}`);
                }
              }

              throw new Error(
                `Insufficient deposit: the fee-lock will deposit ~${(Number(safeUPC) / 1e18).toFixed(4)} $PC ` +
                `but the transaction requires ~${(Number(requiredFunds) / 1e18).toFixed(4)} $PC ` +
                `(shortfall: ~${(Number(shortfall) / 1e18).toFixed(4)} $PC). ` +
                `The fee-lock deposit is capped at $1000 USD. ` +
                (maxTransferableNote ? maxTransferableNote + ' ' : '') +
                `Reduce the transfer value or pre-fund the UEA (${UEA}) on Push Chain.`
              );
            }
          }
        }
      } catch (err) {
        // If the error is our own insufficient-deposit error, rethrow it
        if (err instanceof Error && err.message.startsWith('Insufficient deposit')) {
          throw err;
        }
        // Otherwise quoter failed — log and continue (same fallback as route-handlers)
        printLog(ctx, `Fee-lock pre-flight quote failed, proceeding without validation: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const feeLockTxHashBytes = await lockFee(ctx, effectiveLockAmountInUSD, universalPayload, req);
    feeLockTxHash = bytesToHex(feeLockTxHashBytes);
    verificationData = bytesToHex(feeLockTxHashBytes);

    const { vm } = CHAIN_INFO[chain];
    const feeLockTxHashDisplay = vm === VM.SVM
      ? bs58.encode(Buffer.from(feeLockTxHashBytes))
      : feeLockTxHash;

    const originTx = await fetchOriginChainTransactionForProgress(ctx, chain, feeLockTxHash, feeLockTxHashDisplay);
    fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_105_01, feeLockTxHashDisplay, originTx);

    await waitForLockerFeeConfirmation(ctx, feeLockTxHashBytes);
    fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_105_02);

    const { defaultRPC, lockerContract } = CHAIN_INFO[chain];
    const pushChainUniversalTx = await queryUniversalTxStatusFromGatewayTx(
      ctx,
      new EvmClient({ rpcUrls: ctx.rpcUrls[chain] || defaultRPC }),
      lockerContract as `0x${string}`,
      feeLockTxHash,
      'sendTxWithGas'
    );

    const response = await extractPcTxAndTransform(ctx, pushChainUniversalTx, feeLockTxHash, eventBuffer, 'sendTxWithGas', transformFn);
    fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_199_01, [response]);
    return response;
  }

  // Non-fee-locking path: Broadcasting Tx to PC via sendUniversalTx
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_107);
  const transactions = await sendUniversalTx(
    ctx, isUEADeployed, feeLockTxHash, universalPayload, verificationData, eventBuffer, transformFn
  );
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_199_01, transactions);
  return transactions[transactions.length - 1];
}

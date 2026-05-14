/**
 * Cascade composition functions extracted from Orchestrator.
 *
 * Covers: prepareTransaction, buildHopDescriptor, classifyIntoSegments,
 * getSegmentType, composeCascade, createCascadedBuilder, createChainedBuilder.
 */

import { PublicKey } from '@solana/web3.js';
import { encodeFunctionData } from 'viem';
import { ERC20_EVM } from '../../constants/abi/erc20.evm';
import { CHAIN_INFO, UNIVERSAL_GATEWAY_ADDRESSES } from '../../constants/chain';
import { CHAIN, PUSH_NETWORK } from '../../constants/enums';
import { MoveableToken } from '../../constants/tokens';
import {
  DEFAULT_CEA_TO_PUSH_GAS_LIMIT,
  DEFAULT_OUTBOUND_GAS_LIMIT,
  ZERO_ADDRESS,
} from '../../constants/selectors';
import {
  TransactionRoute,
  detectRoute,
  validateRouteParams,
} from '../route-detector';
import { getCEAAddress } from '../cea-utils';
import {
  buildExecuteMulticall,
  buildCeaMulticallPayload,
  buildInboundUniversalPayload,
  buildOutboundRequest,
  buildSendUniversalTxToUEA,
  buildOutboundApprovalAndCall,
  buildMigrationPayload,
  assertCeaFundsParkingInvariant,
  isSvmChain,
  encodeSvmExecutePayload,
  encodeSvmCeaToUeaPayload,
} from '../payload-builders';
import { PushChain } from '../../push-chain/push-chain';
import type {
  HopDescriptor,
  CascadeSegment,
  CascadeSegmentType,
  PreparedUniversalTx,
  CascadedTxResponse,
  CascadeHopInfo,
  CascadeCompletionResult,
  CascadeTrackOptions,
  UniversalTxResponse,
  UniversalExecuteParams,
  ExecuteParams,
  MultiCall,
  ChainTarget,
  WaitForOutboundOptions,
  OutboundTxDetails,
} from '../orchestrator.types';
import type { OrchestratorContext } from './context';
import { printLog } from './context';
import {
  getUniversalGatewayPCAddress,
  getNativePRC20ForChain,
  toExecuteParams,
  getPushChainForNetwork,
  isPushChain,
  toExternalTxHashDisplay,
} from './helpers';
import { buildMulticallPayloadData } from './payload-builder';
import {
  computeUEAOffchain,
  getUEANonce,
  getUeaStatusAndNonce,
} from './uea-manager';
import {
  queryOutboundGasFee,
  estimateNativeValueForSwap,
} from './gas-calculator';
import type { GasSizingDecision } from './gas-usd-sizer';
import { UNIVERSAL_GATEWAY_PC } from '../../constants/abi';
import { buildPayloadForRoute } from './route-handlers';
import { pickWaitHooks } from './progress-route-hooks';
import PROGRESS_HOOKS from '../../progress-hook/progress-hook';
import { PROGRESS_HOOK } from '../../progress-hook/progress-hook.types';
import { buildSvmPayloadFromParams } from '../svm-idl/build-payload';
import { runPreflight, maybeFireSvmWarnThreshold } from './preflight';
import { ensureSvmFinalizeGasBudgetQuote } from './svm-rent';
import { InsufficientUEABalanceError } from './errors';
import { fireProgressHook } from './context';
import {
  InboundTimeoutError,
  waitForInboundPushTx,
  type InboundPushTxDetails,
  type WaitForInboundOptions,
} from './inbound-tracker';

// ============================================================================
// Callback interfaces
// ============================================================================

export interface CascadeCallbacks {
  executeFn: (params: any) => Promise<UniversalTxResponse>;
  waitForOutboundTxFn: (
    hash: string,
    opts?: WaitForOutboundOptions
  ) => Promise<OutboundTxDetails>;
  waitForInboundPushTxFn?: (
    outboundExternalTxHash: string,
    sourceChain: string,
    opts?: WaitForInboundOptions
  ) => Promise<InboundPushTxDetails>;
  waitForAllOutboundTxsFn: (
    hash: string,
    hops: CascadeHopInfo[],
    opts: any
  ) => Promise<{ success: boolean; failedAt?: number }>;
}

// ============================================================================
// dispatchCascadeProgressEvent
// ============================================================================

/**
 * Fan out a cascade progress event to up to two listeners with dedup.
 *
 * The two listener slots are:
 *   - `primary`: explicit `eventHook` from CascadeTrackOptions (passed at call
 *     time to `waitForAll` / `wait`).
 *   - `secondary`: init-time `ctx.progressHook` from PushChain.initialize.
 *
 * Both may be undefined; if both reference the same function we invoke once.
 * Events with an empty `id` (the no-op sentinel returned by pickWaitHooks for
 * R4/unknown routes) are dropped so consumers don't see placeholder frames.
 *
 * Exported for unit testing. Production code calls this from the
 * `emitHopEvent` closure inside `createCascadedBuilder.waitForAll`.
 */
export function dispatchCascadeProgressEvent(
  event: import('../../progress-hook/progress-hook.types').ProgressEvent,
  primary?: (
    e: import('../../progress-hook/progress-hook.types').ProgressEvent
  ) => void,
  secondary?: (
    e: import('../../progress-hook/progress-hook.types').ProgressEvent
  ) => void
): void {
  if (!event.id) return;
  if (primary) primary(event);
  if (secondary && secondary !== primary) secondary(event);
}

// ============================================================================
// prepareTransaction
// ============================================================================

export async function prepareTransaction(
  ctx: OrchestratorContext,
  params: UniversalExecuteParams,
  callbacks: CascadeCallbacks
): Promise<PreparedUniversalTx> {
  validateRouteParams(params, {
    clientChain: ctx.universalSigner.account.chain,
  });
  const route = detectRoute(params);

  // Push native EOA: block Route 1 — use sendTransaction() for direct Push calls
  const signerChain = ctx.universalSigner.account.chain;
  const isPushNativeEOA = isPushChain(signerChain);

  if (isPushNativeEOA && route === TransactionRoute.UOA_TO_PUSH) {
    throw new Error(
      'Push native accounts cannot use prepareTransaction for Push Chain transactions. ' +
        'Use sendTransaction() instead for direct Push Chain calls.'
    );
  }

  // Fetch UEA nonce (skip for Push native EOA — uses EVM nonce, not UEA contract nonce)
  let nonce: bigint;
  const ueaAddress = computeUEAOffchain(ctx);

  if (isPushNativeEOA) {
    nonce = BigInt(0);
  } else {
    const deployedHintCascade = ctx.accountStatusCache?.uea?.deployed;
    if (deployedHintCascade) {
      nonce = await getUEANonce(ctx, ueaAddress);
    } else {
      const status = await getUeaStatusAndNonce(ctx);
      nonce = status.nonce;
    }
  }

  // Build the payload based on route
  const { payload, gatewayRequest } = await buildPayloadForRoute(
    ctx,
    params,
    route,
    nonce
  );

  const gasEstimate = params.gasLimit || DEFAULT_OUTBOUND_GAS_LIMIT;
  const deadline =
    params.deadline || BigInt(Math.floor(Date.now() / 1000) + 3600);

  // Build the HopDescriptor with all metadata needed for cascade nesting
  const hop = await buildHopDescriptor(ctx, params, route, ueaAddress);

  const prepared: PreparedUniversalTx = {
    route,
    payload,
    gatewayRequest,
    estimatedGas: gasEstimate,
    nonce,
    deadline,
    _hop: hop,
  };

  return prepared;
}

// ============================================================================
// buildHopDescriptor
// ============================================================================

export async function buildHopDescriptor(
  ctx: OrchestratorContext,
  params: UniversalExecuteParams,
  route: TransactionRoute,
  ueaAddress: `0x${string}`
): Promise<HopDescriptor> {
  // Pass 0 when user omits gasLimit so the contract uses the per-chain base,
  // except EVM Route 3 where a CEA deploy + sendUniversalTxToUEA needs more
  // than the generic 500k source-chain base.
  const defaultGasLimit =
    route === TransactionRoute.CEA_TO_PUSH &&
    params.from?.chain &&
    !isSvmChain(params.from.chain)
      ? DEFAULT_CEA_TO_PUSH_GAS_LIMIT
      : BigInt(0);
  const gasLimit = params.gasLimit ?? defaultGasLimit;
  const routeStr = route as unknown as string;

  const baseDescriptor: HopDescriptor = {
    params,
    route: routeStr as HopDescriptor['route'],
    gasLimit,
    maxPCForGas: params.maxPCForGas ?? BigInt(0),
    ueaAddress,
    revertRecipient: ueaAddress,
  };

  switch (route) {
    case TransactionRoute.UOA_TO_PUSH: {
      // Route 1: Build Push Chain multicalls
      const seedAmount = params.value ?? BigInt(0);
      if (isValueOnlyNativeSeedToOwnUea(params, ueaAddress)) {
        return {
          ...baseDescriptor,
          pushMulticalls: [],
          nativeSeedOnly: true,
          nativeSeedAmount: seedAmount,
        };
      }

      const executeParams = toExecuteParams(params);
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
        // SVM path: no CEA lookup, build SVM payload via IDL resolver
        const { svmPayload, hasExecute: hasSvmExecute } =
          buildSvmPayloadFromParams({
            data: params.data,
            to: target,
            senderUea: ueaAddress,
          });

        let prc20Token: `0x${string}` = ZERO_ADDRESS as `0x${string}`;
        let burnAmount = BigInt(0);
        if (params.funds?.amount) {
          const token = (params.funds as { token: MoveableToken }).token;
          if (token) {
            prc20Token = PushChain.utils.tokens.getPRC20Address(token).address;
            burnAmount = params.funds.amount;
          }
        } else if (params.value && params.value > BigInt(0)) {
          prc20Token = getNativePRC20ForChain(targetChain, ctx.pushNetwork);
          burnAmount = params.value;
        } else if (hasSvmExecute) {
          // PAYLOAD-only SVM execute: still need native PRC-20 for chain namespace
          // + gas fees, but burn amount must be zero. Matches executeUoaToCeaSvm
          // (route-handlers.ts) and the EVM cascade branch below.
          // Using burnAmount=1 would trigger transferFrom on the PRC-20 token,
          // which reverts with InsufficientBalance when the UEA has no pSOL balance.
          prc20Token = getNativePRC20ForChain(targetChain, ctx.pushNetwork);
          burnAmount = BigInt(0);
        }

        let gasToken: `0x${string}` = ZERO_ADDRESS as `0x${string}`;
        let gasFee = BigInt(0);
        let sizing: GasSizingDecision | undefined;

        // SVM finalize budget: compare the quoted gasFee in lamports against
        // the gateway finalize minimum, then re-query with a bumped gasLimit
        // if the default quote is too low.
        const svmFundsToken =
          burnAmount > BigInt(0)
            ? (params.funds as { token?: MoveableToken } | undefined)?.token
            : undefined;
        const splMintBase58 =
          svmFundsToken?.mechanism === 'approve'
            ? svmFundsToken.address
            : undefined;
        let effectiveGasLimit = gasLimit;

        if (prc20Token !== (ZERO_ADDRESS as `0x${string}`)) {
          let result = await queryOutboundGasFee(
            ctx,
            prc20Token,
            effectiveGasLimit,
            targetChain
          );
          result = await ensureSvmFinalizeGasBudgetQuote({
            ctx,
            ueaAddress,
            targetChain,
            prc20Token,
            quote: result,
            splMintBase58,
            burnAmount,
            pathTag: 'buildHopDescriptor',
          });
          gasToken = result.gasToken;
          gasFee = result.gasFee;
          sizing = result.sizing;
          effectiveGasLimit = result.gasLimitUsed;
          if (!params.gasLimit) {
            printLog(
              ctx,
              `buildHopDescriptor — SVM resolved effectiveGasLimit: ${effectiveGasLimit} ` +
                `(gasFee=${result.gasFee}, gasPrice=${result.gasPrice})`
            );
          }
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
          gasLimit: effectiveGasLimit,
          sizing,
        };
      }

      // EVM path: Resolve CEA address + build CEA multicalls
      const { cea: ceaAddress } = await getCEAAddress(
        ueaAddress,
        targetChain,
        ctx.rpcUrls[targetChain]?.[0]
      );

      // Migration path: raw MIGRATION_SELECTOR payload, no multicall wrapping
      if (params.migration) {
        const prc20Token = getNativePRC20ForChain(targetChain, ctx.pushNetwork);
        const burnAmount = BigInt(0); // Migration is logic-only — no funds. CEA rejects msg.value != 0.
        let gasToken: `0x${string}` = ZERO_ADDRESS as `0x${string}`;
        let gasFee = BigInt(0);
        let sizing: GasSizingDecision | undefined;
        if (prc20Token !== (ZERO_ADDRESS as `0x${string}`)) {
          const result = await queryOutboundGasFee(
            ctx,
            prc20Token,
            gasLimit,
            targetChain
          );
          gasToken = result.gasToken;
          gasFee = result.gasFee;
          sizing = result.sizing;
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
          sizing,
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
            to: target.address as `0x${string}`,
            value: params.value ?? BigInt(0),
            data: params.data as `0x${string}`,
          });
        }
      } else if (params.value) {
        // Skip multicall when sending native value to own CEA — gateway deposits directly.
        // Self-call with value would revert (CEA._handleMulticall rejects it).
        if (target.address.toLowerCase() !== ceaAddress.toLowerCase()) {
          ceaMulticalls.push({
            to: target.address as `0x${string}`,
            value: params.value,
            data: '0x',
          });
        }
      } else if (params.funds?.amount) {
        // Funds-only transfer (no data, no value). Without this branch the
        // CEA multicall is empty and relayed funds stay in the CEA instead
        // of reaching the caller's recipient.
        const token = (params.funds as { token: MoveableToken }).token;
        if (token) {
          if (token.mechanism === 'native') {
            if (target.address.toLowerCase() !== ceaAddress.toLowerCase()) {
              ceaMulticalls.push({
                to: target.address as `0x${string}`,
                value: params.funds.amount,
                data: '0x',
              });
            }
          } else {
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
      }

      // Determine PRC-20 token and burn amount
      let prc20Token: `0x${string}` = ZERO_ADDRESS as `0x${string}`;
      let burnAmount = BigInt(0);
      if (params.funds?.amount) {
        const token = (params.funds as { token: MoveableToken }).token;
        if (token) {
          prc20Token = PushChain.utils.tokens.getPRC20Address(token).address;
          burnAmount = params.funds.amount;
        }
      } else if (params.value && params.value > BigInt(0)) {
        prc20Token = getNativePRC20ForChain(targetChain, ctx.pushNetwork);
        burnAmount = params.value;
      } else if (params.data) {
        // PAYLOAD-only (no value transfer): still need native PRC-20 token for
        // chain namespace lookup + gas fees, but burn amount must be zero.
        // Matches the direct executeUoaToCea path (route-handlers.ts).
        // Using burnAmount=1 would trigger transferFrom on the PRC-20 token,
        // which reverts when the UEA has no PRC-20 balance for that chain.
        prc20Token = getNativePRC20ForChain(targetChain, ctx.pushNetwork);
        burnAmount = BigInt(0);
      }

      // Query gas fee
      let gasToken: `0x${string}` = ZERO_ADDRESS as `0x${string}`;
      let gasFee = BigInt(0);
      let sizing: GasSizingDecision | undefined;
      if (prc20Token !== (ZERO_ADDRESS as `0x${string}`)) {
        const result = await queryOutboundGasFee(
          ctx,
          prc20Token,
          gasLimit,
          targetChain
        );
        gasToken = result.gasToken;
        gasFee = result.gasFee;
        sizing = result.sizing;
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
        sizing,
      };
    }

    case TransactionRoute.CEA_TO_PUSH: {
      // Route 3: Build CEA multicalls for sendUniversalTxFromCEA
      const sourceChain = params.from!.chain;
      const seedAmount = params.value ?? BigInt(0);
      if (isValueOnlyNativeSeedToOwnUea(params, ueaAddress)) {
        return {
          ...baseDescriptor,
          sourceChain,
          burnAmount: BigInt(0),
          gasToken: ZERO_ADDRESS as `0x${string}`,
          gasFee: BigInt(0),
          nativeSeedOnly: true,
          nativeSeedAmount: seedAmount,
        };
      }

      // SVM chains use PDA-based CEA, not factory-deployed CEA
      if (isSvmChain(sourceChain)) {
        const lockerContract = CHAIN_INFO[sourceChain].lockerContract;
        if (!lockerContract) {
          throw new Error(
            `No SVM gateway program configured for chain ${sourceChain}`
          );
        }
        const programPk = new PublicKey(lockerContract);
        const gatewayProgramHex = ('0x' +
          Buffer.from(programPk.toBytes()).toString('hex')) as `0x${string}`;

        // Derive CEA PDA
        const ueaBytes = Buffer.from(ueaAddress.slice(2), 'hex');
        const [ceaPda] = PublicKey.findProgramAddressSync(
          [Buffer.from('push_identity'), ueaBytes],
          programPk
        );
        const ceaPdaHex = ('0x' +
          Buffer.from(ceaPda.toBytes()).toString('hex')) as `0x${string}`;

        let amount = BigInt(0);
        let prc20Token: `0x${string}`;
        if (params.funds?.amount && params.funds.amount > BigInt(0)) {
          amount = params.funds.amount;
          const token = (params.funds as { token: MoveableToken }).token;
          if (token && token.address) {
            prc20Token = PushChain.utils.tokens.getPRC20Address(token).address;
          } else {
            prc20Token = getNativePRC20ForChain(sourceChain, ctx.pushNetwork);
          }
        } else if (params.value && params.value > BigInt(0)) {
          amount = params.value;
          prc20Token = getNativePRC20ForChain(sourceChain, ctx.pushNetwork);
        } else {
          // Payload-only Route 3 SVM
          prc20Token = getNativePRC20ForChain(sourceChain, ctx.pushNetwork);
        }

        let gasToken: `0x${string}` = ZERO_ADDRESS as `0x${string}`;
        let gasFee = BigInt(0);
        let sizing: GasSizingDecision | undefined;
        let effectiveGasLimit = gasLimit;
        if (prc20Token !== (ZERO_ADDRESS as `0x${string}`)) {
          let result = await queryOutboundGasFee(
            ctx,
            prc20Token,
            effectiveGasLimit,
            sourceChain
          );
          result = await ensureSvmFinalizeGasBudgetQuote({
            ctx,
            ueaAddress,
            targetChain: sourceChain,
            prc20Token,
            quote: result,
            splMintBase58: undefined,
            burnAmount: BigInt(0),
            pathTag: 'buildHopDescriptor',
          });
          gasToken = result.gasToken;
          gasFee = result.gasFee;
          sizing = result.sizing;
          effectiveGasLimit = result.gasLimitUsed;
        }

        return {
          ...baseDescriptor,
          sourceChain,
          ceaAddress: ceaPdaHex,
          isSvmTarget: true,
          prc20Token,
          // Route 3 is payload-only on Push: the drain amount lives inside the
          // SVM payload. Burning here would require the UEA to pre-hold pSOL.
          burnAmount: BigInt(0),
          gasToken,
          gasFee,
          gasLimit: effectiveGasLimit,
          sizing,
        };
      }

      const { cea: ceaAddress } = await getCEAAddress(
        ueaAddress,
        sourceChain,
        ctx.rpcUrls[sourceChain]?.[0]
      );

      // CEA auto-deploys on-chain: Vault.finalizeUniversalTx calls CEAFactory.deployCEA()
      // if CEA doesn't exist yet. No SDK-side blocking needed.

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
      const prc20Token = getNativePRC20ForChain(sourceChain, ctx.pushNetwork);
      let gasToken: `0x${string}` = ZERO_ADDRESS as `0x${string}`;
      let gasFee = BigInt(0);
      let sizing: GasSizingDecision | undefined;
      if (prc20Token !== (ZERO_ADDRESS as `0x${string}`)) {
        const result = await queryOutboundGasFee(
          ctx,
          prc20Token,
          gasLimit,
          sourceChain
        );
        gasToken = result.gasToken;
        gasFee = result.gasFee;
        sizing = result.sizing;
      }

      return {
        ...baseDescriptor,
        sourceChain,
        ceaAddress,
        prc20Token,
        // Route 3 is payload-only on Push: the CEA-side sendUniversalTxToUEA
        // carries `amount`. Burning here would require the UEA to pre-hold the
        // token it is trying to receive from the external CEA.
        burnAmount: BigInt(0),
        gasToken,
        gasFee,
        sizing,
      };
    }

    default:
      return baseDescriptor;
  }
}

// ============================================================================
// classifyIntoSegments
// ============================================================================

export function classifyIntoSegments(hops: HopDescriptor[]): CascadeSegment[] {
  if (hops.length === 0) return [];

  const segments: CascadeSegment[] = [];
  let currentSegment: CascadeSegment | null = null;

  for (const hop of hops) {
    const segType = getSegmentType(hop.route);
    const chain = hop.targetChain || hop.sourceChain;

    const canMerge =
      currentSegment &&
      currentSegment.type === segType &&
      // Same-chain merging for OUTBOUND_TO_CEA (EVM only — SVM hops are atomic).
      // Same-source merging for INBOUND_FROM_CEA (EVM only) — multiple R3 hops
      // that share a source chain collapse into ONE CEA→UEA round-trip whose
      // inbound multicall runs every hop's target op. Without this merge the
      // cascade composer would nest the second R3 as an outbound from inside
      // the first inbound's UEA multicall, which fails inside UGPC.
      // sendUniversalTxOutbound because the UEA holds no PRC20 at that point
      // (see cascade.ts composeCascade INBOUND_FROM_CEA branch).
      (segType === 'OUTBOUND_TO_CEA'
        ? currentSegment.targetChain === hop.targetChain && !hop.isSvmTarget
        : segType === 'INBOUND_FROM_CEA'
        ? currentSegment.sourceChain === hop.sourceChain &&
          !isSvmChain(hop.sourceChain as CHAIN) &&
          isNativeSeedOnlyHop(currentSegment.hops[0]) ===
            isNativeSeedOnlyHop(hop)
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
          (currentSegment.gasFee || BigInt(0)) + (hop.gasFee || BigInt(0));
        currentSegment.maxPCForGas = mergeMaxPCForGas(
          currentSegment.maxPCForGas,
          hop.maxPCForGas
        );
      } else if (segType === 'INBOUND_FROM_CEA') {
        // Sum burn amounts so the single sendUniversalTxToUEA carries the
        // combined native value forwarded from CEA back to the UEA.
        currentSegment.totalBurnAmount =
          (currentSegment.totalBurnAmount || BigInt(0)) +
          (hop.burnAmount || BigInt(0));
        if (hop.gasLimit > (currentSegment.gasLimit || BigInt(0))) {
          currentSegment.gasLimit = hop.gasLimit;
        }
        currentSegment.gasFee =
          (currentSegment.gasFee || BigInt(0)) + (hop.gasFee || BigInt(0));
        currentSegment.maxPCForGas = mergeMaxPCForGas(
          currentSegment.maxPCForGas,
          hop.maxPCForGas
        );
      } else if (segType === 'PUSH_EXECUTION') {
        currentSegment.mergedPushMulticalls = [
          ...(currentSegment.mergedPushMulticalls || []),
          ...(hop.pushMulticalls || []),
        ];
      }

      // Merge sizing: take the strictest category (C > B > A). Overflow
      // from a Case C hop wins so the segment's msg.value covers the
      // highest-cost hop in the merge.
      if (hop.sizing) {
        if (!currentSegment.sizing) {
          currentSegment.sizing = hop.sizing;
        } else if (
          categoryRank(hop.sizing.category) >
          categoryRank(currentSegment.sizing.category)
        ) {
          currentSegment.sizing = hop.sizing;
        }
      }
    } else {
      // Start a new segment
      currentSegment = {
        type: segType,
        hops: [hop],
        targetChain: hop.targetChain,
        sourceChain: hop.sourceChain,
        mergedCeaMulticalls:
          segType === 'OUTBOUND_TO_CEA'
            ? [...(hop.ceaMulticalls || [])]
            : undefined,
        mergedPushMulticalls:
          segType === 'PUSH_EXECUTION'
            ? [...(hop.pushMulticalls || [])]
            : undefined,
        totalBurnAmount: hop.burnAmount,
        prc20Token: hop.prc20Token,
        gasToken: hop.gasToken,
        gasFee: hop.gasFee,
        gasLimit: hop.gasLimit,
        maxPCForGas: hop.maxPCForGas,
        sizing: hop.sizing,
      };
      segments.push(currentSegment);
    }
  }

  return segments;
}

/** Ordering for sizing-category severity (higher = stricter). */
function categoryRank(c: 'A' | 'B' | 'C'): number {
  return c === 'C' ? 2 : c === 'B' ? 1 : 0;
}

function mergeMaxPCForGas(current?: bigint, next?: bigint): bigint {
  const a = current ?? BigInt(0);
  const b = next ?? BigInt(0);
  if (a === BigInt(0) || b === BigInt(0)) return BigInt(0);
  return a + b;
}

// ============================================================================
// getSegmentType
// ============================================================================

export function getSegmentType(route: string): CascadeSegmentType {
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

// ============================================================================
// composeCascade
// ============================================================================

export interface ComposeCascadeResult {
  multicalls: MultiCall[];
  requiredNativeValue: bigint;
}

function sumMulticallNativeValue(multicalls?: MultiCall[]): bigint {
  return (multicalls ?? []).reduce(
    (sum, mc) => sum + (mc.value ?? BigInt(0)),
    BigInt(0)
  );
}

function isEmptyPayloadData(data: UniversalExecuteParams['data']): boolean {
  return (
    data === undefined ||
    data === '0x' ||
    (Array.isArray(data) && data.length === 0)
  );
}

function isValueOnlyNativeSeedToOwnUea(
  params: UniversalExecuteParams,
  ueaAddress: `0x${string}`
): boolean {
  return (
    (params.value ?? BigInt(0)) > BigInt(0) &&
    !params.funds?.amount &&
    isEmptyPayloadData(params.data) &&
    typeof params.to === 'string' &&
    params.to.toLowerCase() === ueaAddress.toLowerCase()
  );
}

function isNativeSeedOnlyHop(hop: HopDescriptor | undefined): boolean {
  return hop?.nativeSeedOnly === true;
}

function isNativeSeedOnlySegment(segment: CascadeSegment): boolean {
  return (
    segment.type === 'INBOUND_FROM_CEA' &&
    segment.hops.length > 0 &&
    segment.hops.every((hop) => isNativeSeedOnlyHop(hop))
  );
}

function segmentNeedsOutboundGas(segment: CascadeSegment): boolean {
  return segment.type !== 'PUSH_EXECUTION' && !isNativeSeedOnlySegment(segment);
}

function sumNativeSeedAmount(hops: HopDescriptor[]): bigint {
  return hops.reduce(
    (sum, hop) => sum + (hop.nativeSeedAmount ?? BigInt(0)),
    BigInt(0)
  );
}

function getCascadeNativeSeed(segments: CascadeSegment[]): bigint {
  let total = BigInt(0);
  for (const segment of segments) {
    for (const hop of segment.hops) {
      const value = hop.params.value ?? BigInt(0);
      if (isNativeSeedOnlyHop(hop)) {
        total += hop.nativeSeedAmount ?? value;
        continue;
      }

      // In a CEA->Push hop that also supplies `funds`, `value` is native PC
      // forwarded inside the inbound UEA payload. That value is available to
      // later Push-side cascade calls and must be counted for sizing fresh UEAs.
      if (
        segment.type === 'INBOUND_FROM_CEA' &&
        value > BigInt(0) &&
        hop.params.funds?.amount
      ) {
        total += value;
      }
    }
  }
  return total;
}

function getInboundFundingForBurnToken(
  segments: CascadeSegment[],
  beforeSegmentIndex: number,
  burnToken: `0x${string}`,
  pushNetwork: PUSH_NETWORK
): bigint {
  let total = BigInt(0);
  const normalizedBurnToken = burnToken.toLowerCase();

  for (const segment of segments.slice(0, beforeSegmentIndex)) {
    if (segment.type !== 'INBOUND_FROM_CEA') continue;

    for (const hop of segment.hops) {
      const params = hop.params;
      let fundedToken: `0x${string}` | undefined;
      let fundedAmount = BigInt(0);

      if (params.funds?.amount) {
        const token = (params.funds as { token?: MoveableToken }).token;
        if (token) {
          fundedToken = PushChain.utils.tokens.getPRC20Address(token).address;
          fundedAmount = params.funds.amount;
        }
      } else if (
        params.value &&
        params.value > BigInt(0) &&
        hop.sourceChain &&
        !isNativeSeedOnlyHop(hop)
      ) {
        fundedToken = getNativePRC20ForChain(hop.sourceChain, pushNetwork);
        fundedAmount = params.value;
      }

      if (fundedToken?.toLowerCase() === normalizedBurnToken) {
        total += fundedAmount;
      }
    }
  }

  return total;
}

export async function composeCascadeDetailed(
  ctx: OrchestratorContext,
  segments: CascadeSegment[],
  ueaAddress: `0x${string}`,
  ueaBalance?: bigint,
  ueaNonce?: bigint
): Promise<ComposeCascadeResult> {
  let accumulatedPushMulticalls: MultiCall[] = [];
  let requiredNativeValue = BigInt(0);
  const gatewayPcAddress = getUniversalGatewayPCAddress();
  const currentUeaBalance = ueaBalance ?? BigInt(0);
  const cascadeNativeSeed = getCascadeNativeSeed(segments);
  const effectiveUeaBalance = currentUeaBalance + cascadeNativeSeed;

  if (cascadeNativeSeed > BigInt(0)) {
    printLog(
      ctx,
      `composeCascade — counting cascade native seed ${cascadeNativeSeed.toString()} for cascade sizing (current UEA balance ${currentUeaBalance.toString()})`
    );
  }

  // Compute per-outbound nativeValueForGas from UEA balance
  // Each outbound segment needs native value for the gas swap on the destination chain.
  // The contract refunds excess, so over-allocating is safe.
  const numOutbounds = segments.filter(segmentNeedsOutboundGas).length;
  const CASCADE_GAS_RESERVE = BigInt(3e18); // 3 PC reserve for gas costs

  // Cascade pre-flight: catches the zero-balance silent-segment-zero failure
  // mode. When `ueaBalance <= CASCADE_GAS_RESERVE`, `perOutboundNativeValue`
  // is left undefined and downstream segments silently allocate value=0,
  // producing under-funded swaps that revert inside Uniswap. Throw early
  // with a structured error so the caller knows which path / hop failed.
  if (numOutbounds > 0) {
    runPreflight({
      ctx,
      ueaAddress,
      ueaBalance: effectiveUeaBalance,
      // Required = at least one wei of allocatable PC after reserve. The
      // per-segment min-swap check below catches finer-grained shortfalls.
      requiredValue: BigInt(1),
      gasReserve: CASCADE_GAS_RESERVE,
      pathTag: 'CASCADE',
    });
  }
  let perOutboundNativeValue: bigint | undefined;
  if (numOutbounds > 0 && effectiveUeaBalance > CASCADE_GAS_RESERVE) {
    perOutboundNativeValue =
      (effectiveUeaBalance - CASCADE_GAS_RESERVE) / BigInt(numOutbounds);
  }

  // Pool-price-based native-value override for SVM outbounds.
  // The flat split above works for EVM gas tokens (pBNB/pETH — cheap per unit),
  // but pSOL has a much higher WPC/pSOL pool price, so the flat 1 PC split is
  // insufficient to swap for gasFee wei of pSOL and Uniswap reverts "STF".
  // Mirror executeUoaToCeaSvm's pool-price read (route-handlers.ts) per SVM segment.
  const svmSegments = segments.filter(
    (s) =>
      s.type === 'OUTBOUND_TO_CEA' &&
      s.hops[0]?.isSvmTarget === true &&
      s.gasToken &&
      s.gasFee &&
      s.gasFee > BigInt(0)
  );
  const svmNativeValueBySegment = new Map<CascadeSegment, bigint>();
  if (svmSegments.length > 0 && effectiveUeaBalance > CASCADE_GAS_RESERVE) {
    const universalCoreAddress =
      await ctx.pushClient.readContract<`0x${string}`>({
        address: gatewayPcAddress,
        abi: UNIVERSAL_GATEWAY_PC,
        functionName: 'universalCore',
        args: [],
      });
    // Compute per-SVM budget = ueaBalance − (PC needed for EVM outbounds) − 1 PC safety
    // (outer-tx gas + refund headroom). Pass a huge accountBalance to the estimator so
    // its internal cap is effectively disabled; we cap externally to the per-SVM budget.
    const numEvmOutbounds = numOutbounds - svmSegments.length;
    const evmReservation =
      perOutboundNativeValue && numEvmOutbounds > 0
        ? perOutboundNativeValue * BigInt(numEvmOutbounds)
        : BigInt(0);
    const outerSafety = BigInt(1e18); // 1 PC for outer-tx gas
    const svmTotal =
      effectiveUeaBalance > evmReservation + outerSafety
        ? effectiveUeaBalance - evmReservation - outerSafety
        : BigInt(0);
    const perSvmCap = svmTotal / BigInt(svmSegments.length);
    const UNCAPPED_BALANCE = BigInt('1000000000000000000000000000000'); // effectively disable estimator's internal cap
    for (const seg of svmSegments) {
      // Cascade-level segment index (position in `segments`, not in `svmSegments`)
      // so the error's `segmentIndex` lines up with what the caller sees.
      const cascadeIdx = segments.indexOf(seg);
      const estimated = await estimateNativeValueForSwap(
        ctx,
        universalCoreAddress,
        seg.gasToken as `0x${string}`,
        seg.gasFee as bigint,
        UNCAPPED_BALANCE
      );
      // SVM warn-threshold telemetry (no truncation — pre-flight handles drain protection).
      maybeFireSvmWarnThreshold(
        ctx,
        estimated,
        seg.gasToken as `0x${string}`,
        'CASCADE'
      );
      const flat = perOutboundNativeValue ?? BigInt(0);
      let value = estimated > flat ? estimated : flat;
      if (perSvmCap > BigInt(0) && value > perSvmCap) {
        const cappedValue = perSvmCap >= estimated ? perSvmCap : estimated;
        if (cappedValue !== perSvmCap) {
          printLog(
            ctx,
            `composeCascade — SVM outbound to ${seg.hops[0]?.targetChain}: perSvmCap=${perSvmCap} is below live pool quote=${estimated}; using quote to avoid underfunded gas swap`
          );
        }
        value = cappedValue;
      }
      // Upward-allocation ceiling (mirrors R3 SVM Fix #4 in route-handlers.ts:1690).
      // When UEA balance is huge, the flat split or perSvmCap can produce a value
      // far above what the swap actually needs. Submitting that into a Uniswap
      // pool moves the price for other users. Cap at max(200 PC, 5×estimated):
      //   - fair pool (estimated ≈ 100 PC): cap = 500 PC → caps voluntary excess
      //   - skewed pool (estimated > 200 PC): cap = 5×estimated → still allows
      //     pool-skew margin; min-swap check below still fires if value < estimated
      // The contract still refunds excess via swapAndBurnGas, so this is purely
      // a guard against submitting wasteful msg.value to fair-priced pools.
      const UPWARD_BASE_CEILING_CASCADE_SVM = BigInt(200) * BigInt(1e18);
      const upwardCeilingCascadeSvm =
        estimated * BigInt(5) > UPWARD_BASE_CEILING_CASCADE_SVM
          ? estimated * BigInt(5)
          : UPWARD_BASE_CEILING_CASCADE_SVM;
      if (value > upwardCeilingCascadeSvm) {
        printLog(
          ctx,
          `composeCascade — SVM outbound to ${seg.hops[0]?.targetChain}: capping value from ${value} to upwardCeiling=${upwardCeilingCascadeSvm} (pool quote=${estimated})`
        );
        value = upwardCeilingCascadeSvm;
      }
      printLog(
        ctx,
        `composeCascade — SVM outbound to ${seg.hops[0]?.targetChain}: gasFee=${seg.gasFee}, estimatedWpc=${estimated}, flat=${flat}, perSvmCap=${perSvmCap}, upwardCeiling=${upwardCeilingCascadeSvm}, chosen=${value}`
      );
      // Per-segment minimum-viable-swap check: if the chosen `value` is below
      // the live pool quote (`estimated`), the cap squeezed the budget below
      // what the swap actually needs and the segment will revert inside
      // Uniswap with STF. Throw cleanly with `segmentIndex` so the caller
      // knows which hop's pool is misbehaving.
      if (estimated > BigInt(0) && value < estimated) {
        const shortfall = estimated - value;
        fireProgressHook(
          ctx,
          PROGRESS_HOOK.SEND_TX_003_04,
          estimated,
          value,
          shortfall,
          ueaAddress,
          'CASCADE',
          { kind: 'NATIVE', segmentIndex: cascadeIdx }
        );
        throw new InsufficientUEABalanceError({
          required: estimated,
          available: value,
          shortfall,
          ueaAddress,
          pathTag: 'CASCADE',
          reason: 'NATIVE',
          segmentIndex: cascadeIdx,
        });
      }
      svmNativeValueBySegment.set(seg, value);
    }
  }

  for (let segIdxLoop = segments.length - 1; segIdxLoop >= 0; segIdxLoop--) {
    const segment = segments[segIdxLoop];

    switch (segment.type) {
      case 'PUSH_EXECUTION': {
        // Prepend Push Chain multicalls to accumulated
        const seedAmount = sumNativeSeedAmount(segment.hops);
        if (seedAmount > requiredNativeValue) {
          requiredNativeValue = seedAmount;
        }
        requiredNativeValue += sumMulticallNativeValue(
          segment.mergedPushMulticalls
        );
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
          // For SVM, to.address IS the target (program for execute, recipient for withdraw)
          const svmTarget = firstHop.params.to as ChainTarget;
          targetForOutbound = svmTarget.address as `0x${string}`;
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
          targetForOutbound = outboundPayload === '0x'
            ? (ZERO_ADDRESS as `0x${string}`)
            : firstHop?.ceaAddress || ueaAddress;
          assertCeaFundsParkingInvariant(targetForOutbound, outboundPayload);
        }

        // Per-segment PRC-20 burn-balance pre-check (cascade R2-style segments
        // only — INBOUND_FROM_CEA segments are payload-only with totalBurnAmount=0
        // per the 2026-03-19 fix). Skip MIGRATION (totalBurnAmount=0). Fires
        // whenever burnAmount > 0 even when burn token equals gas token — the
        // gateway's transferFrom happens BEFORE the gas swap, so user must
        // pre-hold the burn amount.
        const segBurnAmount = segment.totalBurnAmount || BigInt(0);
        const segBurnToken = segment.prc20Token;
        if (segBurnAmount > BigInt(0) && segBurnToken && !isMigration) {
          const onHand = await ctx.pushClient.readContract<bigint>({
            address: segBurnToken,
            abi: ERC20_EVM,
            functionName: 'balanceOf',
            args: [ueaAddress],
          });
          const sufficient = onHand >= segBurnAmount;
          fireProgressHook(
            ctx,
            PROGRESS_HOOK.SEND_TX_003_03,
            segBurnAmount,
            onHand,
            sufficient,
            ueaAddress,
            'CASCADE',
            { kind: 'PRC20', burnToken: segBurnToken, segmentIndex: segIdxLoop }
          );
          const priorPushExecutionMayFundBurn = segments
            .slice(0, segIdxLoop)
            .some((s) => s.type === 'PUSH_EXECUTION');
          const priorInboundFundingForBurn = getInboundFundingForBurnToken(
            segments,
            segIdxLoop,
            segBurnToken,
            ctx.pushNetwork
          );
          const priorInboundMayFundBurn =
            onHand + priorInboundFundingForBurn >= segBurnAmount;
          if (
            !sufficient &&
            !priorPushExecutionMayFundBurn &&
            !priorInboundMayFundBurn
          ) {
            const projectedOnHand = onHand + priorInboundFundingForBurn;
            const shortfall = segBurnAmount - projectedOnHand;
            fireProgressHook(
              ctx,
              PROGRESS_HOOK.SEND_TX_003_04,
              segBurnAmount,
              projectedOnHand,
              shortfall,
              ueaAddress,
              'CASCADE',
              {
                kind: 'PRC20',
                burnToken: segBurnToken,
                segmentIndex: segIdxLoop,
              }
            );
            throw new InsufficientUEABalanceError({
              required: segBurnAmount,
              available: projectedOnHand,
              shortfall,
              ueaAddress,
              pathTag: 'CASCADE',
              reason: 'PRC20',
              burnToken: segBurnToken,
              segmentIndex: segIdxLoop,
            });
          } else if (!sufficient && priorPushExecutionMayFundBurn) {
            printLog(
              ctx,
              `composeCascade — skipping PRC-20 preflight failure for segment ${segIdxLoop}; earlier Push execution may fund ${segBurnToken} before this outbound runs`
            );
          } else if (!sufficient && priorInboundMayFundBurn) {
            printLog(
              ctx,
              `composeCascade — skipping PRC-20 preflight failure for segment ${segIdxLoop}; earlier inbound funds ${priorInboundFundingForBurn.toString()} units of ${segBurnToken} before this outbound runs`
            );
          }
        }

        // Build outbound request
        const outboundReq = buildOutboundRequest(
          targetForOutbound,
          segment.prc20Token || (ZERO_ADDRESS as `0x${string}`),
          segment.totalBurnAmount || BigInt(0),
          segment.gasLimit ?? BigInt(0),
          outboundPayload,
          ueaAddress,
          segment.maxPCForGas ?? BigInt(0)
        );

        // Build approval + outbound multicalls
        const segGasFee = segment.gasFee || BigInt(0);
        const svmOverride = svmNativeValueBySegment.get(segment);
        // When UEA balance < CASCADE_GAS_RESERVE, perOutboundNativeValue is
        // undefined. Mirror the drained-UEA branch in executeUoaToCea
        // (route-handlers.ts): send the entire available balance divided
        // across outbound segments. The contract refunds excess via
        // swapAndBurnGas, so overshooting is safe; undershooting causes STF.
        let evmFallbackValue: bigint;
        if (effectiveUeaBalance > BigInt(0)) {
          evmFallbackValue =
            effectiveUeaBalance / BigInt(Math.max(numOutbounds, 1));
        } else {
          evmFallbackValue = segGasFee * BigInt(1000000);
        }
        let nativeValueForGas =
          svmOverride ?? perOutboundNativeValue ?? evmFallbackValue;

        // SDK 5.2 Case C: when the segment's sizing is category C, compose
        // R2/OUTBOUND_TO_CEA segments no longer apply Case A/B/C sizing
        // (scoped to R1 + R3 only). segment.sizing may still be populated
        // from the hop descriptor merge, but it is not consulted here —
        // nativeValueForGas is driven by pool-quote on the single-hop path
        // and by the cascade-level per-outbound allocation above.

        const outboundMulticalls = buildOutboundApprovalAndCall({
          prc20Token: segment.prc20Token || (ZERO_ADDRESS as `0x${string}`),
          gasToken: segment.gasToken || (ZERO_ADDRESS as `0x${string}`),
          burnAmount: segment.totalBurnAmount || BigInt(0),
          gasFee: segGasFee,
          nativeValueForGas,
          gatewayPcAddress,
          outboundRequest: outboundReq,
        });
        requiredNativeValue += sumMulticallNativeValue(outboundMulticalls);

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

        if (isNativeSeedOnlySegment(segment)) {
          const seedAmount = sumNativeSeedAmount(segment.hops);
          if (seedAmount > requiredNativeValue) {
            requiredNativeValue = seedAmount;
          }
          printLog(
            ctx,
            `composeCascade — value-only CEA_TO_PUSH seed ${seedAmount.toString()} folded into root Push execution; no source-chain outbound needed`
          );
          break;
        }

        // Build push multicalls from EVERY merged hop's own data in original
        // order (e.g. counter.increment() + value transfer). Multi-hop R3
        // segments (same sourceChain) bundle all target ops into the single
        // UEA multicall so no nested outbound is needed.
        const mergedHopMulticalls: MultiCall[] = [];
        for (const h of segment.hops) {
          if (h?.params?.data || h?.params?.value) {
            const hopCalls = buildExecuteMulticall({
              execute: {
                to: h.params.to as `0x${string}`,
                value: h.params.value,
                data: h.params.data,
              },
              ueaAddress,
            });
            mergedHopMulticalls.push(...hopCalls);
          }
        }
        if (mergedHopMulticalls.length > 0) {
          requiredNativeValue += sumMulticallNativeValue(mergedHopMulticalls);
          accumulatedPushMulticalls = [
            ...mergedHopMulticalls,
            ...accumulatedPushMulticalls,
          ];
        }
        // Primary hop carries the sourceChain / CEA address (shared across merged hops).
        const hop0 = segment.hops[0];

        let intermediatePayload: `0x${string}` = '0x';
        if (accumulatedPushMulticalls.length > 0) {
          const multicallPayload = buildMulticallPayloadData(
            ctx,
            ueaAddress,
            accumulatedPushMulticalls
          );
          // +1: the outbound tx consumes one nonce via execute()
          intermediatePayload = buildInboundUniversalPayload(multicallPayload, {
            nonce: (ueaNonce ?? BigInt(0)) + BigInt(1),
          });
        }

        const hop = segment.hops[0];
        const sourceChain = hop.sourceChain!;
        const ceaAddress = hop.ceaAddress || ueaAddress;

        // SVM chains: build SVM CPI payload instead of EVM CEA multicall
        if (isSvmChain(sourceChain)) {
          const lockerContract = CHAIN_INFO[sourceChain].lockerContract;
          if (!lockerContract) {
            throw new Error(
              `No SVM gateway program configured for chain ${sourceChain}`
            );
          }
          const programPk = new PublicKey(lockerContract);
          const gatewayProgramHex = ('0x' +
            Buffer.from(programPk.toBytes()).toString('hex')) as `0x${string}`;

          let drainAmount = BigInt(0);
          let tokenMintHex: `0x${string}` | undefined;
          const params = hop.params;
          if (params.funds?.amount && params.funds.amount > BigInt(0)) {
            drainAmount = params.funds.amount;
            const token = (params.funds as { token: MoveableToken }).token;
            if (token && token.address) {
              const mintPk = new PublicKey(token.address);
              tokenMintHex = ('0x' +
                Buffer.from(mintPk.toBytes()).toString('hex')) as `0x${string}`;
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
          const ceaPdaHex = ('0x' +
            Buffer.from(ceaPda.toBytes()).toString('hex')) as `0x${string}`;

          // Build SVM payload with intermediate Push Chain payload embedded
          const svmPayload = encodeSvmCeaToUeaPayload({
            gatewayProgramHex,
            drainAmount,
            tokenMintHex,
            revertRecipientHex: ceaPdaHex,
            extraPayload:
              intermediatePayload !== '0x'
                ? new Uint8Array(
                    Buffer.from(intermediatePayload.slice(2), 'hex')
                  )
                : undefined,
          });

          const svmBurnAmount = segment.totalBurnAmount || BigInt(0);
          const outboundReq = buildOutboundRequest(
            gatewayProgramHex,
            segment.prc20Token ||
              getNativePRC20ForChain(sourceChain, ctx.pushNetwork),
            svmBurnAmount,
            segment.gasLimit ?? BigInt(0),
            svmPayload,
            ueaAddress,
            segment.maxPCForGas ?? BigInt(0)
          );

          const inboundGasFee = segment.gasFee || BigInt(0);
          let svmInboundFallback: bigint;
          if (effectiveUeaBalance > BigInt(0)) {
            svmInboundFallback =
              effectiveUeaBalance / BigInt(Math.max(numOutbounds, 1));
          } else {
            svmInboundFallback = inboundGasFee * BigInt(1000000);
          }
          let svmInboundNativeValue =
            perOutboundNativeValue ?? svmInboundFallback;
          // SDK 5.2 R3-style Case C bump: when the inbound segment's sizing
          // is C, top up the swap budget by the overflow. No bridge-swap —
          // R3 has no destination funds delivery.
          if (
            segment.sizing?.category === 'C' &&
            segment.sizing.overflowNativePc > BigInt(0)
          ) {
            const bumped =
              svmInboundNativeValue + segment.sizing.overflowNativePc;
            printLog(
              ctx,
              `composeCascade — INBOUND_FROM_CEA (SVM) Case C: bumping nativeValueForGas from ${svmInboundNativeValue} to ${bumped} (overflow=${segment.sizing.overflowNativePc})`
            );
            svmInboundNativeValue = bumped;
          }
          const outboundMulticalls = buildOutboundApprovalAndCall({
            prc20Token:
              segment.prc20Token ||
              getNativePRC20ForChain(sourceChain, ctx.pushNetwork),
            gasToken: segment.gasToken || (ZERO_ADDRESS as `0x${string}`),
            burnAmount: svmBurnAmount,
            gasFee: inboundGasFee,
            nativeValueForGas: svmInboundNativeValue,
            gatewayPcAddress,
            outboundRequest: outboundReq,
          });
          requiredNativeValue += sumMulticallNativeValue(outboundMulticalls);

          accumulatedPushMulticalls = [...outboundMulticalls];
          break;
        }

        // EVM path: Build CEA multicall: sendUniversalTxToUEA(payload).
        // CEA handles ERC20 gateway approval internally.
        const ceaMulticalls: MultiCall[] = [];

        // Add primary hop's own CEA operations if any
        // (e.g., approve + swap before bridging back)
        if (hop.ceaMulticalls && hop.ceaMulticalls.length > 0) {
          ceaMulticalls.push(...hop.ceaMulticalls);
        }

        // Aggregate token/amount across all merged hops so the single
        // sendUniversalTxToUEA call carries the combined forward amount.
        // For multi-hop R3 segments (same sourceChain), ERC20 funds across
        // hops must resolve to the same token — otherwise this path can't
        // express it in one call and the caller should split manually.
        let tokenAddress: `0x${string}` = ZERO_ADDRESS as `0x${string}`;
        let amount = BigInt(0);
        for (const mergedHop of segment.hops) {
          const hParams = mergedHop.params;
          if (hParams.funds?.amount) {
            const token = (hParams.funds as { token: MoveableToken }).token;
            if (token) {
              if (token.mechanism === 'native') {
                amount += hParams.funds.amount;
              } else {
                const addr = token.address as `0x${string}`;
                if (
                  tokenAddress !== (ZERO_ADDRESS as `0x${string}`) &&
                  tokenAddress.toLowerCase() !== addr.toLowerCase()
                ) {
                  throw new Error(
                    `composeCascade: merged R3 hops target different ERC20 tokens (${tokenAddress} vs ${addr}); split into separate executeTransactions batches`
                  );
                }
                tokenAddress = addr;
                amount += hParams.funds.amount;
              }
            }
          } else if (hParams.value && hParams.value > BigInt(0)) {
            amount += hParams.value;
          }
        }

        // Build sendUniversalTxToUEA self-call on CEA. CEA self-calls must
        // always use value=0; native funds are spent from the CEA balance.
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

        // The nested outbound back to the source chain needs a non-zero
        // gasLimit — UGPC.sendUniversalTxOutbound reverts with
        // "Missing or invalid parameters" on 0. When the hop didn't supply
        // one (typical for a pure-R3 leg composed inside a cascade), fall
        // back to the EVM Route 3 default.
        const effectiveGasLimit =
          segment.gasLimit && segment.gasLimit > BigInt(0)
            ? segment.gasLimit
            : DEFAULT_CEA_TO_PUSH_GAS_LIMIT;
        const outboundReq = buildOutboundRequest(
          ceaAddress,
          segment.prc20Token ||
            getNativePRC20ForChain(sourceChain, ctx.pushNetwork),
          segment.totalBurnAmount || BigInt(0),
          effectiveGasLimit,
          ceaPayload,
          ueaAddress,
          segment.maxPCForGas ?? BigInt(0)
        );

        const inboundGasFee = segment.gasFee || BigInt(0);
        let evmInboundFallback: bigint;
        if (effectiveUeaBalance > BigInt(0)) {
          evmInboundFallback =
            effectiveUeaBalance / BigInt(Math.max(numOutbounds, 1));
        } else {
          evmInboundFallback = inboundGasFee * BigInt(1000000);
        }
        let evmInboundNativeValue =
          perOutboundNativeValue ?? evmInboundFallback;
        // SDK 5.2 R3-style Case C bump: when the inbound segment's sizing
        // is C, top up the swap budget by the overflow. No bridge-swap —
        // R3 has no destination funds delivery.
        if (
          segment.sizing?.category === 'C' &&
          segment.sizing.overflowNativePc > BigInt(0)
        ) {
          const bumped =
            evmInboundNativeValue + segment.sizing.overflowNativePc;
          printLog(
            ctx,
            `composeCascade — INBOUND_FROM_CEA (EVM) Case C: bumping nativeValueForGas from ${evmInboundNativeValue} to ${bumped} (overflow=${segment.sizing.overflowNativePc})`
          );
          evmInboundNativeValue = bumped;
        }
        const outboundMulticalls = buildOutboundApprovalAndCall({
          prc20Token:
            segment.prc20Token ||
            getNativePRC20ForChain(sourceChain, ctx.pushNetwork),
          gasToken: segment.gasToken || (ZERO_ADDRESS as `0x${string}`),
          burnAmount: segment.totalBurnAmount || BigInt(0),
          gasFee: inboundGasFee,
          nativeValueForGas: evmInboundNativeValue,
          gatewayPcAddress,
          outboundRequest: outboundReq,
        });
        requiredNativeValue += sumMulticallNativeValue(outboundMulticalls);

        // Reset accumulated -- everything is now inside this outbound
        accumulatedPushMulticalls = [...outboundMulticalls];
        break;
      }
    }
  }

  return {
    multicalls: accumulatedPushMulticalls,
    requiredNativeValue,
  };
}

export async function composeCascade(
  ctx: OrchestratorContext,
  segments: CascadeSegment[],
  ueaAddress: `0x${string}`,
  ueaBalance?: bigint,
  ueaNonce?: bigint
): Promise<MultiCall[]> {
  const result = await composeCascadeDetailed(
    ctx,
    segments,
    ueaAddress,
    ueaBalance,
    ueaNonce
  );
  return result.multicalls;
}

// ============================================================================
// createCascadedBuilder
// ============================================================================

export function createCascadedBuilder(
  ctx: OrchestratorContext,
  preparedTxs: PreparedUniversalTx[],
  callbacks: CascadeCallbacks,
  defaultEventHook?: (
    event: import('../../progress-hook/progress-hook.types').ProgressEvent
  ) => void
): { send: () => Promise<CascadedTxResponse> } {
  return {
    send: async (): Promise<CascadedTxResponse> => {
      const ueaAddress = computeUEAOffchain(ctx);

      // Extract HopDescriptors
      const hops = preparedTxs.map((tx) => tx._hop);

      // Classify into segments
      const segments = classifyIntoSegments(hops);

      // Check if this is a single-hop Route 1 (no composition needed)
      if (preparedTxs.length === 1 && preparedTxs[0].route === 'UOA_TO_PUSH') {
        const response = await callbacks.executeFn(hops[0].params);
        const singleRoute1Result: CascadedTxResponse = {
          initialTxHash: response.hash,
          initialTxResponse: response,
          hops: [
            {
              hopIndex: 0,
              route: hops[0].route,
              executionChain: getPushChainForNetwork(ctx.pushNetwork),
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
                executionChain: getPushChainForNetwork(ctx.pushNetwork),
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
      if (preparedTxs.length === 1 && preparedTxs[0].route === 'UOA_TO_CEA') {
        const response = await callbacks.executeFn(hops[0].params);
        const targetChain =
          hops[0].targetChain || getPushChainForNetwork(ctx.pushNetwork);
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
      const ueaBalance = await ctx.pushClient.getBalance(ueaAddress);
      const ueaCodeCascade = await ctx.pushClient.publicClient.getCode({
        address: ueaAddress,
      });
      const ueaNonceCascade =
        ueaCodeCascade !== undefined
          ? await getUEANonce(ctx, ueaAddress)
          : BigInt(0);
      let composedMulticalls: MultiCall[];
      let cascadeRequiredNativeValue = BigInt(0);
      try {
        const composed = await composeCascadeDetailed(
          ctx,
          segments,
          ueaAddress,
          ueaBalance,
          ueaNonceCascade
        );
        composedMulticalls = composed.multicalls;
        cascadeRequiredNativeValue = composed.requiredNativeValue;
      } catch (err) {
        // Pre-flight or per-segment min-swap failure inside composeCascade
        // throws before the cascade ever broadcasts. Fire 999-02 with the
        // segmentIndex (1-indexed for the failedAt slot) so consumers see a
        // terminal "cascade failed" frame instead of the stream stopping
        // silently after 203-04.
        if (err instanceof InsufficientUEABalanceError) {
          const failedHopIndex = err.segmentIndex ?? 0;
          fireProgressHook(
            ctx,
            PROGRESS_HOOK.SEND_TX_999_02,
            failedHopIndex + 1,
            preparedTxs.length,
            err.message
          );
        }
        throw err;
      }

      // Execute the composed multicall as a single Push Chain tx
      const executeParams: ExecuteParams = {
        to: ueaAddress,
        value: cascadeRequiredNativeValue,
        data: composedMulticalls,
      };

      const response = await callbacks.executeFn(executeParams);

      // Build hop info for tracking
      const hopInfos: CascadeHopInfo[] = hops.map((hop, index) => ({
        hopIndex: index,
        route: hop.route,
        executionChain:
          hop.targetChain ||
          hop.sourceChain ||
          getPushChainForNetwork(ctx.pushNetwork),
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
            eventHook = defaultEventHook,
          } = opts || {};
          const startTime = Date.now();

          // Per-hop progress emission. Fans out cascade markers to BOTH the
          // explicit `eventHook` (passed into waitForAll) AND the init-time
          // `ctx.progressHook` (set on PushChain.initialize), deduping if the
          // two are the same reference. This is the bridge that lets UI-kit
          // consumers — which only listen on `ctx.progressHook` — receive the
          // cascade-level marker stream (001 / 002-xx / 203-xx / 204-xx /
          // 209-xx / 299-01 / 999-xx) without having to manually wire
          // `eventHook` at every call site. Drops events whose id is '' (the
          // no-op sentinel returned by pickWaitHooks for R4/unknown routes).
          const emitHopEvent = (
            event: import('../../progress-hook/progress-hook.types').ProgressEvent
          ) => {
            dispatchCascadeProgressEvent(event, eventHook, ctx.progressHook);
          };

          // ---- Multichain (multi-hop) cascade markers (001 / 002 / 999) ----
          // Only fire when this is genuinely a multi-hop cascade. Single-hop
          // R1/R2 takes the early-return paths above and never reaches here,
          // but guard explicitly in case someone wires a 1-element prepared list.
          const totalHops = hopInfos.length;
          const isMulti = totalHops > 1;
          const chainLabels = hops.map((h) =>
            String(
              h.targetChain ??
                h.sourceChain ??
                getPushChainForNetwork(ctx.pushNetwork)
            )
          );
          const signerOriginChain = String(
            ctx.universalSigner.account.chain ?? 'origin'
          );

          const emitHopStart = (hopIndex0: number) => {
            if (!isMulti) return;
            const n = hopIndex0 + 1;
            const fromChain =
              hopIndex0 === 0 ? signerOriginChain : chainLabels[hopIndex0 - 1];
            const toChain = chainLabels[hopIndex0];
            emitHopEvent(
              PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_002_01](
                n,
                totalHops,
                fromChain,
                toChain
              )
            );
          };
          const emitHopComplete = (hopIndex0: number) => {
            if (!isMulti) return;
            const n = hopIndex0 + 1;
            if (n >= totalHops) return; // skip after final hop — 999-01 takes over
            emitHopEvent(
              PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_002_99_99](n, totalHops)
            );
          };
          const emitCascadeSuccess = () => {
            if (!isMulti) return;
            emitHopEvent(
              PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_999_01](totalHops)
            );
          };
          const emitCascadeFailed = (failedIdx0: number, errMsg: string) => {
            if (!isMulti) return;
            emitHopEvent(
              PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_999_02](
                failedIdx0 + 1,
                totalHops,
                errMsg
              )
            );
          };
          const emitCascadeTimeout = (failedIdx0: number) => {
            if (!isMulti) return;
            emitHopEvent(
              PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_999_03](
                failedIdx0 + 1,
                totalHops
              )
            );
          };

          if (isMulti) {
            emitHopEvent(
              PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_001](totalHops, chainLabels)
            );
          }

          try {
            // 1. Wait for initial Push Chain tx confirmation
            // Emit 002-01 for hop 0 ONLY when the first hop is a Push (R1) tx —
            // its "start" coincides with submitting the composed Push tx. For
            // cascades that begin with R2/R3, the per-outbound/inbound branches
            // below own the emitHopStart for hop 0 to avoid a duplicate marker.
            if (hopInfos[0]?.route === 'UOA_TO_PUSH') {
              emitHopStart(0);
            }
            cascadeProgressHook?.({
              hopIndex: 0,
              route: hopInfos[0]?.route || 'UOA_TO_PUSH',
              chain: getPushChainForNetwork(ctx.pushNetwork),
              status: 'waiting',
              elapsed: Date.now() - startTime,
            });

            await response.wait();

            const ceaToPushIndex = hopInfos.findIndex(
              (h, index) =>
                h.route === 'CEA_TO_PUSH' && !isNativeSeedOnlyHop(hops[index])
            );
            const isAfterCeaToPush = (index: number) =>
              ceaToPushIndex >= 0 && index > ceaToPushIndex;

            const trackOutboundHops = async (
              outboundHops: CascadeHopInfo[],
              pushTxHash: string,
              resolvedSubTxId?: string
            ): Promise<CascadeCompletionResult | null> => {
              if (outboundHops.length === 0) return null;

              if (outboundHops.length === 1) {
                const hop = outboundHops[0];
                const hopHooks = pickWaitHooks(hop.route);
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
                  emitHopEvent(
                    hopHooks.timeout(hop.executionChain, Date.now() - startTime)
                  );
                  emitCascadeTimeout(hop.hopIndex);
                  return {
                    success: false,
                    hops: hopInfos,
                    failedAt: hop.hopIndex,
                  };
                }

                emitHopStart(hop.hopIndex);
                emitHopEvent(hopHooks.awaiting(hop.executionChain));

                cascadeProgressHook?.({
                  hopIndex: hop.hopIndex,
                  route: hop.route,
                  chain: hop.executionChain,
                  status: 'polling',
                  elapsed: Date.now() - startTime,
                });

                let lastEmittedStatus: string | undefined;

                try {
                  const outboundDetails = await callbacks.waitForOutboundTxFn(
                    pushTxHash,
                    {
                      initialWaitMs: Math.min(60000, remainingTimeout),
                      pollingIntervalMs,
                      timeout: remainingTimeout,
                      _resolvedSubTxId: resolvedSubTxId,
                      _expectedDestinationChain: hop.executionChain,
                      progressHook: (event) => {
                        cascadeProgressHook?.({
                          hopIndex: hop.hopIndex,
                          route: hop.route,
                          chain: hop.executionChain,
                          status: event.status as
                            | 'waiting'
                            | 'polling'
                            | 'found'
                            | 'confirmed'
                            | 'failed'
                            | 'timeout',
                          elapsed: Date.now() - startTime,
                        });
                        if (
                          event.status === 'polling' &&
                          lastEmittedStatus !== 'polling'
                        ) {
                          lastEmittedStatus = 'polling';
                          emitHopEvent(
                            hopHooks.polling(hop.executionChain, event.elapsed)
                          );
                        }
                      },
                    }
                  );
                  // `outboundDetails.externalTxHash` from waitForOutboundTx
                  // is the raw `0x`-hex form (internal canonical). For the
                  // user-facing `hop.txHash`, `hop.outboundDetails`, and
                  // cascade progress event, normalize to base58 for SVM so
                  // consumers can paste it straight into a Solana explorer.
                  const displayTxHash =
                    toExternalTxHashDisplay(
                      outboundDetails.destinationChain,
                      outboundDetails.externalTxHash
                    ) ?? outboundDetails.externalTxHash;
                  const userFacingOutboundDetails = {
                    ...outboundDetails,
                    externalTxHash: displayTxHash,
                  };
                  hop.status = 'confirmed';
                  hop.txHash = displayTxHash;
                  hop.outboundDetails = userFacingOutboundDetails;
                  emitHopEvent(hopHooks.success(userFacingOutboundDetails));
                  emitHopComplete(hop.hopIndex);
                  cascadeProgressHook?.({
                    hopIndex: hop.hopIndex,
                    route: hop.route,
                    chain: hop.executionChain,
                    status: 'confirmed',
                    txHash: displayTxHash,
                    elapsed: Date.now() - startTime,
                  });
                } catch (err) {
                  const errMsg =
                    err instanceof Error ? err.message : String(err);
                  const isTimeout = errMsg.startsWith(
                    'Timeout waiting for outbound transaction'
                  );
                  emitHopEvent(
                    isTimeout
                      ? hopHooks.timeout(hop.executionChain, remainingTimeout)
                      : hopHooks.failed(hop.executionChain, errMsg)
                  );
                  if (isTimeout) {
                    emitCascadeTimeout(hop.hopIndex);
                  } else {
                    emitCascadeFailed(hop.hopIndex, errMsg);
                  }
                  hop.status = 'failed';
                  cascadeProgressHook?.({
                    hopIndex: hop.hopIndex,
                    route: hop.route,
                    chain: hop.executionChain,
                    status: 'failed',
                    elapsed: Date.now() - startTime,
                  });
                  return {
                    success: false,
                    hops: hopInfos,
                    failedAt: hop.hopIndex,
                  };
                }
              } else {
                for (const outHop of outboundHops) {
                  emitHopStart(outHop.hopIndex);
                  emitHopEvent(
                    pickWaitHooks(outHop.route).awaiting(outHop.executionChain)
                  );
                }

                const perHopLastStatus = new Map<number, string>();
                const confirmedHops = new Set<number>();

                const allOutboundDetails =
                  await callbacks.waitForAllOutboundTxsFn(
                    pushTxHash,
                    outboundHops,
                    {
                      initialWaitMs: Math.min(
                        60000,
                        timeout - (Date.now() - startTime)
                      ),
                      pollingIntervalMs,
                      timeout: timeout - (Date.now() - startTime),
                      _resolvedSubTxId: resolvedSubTxId,
                      progressHook: (event: any) => {
                        cascadeProgressHook?.({
                          hopIndex: event.hopIndex,
                          route: event.route,
                          chain: event.chain,
                          status: event.status as
                            | 'waiting'
                            | 'polling'
                            | 'found'
                            | 'confirmed'
                            | 'failed'
                            | 'timeout',
                          txHash: event.txHash,
                          elapsed: Date.now() - startTime,
                        });

                        const matchedHop = outboundHops.find(
                          (h) => h.hopIndex === event.hopIndex
                        );
                        const eventHooks = pickWaitHooks(matchedHop?.route);

                        const prev = perHopLastStatus.get(event.hopIndex);
                        if (event.status === 'polling' && prev !== 'polling') {
                          perHopLastStatus.set(event.hopIndex, 'polling');
                          emitHopEvent(
                            eventHooks.polling(
                              matchedHop?.executionChain ?? event.chain ?? '',
                              Date.now() - startTime
                            )
                          );
                        }

                        if (
                          event.status === 'confirmed' &&
                          event.txHash &&
                          !confirmedHops.has(event.hopIndex)
                        ) {
                          // waitForAllOutboundTxsV2 populates hop.outboundDetails
                          // on the matched hop before emitting 'confirmed' (see
                          // outbound-sync.ts:348-355). Auto-promotion paths
                          // without a txHash are skipped by the `event.txHash`
                          // guard above, so we only reach here with full details.
                          if (matchedHop?.outboundDetails) {
                            confirmedHops.add(event.hopIndex);
                            emitHopEvent(
                              eventHooks.success(matchedHop.outboundDetails)
                            );
                            emitHopComplete(event.hopIndex);
                          }
                        }
                      },
                    }
                  );

                if (!allOutboundDetails.success) {
                  const failedIdx = allOutboundDetails.failedAt ?? 0;
                  const failedHop = outboundHops.find(
                    (h) => h.hopIndex === failedIdx
                  );
                  const failMsg = failedHop
                    ? `Outbound failed for hop ${failedIdx} on ${failedHop.executionChain}`
                    : `Outbound cascade failed at hop ${failedIdx}`;
                  emitHopEvent(
                    pickWaitHooks(failedHop?.route).failed(
                      failedHop?.executionChain ?? '',
                      failMsg
                    )
                  );
                  emitCascadeFailed(failedIdx, failMsg);
                  return {
                    success: false,
                    hops: hopInfos,
                    failedAt: failedIdx,
                  };
                }
              }
              return null;
            };

            // Mark only root Push Chain (Route 1) hops as confirmed. Route 1
            // hops after a Route 3 leg execute in the child inbound Push tx and
            // must wait for that child UTX to reach terminal success.
            for (const hop of hopInfos) {
              if (
                hop.route === 'CEA_TO_PUSH' &&
                isNativeSeedOnlyHop(hops[hop.hopIndex])
              ) {
                emitHopStart(hop.hopIndex);
                hop.status = 'confirmed';
                hop.txHash = response.hash;
                cascadeProgressHook?.({
                  hopIndex: hop.hopIndex,
                  route: hop.route,
                  chain: getPushChainForNetwork(ctx.pushNetwork),
                  status: 'confirmed',
                  txHash: response.hash,
                  elapsed: Date.now() - startTime,
                });
                emitHopComplete(hop.hopIndex);
              }
            }

            for (const hop of hopInfos) {
              if (hop.route === 'UOA_TO_PUSH' && !isAfterCeaToPush(hop.hopIndex)) {
                hop.status = 'confirmed';
                hop.txHash = response.hash;
                cascadeProgressHook?.({
                  hopIndex: hop.hopIndex,
                  route: hop.route,
                  chain: getPushChainForNetwork(ctx.pushNetwork),
                  status: 'confirmed',
                  txHash: response.hash,
                  elapsed: Date.now() - startTime,
                });
                emitHopComplete(hop.hopIndex);
              }
            }

            // 2. Track direct outbound hops (Route 2: UOA_TO_CEA) that belong
            // to the root Push UTX.
            const rootOutboundHops = hopInfos.filter(
              (h) => h.route === 'UOA_TO_CEA' && !isAfterCeaToPush(h.hopIndex)
            );
            const rootOutboundFailure = await trackOutboundHops(
              rootOutboundHops,
              response.hash
            );
            if (rootOutboundFailure) return rootOutboundFailure;

            let childInbound: InboundPushTxDetails | undefined;
            if (ceaToPushIndex >= 0) {
              const inboundHop = hopInfos[ceaToPushIndex];
              const hopHooks = pickWaitHooks(inboundHop.route);
              const remainingTimeout = timeout - (Date.now() - startTime);
              if (remainingTimeout <= 0) {
                inboundHop.status = 'failed';
                emitHopEvent(
                  hopHooks.timeout(inboundHop.executionChain, Date.now() - startTime)
                );
                emitCascadeTimeout(inboundHop.hopIndex);
                return {
                  success: false,
                  hops: hopInfos,
                  failedAt: inboundHop.hopIndex,
                };
              }

              emitHopStart(inboundHop.hopIndex);
              emitHopEvent(hopHooks.awaiting(inboundHop.executionChain));
              cascadeProgressHook?.({
                hopIndex: inboundHop.hopIndex,
                route: inboundHop.route,
                chain: inboundHop.executionChain,
                status: 'polling',
                elapsed: Date.now() - startTime,
              });

              let outboundLastStatus: string | undefined;
              let sourceOutboundDetails: OutboundTxDetails;
              try {
                sourceOutboundDetails = await callbacks.waitForOutboundTxFn(
                  response.hash,
                  {
                    initialWaitMs: Math.min(60000, remainingTimeout),
                    pollingIntervalMs,
                    timeout: remainingTimeout,
                    _expectedDestinationChain: inboundHop.executionChain,
                    progressHook: (event) => {
                      cascadeProgressHook?.({
                        hopIndex: inboundHop.hopIndex,
                        route: inboundHop.route,
                        chain: inboundHop.executionChain,
                        status: event.status as
                          | 'waiting'
                          | 'polling'
                          | 'found'
                          | 'confirmed'
                          | 'failed'
                          | 'timeout',
                        elapsed: Date.now() - startTime,
                      });
                      if (
                        event.status === 'polling' &&
                        outboundLastStatus !== 'polling'
                      ) {
                        outboundLastStatus = 'polling';
                        emitHopEvent(
                          hopHooks.polling(
                            inboundHop.executionChain,
                            event.elapsed
                          )
                        );
                      }
                    },
                  }
                );
              } catch (err) {
                const errMsg =
                  err instanceof Error ? err.message : String(err);
                const isTimeout = errMsg.startsWith(
                  'Timeout waiting for outbound transaction'
                );
                emitHopEvent(
                  isTimeout
                    ? hopHooks.timeout(inboundHop.executionChain, remainingTimeout)
                    : hopHooks.failed(inboundHop.executionChain, errMsg)
                );
                if (isTimeout) emitCascadeTimeout(inboundHop.hopIndex);
                else emitCascadeFailed(inboundHop.hopIndex, errMsg);
                inboundHop.status = 'failed';
                const failedExternalTxHash = (err as { externalTxHash?: string })
                  ?.externalTxHash;
                const failedDisplayTxHash =
                  toExternalTxHashDisplay(
                    inboundHop.executionChain,
                    failedExternalTxHash
                  ) ?? failedExternalTxHash;
                if (failedDisplayTxHash) inboundHop.txHash = failedDisplayTxHash;
                cascadeProgressHook?.({
                  hopIndex: inboundHop.hopIndex,
                  route: inboundHop.route,
                  chain: inboundHop.executionChain,
                  status: 'failed',
                  txHash: failedDisplayTxHash,
                  elapsed: Date.now() - startTime,
                });
                return {
                  success: false,
                  hops: hopInfos,
                  failedAt: inboundHop.hopIndex,
                };
              }

              const displayExternalTxHash =
                toExternalTxHashDisplay(
                  sourceOutboundDetails.destinationChain,
                  sourceOutboundDetails.externalTxHash
                ) ?? sourceOutboundDetails.externalTxHash;
              inboundHop.outboundDetails = {
                ...sourceOutboundDetails,
                externalTxHash: displayExternalTxHash,
              };
              inboundHop.txHash = displayExternalTxHash;
              emitHopEvent(hopHooks.success(inboundHop.outboundDetails));
              emitHopEvent(
                PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_310_01](
                  inboundHop.executionChain
                )
              );

              let inboundLastStatus: string | undefined;
              const inboundRemainingTimeout =
                timeout - (Date.now() - startTime);
              try {
                childInbound = await (
                  callbacks.waitForInboundPushTxFn ??
                  ((externalTxHash, sourceChain, opts) =>
                    waitForInboundPushTx(ctx, externalTxHash, sourceChain, opts))
                )(sourceOutboundDetails.externalTxHash, inboundHop.executionChain, {
                  initialWaitMs: Math.min(60000, inboundRemainingTimeout),
                  pollingIntervalMs,
                  timeout: inboundRemainingTimeout,
                  progressHook: (event) => {
                    if (
                      event.status === 'polling' &&
                      inboundLastStatus !== 'polling'
                    ) {
                      inboundLastStatus = 'polling';
                      emitHopEvent(
                        PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_310_02](
                          inboundHop.executionChain,
                          event.elapsedMs
                        )
                      );
                    }
                  },
                });
              } catch (err) {
                const errMsg =
                  err instanceof Error ? err.message : String(err);
                const isTimeout = err instanceof InboundTimeoutError;
                emitHopEvent(
                  isTimeout
                    ? PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_399_03](
                        inboundHop.executionChain,
                        inboundRemainingTimeout,
                        'inbound'
                      )
                    : PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_399_02](
                        errMsg,
                        'inbound',
                        inboundHop.executionChain
                      )
                );
                if (isTimeout) emitCascadeTimeout(inboundHop.hopIndex);
                else emitCascadeFailed(inboundHop.hopIndex, errMsg);
                inboundHop.status = 'failed';
                cascadeProgressHook?.({
                  hopIndex: inboundHop.hopIndex,
                  route: inboundHop.route,
                  chain: inboundHop.executionChain,
                  status: 'failed',
                  elapsed: Date.now() - startTime,
                });
                return {
                  success: false,
                  hops: hopInfos,
                  failedAt: inboundHop.hopIndex,
                };
              }

              if (childInbound.status !== 'confirmed') {
                const failMsg =
                  childInbound.errorMessage ??
                  'inbound execution failed on Push Chain';
                inboundHop.status = 'failed';
                inboundHop.txHash =
                  childInbound.pushTxHash || displayExternalTxHash;
                emitHopEvent(
                  PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_399_02](
                    failMsg,
                    'inbound',
                    inboundHop.executionChain
                  )
                );
                emitCascadeFailed(inboundHop.hopIndex, failMsg);
                cascadeProgressHook?.({
                  hopIndex: inboundHop.hopIndex,
                  route: inboundHop.route,
                  chain: inboundHop.executionChain,
                  status: 'failed',
                  txHash: inboundHop.txHash,
                  elapsed: Date.now() - startTime,
                });
                return {
                  success: false,
                  hops: hopInfos,
                  failedAt: inboundHop.hopIndex,
                };
              }

              inboundHop.status = 'confirmed';
              inboundHop.txHash =
                childInbound.pushTxHash || displayExternalTxHash;
              emitHopEvent(
                PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_399_01](
                  inboundHop.executionChain,
                  childInbound.pushTxHash
                )
              );
              emitHopComplete(inboundHop.hopIndex);
              cascadeProgressHook?.({
                hopIndex: inboundHop.hopIndex,
                route: inboundHop.route,
                chain: inboundHop.executionChain,
                status: 'confirmed',
                txHash: inboundHop.txHash,
                elapsed: Date.now() - startTime,
              });
            }

            if (childInbound) {
              for (const hop of hopInfos) {
                if (
                  hop.route === 'UOA_TO_PUSH' &&
                  isAfterCeaToPush(hop.hopIndex)
                ) {
                  emitHopStart(hop.hopIndex);
                  hop.status = 'confirmed';
                  hop.txHash = childInbound.pushTxHash;
                  cascadeProgressHook?.({
                    hopIndex: hop.hopIndex,
                    route: hop.route,
                    chain: getPushChainForNetwork(ctx.pushNetwork),
                    status: 'confirmed',
                    txHash: childInbound.pushTxHash,
                    elapsed: Date.now() - startTime,
                  });
                  emitHopComplete(hop.hopIndex);
                }
              }

              const childOutboundHops = hopInfos.filter(
                (h) => h.route === 'UOA_TO_CEA' && isAfterCeaToPush(h.hopIndex)
              );
              const childOutboundFailure = await trackOutboundHops(
                childOutboundHops,
                childInbound.pushTxHash || response.hash,
                childInbound.childUtxId
              );
              if (childOutboundFailure) return childOutboundFailure;
            }

            emitCascadeSuccess();
            return { success: true, hops: hopInfos };
          } catch (err) {
            const failedIdx = hopInfos.findIndex(
              (h) => h.status !== 'confirmed'
            );
            const errMsg = err instanceof Error ? err.message : String(err);
            const failedAt = failedIdx >= 0 ? failedIdx : 0;
            const isTimeout = errMsg.startsWith('Timeout');
            if (isTimeout) {
              emitCascadeTimeout(failedAt);
            } else {
              emitCascadeFailed(failedAt, errMsg);
            }
            return {
              success: false,
              hops: hopInfos,
              failedAt,
            };
          }
        },
        wait: async (opts?: CascadeTrackOptions) =>
          cascadeResponse.waitForAll(opts),
      };

      return cascadeResponse;
    },
  };
}

/**
 * Cascade composition functions extracted from Orchestrator.
 *
 * Covers: prepareTransaction, buildHopDescriptor, classifyIntoSegments,
 * getSegmentType, composeCascade, createCascadedBuilder, createChainedBuilder.
 */

import { PublicKey } from '@solana/web3.js';
import { encodeFunctionData } from 'viem';
import { ERC20_EVM } from '../../constants/abi';
import {
  CHAIN_INFO,
  UNIVERSAL_GATEWAY_ADDRESSES,
} from '../../constants/chain';
import { CHAIN } from '../../constants/enums';
import { MoveableToken } from '../../constants/tokens';
import {
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
  CascadedTransactionBuilder,
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
import {
  getUniversalGatewayPCAddress,
  getNativePRC20ForChain,
  toExecuteParams,
} from './helpers';
import { buildMulticallPayloadData } from './payload-builder';
import { computeUEAOffchain, getUEANonce, getUeaStatusAndNonce } from './uea-manager';
import { queryOutboundGasFee } from './gas-calculator';
import { buildPayloadForRoute } from './route-handlers';

// ============================================================================
// Callback interfaces
// ============================================================================

export interface CascadeCallbacks {
  executeFn: (params: any) => Promise<UniversalTxResponse>;
  waitForOutboundTxFn: (
    hash: string,
    opts?: WaitForOutboundOptions
  ) => Promise<OutboundTxDetails>;
  waitForAllOutboundTxsFn: (
    hash: string,
    hops: CascadeHopInfo[],
    opts: any
  ) => Promise<{ success: boolean; failedAt?: number }>;
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

  const { nonce, deployed } = await getUeaStatusAndNonce(ctx);
  const ueaAddress = computeUEAOffchain(ctx);

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
    thenOn: (nextTx: PreparedUniversalTx) =>
      createCascadedBuilder(ctx, [prepared, nextTx], callbacks),
    send: () => callbacks.executeFn(params),
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
          prc20Token = getNativePRC20ForChain(targetChain, ctx.pushNetwork);
          burnAmount = params.value;
        } else if (hasSvmExecute) {
          prc20Token = getNativePRC20ForChain(targetChain, ctx.pushNetwork);
          burnAmount = BigInt(1);
        }

        let gasToken: `0x${string}` = ZERO_ADDRESS as `0x${string}`;
        let gasFee = BigInt(0);
        if (prc20Token !== (ZERO_ADDRESS as `0x${string}`)) {
          const result = await queryOutboundGasFee(ctx, prc20Token, gasLimit);
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
        ctx.rpcUrls[targetChain]?.[0]
      );

      // Migration path: raw MIGRATION_SELECTOR payload, no multicall wrapping
      if (params.migration) {
        const prc20Token = getNativePRC20ForChain(targetChain, ctx.pushNetwork);
        const burnAmount = BigInt(0); // Migration is logic-only — no funds. CEA rejects msg.value != 0.
        let gasToken: `0x${string}` = ZERO_ADDRESS as `0x${string}`;
        let gasFee = BigInt(0);
        if (prc20Token !== (ZERO_ADDRESS as `0x${string}`)) {
          const result = await queryOutboundGasFee(ctx, prc20Token, gasLimit);
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
        prc20Token = getNativePRC20ForChain(targetChain, ctx.pushNetwork);
        burnAmount = params.value;
      } else if (params.data) {
        prc20Token = getNativePRC20ForChain(targetChain, ctx.pushNetwork);
        burnAmount = BigInt(1); // Minimum for precompile
      }

      // Query gas fee
      let gasToken: `0x${string}` = ZERO_ADDRESS as `0x${string}`;
      let gasFee = BigInt(0);
      if (prc20Token !== (ZERO_ADDRESS as `0x${string}`)) {
        const result = await queryOutboundGasFee(ctx, prc20Token, gasLimit);
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
          throw new Error(
            `No SVM gateway program configured for chain ${sourceChain}`
          );
        }
        const programPk = new PublicKey(lockerContract);
        const gatewayProgramHex = ('0x' +
          Buffer.from(programPk.toBytes()).toString(
            'hex'
          )) as `0x${string}`;

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
            prc20Token = PushChain.utils.tokens.getPRC20Address(token);
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
        if (prc20Token !== (ZERO_ADDRESS as `0x${string}`)) {
          const result = await queryOutboundGasFee(ctx, prc20Token, gasLimit);
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
        ctx.rpcUrls[sourceChain]?.[0]
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
      const prc20Token = getNativePRC20ForChain(sourceChain, ctx.pushNetwork);
      let gasToken: `0x${string}` = ZERO_ADDRESS as `0x${string}`;
      let gasFee = BigInt(0);
      if (prc20Token !== (ZERO_ADDRESS as `0x${string}`)) {
        const result = await queryOutboundGasFee(ctx, prc20Token, gasLimit);
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
      // Same-chain merging for OUTBOUND_TO_CEA (EVM only — SVM hops are atomic)
      (segType === 'OUTBOUND_TO_CEA'
        ? currentSegment.targetChain === hop.targetChain && !hop.isSvmTarget
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
      };
      segments.push(currentSegment);
    }
  }

  return segments;
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

export function composeCascade(
  ctx: OrchestratorContext,
  segments: CascadeSegment[],
  ueaAddress: `0x${string}`,
  ueaBalance?: bigint,
  ueaNonce?: bigint
): MultiCall[] {
  let accumulatedPushMulticalls: MultiCall[] = [];
  const gatewayPcAddress = getUniversalGatewayPCAddress();

  // Compute per-outbound nativeValueForGas from UEA balance
  // Each outbound segment needs native value for the gas swap on the destination chain.
  // The contract refunds excess, so over-allocating is safe.
  const numOutbounds = segments.filter(
    (s) => s.type !== 'PUSH_EXECUTION'
  ).length;
  const CASCADE_GAS_RESERVE = BigInt(3e18); // 3 PC reserve for gas costs
  let perOutboundNativeValue: bigint | undefined;
  if (ueaBalance && numOutbounds > 0 && ueaBalance > CASCADE_GAS_RESERVE) {
    perOutboundNativeValue =
      (ueaBalance - CASCADE_GAS_RESERVE) / BigInt(numOutbounds);
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
          targetForOutbound =
            firstHop.params.svmExecute?.targetProgram ?? svmTarget.address;
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
          prc20Token:
            segment.prc20Token || (ZERO_ADDRESS as `0x${string}`),
          gasToken:
            segment.gasToken || (ZERO_ADDRESS as `0x${string}`),
          burnAmount: segment.totalBurnAmount || BigInt(0),
          gasFee: segGasFee,
          nativeValueForGas:
            perOutboundNativeValue ?? segGasFee * BigInt(1000),
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
          const multicallPayload = buildMulticallPayloadData(
            ctx,
            ueaAddress,
            accumulatedPushMulticalls
          );
          // +1: the outbound tx consumes one nonce via execute()
          intermediatePayload = buildInboundUniversalPayload(
            multicallPayload,
            { nonce: (ueaNonce ?? BigInt(0)) + BigInt(1) }
          );
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
            Buffer.from(programPk.toBytes()).toString(
              'hex'
            )) as `0x${string}`;

          let drainAmount = BigInt(0);
          let tokenMintHex: `0x${string}` | undefined;
          const params = hop.params;
          if (params.funds?.amount && params.funds.amount > BigInt(0)) {
            drainAmount = params.funds.amount;
            const token = (params.funds as { token: MoveableToken }).token;
            if (token && token.address) {
              const mintPk = new PublicKey(token.address);
              tokenMintHex = ('0x' +
                Buffer.from(mintPk.toBytes()).toString(
                  'hex'
                )) as `0x${string}`;
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

          const burnAmount = BigInt(1);
          const outboundReq = buildOutboundRequest(
            gatewayProgramHex,
            segment.prc20Token ||
              getNativePRC20ForChain(sourceChain, ctx.pushNetwork),
            burnAmount,
            segment.gasLimit ?? BigInt(0),
            svmPayload,
            ueaAddress
          );

          const inboundGasFee = segment.gasFee || BigInt(0);
          const outboundMulticalls = buildOutboundApprovalAndCall({
            prc20Token:
              segment.prc20Token ||
              getNativePRC20ForChain(sourceChain, ctx.pushNetwork),
            gasToken:
              segment.gasToken || (ZERO_ADDRESS as `0x${string}`),
            burnAmount,
            gasFee: inboundGasFee,
            nativeValueForGas:
              perOutboundNativeValue ?? inboundGasFee * BigInt(1000),
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
                throw new Error(
                  `No UniversalGateway address configured for chain ${sourceChain}`
                );
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
          segment.prc20Token ||
            getNativePRC20ForChain(sourceChain, ctx.pushNetwork),
          segment.totalBurnAmount || BigInt(1),
          segment.gasLimit ?? BigInt(0),
          ceaPayload,
          ueaAddress
        );

        const inboundGasFee = segment.gasFee || BigInt(0);
        const outboundMulticalls = buildOutboundApprovalAndCall({
          prc20Token:
            segment.prc20Token ||
            getNativePRC20ForChain(sourceChain, ctx.pushNetwork),
          gasToken:
            segment.gasToken || (ZERO_ADDRESS as `0x${string}`),
          burnAmount: segment.totalBurnAmount || BigInt(1),
          gasFee: inboundGasFee,
          nativeValueForGas:
            perOutboundNativeValue ?? inboundGasFee * BigInt(1000),
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

// ============================================================================
// createCascadedBuilder
// ============================================================================

export function createCascadedBuilder(
  ctx: OrchestratorContext,
  preparedTxs: PreparedUniversalTx[],
  callbacks: CascadeCallbacks
): CascadedTransactionBuilder {
  return {
    thenOn: (nextTx: PreparedUniversalTx) =>
      createCascadedBuilder(ctx, [...preparedTxs, nextTx], callbacks),

    send: async (): Promise<CascadedTxResponse> => {
      const ueaAddress = computeUEAOffchain(ctx);

      // Extract HopDescriptors
      const hops = preparedTxs.map((tx) => tx._hop);

      // Classify into segments
      const segments = classifyIntoSegments(hops);

      // Check if this is a single-hop Route 1 (no composition needed)
      if (
        preparedTxs.length === 1 &&
        preparedTxs[0].route === 'UOA_TO_PUSH'
      ) {
        const response = await callbacks.executeFn(hops[0].params);
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
        const response = await callbacks.executeFn(hops[0].params);
        const targetChain =
          hops[0].targetChain || CHAIN.PUSH_TESTNET_DONUT;
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
      const composedMulticalls = composeCascade(
        ctx,
        segments,
        ueaAddress,
        ueaBalance,
        ueaNonceCascade
      );

      // Execute the composed multicall as a single Push Chain tx
      const executeParams: ExecuteParams = {
        to: ueaAddress,
        data: composedMulticalls,
      };

      const response = await callbacks.executeFn(executeParams);

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
                  return {
                    success: false,
                    hops: hopInfos,
                    failedAt: hop.hopIndex,
                  };
                }

                cascadeProgressHook?.({
                  hopIndex: hop.hopIndex,
                  route: hop.route,
                  chain: hop.executionChain,
                  status: 'polling',
                  elapsed: Date.now() - startTime,
                });

                try {
                  const outboundDetails =
                    await callbacks.waitForOutboundTxFn(response.hash, {
                      initialWaitMs: Math.min(60000, remainingTimeout),
                      pollingIntervalMs,
                      timeout: remainingTimeout,
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
                  return {
                    success: false,
                    hops: hopInfos,
                    failedAt: hop.hopIndex,
                  };
                }
              } else {
                // Multiple outbound hops: use V2 API which returns outboundTx[]
                const allOutboundDetails =
                  await callbacks.waitForAllOutboundTxsFn(
                    response.hash,
                    outboundHops,
                    {
                      initialWaitMs: Math.min(
                        60000,
                        timeout - (Date.now() - startTime)
                      ),
                      pollingIntervalMs,
                      timeout: timeout - (Date.now() - startTime),
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
        wait: async (opts?: CascadeTrackOptions) =>
          cascadeResponse.waitForAll(opts),
      };

      return cascadeResponse;
    },
  };
}


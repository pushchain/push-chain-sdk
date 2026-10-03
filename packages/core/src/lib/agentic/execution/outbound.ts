import {
  concat,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  type Address,
  type Hex,
} from 'viem';
import { CHAIN, VM } from '../../constants/enums';
import { CHAIN_INFO } from '../../constants/chain';
import type { MoveableToken } from '../../constants/tokens';
import { ERC20_EVM, UNIVERSAL_GATEWAY_PC } from '../../constants/abi';
import type { UniversalExecuteParams, UniversalOutboundTxRequest } from '../../orchestrator/orchestrator.types';
import { isPC20Reference } from '../../orchestrator/orchestrator.types';
import { AgenticCapability, requireCapability } from '../capabilities';
import type { AgenticGeneration } from '../deployments';
import type { Call } from '../contracts/e704d5b';
import { UEA_MULTICALL_PREFIX } from '../contracts/e704d5b';
import { AGENTIC_ERROR_CODE, AgenticError, capabilityUnavailable } from '../errors';
import type { AgenticRuntime } from '../runtime';

/** URP MAX_ACTIONS_PER_REQUEST at e704d5b. */
export const MAX_DESTINATION_CALLS = 10;

const MULTICALL_TUPLE = [
  {
    type: 'tuple[]',
    components: [
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'data', type: 'bytes' },
    ],
  },
] as const;

export interface ComposedOutbound {
  chain: CHAIN;
  destinationAccount: Address;
  destinationAccountDeployed: boolean;
  token: Address;
  amount: bigint;
  /** PC the wallet attaches: protocolFee + maxPCForGas. */
  value: bigint;
  request: UniversalOutboundTxRequest;
  /** The wallet's call into the gateway. */
  gatewayCall: Call;
  destinationCalls: { to: Address; value: bigint; data: Hex }[];
}

/** Destination calls carried in the outbound multicall payload. */
export function destinationCalls(params: UniversalExecuteParams): { to: Address; value: bigint; data: Hex }[] {
  const target = params.to as { address: string; chain: CHAIN };
  if (Array.isArray(params.data)) {
    return params.data.map((c) => ({ to: getAddress(c.to), value: c.value ?? BigInt(0), data: c.data }));
  }
  if (params.data && params.data !== '0x') {
    return [{ to: getAddress(target.address), value: params.value ?? BigInt(0), data: params.data }];
  }
  return [];
}

/**
 * Compose the AGW-originated EVM outbound (Route 2 shape, wallet context):
 *  - recipient = empty bytes, revertRecipient = the AGW, maxPCForGas > 0
 *  - payload   = UEA_MULTICALL ‖ abi.encode(Multicall[1..10]) executed by the AGW's CEA
 *  - value     = protocolFee + maxPCForGas, paid from the AGW's PC
 * The destination account is resolved from the AGW, never from the signer.
 * No approval is added here: agent sends rely on an owner-set allowance.
 */
export async function composeOutbound(
  runtime: AgenticRuntime,
  gen: AgenticGeneration,
  wallet: Address,
  params: UniversalExecuteParams,
  opts: { ruleAsset?: Address; requireCalls: boolean }
): Promise<ComposedOutbound> {
  requireCapability(gen.capabilities, AgenticCapability.UNIVERSAL_EVM_OUTBOUND);
  const target = params.to as { address: string; chain: CHAIN };
  const chain = target.chain;
  const info = CHAIN_INFO[chain];
  if (!info) {
    throw new AgenticError(AGENTIC_ERROR_CODE.INVALID_RULE, `unknown destination chain ${String(chain)}`);
  }
  if (info.vm !== VM.EVM) {
    throw capabilityUnavailable(
      AgenticCapability.UNIVERSAL_SVM_RULES,
      'SVM destinations are not enabled for agentic wallets (A05/A07, H4.4)'
    );
  }
  const calls = destinationCalls(params);
  if (opts.requireCalls && calls.length === 0) {
    throw new AgenticError(
      AGENTIC_ERROR_CODE.INVALID_RULE,
      'an agent outbound must carry at least one destination call (URP requires a multicall payload)'
    );
  }
  if (calls.length > MAX_DESTINATION_CALLS) {
    throw new AgenticError(
      AGENTIC_ERROR_CODE.INVALID_RULE,
      `at most ${MAX_DESTINATION_CALLS} destination calls per outbound`
    );
  }
  const funds = params.funds;
  if (funds && isPC20Reference(funds.token)) {
    throw capabilityUnavailable('pc20Outbound', 'PC20 tokens are not supported through an agentic wallet');
  }

  let token: Address;
  let amount = BigInt(0);
  if (funds?.amount) {
    token = runtime.resolvePrc20(funds.token as MoveableToken | undefined, chain);
    amount = funds.amount;
  } else if (opts.ruleAsset) {
    token = getAddress(opts.ruleAsset);
  } else {
    token = runtime.resolvePrc20(undefined, chain);
  }
  if (opts.ruleAsset && getAddress(opts.ruleAsset) !== token) {
    throw new AgenticError(
      AGENTIC_ERROR_CODE.RULE_LIMIT_EXCEEDED,
      `the selected rule only permits asset ${opts.ruleAsset}, not ${token}`
    );
  }

  const resolved = await runtime.resolveCEA(wallet, chain);
  const cea = getAddress(resolved.cea);
  const isDeployed = resolved.isDeployed;
  const quote = await runtime.quoteOutbound(token, params.gasLimit ?? BigInt(0), chain);
  if (quote.nativeValueForGas <= BigInt(0)) {
    throw new AgenticError(
      AGENTIC_ERROR_CODE.INVALID_RULE,
      'outbound gas quote returned zero; URP rejects an uncapped gas swap'
    );
  }
  const maxPCForGas = quote.nativeValueForGas;
  const value = quote.protocolFee + maxPCForGas;
  const payload =
    calls.length === 0
      ? ('0x' as Hex)
      : concat([UEA_MULTICALL_PREFIX, encodeAbiParameters(MULTICALL_TUPLE, [calls])]);
  const request: UniversalOutboundTxRequest = {
    recipient: '0x',
    token,
    amount,
    gasLimit: quote.gasLimitUsed,
    gasPrice: BigInt(0),
    maxPCForGas,
    payload,
    revertRecipient: wallet,
  };
  const data = encodeFunctionData({
    abi: UNIVERSAL_GATEWAY_PC,
    functionName: 'sendUniversalTxOutbound',
    args: [request],
  });
  return {
    chain,
    destinationAccount: cea,
    destinationAccountDeployed: isDeployed,
    token,
    amount,
    value,
    request,
    gatewayCall: { target: gen.addresses.gateway, value, data },
    destinationCalls: calls,
  };
}

/**
 * Owner door: approval and outbound in one atomic owner batch. The approval is
 * `currentAllowance + amount`, so after the gateway pulls `amount` any standing
 * allowance the owner set for agents is left exactly as it was.
 */
export function ownerOutboundCalls(
  gen: AgenticGeneration,
  out: ComposedOutbound,
  currentAllowance: bigint
): Call[] {
  if (out.amount === BigInt(0)) return [out.gatewayCall];
  return [
    {
      target: out.token,
      value: BigInt(0),
      data: encodeFunctionData({
        abi: ERC20_EVM,
        functionName: 'approve',
        args: [gen.addresses.gateway, currentAllowance + out.amount],
      }),
    },
    out.gatewayCall,
  ];
}

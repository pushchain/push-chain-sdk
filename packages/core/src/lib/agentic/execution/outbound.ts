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
import type {
  UniversalExecuteParams,
  UniversalOutboundTxRequest,
} from '../../orchestrator/orchestrator.types';
import { isPC20Reference } from '../../orchestrator/orchestrator.types';
import { resolveR2DestinationFundsToken } from '../../orchestrator/internals/route-handlers';
import { AgenticCapability, requireCapability } from '../capabilities';
import type { AgenticGeneration } from '../deployments';
import type { Call } from '../contracts/v4';
import { UEA_MULTICALL_PREFIX } from '../contracts/v4';
import {
  AGENTIC_ERROR_CODE,
  AgenticError,
  capabilityUnavailable,
} from '../errors';
import type { AgenticRuntime } from '../runtime';

/** URP MAX_ACTIONS_PER_REQUEST at v4. */
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

export interface DestinationCall {
  to: Address;
  value: bigint;
  data: Hex;
}

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
  destinationCalls: DestinationCall[];
}

/**
 * The calls the wallet's destination account (CEA) executes, built exactly as
 * core's Route 2 builds them for an ordinary account (buildR2CeaPayloadEvm):
 *  - explicit call arrays are used as given (the caller handles transfers);
 *  - with ERC-20 funds, a transfer(target, amount) is prepended to a single
 *    call, or is the whole payload for a transfer-only send;
 *  - native value (and native funds) goes to the target with the call, or as
 *    a value-only call; a value transfer to the CEA itself is skipped.
 * Every encoded call names the requested target, so a response never reports
 * a delivery the request does not instruct.
 */
export function destinationCalls(
  params: UniversalExecuteParams,
  ctx: { cea: Address; fundsToken?: MoveableToken }
): DestinationCall[] {
  const target = getAddress((params.to as { address: string }).address);
  if (Array.isArray(params.data)) {
    return params.data.map((c) => ({
      to: getAddress(c.to),
      value: c.value ?? BigInt(0),
      data: c.data,
    }));
  }
  const amount = params.funds?.amount ?? BigInt(0);
  const token = ctx.fundsToken;
  const erc20 = amount > BigInt(0) && token && token.mechanism !== 'native';
  const nativeFunds =
    amount > BigInt(0) && token?.mechanism === 'native' ? amount : BigInt(0);
  const value = params.value ?? BigInt(0);
  const calls: DestinationCall[] = [];
  if (erc20) {
    calls.push({
      to: getAddress((token as MoveableToken).address),
      value: BigInt(0),
      data: encodeFunctionData({
        abi: ERC20_EVM,
        functionName: 'transfer',
        args: [target, amount],
      }),
    });
  }
  const data = params.data && params.data !== '0x' ? params.data : undefined;
  if (data) {
    calls.push({ to: target, value: value + nativeFunds, data });
  } else {
    const forward = value > BigInt(0) ? value : nativeFunds;
    if (forward > BigInt(0) && target !== ctx.cea) {
      calls.push({ to: target, value: forward, data: '0x' });
    }
  }
  return calls;
}

/**
 * Compose the AGW-originated EVM outbound (Route 2 shape, wallet context):
 *  - recipient = empty bytes, revertRecipient = the AGW, maxPCForGas > 0
 *  - payload   = UEA_MULTICALL ‖ abi.encode(Multicall[1..10]) executed by the AGW's CEA
 *  - value     = protocolFee + maxPCForGas, paid from the AGW's PC
 * The destination account is resolved from the AGW, never from the signer.
 * The SDK never writes a gateway allowance on either door: the gateway pulls
 * from an allowance the owner set separately with an ordinary send.
 */
export async function composeOutbound(
  runtime: AgenticRuntime,
  gen: AgenticGeneration,
  wallet: Address,
  params: UniversalExecuteParams,
  opts: { ruleAssets?: readonly Address[]; door: 'owner' | 'agent' }
): Promise<ComposedOutbound> {
  requireCapability(gen.capabilities, AgenticCapability.UNIVERSAL_EVM_OUTBOUND);
  const target = params.to as { address: string; chain: CHAIN };
  const chain = target.chain;
  const info = CHAIN_INFO[chain];
  if (!info) {
    throw new AgenticError(
      AGENTIC_ERROR_CODE.INVALID_RULE,
      `unknown destination chain ${String(chain)}`
    );
  }
  if (info.vm !== VM.EVM) {
    throw capabilityUnavailable(
      AgenticCapability.UNIVERSAL_SVM_RULES,
      'This composer accepts EVM destinations; use the Solana instruction route'
    );
  }
  const funds = params.funds;
  if (funds && isPC20Reference(funds.token)) {
    throw capabilityUnavailable(
      'pc20Outbound',
      'PC20 tokens are not supported through an agentic wallet'
    );
  }
  // An omitted funds.token means the destination chain's native token, as in Route 2.
  const fundsToken: MoveableToken | undefined = funds?.amount
    ? funds.token
      ? resolveR2DestinationFundsToken(
          funds.token as MoveableToken,
          chain,
          runtime.network
        )
      : {
          symbol: 'native',
          decimals: 18,
          address: '0x0000000000000000000000000000000000000000',
          mechanism: 'native',
        }
    : undefined;

  // Burn token and amount, as Route 2 sizes them for an ordinary account.
  let token: Address;
  let amount = BigInt(0);
  if (funds) {
    token = runtime.resolvePrc20(
      funds.token as MoveableToken | undefined,
      chain
    );
    amount = funds.amount;
  } else if ((params.value ?? BigInt(0)) > BigInt(0)) {
    token = runtime.resolvePrc20(undefined, chain);
    amount = params.value as bigint;
  } else if (opts.ruleAssets?.length) {
    token = getAddress(opts.ruleAssets[0]);
  } else {
    token = runtime.resolvePrc20(undefined, chain);
  }
  if (
    opts.ruleAssets &&
    !opts.ruleAssets.some((a) => getAddress(a) === token)
  ) {
    throw new AgenticError(
      AGENTIC_ERROR_CODE.RULE_LIMIT_EXCEEDED,
      `the selected rule does not list asset ${token}`
    );
  }

  const resolved = await runtime.resolveCEA(wallet, chain);
  const cea = getAddress(resolved.cea);
  const calls = destinationCalls(params, { cea, fundsToken });
  if (calls.length === 0) {
    throw new AgenticError(
      AGENTIC_ERROR_CODE.INVALID_RULE,
      'this outbound carries no destination call; parking funds in the wallet’s destination account is not supported',
      {
        hint: 'Name a recipient other than the wallet’s own destination account, or add calldata.',
      }
    );
  }
  if (calls.length > MAX_DESTINATION_CALLS) {
    throw new AgenticError(
      AGENTIC_ERROR_CODE.INVALID_RULE,
      `at most ${MAX_DESTINATION_CALLS} destination calls per outbound`
    );
  }
  if (opts.door === 'agent') {
    const bare = calls.findIndex((c) => (c.data.length - 2) / 2 < 4);
    if (bare >= 0) {
      throw new AgenticError(
        AGENTIC_ERROR_CODE.INVALID_RULE,
        `destination call ${bare} has no function selector; the rules policy only admits allow-listed calls`,
        {
          hint: 'A value-only destination transfer is not representable in an agent rule.',
        }
      );
    }
  }

  const quote = await runtime.quoteOutbound(
    token,
    params.gasLimit ?? BigInt(0),
    chain
  );
  if (quote.nativeValueForGas <= BigInt(0)) {
    throw new AgenticError(
      AGENTIC_ERROR_CODE.INVALID_RULE,
      'outbound gas quote returned zero; URP rejects an uncapped gas swap'
    );
  }
  const maxPCForGas = quote.nativeValueForGas;
  const value = quote.protocolFee + maxPCForGas;
  const payload = concat([
    UEA_MULTICALL_PREFIX,
    encodeAbiParameters(MULTICALL_TUPLE, [calls]),
  ]);
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
    destinationAccountDeployed: resolved.isDeployed,
    token,
    amount,
    value,
    request,
    gatewayCall: { target: gen.addresses.gateway, value, data },
    destinationCalls: calls,
  };
}

/** Outbound encoding plus a diagnostic-only policy preview. */
import { encodeFunctionData, getAddress, type Address, type Hex } from 'viem';
import { UNIVERSAL_GATEWAY_PC } from '../../constants/abi';
import { AGENTIC_ERROR_CODE, AgenticError } from '../errors';
import type { Call, SvmConfigRead } from '../contracts/v5';
import { UINT256_MAX } from '../codec/defaults';
import { UINT64_MAX } from '../codec/svm-terms';
import { validateAgwSvmPayload } from './svm-payload';

export interface SvmOutboundInput {
  wallet: Address;
  gateway: Address;
  token: Address;
  amount: bigint;
  recipient: Hex;
  payload: Hex;
  gasLimit: bigint;
  protocolFee: bigint;
  maxPCForGas: bigint;
}
/** Diagnostic-only local preview; production sends use buildAgwSvmAction. */
export function composeAgwSvmAction(
  input: SvmOutboundInput,
  config: SvmConfigRead,
  nowSeconds: number
): Call {
  function fail(name: string): never {
    throw new AgenticError(AGENTIC_ERROR_CODE.RULE_LIMIT_EXCEEDED, name, {
      details: { contractError: name },
    });
  }
  if (!config.initialized) fail('NotInitialized');
  if (nowSeconds > config.validUntil) fail('RulesExpired');
  for (const [name, value] of Object.entries({
    amount: input.amount,
    gasLimit: input.gasLimit,
    protocolFee: input.protocolFee,
    maxPCForGas: input.maxPCForGas,
  })) {
    if (typeof value !== 'bigint' || value < BigInt(0) || value > UINT256_MAX)
      fail(`${name}OutOfRange`);
  }
  const token = getAddress(input.token),
    cap = config.assets.find((a) => getAddress(a.token) === token);
  if (!cap) fail('AssetNotAllowed');
  if (input.amount > UINT64_MAX) fail('AmountExceedsU64');
  if (input.amount > cap.maxPerCall) fail('AmountExceedsCap');
  if (cap.spent + input.amount > cap.maxTotal) fail('TotalSpendCapExceeded');
  const value = input.protocolFee + input.maxPCForGas;
  if (value > UINT256_MAX || value > config.maxGasPerCall)
    fail('PCValueExceedsCap');
  if (!input.maxPCForGas) fail('UncappedGasSwapRejected');
  validateAgwSvmPayload(config, input.recipient, input.payload);
  return buildAgwSvmAction(input);
}

/** Encode an outbound without evaluating the granted policy; the wallet/URP enforces it. */
export function buildAgwSvmAction(input: SvmOutboundInput): Call {
  for (const [name, value] of Object.entries({
    amount: input.amount,
    gasLimit: input.gasLimit,
    protocolFee: input.protocolFee,
    maxPCForGas: input.maxPCForGas,
  })) {
    if (typeof value !== 'bigint' || value < BigInt(0) || value > UINT256_MAX)
      throw new AgenticError(
        AGENTIC_ERROR_CODE.INVALID_RULE,
        `${name} must fit uint256`
      );
  }
  if (input.amount > UINT64_MAX)
    throw new AgenticError(
      AGENTIC_ERROR_CODE.INVALID_RULE,
      'Solana amount must fit uint64'
    );
  const value = input.protocolFee + input.maxPCForGas;
  if (value > UINT256_MAX || input.maxPCForGas === BigInt(0))
    throw new AgenticError(
      AGENTIC_ERROR_CODE.INVALID_RULE,
      'invalid outbound gas quote'
    );
  const token = getAddress(input.token);
  const request = {
    recipient: input.recipient,
    token,
    amount: input.amount,
    gasLimit: input.gasLimit,
    gasPrice: BigInt(0),
    maxPCForGas: input.maxPCForGas,
    payload: input.payload,
    revertRecipient: getAddress(input.wallet),
  };
  return {
    target: getAddress(input.gateway),
    value,
    data: encodeFunctionData({
      abi: UNIVERSAL_GATEWAY_PC,
      functionName: 'sendUniversalTxOutbound',
      args: [request],
    }),
  };
}

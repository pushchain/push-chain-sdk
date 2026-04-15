import { hexToBytes } from 'viem';
import { encodeSvmExecutePayload } from '../payload-builders';
import { resolveSvmCall } from './resolve';
import type { CHAIN } from '../../constants/enums';
import type { ChainTarget } from '../orchestrator.types';

export interface SvmPayloadBundle {
  svmPayload: `0x${string}`;
  targetBytes: `0x${string}`;
  hasExecute: boolean;
}

export function buildSvmPayloadFromParams(params: {
  data?: `0x${string}` | unknown;
  to: ChainTarget;
  senderUea: `0x${string}`;
}): SvmPayloadBundle {
  const hasExecute =
    typeof params.data === 'string' &&
    params.data.startsWith('0x') &&
    params.data.length > 2;

  if (!hasExecute) {
    return {
      svmPayload: '0x',
      targetBytes: params.to.address,
      hasExecute: false,
    };
  }

  const resolved = resolveSvmCall({
    programAddress: params.to.address,
    data: hexToBytes(params.data as `0x${string}`),
    senderUea: params.senderUea,
    targetChain: params.to.chain as CHAIN,
  });

  const svmPayload = encodeSvmExecutePayload({
    targetProgram: resolved.targetProgram,
    accounts: resolved.accounts,
    ixData: resolved.ixData,
    instructionId: 2,
  });

  return {
    svmPayload,
    targetBytes: resolved.targetProgram,
    hasExecute: true,
  };
}

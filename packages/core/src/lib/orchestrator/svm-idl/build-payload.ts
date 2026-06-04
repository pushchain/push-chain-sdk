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
      targetBytes: params.to.address as `0x${string}`,
      hasExecute: false,
    };
  }

  // `data` is the EVM-oriented calldata field. On an SVM hop it is only a real
  // instruction when it resolves against a registered Anchor IDL (8-byte
  // discriminator + matching instruction). EVM calldata (e.g. a 4-byte selector
  // like `increment()`) is NOT an SVM instruction for the target program — treat
  // it as "no execute" (empty svmPayload), matching the documented behaviour that
  // the `data` field is ignored for SVM chains, rather than throwing mid-prepare.
  //
  // We deliberately only swallow "the data isn't a valid instruction for this
  // program's IDL" (too short / no discriminator match). A "no IDL found" error
  // still throws — that means the caller targeted a program whose IDL was never
  // registered, which is a real configuration mistake they need to see.
  let resolved;
  try {
    resolved = resolveSvmCall({
      programAddress: params.to.address as `0x${string}`,
      data: hexToBytes(params.data as `0x${string}`),
      senderUea: params.senderUea,
      targetChain: params.to.chain as CHAIN,
    });
  } catch (err) {
    if (err instanceof Error && /no IDL found/i.test(err.message)) {
      throw err;
    }
    return {
      svmPayload: '0x',
      targetBytes: params.to.address as `0x${string}`,
      hasExecute: false,
    };
  }

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

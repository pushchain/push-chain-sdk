import type { CHAIN } from '../../constants/enums';
import { resolveSvmCallForCea } from '../../orchestrator/svm-idl/resolve';
import type { SvmTermsWire } from '../codec/svm-terms';
import { svmKey } from '../codec/svm-accounts';
import {
  encodeAgwSvmPayload,
  validateAgwSvmPayload,
  type SvmPayloadAccount,
} from './svm-payload';
import type { Address } from 'viem';

/** Resolve IDL accounts with the wallet authority; granted permissions are checked by URP. */
export function resolveAgwSvmInstruction(
  input: {
    wallet: Address;
    chain: CHAIN;
    program: string;
    instructionData: Uint8Array;
    accounts?: readonly SvmPayloadAccount[];
  },
  terms: SvmTermsWire
) {
  const program = svmKey(input.program);
  if (input.accounts) {
    const payload = encodeAgwSvmPayload(
      program,
      input.accounts,
      input.instructionData
    );
    return {
      recipient: program,
      payload,
      accounts: [...input.accounts],
      instructionData: input.instructionData,
    };
  }
  const resolved = resolveSvmCallForCea(
    {
      programAddress: program,
      data: input.instructionData,
      senderUea: input.wallet,
      targetChain: input.chain,
    },
    terms.expectedCEA
  );
  const payload = encodeAgwSvmPayload(
    resolved.targetProgram,
    resolved.accounts,
    resolved.ixData
  );
  return {
    recipient: program,
    payload,
    accounts: resolved.accounts,
    instructionData: resolved.ixData,
  };
}

/** Diagnostic-only local policy preview. Sends use the resolver and contract enforcement. */
export function prepareAgwSvmInstruction(
  input: Parameters<typeof resolveAgwSvmInstruction>[0],
  terms: SvmTermsWire
) {
  const resolved = resolveAgwSvmInstruction(input, terms);
  validateAgwSvmPayload(terms, resolved.recipient, resolved.payload);
  return resolved;
}

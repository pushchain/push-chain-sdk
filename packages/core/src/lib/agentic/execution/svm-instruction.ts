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

/** Existing IDL encoding, with the wallet's authority and strict policy checks. */
export function prepareAgwSvmInstruction(
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
    validateAgwSvmPayload(terms, program, payload);
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
  validateAgwSvmPayload(terms, program, payload);
  return {
    recipient: program,
    payload,
    accounts: resolved.accounts,
    instructionData: resolved.ixData,
  };
}

/** Parser/validator for the deployed S12–S18 instruction grammar. */
import { bytesToHex, hexToBytes, type Hex } from 'viem';
import { encodeSvmExecutePayload } from '../../orchestrator/payload-builders';
import { AGENTIC_ERROR_CODE, AgenticError } from '../errors';
import {
  exactHex,
  isForbiddenSvmProgram,
  SVM_LIMITS,
  SvmDataPinMode,
  type SvmTermsWire,
} from '../codec/svm-terms';

export interface SvmPayloadAccount {
  pubkey: Hex;
  isWritable: boolean;
}
export interface ParsedSvmPayload {
  program: Hex;
  accounts: (SvmPayloadAccount & { writableFlag: number })[];
  instructionData: Uint8Array;
}
function fail(name: string): never {
  throw new AgenticError(AGENTIC_ERROR_CODE.INVALID_RULE, name, {
    details: { contractError: name },
  });
}
export function parseAgwSvmPayload(payload: Hex): ParsedSvmPayload {
  if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(payload)) fail('MalformedSvmPayload');
  const bytes = hexToBytes(payload);
  if (!bytes.length) fail('SvmPayloadEmpty');
  if (bytes.length < 41) fail('MalformedSvmPayload');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    count = view.getUint32(0, false);
  if (count > SVM_LIMITS.accounts) fail('SvmAccountsOutOfRange');
  const lenOffset = 4 + count * 33;
  if (bytes.length < lenOffset + 4) fail('MalformedSvmPayload');
  const length = view.getUint32(lenOffset, false);
  if (length > SVM_LIMITS.ixData) fail('SvmIxDataTooLong');
  const dataOffset = lenOffset + 4;
  if (bytes.length !== dataOffset + length + 33) fail('MalformedSvmPayload');
  if (bytes[dataOffset + length] !== 2) fail('SvmInstructionNotExecute');
  const accounts = Array.from({ length: count }, (_, i) => {
    const offset = 4 + i * 33,
      writableFlag = bytes[offset + 32];
    // URP does not judge this flag. Preserve the raw value for diagnostics.
    return {
      pubkey: bytesToHex(bytes.slice(offset, offset + 32)),
      isWritable: writableFlag === 1,
      writableFlag,
    };
  });
  return {
    program: bytesToHex(bytes.slice(dataOffset + length + 1)),
    accounts,
    instructionData: bytes.slice(dataOffset, dataOffset + length),
  };
}
export function encodeAgwSvmPayload(
  program: Hex,
  accounts: readonly SvmPayloadAccount[],
  instructionData: Uint8Array
): Hex {
  exactHex(program, 32, 'target program');
  if (accounts.length > SVM_LIMITS.accounts) fail('SvmAccountsOutOfRange');
  if (instructionData.length > SVM_LIMITS.ixData) fail('SvmIxDataTooLong');
  accounts.forEach((a) => {
    exactHex(a.pubkey, 32, 'account');
    if (typeof a.isWritable !== 'boolean') fail('MalformedSvmPayload');
  });
  return encodeSvmExecutePayload({
    targetProgram: program,
    accounts: [...accounts],
    ixData: instructionData,
    instructionId: 2,
  });
}
function uintLE(data: Uint8Array): bigint {
  return data.reduceRight((v, b) => (v << BigInt(8)) + BigInt(b), BigInt(0));
}
/** Terms must have passed grant-shape validation. On-chain URP remains the enforcement authority. */
export function validateAgwSvmPayload(
  terms: SvmTermsWire,
  recipient: Hex,
  payload: Hex
): number {
  exactHex(recipient, 32, 'recipient');
  if (BigInt(recipient) === BigInt(0)) fail('RecipientNotPubkey');
  const v = parseAgwSvmPayload(payload),
    data = v.instructionData;
  if (v.program.toLowerCase() !== recipient.toLowerCase())
    fail('RecipientTargetMismatch');
  if (isForbiddenSvmProgram(v.program, terms)) fail('ForbiddenTargetProgram');
  const rule = terms.programs.findIndex(
    (p) =>
      p.program.toLowerCase() === v.program.toLowerCase() &&
      (p.dataless
        ? data.length === 0
        : data.length >= p.discriminatorLen &&
          bytesToHex(data.slice(0, p.discriminatorLen)).toLowerCase() ===
            p.discriminator.slice(0, 2 + p.discriminatorLen * 2).toLowerCase())
  );
  if (rule < 0) fail('ProgramNotAllowed');
  const fixed = terms.programs[rule].maxAccounts;
  if (fixed && fixed !== v.accounts.length) fail('SvmAccountCountMismatch');
  const pins = terms.pins.filter((p) => p.ruleIndex === rule);
  for (const p of pins) {
    if (p.accountIndex >= v.accounts.length) fail('SvmAccountCountBelowPin');
    if (
      v.accounts[p.accountIndex].pubkey.toLowerCase() !==
      p.expected.toLowerCase()
    )
      fail('SvmAccountPinMismatch');
  }
  function field(fromEnd: boolean, offset: number, len: number): Uint8Array {
    const start = fromEnd ? data.length - offset : offset;
    if (start < 0 || start + len > data.length) fail('SvmDataTooShortForPin');
    return data.slice(start, start + len);
  }
  for (const p of terms.dataPins.filter((p) => p.ruleIndex === rule)) {
    const a = field(p.fromEnd, p.offset, p.len);
    if (p.mode === SvmDataPinMode.EQ) {
      if (
        bytesToHex(a).toLowerCase() !==
        p.expected.slice(0, 2 + p.len * 2).toLowerCase()
      )
        fail('SvmDataPinMismatch');
    } else if (p.mode === SvmDataPinMode.GTE_LE) {
      if (uintLE(a) < BigInt(p.expected)) fail('SvmDataFloorNotMet');
    } else if (p.mode === SvmDataPinMode.LTE_LE) {
      if (uintLE(a) > BigInt(p.expected)) fail('SvmDataCeilingExceeded');
    } else if (
      uintLE(a) * p.den <
      uintLE(field(p.fromEnd, p.offsetB, p.len)) * p.num
    )
      fail('SvmDataRatioNotMet');
  }
  const protectedKeys = new Set(terms.ceaAccounts.map((k) => k.toLowerCase()));
  v.accounts.forEach((a, i) => {
    if (
      protectedKeys.has(a.pubkey.toLowerCase()) &&
      !pins.some((p) => p.accountIndex === i)
    )
      fail('CeaAccountAtUnpinnedIndex');
  });
  return rule;
}

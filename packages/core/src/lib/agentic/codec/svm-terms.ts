/** Internal v4 SVM wire representation; not a proposed public Rule API. */
import {
  decodeAbiParameters,
  encodeAbiParameters,
  isAddress,
  type Hex,
} from 'viem';
import { AGENTIC_ERROR_CODE, AgenticError } from '../errors';
import { UINT256_MAX } from './defaults';
import type { AssetCapWire } from './universal-terms';

export enum SvmDataPinMode {
  EQ,
  GTE_LE,
  LTE_LE,
  RATIO_GTE_LE,
}
export interface AllowedProgramWire {
  program: Hex;
  discriminator: Hex;
  discriminatorLen: number;
  dataless: boolean;
  maxAccounts: number;
}
export interface SvmAccountPinWire {
  ruleIndex: number;
  accountIndex: number;
  expected: Hex;
}
export interface SvmDataPinWire {
  ruleIndex: number;
  fromEnd: boolean;
  offset: number;
  offsetB: number;
  len: number;
  mode: SvmDataPinMode;
  expected: Hex;
  num: bigint;
  den: bigint;
}
export interface SvmTermsWire {
  validUntil: number;
  expectedCEA: Hex;
  gatewayProgram: Hex;
  assets: readonly AssetCapWire[];
  maxGasPerCall: bigint;
  ceaAccounts: readonly Hex[];
  programs: readonly AllowedProgramWire[];
  pins: readonly SvmAccountPinWire[];
  dataPins: readonly SvmDataPinWire[];
}
export const SVM_LIMITS = {
  assets: 8,
  programs: 32,
  pins: 16,
  dataPins: 8,
  ceaAccounts: 16,
  accounts: 64,
  ixData: 1024,
} as const;
export const UINT64_MAX = BigInt(2) ** BigInt(64) - BigInt(1);
export const FORBIDDEN_SVM_PROGRAMS: readonly Hex[] = [
  `0x${'00'.repeat(32)}`,
  '0x06ddf6e1d765a193d9cbe146ceeb79ac1cb485ed5f5b37913a8cf5857eff00a9',
  '0x06ddf6e1ee758fde18425dbce46ccddab61afc4d83b90d27febdf928d8a18bfc',
  '0x06a1d8179137542a983437bdfe2a7ab2557f535c8a78722b68a49dc000000000',
  '0x02a8f6914e88a1b0e210153ef763ae2b00c2b93d16c124d2c0537a1004800000',
  '0x0277a6af97339b7ac88d1892c90446f50002309266f62e53c118244982000000',
];
export const SVM_TERMS_PARAM = {
  type: 'tuple',
  components: [
    { name: 'validUntil', type: 'uint48' },
    { name: 'expectedCEA', type: 'bytes32' },
    { name: 'gatewayProgram', type: 'bytes32' },
    {
      name: 'assets',
      type: 'tuple[]',
      components: [
        { name: 'token', type: 'address' },
        { name: 'maxPerCall', type: 'uint256' },
        { name: 'maxTotal', type: 'uint256' },
      ],
    },
    { name: 'maxGasPerCall', type: 'uint256' },
    { name: 'ceaAccounts', type: 'bytes32[]' },
    {
      name: 'programs',
      type: 'tuple[]',
      components: [
        { name: 'program', type: 'bytes32' },
        { name: 'discriminator', type: 'bytes8' },
        { name: 'discriminatorLen', type: 'uint8' },
        { name: 'dataless', type: 'bool' },
        { name: 'maxAccounts', type: 'uint8' },
      ],
    },
    {
      name: 'pins',
      type: 'tuple[]',
      components: [
        { name: 'ruleIndex', type: 'uint8' },
        { name: 'accountIndex', type: 'uint8' },
        { name: 'expected', type: 'bytes32' },
      ],
    },
    {
      name: 'dataPins',
      type: 'tuple[]',
      components: [
        { name: 'ruleIndex', type: 'uint8' },
        { name: 'fromEnd', type: 'bool' },
        { name: 'offset', type: 'uint16' },
        { name: 'offsetB', type: 'uint16' },
        { name: 'len', type: 'uint8' },
        { name: 'mode', type: 'uint8' },
        { name: 'expected', type: 'bytes32' },
        { name: 'num', type: 'uint64' },
        { name: 'den', type: 'uint64' },
      ],
    },
  ],
} as const;

export function svmInvalid(message: string): AgenticError {
  return new AgenticError(AGENTIC_ERROR_CODE.INVALID_RULE, message);
}
export function exactHex(
  value: unknown,
  bytes: number,
  field: string
): asserts value is Hex {
  if (
    typeof value !== 'string' ||
    !new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`).test(value)
  )
    throw svmInvalid(`${field} must contain exactly ${bytes} bytes`);
}
function integer(value: number, max: number, field: string) {
  if (!Number.isInteger(value) || value < 0 || value > max)
    throw svmInvalid(`${field} is out of range`);
}
function uint(value: bigint, max: bigint, field: string) {
  if (typeof value !== 'bigint' || value < BigInt(0) || value > max)
    throw svmInvalid(`${field} is out of range`);
}
export function isForbiddenSvmProgram(
  program: Hex,
  terms: Pick<SvmTermsWire, 'expectedCEA' | 'gatewayProgram'>
): boolean {
  return [
    ...FORBIDDEN_SVM_PROGRAMS,
    terms.gatewayProgram,
    terms.expectedCEA,
  ].some((x) => x.toLowerCase() === program.toLowerCase());
}
function offsetValid(fromEnd: boolean, offset: number, len: number): boolean {
  return fromEnd
    ? offset >= len && offset <= SVM_LIMITS.ixData
    : offset + len <= SVM_LIMITS.ixData;
}

/** Grant-time structural rules. Chain/token/mint correctness requires resolved on-chain inputs. */
export function validateSvmTerms(t: SvmTermsWire, nowSeconds: number): void {
  integer(t.validUntil, 2 ** 48 - 1, 'validUntil');
  if (t.validUntil <= nowSeconds)
    throw svmInvalid('validUntil must be in the future');
  exactHex(t.expectedCEA, 32, 'expectedCEA');
  exactHex(t.gatewayProgram, 32, 'gatewayProgram');
  if (
    BigInt(t.expectedCEA) === BigInt(0) ||
    BigInt(t.gatewayProgram) === BigInt(0)
  )
    throw svmInvalid('CEA/gateway cannot be zero');
  uint(t.maxGasPerCall, UINT256_MAX, 'maxGasPerCall');
  if (!t.assets.length || t.assets.length > SVM_LIMITS.assets)
    throw svmInvalid('assets must contain 1..8 entries');
  const tokens = new Set<string>();
  for (const a of t.assets) {
    if (!isAddress(a.token, { strict: false }) || BigInt(a.token) === BigInt(0))
      throw svmInvalid('asset token must be a non-zero PRC20');
    if (tokens.has(a.token.toLowerCase())) throw svmInvalid('duplicate asset');
    tokens.add(a.token.toLowerCase());
    uint(a.maxPerCall, UINT256_MAX, 'maxPerCall');
    uint(a.maxTotal, UINT256_MAX, 'maxTotal');
  }
  if (!t.programs.length || t.programs.length > SVM_LIMITS.programs)
    throw svmInvalid('programs must contain 1..32 entries');
  t.programs.forEach((r, i) => {
    exactHex(r.program, 32, 'program');
    exactHex(r.discriminator, 8, 'discriminator');
    if (typeof r.dataless !== 'boolean')
      throw svmInvalid('dataless must be boolean');
    integer(r.discriminatorLen, 8, 'discriminatorLen');
    integer(r.maxAccounts, SVM_LIMITS.accounts, 'maxAccounts');
    if (r.dataless !== (r.discriminatorLen === 0))
      throw svmInvalid('dataless and discriminator length disagree');
    if (isForbiddenSvmProgram(r.program, t))
      throw svmInvalid('forbidden program');
    for (const earlier of t.programs.slice(0, i)) {
      if (earlier.program.toLowerCase() !== r.program.toLowerCase()) continue;
      const overlap =
        earlier.dataless || r.dataless
          ? earlier.dataless && r.dataless
          : earlier.discriminator
              .slice(
                0,
                2 + 2 * Math.min(earlier.discriminatorLen, r.discriminatorLen)
              )
              .toLowerCase() ===
            r.discriminator
              .slice(
                0,
                2 + 2 * Math.min(earlier.discriminatorLen, r.discriminatorLen)
              )
              .toLowerCase();
      if (overlap)
        throw svmInvalid('ambiguous instruction discriminator prefixes');
    }
  });
  if (t.pins.length > SVM_LIMITS.pins)
    throw svmInvalid('too many account pins');
  const positions = new Set<string>(),
    covered = new Set<number>();
  for (const p of t.pins) {
    integer(p.ruleIndex, t.programs.length - 1, 'pin ruleIndex');
    integer(p.accountIndex, SVM_LIMITS.accounts - 1, 'accountIndex');
    exactHex(p.expected, 32, 'pin expected');
    const count = t.programs[p.ruleIndex].maxAccounts;
    if (count && p.accountIndex >= count)
      throw svmInvalid('pin outside fixed account count');
    const key = `${p.ruleIndex}:${p.accountIndex}`;
    if (positions.has(key)) throw svmInvalid('duplicate account pin');
    positions.add(key);
    covered.add(p.ruleIndex);
  }
  if (covered.size !== t.programs.length)
    throw svmInvalid('every program rule needs an account pin');
  if (t.dataPins.length > SVM_LIMITS.dataPins)
    throw svmInvalid('too many data pins');
  for (const p of t.dataPins) {
    integer(p.ruleIndex, t.programs.length - 1, 'data pin ruleIndex');
    integer(p.mode, 3, 'data pin mode');
    integer(p.len, p.mode === SvmDataPinMode.EQ ? 32 : 8, 'data pin len');
    integer(p.offset, 65535, 'offset');
    integer(p.offsetB, 65535, 'offsetB');
    exactHex(p.expected, 32, 'data pin expected');
    uint(p.num, UINT64_MAX, 'num');
    uint(p.den, UINT64_MAX, 'den');
    if (
      typeof p.fromEnd !== 'boolean' ||
      !p.len ||
      t.programs[p.ruleIndex].dataless ||
      !offsetValid(p.fromEnd, p.offset, p.len)
    )
      throw svmInvalid('invalid data pin shape');
    if (
      p.mode === SvmDataPinMode.EQ &&
      !/^0*$/.test(p.expected.slice(2 + p.len * 2))
    )
      throw svmInvalid('EQ expected must be left-aligned');
    if (
      (p.mode === SvmDataPinMode.GTE_LE || p.mode === SvmDataPinMode.LTE_LE) &&
      BigInt(p.expected) >= BigInt(1) << BigInt(p.len * 8)
    )
      throw svmInvalid('integer expected exceeds field width');
    if (
      p.mode === SvmDataPinMode.RATIO_GTE_LE &&
      (!p.num || !p.den || !offsetValid(p.fromEnd, p.offsetB, p.len))
    )
      throw svmInvalid('invalid ratio pin');
  }
  if (t.ceaAccounts.length > SVM_LIMITS.ceaAccounts)
    throw svmInvalid('too many CEA accounts');
  const accounts = new Set<string>();
  for (const key of t.ceaAccounts) {
    exactHex(key, 32, 'CEA account');
    if (
      BigInt(key) === BigInt(0) ||
      accounts.has(key.toLowerCase()) ||
      t.programs.some((p) => p.program.toLowerCase() === key.toLowerCase())
    )
      throw svmInvalid('invalid CEA account list');
    accounts.add(key.toLowerCase());
  }
  if (!accounts.has(t.expectedCEA.toLowerCase()))
    throw svmInvalid('CEA account list must include expectedCEA');
}
export function encodeSvmTerms(terms: SvmTermsWire, nowSeconds: number): Hex {
  validateSvmTerms(terms, nowSeconds);
  return encodeAbiParameters([SVM_TERMS_PARAM], [terms]);
}
export function decodeSvmTerms(body: Hex): SvmTermsWire {
  try {
    return decodeAbiParameters([SVM_TERMS_PARAM], body)[0];
  } catch (cause) {
    throw new AgenticError(
      AGENTIC_ERROR_CODE.RULE_READ_FAILED,
      'malformed SVM terms',
      { cause }
    );
  }
}

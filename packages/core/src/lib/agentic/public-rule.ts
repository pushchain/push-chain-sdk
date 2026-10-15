import {
  UNLIMITED_CALLS,
  ANY_ACCOUNT_COUNT,
  type ArgPinWire,
} from './codec/pins';
/** Public section-6 rule normalization into the deployed v6 wire model. */
import type { Idl } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';
import {
  getAddress,
  hexToBytes,
  isAddress,
  isHex,
  numberToHex,
  sha256,
  toHex,
  type Address,
  type Hex,
} from 'viem';
import type {
  Rule,
  RuleInput,
  InternalRule,
  NativeAction,
  SolanaRule,
  UniversalRule,
  Pin,
} from './agentic.types';
import {
  AGENTIC_ERROR_CODE,
  AgenticError,
  capabilityUnavailable,
} from './errors';
import { parseSelector } from './codec/selectors';
import { argumentOffset, encodeArgWord, headSize } from './codec/abi-layout';
import { UINT256_MAX } from './codec/defaults';
import { deriveAgwSvmCea, svmKey } from './codec/svm-accounts';
import type { AgenticRuntime } from './runtime';
import { CHAIN } from '../constants/enums';

export const WALLET = 'agentic:wallet' as const;
const PUBLIC_INPUT = Symbol('AGW public rule');
/** Mark authored inputs for normalization after the wallet address is fixed. */
export function publicRules(rules: readonly RuleInput[]): InternalRule[] {
  if (!Array.isArray(rules)) throw invalid('rules must be an array');
  return rules.map((rule) => {
    if (!rule || typeof rule !== 'object')
      throw invalid('rule must be an object');
    return { ...rule, [PUBLIC_INPUT]: true } as unknown as InternalRule;
  });
}
export function isPublicRule(rule: InternalRule): boolean {
  return !!rule && !!(rule as unknown as Record<symbol, unknown>)[PUBLIC_INPUT];
}
function invalid(message: string) {
  return new AgenticError(AGENTIC_ERROR_CODE.INVALID_RULE, message);
}
function rejectFields(obj: object, fields: string[], where: string) {
  for (const field of fields)
    if (field in obj)
      throw invalid(
        `${where}.${field} is not supported by the current rule shape`
      );
}
function uint(value: unknown, name: string): bigint {
  if (typeof value !== 'bigint' || value < BigInt(0) || value > UINT256_MAX)
    throw invalid(`${name} must be a uint256 bigint`);
  return value;
}
export function evmPinOffset(
  selector: Rule['allowedCalls'][number]['selector'],
  arg: number
): number {
  if (!Number.isInteger(arg) || arg < 0 || 4 + 32 * arg + 32 > 65535)
    throw invalid('pin arg is outside the supported calldata range');
  const parsed = parseSelector(selector);
  if (parsed.valueOnly)
    throw invalid('value-only calls cannot have argument pins');
  if (!parsed.inputs) return 4 + 32 * arg;
  if (parsed.inputs.slice(0, arg).some((p) => headSize(p) !== 32))
    throw capabilityUnavailable(
      'argumentLayout',
      'pins after multi-word tuple/array arguments need an explicit lossless index convention'
    );
  return argumentOffset(parsed.inputs, arg, 'pin');
}
function expectedWord(
  selector: Rule['allowedCalls'][number]['selector'],
  arg: number,
  value: unknown
): Hex {
  const parsed = parseSelector(selector);
  if (parsed.inputs)
    return encodeArgWord(parsed.inputs[arg], value as Hex | bigint, 'pin');
  if (typeof value === 'bigint')
    return numberToHex(uint(value, 'pin.expected'), { size: 32 });
  if (typeof value === 'string' && isAddress(value, { strict: false }))
    return `0x${value.slice(2).padStart(64, '0')}`.toLowerCase() as Hex;
  if (typeof value === 'string' && isHex(value) && value.length === 66)
    return value.toLowerCase() as Hex;
  throw invalid(
    'a raw EVM selector needs an address, uint256 or exact 32-byte expected word'
  );
}
export async function normalizePublicRule(
  input: InternalRule,
  wallet: Address,
  runtime: AgenticRuntime
): Promise<InternalRule> {
  const rule = input as unknown as RuleInput;
  if ('format' in rule && rule.format === 'decoded') return input;
  const r = rule as Rule;
  rejectFields(
    r,
    [
      'target',
      'selector',
      'actions',
      'pins',
      'amount',
      'maxCalls',
      'maxValuePerCall',
      'maxValueTotal',
      'ref',
      'allowedInstructions',
      'outputTokens',
    ],
    'rule'
  );
  if (
    !Number.isSafeInteger(r.validUntil) ||
    r.validUntil <= runtime.nowSeconds() ||
    r.validUntil >= 2 ** 48
  )
    throw invalid('validUntil must be a future uint48 timestamp');
  if (
    !Array.isArray(r.allowedCalls) ||
    r.allowedCalls.length < 1 ||
    r.allowedCalls.length > 32
  )
    throw invalid('allowedCalls must contain 1..32 calls');
  for (const c of r.allowedCalls) {
    if (!c || typeof c !== 'object')
      throw invalid('allowedCall must be an object');
    rejectFields(
      c,
      [
        'beneficiary',
        'beneficiaryOffset',
        'amount',
        'maxCalls',
        'maxValuePerCall',
        'maxValueTotal',
        'validUntil',
      ],
      'allowedCall'
    );
    uint(c.maxValue ?? BigInt(0), 'allowedCall.maxValue');
    if (c.pins !== undefined && !Array.isArray(c.pins))
      throw invalid('pins must be an array');
    for (const pin of c.pins ?? []) {
      if (!pin || typeof pin !== 'object')
        throw invalid('pin must be an object');
      rejectFields(pin, ['offset', 'min'], 'pin');
      if ('token' in pin && (!('account' in pin) || pin.expected !== WALLET))
        throw invalid('token is only valid on a WALLET account pin');
      if ('arg' in pin === 'account' in pin)
        throw invalid('pin must identify exactly one arg or account');
      if ('expected' in pin === 'max' in pin)
        throw invalid('pin must specify exactly one expected or max');
    }
  }
  if (r.chainNamespace?.startsWith('solana:')) {
    const { svmMetadata } = await import('./management/svm-public');
    const gateway = await svmMetadata(runtime).gateway(
      r.chainNamespace as `solana:${string}`
    );
    if (gateway.chainNamespace !== r.chainNamespace)
      throw invalid('gateway registry cluster mismatch');
    return svmRule(r, deriveAgwSvmCea(wallet, gateway.program).address);
  }
  const native = r.chainNamespace === undefined;
  if (r.chainNamespace === runtime.pushChainNamespace)
    throw invalid('omit chainNamespace for Push rules');
  if (native && r.allowedCalls.length > 8)
    throw capabilityUnavailable(
      'nativeActions',
      'the deployed v6 wallet permits at most eight native actions'
    );
  if (native && (r.assets !== undefined || r.maxGasPerCall !== undefined))
    throw invalid('native rules do not carry assets or maxGasPerCall');
  const own = native
    ? wallet
    : getAddress(
        (await runtime.resolveCEA(wallet, r.chainNamespace as CHAIN)).cea
      );
  const nativeActions: NativeAction[] = [];
  const calls: UniversalRule['allowedCalls'] = [];
  for (const call of r.allowedCalls) {
    const pins = call.pins ?? [];
    const wirePins: ArgPinWire[] = [];
    const occupied = new Set<number>();
    for (const pin of pins) {
      if ('account' in pin) throw invalid('account pins only apply to Solana');
      const offset = evmPinOffset(call.selector, pin.arg);
      if (occupied.has(offset)) throw invalid('duplicate pin argument');
      occupied.add(offset);
      wirePins.push({
        offset,
        op: 'max' in pin ? 1 : 0,
        value:
          'max' in pin
            ? numberToHex(uint(pin.max, 'pin.max'), { size: 32 })
            : expectedWord(
                call.selector,
                pin.arg,
                pin.expected === WALLET ? own : pin.expected
              ),
      });
    }
    if (native)
      nativeActions.push({
        target: getAddress(call.target),
        selector: call.selector,
        wirePins,
        maxValuePerCall: call.maxValue ?? BigInt(0),
        maxValueTotal: UINT256_MAX,
        maxCalls: UNLIMITED_CALLS,
      });
    else
      calls.push({
        target: getAddress(call.target),
        selector:
          call.selector as UniversalRule['allowedCalls'][number]['selector'],
        pins: wirePins,
        maxValue: call.maxValue ?? BigInt(0),
      });
  }
  if (native)
    return { agent: r.agent, validUntil: r.validUntil, actions: nativeActions };
  return {
    agent: r.agent,
    validUntil: r.validUntil,
    chainNamespace: r.chainNamespace as `eip155:${string}`,
    assets: (r.assets ?? []).map((a) => ({
      ...a,
      token: a.token as Address,
      maxTotal: a.maxTotal ?? BigInt(0),
    })),
    maxGasPerCall: r.maxGasPerCall ?? BigInt(0),
    allowedCalls: calls,
  };
}

function svmType(
  text: string
): Idl['instructions'][number]['args'][number]['type'] {
  const array = text.match(/^(.+)\[(\d+)\]$/);
  if (array) {
    const count = Number(array[2]);
    if (!Number.isSafeInteger(count) || count < 1 || count > 128)
      throw invalid('unsupported SVM fixed array size');
    return { array: [svmType(array[1]), count] };
  }
  if (
    [
      'u8',
      'u16',
      'u32',
      'u64',
      'i8',
      'i16',
      'i32',
      'i64',
      'bool',
      'pubkey',
    ].includes(text)
  )
    return text as 'u64';
  if (text === 'publicKey') return 'pubkey';
  throw capabilityUnavailable(
    'svmArgumentLayout',
    `unsupported fixed-size Solana type ${text}`
  );
}
function svmRule(rule: Rule, cea: Hex): SolanaRule {
  return {
    agent: rule.agent,
    validUntil: rule.validUntil,
    chainNamespace: rule.chainNamespace as `solana:${string}`,
    outputTokens: [
      ...new Set(
        rule.allowedCalls.flatMap((c) =>
          (c.pins ?? []).flatMap((p) =>
            'account' in p && 'token' in p && p.expected === WALLET && p.token
              ? [typeof p.token === 'string' ? p.token : p.token.address]
              : []
          )
        )
      ),
    ],
    assets: (rule.assets ?? []).map((asset) => ({
      ...asset,
      maxTotal: asset.maxTotal ?? BigInt(0),
    })),
    maxGasPerCall: rule.maxGasPerCall ?? BigInt(0),
    allowedInstructions: rule.allowedCalls.map((call) => {
      if ((call.maxValue ?? BigInt(0)) !== BigInt(0))
        throw capabilityUnavailable(
          'svmCallValue',
          'native Solana instruction value is governed by its transfer/pin, not an EVM call value'
        );
      const full = String(call.selector).match(
        /^([A-Za-z_][A-Za-z0-9_]*)\((.*)\)$/
      );
      const raw = /^0x[0-9a-fA-F]{16}$/.test(call.selector);
      if (!full && !raw)
        throw invalid(
          'Solana selector needs a fixed-width signature or eight-byte discriminator'
        );
      const types =
        full && full[2] ? full[2].split(',').map((s) => svmType(s.trim())) : [];
      const name = full?.[1] ?? 'raw';
      const discriminator = raw
        ? hexToBytes(call.selector as Hex)
        : hexToBytes(
            sha256(
              toHex(
                `global:${name
                  .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
                  .toLowerCase()}`
              )
            )
          ).slice(0, 8);
      const pins = call.pins ?? [];
      const accounts = pins.filter(
        (p): p is Extract<Pin, { account: number }> => 'account' in p
      );
      if (
        accounts.some(
          (p) =>
            !Number.isInteger(p.account) || p.account < 0 || p.account >= 64
        )
      )
        throw invalid('Solana account position must be 0..63');
      const accountCount = Math.max(0, ...accounts.map((p) => p.account + 1));
      const idl: Idl = {
        address: new PublicKey(hexToBytes(svmKey(call.target))).toBase58(),
        metadata: { name: 'rule_layout', version: '1', spec: '0.1.0' },
        instructions: [
          {
            name,
            discriminator: Array.from(discriminator),
            accounts: Array.from({ length: accountCount }, (_, i) => ({
              name: `account${i}`,
            })),
            args: types.map((type, i) => ({ name: `arg${i}`, type })),
          },
        ],
      };
      return {
        maxAccounts: ANY_ACCOUNT_COUNT,
        program: call.target,
        instruction: { idl, name },
        accounts: accounts.map((p) => ({
          name: `account${p.account}`,
          expected:
            p.expected === WALLET
              ? p.token
                ? {
                    kind: 'walletATA' as const,
                    token:
                      typeof p.token === 'string' ? p.token : p.token.address,
                  }
                : { kind: 'walletCEA' as const }
              : { kind: 'address' as const, address: p.expected },
        })),
        fields: pins
          .filter((p) => 'arg' in p)
          .map((p) => {
            const arg = (p as { arg: number }).arg;
            if (!Number.isInteger(arg) || arg < 0 || arg >= types.length)
              throw capabilityUnavailable(
                'svmArgumentLayout',
                'argument pins need a signature with the indexed argument type; use decoded raw constraints for stored rules'
              );
            if ('max' in p)
              return { name: `arg${arg}`, max: uint(p.max, 'pin.max') };
            const rawExpected = (p as { expected: string | bigint }).expected;
            const eq = rawExpected === WALLET ? cea : rawExpected;
            return {
              name: `arg${arg}`,
              equals:
                typeof eq === 'bigint'
                  ? eq
                  : /^0x/.test(eq)
                  ? (eq as Hex)
                  : svmKey(eq),
            };
          }),
      };
    }),
  };
}

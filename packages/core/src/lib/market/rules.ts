import {
  decodeAbiParameters,
  encodeAbiParameters,
  getAddress,
  isAddress,
  keccak256,
  stringToHex,
  toHex,
  type Address,
  type Hex,
} from 'viem';
import type { MoveableToken } from '../constants/tokens';
import { CHAIN, PUSH_NETWORK } from '../constants/enums';
import { getPRC20Address } from '../universal/prc20-address';
import { argumentLocation, encodeArgWord } from '../agentic/codec/abi-layout';
import { parseSelector } from '../agentic/codec/selectors';
import { validatePins } from '../agentic/codec/pins';
import {
  UNIVERSAL_TERMS_PARAM,
  type AssetCapWire,
  type AllowedCallWire,
  type UniversalTermsWire,
} from '../agentic/codec/universal-terms';
import type {
  ArgumentPath,
  WalletMarker,
  Selector,
} from '../agentic/agentic.types';
import type { PrincipalMarker } from '../job-spec/types';
import { PRINCIPAL } from '../job-spec/constants';
import { MarketError } from './errors';

export type MarketAssetToken = MoveableToken | string | { prc20: Address };
export type MarketPin =
  | {
      arg: ArgumentPath;
      expected:
        | Hex
        | Address
        | bigint
        | boolean
        | WalletMarker
        | PrincipalMarker;
      max?: never;
    }
  | { arg: ArgumentPath; max: bigint | PrincipalMarker; expected?: never };
export interface AgentCardRule {
  chain: string;
  assets: {
    token: MarketAssetToken;
    maxPerCall: bigint | PrincipalMarker;
    maxTotal?: bigint | PrincipalMarker;
  }[];
  maxGasPerCall: bigint;
  allowedCalls: {
    target: Address;
    selector: string;
    pins?: MarketPin[];
    maxValue?: bigint;
  }[];
}
export type AgentCardRules = AgentCardRule[];
export interface CardRuleWire {
  chainNamespace: string;
  terms: UniversalTermsWire;
}
export type CardRulesWire = CardRuleWire[];
interface LegWire {
  assets: readonly AssetCapWire[];
  principalAsset: number;
  maxGasPerCall: bigint;
  allowedCalls: readonly AllowedCallWire[];
}
export const MARKER_WALLET = keccak256(
  stringToHex('push.marketplace.marker.WALLET')
);
export const MARKER_PRINCIPAL = keccak256(
  stringToHex('push.marketplace.marker.PRINCIPAL')
);
const PRINCIPAL_WORD = BigInt(MARKER_PRINCIPAL);
const decodedRules = new WeakMap<
  AgentCardRule,
  { fingerprint: string; wire: LegWire }
>();
const fingerprint = (r: AgentCardRule) =>
  JSON.stringify(r, (_, v) => (typeof v === 'bigint' ? v.toString() : v));
const fields = UNIVERSAL_TERMS_PARAM.components;
export const CARD_RULES_PARAM = {
  type: 'tuple[]',
  components: [
    { name: 'chainNamespace', type: 'string' },
    { ...UNIVERSAL_TERMS_PARAM, name: 'terms' },
  ],
} as const;
const bad = (message: string): never => {
  throw new MarketError('INVALID_AGENT_CARD_RULES', message);
};
function cap(n: bigint | PrincipalMarker | undefined): bigint {
  const v = n === PRINCIPAL ? PRINCIPAL_WORD : n ?? BigInt(0);
  if (typeof v !== 'bigint' || v < BigInt(0) || v >= BigInt(1) << BigInt(256))
    bad('Spending caps must fit uint256.');
  return v;
}
function toWire(
  input: AgentCardRule,
  options?: { chain?: string; network?: PUSH_NETWORK; structural?: boolean }
): LegWire {
  if (
    !input ||
    !Array.isArray(input.assets) ||
    !Array.isArray(input.allowedCalls)
  )
    bad('Card rules need assets and allowedCalls arrays.');
  const saved = decodedRules.get(input);
  if (saved?.fingerprint === fingerprint(input)) return saved.wire;
  if ('approvals' in input)
    bad(
      'V2 approvals belong in allowedCalls with spender and amount pins; remove the retired approvals array.'
    );
  if (
    input.assets.some(
      (a) =>
        typeof a.token === 'object' &&
        'prc20' in a.token &&
        /^0x0{40}$/i.test(a.token.prc20)
    )
  )
    bad('An explicit PRC20 reference cannot be zero.');
  const assets = input.assets.map((a) => ({
    token:
      typeof a.token === 'object' && 'prc20' in a.token
        ? getAddress(a.token.prc20)
        : (() => {
            if (options?.structural)
              return getAddress(
                typeof a.token === 'string' ? a.token : a.token.address
              );
            if (!options?.chain)
              return bad(
                'Encoding destination tokens needs the card chain, or an explicit { prc20 } reference.'
              );
            try {
              return getPRC20Address(
                {
                  chain: options.chain as CHAIN,
                  address:
                    typeof a.token === 'string' ? a.token : a.token.address,
                },
                { network: options.network ?? PUSH_NETWORK.TESTNET_DONUT }
              ).address as Address;
            } catch (cause) {
              throw new MarketError(
                'TOKEN_ROUTE_UNAVAILABLE',
                'This card token has no verified Push route for the selected chain.',
                { chain: options.chain, token: a.token },
                cause
              );
            }
          })(),
    maxPerCall: cap(a.maxPerCall),
    maxTotal: cap(a.maxTotal),
  }));
  const allowedCalls: AllowedCallWire[] = input.allowedCalls.map((call) => {
    const parsed = parseSelector(call.selector as Selector);
    if (parsed.valueOnly)
      bad(
        'Marketplace cards support EVM function calls, not Push value-only rules.'
      );
    const pins = (call.pins ?? []).map((p) => {
      const location = parsed.inputs
        ? argumentLocation(parsed.inputs, p.arg, 'Card pin')
        : {
            offset:
              typeof p.arg === 'number' && Number.isInteger(p.arg) && p.arg >= 0
                ? 4 + p.arg * 32
                : bad(
                    'Raw selector pins need a nonnegative integer word index.'
                  ),
            param: { type: 'uint256' } as const,
          };
      const max = 'max' in p && p.max !== undefined;
      const value = 'max' in p && p.max !== undefined ? p.max : p.expected;
      if (value === undefined) return bad('A card pin needs expected or max.');
      if (value === 'agentic:wallet' && max)
        bad('WALLET is supported only in equality pins.');
      const encoded =
        value === 'agentic:wallet'
          ? MARKER_WALLET
          : value === PRINCIPAL
          ? MARKER_PRINCIPAL
          : max
          ? toHex(cap(value as bigint), { size: 32 })
          : encodeArgWord(location.param, value, 'Card pin');
      return {
        offset: location.offset,
        op: max ? (1 as const) : (0 as const),
        value: encoded,
      };
    });
    return {
      target: getAddress(call.target),
      selector: parsed.selector,
      beneficiaryOffset: 0,
      hasBeneficiary: false,
      maxValue: cap(call.maxValue),
      pins,
    };
  });
  const wire = {
    assets,
    principalAsset: assets.findIndex((a) => a.maxTotal === PRINCIPAL_WORD),
    maxGasPerCall: cap(input.maxGasPerCall),
    allowedCalls,
  };
  validateWire(wire, !!options?.structural);
  return wire;
}
function validateWire(r: LegWire, structural = false): void {
  if (!Array.isArray(r.assets) || r.assets.length < 1 || r.assets.length > 8)
    bad('Cards need 1..8 assets.');
  if (
    !Number.isInteger(r.principalAsset) ||
    r.principalAsset < -1 ||
    r.principalAsset >= r.assets.length
  )
    bad('principalAsset is outside the asset list.');
  const tokens = new Set<string>();
  r.assets.forEach((a, i) => {
    if (
      !isAddress(a.token) ||
      (!structural && /^0x0{40}$/i.test(a.token)) ||
      tokens.has(a.token.toLowerCase())
    )
      bad('Assets need distinct nonzero PRC20 addresses.');
    tokens.add(a.token.toLowerCase());
    cap(a.maxPerCall);
    cap(a.maxTotal);
    if (i === r.principalAsset) {
      if (a.maxTotal !== PRINCIPAL_WORD || a.maxPerCall === BigInt(0))
        bad(
          'The principal total must be PRINCIPAL and its per-call cap must be positive or PRINCIPAL.'
        );
    } else if (a.maxPerCall === PRINCIPAL_WORD || a.maxTotal === PRINCIPAL_WORD)
      bad('PRINCIPAL asset-cap markers belong only on the principal asset.');
  });
  cap(r.maxGasPerCall);
  if (
    !Array.isArray(r.allowedCalls) ||
    r.allowedCalls.length < 1 ||
    r.allowedCalls.length > 32
  )
    bad('Cards need 1..32 allowed calls.');
  if (r.allowedCalls.reduce((n, c) => n + c.pins.length, 0) > 32)
    bad('A card rule supports at most 32 conditions.');
  const entries = new Set<string>();
  const pairs = new Map<string, boolean>();
  for (const c of r.allowedCalls) {
    if (
      !isAddress(c.target) ||
      /^0x0{40}$/i.test(c.target) ||
      !/^0x[\da-f]{8}$/i.test(c.selector)
    )
      bad('An allowed app or selector is invalid.');
    cap(c.maxValue);
    try {
      validatePins(c.pins);
    } catch (cause) {
      throw new MarketError(
        'INVALID_AGENT_CARD_RULES',
        'An allowed call has invalid argument conditions.',
        undefined,
        cause
      );
    }
    if (
      c.hasBeneficiary &&
      (c.beneficiaryOffset < 4 || (c.beneficiaryOffset - 4) % 32 !== 0)
    )
      bad('Invalid recipient offset.');
    for (const p of c.pins)
      if (p.value === MARKER_WALLET && p.op !== 0)
        bad('WALLET pins must use equality.');
    const encoded = encodeAbiParameters([{ ...fields[4], type: 'tuple' }], [c]);
    if (entries.has(encoded)) bad('Duplicate allowed call.');
    entries.add(encoded);
    const key = `${c.target.toLowerCase()}:${c.selector.toLowerCase()}`;
    if (pairs.has(key) && (!pairs.get(key) || !c.pins.length))
      bad('An unpinned alternative would bypass the pinned call.');
    pairs.set(key, c.pins.length > 0);
    const pin = (offset: number, op: number) =>
      c.pins.find((p) => p.offset === offset && p.op === op);
    const recipient = (offset: number) =>
      (c.hasBeneficiary && c.beneficiaryOffset === offset) ||
      pin(offset, 0)?.value === MARKER_WALLET;
    if (c.selector === '0x39509351')
      bad('increaseAllowance is not supported in cards.');
    if (c.selector === '0x095ea7b3') {
      const spender = pin(4, 0)?.value;
      if (
        !spender ||
        BigInt(spender) === BigInt(0) ||
        BigInt(spender) >> BigInt(160) !== BigInt(0)
      )
        bad('approve needs an EQ pin to a nonzero literal spender.');
      if (!pin(36, 1)) bad('approve needs a MAX amount pin.');
    }
    if (c.selector === '0xa9059cbb' && !recipient(4))
      bad('transfer must pin its recipient to WALLET.');
    if (c.selector === '0x23b872dd' && !recipient(36))
      bad('transferFrom must pin its recipient to WALLET.');
  }
}
function validateChains(rules: AgentCardRules): void {
  if (!Array.isArray(rules) || rules.length < 1 || rules.length > 4)
    bad('Cards need 1..4 ordered rules.');
  const chains = new Set<string>();
  let principals = 0;
  for (const r of rules) {
    if (
      !/^eip155:[1-9]\d*$/.test(r.chain) ||
      r.chain === 'eip155:42101' ||
      chains.has(r.chain)
    )
      bad('Card chains must be distinct supported external EVM chains.');
    chains.add(r.chain);
    principals += r.assets.filter((a) => a.maxTotal === PRINCIPAL).length;
  }
  if (principals !== 1)
    bad('Exactly one asset across the card must have a PRINCIPAL total.');
}
export function validateAgentCardRules(rules: AgentCardRules): void {
  validateChains(rules);
  rules.forEach((r) => toWire(r, { structural: true }));
}
export function encodeAgentCardRules(
  rules: AgentCardRules,
  options: { network?: PUSH_NETWORK } = {}
): Hex {
  validateChains(rules);
  const wire = rules.map((r) => {
    const leg = toWire(r, { ...options, chain: r.chain });
    return {
      chainNamespace: r.chain,
      terms: {
        validUntil: 0,
        expectedCEA: '0x0000000000000000000000000000000000000000' as Address,
        assets: leg.assets,
        maxGasPerCall: leg.maxGasPerCall,
        allowedCalls: leg.allowedCalls,
      },
    };
  });
  return encodeAbiParameters([CARD_RULES_PARAM], [wire]);
}
export function decodeCardRulesWire(bytes: Hex): CardRulesWire {
  try {
    const wire = decodeAbiParameters(
      [CARD_RULES_PARAM],
      bytes
    )[0] as unknown as CardRulesWire;
    if (encodeAbiParameters([CARD_RULES_PARAM], [wire]) !== bytes)
      bad('Noncanonical card rules.');
    const authored = wire.map((r) => {
      if (r.terms.validUntil !== 0 || BigInt(r.terms.expectedCEA) !== BigInt(0))
        bad('Card per-job terms must be blank.');
      const leg = {
        ...r.terms,
        principalAsset: r.terms.assets.findIndex(
          (a) => a.maxTotal === PRINCIPAL_WORD
        ),
      };
      validateWire(leg);
      return decodeLeg(leg, r.chainNamespace);
    });
    validateChains(authored);
    return wire;
  } catch (cause) {
    if (cause instanceof MarketError) throw cause;
    throw new MarketError(
      'INVALID_AGENT_CARD_RULES',
      'Malformed marketplace 2.1 card rules.',
      undefined,
      cause
    );
  }
}
export function decodeAgentCardRules(bytes: Hex): AgentCardRules {
  return decodeCardRulesWire(bytes).map((r) =>
    decodeLeg(
      {
        ...r.terms,
        principalAsset: r.terms.assets.findIndex(
          (a) => a.maxTotal === PRINCIPAL_WORD
        ),
      },
      r.chainNamespace
    )
  );
}
function decodeLeg(r: LegWire, chain: string): AgentCardRule {
  // Explicit PRC20 references make unknown/custom registry tokens lossless and unambiguous.
  const result: AgentCardRule = {
    chain,
    maxGasPerCall: r.maxGasPerCall,
    assets: r.assets.map((a) => ({
      token: { prc20: a.token },
      maxPerCall: a.maxPerCall === PRINCIPAL_WORD ? PRINCIPAL : a.maxPerCall,
      maxTotal: a.maxTotal === PRINCIPAL_WORD ? PRINCIPAL : a.maxTotal,
    })),
    allowedCalls: r.allowedCalls.map((c) => ({
      target: c.target,
      selector: c.selector,
      maxValue: c.maxValue,
      pins: [
        ...c.pins.map((p) => {
          const value =
            p.value === MARKER_WALLET
              ? ('agentic:wallet' as const)
              : p.value === MARKER_PRINCIPAL
              ? PRINCIPAL
              : p.value;
          return p.op === 1
            ? {
                arg: (p.offset - 4) / 32,
                max: value === PRINCIPAL ? PRINCIPAL : BigInt(p.value),
              }
            : { arg: (p.offset - 4) / 32, expected: value };
        }),
        ...(c.hasBeneficiary
          ? [
              {
                arg: (c.beneficiaryOffset - 4) / 32,
                expected: 'agentic:wallet' as const,
              },
            ]
          : []),
      ],
    })),
  };
  decodedRules.set(result, { fingerprint: fingerprint(result), wire: r });
  return result;
}
export function fillCardRules(
  r: CardRuleWire,
  principal: bigint,
  wallet: Address,
  expiredAt: number
): UniversalTermsWire {
  const walletWord = toHex(BigInt(wallet), { size: 32 });
  return {
    validUntil: expiredAt,
    expectedCEA: wallet,
    assets: r.terms.assets.map((a) => ({
      ...a,
      maxPerCall: a.maxPerCall === PRINCIPAL_WORD ? principal : a.maxPerCall,
      maxTotal: a.maxTotal === PRINCIPAL_WORD ? principal : a.maxTotal,
    })),
    maxGasPerCall: r.terms.maxGasPerCall,
    allowedCalls: r.terms.allowedCalls.map((c) => ({
      ...c,
      pins: c.pins.map((p) => ({
        ...p,
        value:
          p.value === MARKER_WALLET
            ? walletWord
            : p.value === MARKER_PRINCIPAL
            ? toHex(principal, { size: 32 })
            : p.value,
      })),
    })),
  };
}

export function principalAssetOf(rules: CardRulesWire): AssetCapWire {
  const asset = rules
    .flatMap((r) => r.terms.assets)
    .find((a) => a.maxTotal === PRINCIPAL_WORD);
  if (!asset) return bad('The card has no principal asset.');
  return asset;
}

import { getAddress, zeroAddress } from 'viem';
import { AGENTIC } from '../constants';
import { buildPresetApi } from '../presets';
import type { PresetDefinition } from '../presets/catalog';
import type { Rule } from '../agentic.types';
import { MOVEABLE_TOKEN_CONSTANTS } from '../../constants/tokens';
import { normalizePublicRule, publicRules } from '../public-rule';
import { FakeChain, ADDR } from './fake-chain';
import { mockRuntime } from './mock-runtime';
const chain = 'eip155:11155111' as const,
  other = 'eip155:84532' as const;
const target = getAddress('0x0000000000000000000000000000000000001234');
const token = getAddress('0x000000000000000000000000000000000000abcd');
const agent = getAddress('0x000000000000000000000000000000000000a999');
const until = () => Math.floor(Date.now() / 1000) + 3600;
const eth = (maxPerCall = BigInt(5), maxTotal = BigInt(10)) => ({
  token: zeroAddress,
  maxPerCall,
  maxTotal,
});
function catalog(): PresetDefinition[] {
  return [
    {
      constant: 'DEXES',
      name: 'Test-only DEX',
      chains: [
        {
          chainNamespace: chain,
          allowedCalls: [
            {
              target,
              selector: 'deposit()',
              budget: { kind: 'native-value' },
            },
            {
              target,
              selector: 'lend(address,uint256)',
              pins: [{ arg: 0, expected: AGENTIC.WALLET }],
              app: 'Fixture',
              label: 'Lend',
              budget: { kind: 'native-amount', amountArg: 1 },
            },
          ],
        },
        {
          chainNamespace: other,
          allowedCalls: [
            {
              target,
              selector: 'withdraw(address)',
              pins: [{ arg: 0, expected: AGENTIC.WALLET }],
            },
          ],
        },
      ],
    },
  ];
}
it('returns one editable template per chain with default ETH limits, expiry and no identity', () => {
  const api = buildPresetApi(catalog()),
    res = api.get('DEXES');
  expect(Object.keys(res)).toEqual(['rules']);
  expect(res.rules.map((r) => r.chainNamespace)).toEqual([chain, other]);
  for (const rule of res.rules) {
    expect(rule).not.toHaveProperty('agent');
    expect(rule.assets).toHaveLength(1);
    expect(rule.assets![0].token).toBe(zeroAddress);
    expect(rule.validUntil).toBeGreaterThan(Math.floor(Date.now() / 1000));
  }
  const max = res.rules[0].assets![0].maxPerCall;
  expect(res.rules[0].allowedCalls[0].maxValue).toBe(max);
  expect(res.rules[0].allowedCalls[1].pins).toEqual([
    { arg: 0, expected: AGENTIC.WALLET },
    { arg: 1, max },
  ]);
  expect(api.list({ type: 'CATEGORY' }).presets[0].chains).toEqual([
    chain,
    other,
  ]);
});
it('returns ready Rule types with identity and expiry and places each ETH asset on its chain', () => {
  const { rules } = buildPresetApi(catalog()).get('DEXES', {
    agent,
    validUntil: until(),
    assets: [
      { chainNamespace: chain, ...eth(BigInt(2), BigInt(3)) },
      {
        chainNamespace: other,
        token: MOVEABLE_TOKEN_CONSTANTS.BASE_SEPOLIA.ETH,
        maxPerCall: BigInt(4),
        maxTotal: BigInt(8),
      },
    ],
  });
  const typed: Rule[] = rules;
  expect(typed[0].assets).toEqual([eth(BigInt(2), BigInt(3))]);
  expect(typed[1].assets).toEqual([
    {
      token: { ...MOVEABLE_TOKEN_CONSTANTS.BASE_SEPOLIA.ETH },
      maxPerCall: BigInt(4),
      maxTotal: BigInt(8),
    },
  ]);
  expect(typed[0].allowedCalls[0].maxValue).toBe(BigInt(2));
  expect(typed.every((r) => r.agent === agent && r.validUntil > 0)).toBe(true);
});
it('does not type an incomplete template as a ready rule', () => {
  const { rules } = buildPresetApi(catalog()).get('DEXES');
  // @ts-expect-error callers must fill agent before create
  const ready: Rule[] = rules;
  expect(ready[0].agent).toBeUndefined();
});
it('does not mutate caller assets, returned records, or the bundled catalog', () => {
  const data = catalog();
  const api = buildPresetApi(data);
  const asset = {
    token: { ...MOVEABLE_TOKEN_CONSTANTS.ETHEREUM_SEPOLIA.ETH },
    maxPerCall: BigInt(5),
    maxTotal: BigInt(10),
  };
  const first = api.get('DEXES', { chainNamespace: chain, assets: [asset] });
  first.rules[0].allowedCalls[1].pins![0] = { arg: 0, expected: zeroAddress };
  (first.rules[0].assets![0].token as { symbol: string }).symbol = 'X';
  api.list().presets[0].chains.length = 0;
  data[0].chains[0].allowedCalls[1].target = zeroAddress;
  expect(asset.token.symbol).toBe('ETH');
  expect(api.get('DEXES').rules[0].allowedCalls[1]).toMatchObject({
    target,
    pins: [{ arg: 0, expected: AGENTIC.WALLET }, { arg: 1 }],
  });
  expect(api.list().presets[0].chains).toHaveLength(2);
});
it.each([
  [{ assets: [eth()] }, /needs chainNamespace/],
  [
    { chainNamespace: chain, assets: [{ chainNamespace: other, ...eth() }] },
    /outside the selected preset/,
  ],
  [{ chainNamespace: chain, assets: [eth(), eth()] }, /duplicate/],
  [
    { chainNamespace: chain, assets: [{ ...eth(), token }] },
    /only ETH from Push/,
  ],
  [{ chainNamespace: chain, assets: [{ token: zeroAddress }] }, /uint256/],
  [
    { chainNamespace: chain, assets: [eth(BigInt(0), BigInt(1))] },
    /positive maxPerCall and maxTotal/,
  ],
  [
    { chainNamespace: chain, assets: [eth(BigInt(-1))] },
    /maxPerCall must be a uint256/,
  ],
  [
    {
      chainNamespace: chain,
      assets: [eth(BigInt(1), BigInt(1) << BigInt(256))],
    },
    /maxTotal must be a uint256/,
  ],
  [{ chainNamespace: chain, assets: [] }, /Add an ETH asset/],
  [{ assets: [{ chainNamespace: chain, ...eth() }] }, /Add an ETH asset/],
  [{ agent: zeroAddress }, /nonzero Push address/],
  [{ validUntil: 1 }, /future uint48/],
  [{ validUntil: 1.5 }, /future uint48/],
  [{ assets: [null] }, /must be an object/],
])(
  'rejects malformed or mismatched options before returning templates (case %#)',
  (options, error) => {
    expect(() =>
      buildPresetApi(catalog()).get('DEXES', options as never)
    ).toThrow(error);
  }
);
it('rejects unknown presets, unsupported list types and unsupported chain filters', () => {
  const api = buildPresetApi(catalog());
  expect(() => api.get('UNKNOWN' as never)).toThrow(/unknown preset/);
  expect(() => api.list({ type: 'APP' } as never)).toThrow(/only CATEGORY/);
  expect(() => api.get('DEXES', { chainNamespace: 'eip155:999999' })).toThrow(
    /no approved entry/
  );
});
it('enforces the 32-call ceiling', () => {
  const data = catalog();
  data[0].chains[0].allowedCalls = Array.from({ length: 33 }, (_, i) => ({
    target,
    selector: `fn${i}()`,
  }));
  expect(() =>
    buildPresetApi(data).get('DEXES', { chainNamespace: chain })
  ).toThrow(/1..32/);
});
it('requires full signatures and rejects duplicate function entries', () => {
  const data = catalog();
  data[0].chains[0].allowedCalls = [{ target, selector: 'deposit' as never }];
  expect(() => buildPresetApi(data).get('DEXES')).toThrow(/full signatures/);
  data[0].chains[0].allowedCalls = [
    { target, selector: 'deposit()' },
    { target, selector: 'deposit()' },
  ];
  expect(() => buildPresetApi(data).get('DEXES')).toThrow(
    /unpinned alternative/
  );
});
it('compiles preset value and amount caps with the deployed v6 policy', async () => {
  const { rules } = buildPresetApi(catalog()).get('DEXES', {
    chainNamespace: chain,
    agent,
    validUntil: until(),
    assets: [eth()],
  });
  const normalized = (await normalizePublicRule(
    publicRules(rules)[0],
    ADDR.other,
    mockRuntime(new FakeChain())
  )) as import('../agentic.types').UniversalRule;
  expect(normalized.allowedCalls[0].maxValue).toBe(BigInt(5));
  expect(normalized.allowedCalls[1].pins?.map((p) => p.op)).toEqual([0, 1]);
});
it('keeps OR alternatives EVM-only: repeated Solana instructions are refused', () => {
  const api = buildPresetApi([
    {
      constant: 'DEXES',
      name: 'fixture',
      chains: [
        {
          chainNamespace: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
          allowedCalls: [
            {
              target: '11111111111111111111111111111111',
              selector: 'deposit(u64)',
              pins: [{ account: 0, expected: AGENTIC.WALLET }],
            },
            {
              target: '11111111111111111111111111111111',
              selector: 'deposit(u64)',
              pins: [{ arg: 0, max: BigInt(1) }],
            },
          ],
        },
      ],
    },
  ]);
  expect(() => api.get('DEXES')).toThrow(/Solana does not support alternative/);
});

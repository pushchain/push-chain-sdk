import { getAddress, zeroAddress } from 'viem';
import { AGENTIC } from '../constants';
import { agenticPresets, buildPresetApi } from '../presets';
import type { PresetDefinition } from '../presets/catalog';
import type { Rule } from '../agentic.types';
import { normalizePublicRule, publicRules } from '../public-rule';
import { FakeChain, ADDR } from './fake-chain';
import { mockRuntime } from './mock-runtime';
const chain = 'eip155:11155111' as const,
  other = 'eip155:84532' as const;
const target = getAddress('0x0000000000000000000000000000000000001234');
const token = getAddress('0x000000000000000000000000000000000000abcd');
const agent = getAddress('0x000000000000000000000000000000000000a999');
const until = () => Math.floor(Date.now() / 1000) + 3600;
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
              selector: 'deposit(address,uint256)',
              pins: [{ arg: 0, expected: AGENTIC.WALLET }],
              app: 'Fixture',
              label: 'Deposit',
            },
          ],
          approvals: [{ spender: target, app: 'Fixture' }],
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
it('ships verified mainnet and testnet templates and keeps prediction empty', () => {
  expect(Object.values(AGENTIC.PRESETS.CATEGORY)).toEqual([
    'DEXES',
    'LENDING',
    'STAKING',
    'PREDICTION',
  ]);
  const entries = agenticPresets.list().presets;
  expect(entries.map((p) => [p.constant, p.chains.length])).toEqual([
    ['DEXES', 8],
    ['LENDING', 8],
    ['STAKING', 2],
    ['PREDICTION', 0],
  ]);
  expect(
    entries
      .flatMap((p) => p.chains)
      .every((c) =>
        [
          'eip155:1',
          'eip155:8453',
          'eip155:42161',
          'eip155:56',
          'eip155:11155111',
          'eip155:84532',
          'eip155:421614',
          'eip155:97',
        ].includes(c)
      )
  ).toBe(true);
  expect(agenticPresets.get('PREDICTION')).toEqual({
    rules: [],
    readiness: { ready: false, chains: [] },
  });
  expect(agenticPresets.get('DEXES').rules).toHaveLength(8);
  expect(() =>
    agenticPresets.get('LENDING', { chainNamespace: 'eip155:999999' })
  ).toThrow(/no approved entry/);
});
it('groups apps on a chain into one editable template with default expiry and omitted identity', () => {
  const data = catalog();
  data[0].chains[0].allowedCalls = [
    ...data[0].chains[0].allowedCalls,
    {
      target: ADDR.other,
      selector: 'lend(address)',
      pins: [{ arg: 0, expected: AGENTIC.WALLET }],
    },
  ];
  const api = buildPresetApi(data),
    res = api.get('DEXES');
  expect(res.rules.map((r) => r.chainNamespace)).toEqual([chain, other]);
  expect(res.rules[0].allowedCalls).toHaveLength(2);
  for (const rule of res.rules) {
    expect(rule).not.toHaveProperty('agent');
    expect(rule).not.toHaveProperty('assets');
    expect(rule.validUntil).toBeGreaterThan(Math.floor(Date.now() / 1000));
  }
  expect(api.list({ type: 'CATEGORY' }).presets[0].chains).toEqual([
    chain,
    other,
  ]);
});
it('returns ready Rule types with identity and expiry; routes assets and defaults missing caps to zero', () => {
  const api = buildPresetApi(catalog());
  const { rules } = api.get('DEXES', {
    agent,
    validUntil: until(),
    assets: [
      { chainNamespace: chain, token },
      {
        chainNamespace: other,
        token: zeroAddress,
        maxPerCall: BigInt(2),
        maxTotal: BigInt(3),
      },
    ],
  });
  const typed: Rule[] = rules;
  expect(typed[0].assets).toEqual([
    { token, maxPerCall: BigInt(0), maxTotal: BigInt(0) },
  ]);
  expect(typed[1].assets).toEqual([
    { token: zeroAddress, maxPerCall: BigInt(2), maxTotal: BigInt(3) },
  ]);
  expect(typed.every((r) => r.agent === agent && r.validUntil > 0)).toBe(true);
});
it('does not type an incomplete template as a ready rule', () => {
  const { rules } = buildPresetApi(catalog()).get('DEXES');
  // @ts-expect-error callers must fill agent before create
  const ready: Rule[] = rules;
  expect(ready[0].agent).toBeUndefined();
});
it('adds only spender-pinned and amount-bounded ERC20 approvals; native assets have none', () => {
  const { rules } = buildPresetApi(catalog()).get('DEXES', {
    chainNamespace: chain,
    assets: [
      { token, maxPerCall: BigInt(5), maxTotal: BigInt(10) },
      { token: zeroAddress, maxPerCall: BigInt(1) },
    ],
  });
  expect(rules).toHaveLength(1);
  expect(rules[0].allowedCalls).toHaveLength(2);
  expect(rules[0].allowedCalls[1]).toMatchObject({
    target: token,
    selector: 'approve(address,uint256)',
    pins: [
      { arg: 0, expected: target },
      { arg: 1, max: BigInt(5) },
    ],
  });
  expect(rules[0].assets![0]).not.toHaveProperty('chainNamespace');
});
it('does not mutate caller assets, returned records, or the bundled catalog', () => {
  const data = catalog();
  const api = buildPresetApi(data);
  const asset = {
    token: {
      address: token,
      symbol: 'TEST',
      decimals: 6,
      mechanism: 'approve' as const,
    },
  };
  const first = api.get('DEXES', { chainNamespace: chain, assets: [asset] });
  first.rules[0].allowedCalls[0].pins![0] = { arg: 0, expected: zeroAddress };
  (first.rules[0].assets![0].token as { address: string }).address =
    zeroAddress;
  api.list().presets[0].chains.length = 0;
  data[0].chains[0].allowedCalls[0].target = zeroAddress;
  expect(asset.token.address).toBe(token);
  expect(api.get('DEXES').rules[0].allowedCalls[0]).toMatchObject({
    target,
    pins: [{ arg: 0, expected: AGENTIC.WALLET }],
  });
  expect(api.list().presets[0].chains).toHaveLength(2);
});
it.each([
  { assets: [{ token }] },
  { chainNamespace: chain, assets: [{ chainNamespace: other, token }] },
  {
    chainNamespace: chain,
    assets: [{ token }, { token: token.toUpperCase().replace('0X', '0x') }],
  },
  { chainNamespace: chain, assets: [{ token, maxPerCall: BigInt(-1) }] },
  {
    chainNamespace: chain,
    assets: [{ token, maxTotal: BigInt(1) << BigInt(256) }],
  },
  { agent: zeroAddress },
  { validUntil: 1 },
  { validUntil: 1.5 },
  { assets: [null] },
])(
  'rejects malformed or mismatched options before returning templates (case %#)',
  (options) => {
    expect(() =>
      buildPresetApi(catalog()).get('DEXES', options as never)
    ).toThrow();
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
it('produces separate pinned alternatives for multiple spenders', () => {
  const data = catalog();
  data[0].chains[0].approvals = [
    { spender: target, app: 'One' },
    { spender: ADDR.other, app: 'Two' },
  ];
  const result = buildPresetApi(data).get('DEXES', {
    chainNamespace: chain,
    assets: [{ token }],
  });
  expect(
    result.rules[0].allowedCalls.filter(
      (c) => c.selector === 'approve(address,uint256)'
    )
  ).toHaveLength(2);
});
it('enforces the 32-call ceiling including generated approvals', () => {
  const data = catalog();
  data[0].chains[0].allowedCalls = Array.from({ length: 32 }, (_, i) => ({
    target,
    selector: `fn${i}()`,
  }));
  const api = buildPresetApi(data);
  expect(
    api.get('DEXES', { chainNamespace: chain }).rules[0].allowedCalls
  ).toHaveLength(32);
  expect(() =>
    api.get('DEXES', { chainNamespace: chain, assets: [{ token }] })
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
it('compiles preset spender and amount pins with the deployed v6 policy', async () => {
  const { rules } = buildPresetApi(catalog()).get('DEXES', {
    chainNamespace: chain,
    agent,
    validUntil: until(),
    assets: [{ token, maxPerCall: BigInt(5) }],
  });
  const normalized = await normalizePublicRule(
    publicRules(rules)[0],
    ADDR.other,
    mockRuntime(new FakeChain())
  );
  expect(
    (
      normalized as import('../agentic.types').UniversalRule
    ).allowedCalls[1].pins?.map((p) => p.op)
  ).toEqual([0, 1]);
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

import { getAddress, parseEther, zeroAddress } from 'viem';
import { agenticPresets } from '../presets';
import { defaultPresetAsset } from '../presets/default-policy';
import type { Rule } from '../agentic.types';
import { ADDR } from './fake-chain';

const chainNamespace = 'eip155:11155111' as const;
const agent = ADDR.agent;

it.each(['DEXES', 'LENDING', 'STAKING'] as const)(
  'an agent alone produces typed, locally complete %s rules on all catalog chains',
  (category) => {
    const { rules, readiness } = agenticPresets.get(category, { agent });
    const typed: Rule[] = rules;
    expect(typed.length).toBeGreaterThan(0);
    expect(readiness.chains.every((c) => c.configurationReady)).toBe(true);
    for (const rule of typed) {
      expect(rule.agent).toBe(agent);
      expect(rule.maxGasPerCall).toBe(parseEther('20'));
      expect(rule.validUntil).toBeGreaterThan(Math.floor(Date.now() / 1000));
      expect(rule.assets?.every((a) => a.maxPerCall > BigInt(0))).toBe(true);
    }
  }
);

it('generates one expiry seven days from this get call, refreshing on the next call', () => {
  const clock = jest.spyOn(Date, 'now');
  try {
    const now = 1_800_000_000;
    clock.mockReturnValue(now * 1000);
    const first = agenticPresets.get('DEXES', { agent });
    expect(new Set(first.rules.map((r) => r.validUntil))).toEqual(
      new Set([now + 604800])
    );
    clock.mockReturnValue((now + 60) * 1000);
    expect(agenticPresets.get('DEXES', { agent }).rules[0].validUntil).toBe(
      now + 60 + 604800
    );
    expect(first.rules[0].validUntil).toBe(now + 604800);
  } finally {
    clock.mockRestore();
  }
});

it('uses verified raw-unit limits for stablecoins with different decimals', () => {
  const mainnet = agenticPresets.get('DEXES', {
    agent,
    chainNamespace: 'eip155:56',
  }).rules[0];
  const testnet = agenticPresets.get('DEXES', {
    agent,
    chainNamespace: 'eip155:97',
  }).rules[0];
  expect(mainnet.assets?.[1]).toMatchObject({
    maxPerCall: BigInt('10000000000000000000'),
    maxTotal: BigInt('100000000000000000000'),
  });
  expect(testnet.assets?.[1]).toMatchObject({
    maxPerCall: BigInt('10000000'),
    maxTotal: BigInt('100000000'),
  });
  const aave = agenticPresets.get('LENDING', {
    agent,
    chainNamespace: 'eip155:1',
  }).rules[0];
  expect(aave.assets?.[1]).toMatchObject({
    token: getAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'),
    maxPerCall: BigInt('10000000'),
    maxTotal: BigInt('100000000'),
  });
});

it('uses token quantities for native, wrapped-native and LINK defaults', () => {
  const eth = agenticPresets.get('STAKING', {
    agent,
    chainNamespace: 'eip155:1',
  }).rules[0];
  expect(eth.assets?.[0]).toEqual({
    token: zeroAddress,
    maxPerCall: parseEther('0.001'),
    maxTotal: parseEther('0.01'),
  });
  expect(
    eth.allowedCalls.find((c) => c.selector === 'submit(address)')?.maxValue
  ).toBe(parseEther('0.001'));
  const link = agenticPresets.get('LENDING', { agent, chainNamespace })
    .rules[0];
  expect(link.assets?.[0]).toMatchObject({
    maxPerCall: parseEther('1'),
    maxTotal: parseEther('10'),
  });
  const bnb = agenticPresets.get('DEXES', {
    agent,
    chainNamespace: 'eip155:97',
  }).rules[0];
  expect(bnb.assets?.[0]).toMatchObject({
    maxPerCall: parseEther('0.01'),
    maxTotal: parseEther('0.1'),
  });
});

it('preserves explicit expiry and gas, including a zero gas ceiling', () => {
  const validUntil = Math.floor(Date.now() / 1000) + 600;
  const disabled = agenticPresets.get('LENDING', {
    agent,
    chainNamespace,
    validUntil,
    maxGasPerCall: BigInt(0),
  });
  expect(disabled.rules[0].validUntil).toBe(validUntil);
  expect(disabled.rules[0].maxGasPerCall).toBe(BigInt(0));
  expect(disabled.readiness.ready).toBe(false);
  expect(disabled.readiness.chains[0].issues.map((i) => i.code)).toEqual(
    expect.arrayContaining(['GAS_BUDGET_REQUIRED', 'BRIDGE_ASSET_UNAVAILABLE'])
  );
  expect(
    agenticPresets.get('LENDING', {
      agent,
      chainNamespace,
      maxGasPerCall: BigInt(123),
    }).rules[0].maxGasPerCall
  ).toBe(BigInt(123));
});

it('never invents caps for explicit assets, even when their address is a default', () => {
  const defaults = agenticPresets.get('LENDING', { agent, chainNamespace })
    .rules[0];
  const token = defaults.assets?.[0].token;
  if (!token) throw new Error('missing default asset');
  const supplied = agenticPresets.get('LENDING', {
    agent,
    chainNamespace,
    assets: [{ token }],
  });
  expect(supplied.rules[0].assets).toEqual([
    { token, maxPerCall: BigInt(0), maxTotal: BigInt(0) },
  ]);
  expect(supplied.readiness.ready).toBe(false);
  const totalZero = agenticPresets.get('LENDING', {
    agent,
    chainNamespace,
    assets: [{ token, maxPerCall: BigInt(5), maxTotal: BigInt(0) }],
  });
  expect(totalZero.rules[0].assets?.[0].maxTotal).toBe(BigInt(0));
  expect(totalZero.readiness.chains[0].zeroBridgeLimits).toEqual([token]);
});

it('does not grant the default tokens on a different chain when assets is explicit', () => {
  const res = agenticPresets.get('LENDING', {
    agent,
    assets: [{ chainNamespace, token: ADDR.other, maxPerCall: BigInt(5) }],
  });
  expect(
    res.rules
      .filter((r) => r.chainNamespace !== chainNamespace)
      .every((r) => r.assets?.length === 0)
  ).toBe(true);
  expect(res.readiness.ready).toBe(false);
});

it('refuses unreviewed default tokens instead of inferring permissions from symbols', () => {
  expect(() => defaultPresetAsset('eip155:999', ADDR.other)).toThrow(
    /No reviewed default spending policy/
  );
  expect(() => defaultPresetAsset(chainNamespace, ADDR.other)).toThrow(
    /No reviewed default spending policy/
  );
});

import { getAddress } from 'viem';
import { agenticPresets } from '../presets';
import { buildPresetApi } from '../presets';
import type { PresetDefinition } from '../presets/catalog';
import { ADDR } from './fake-chain';

const options = {
  agent: ADDR.agent,
  validUntil: 2_000_000_000,
  maxGasPerCall: BigInt(1),
};

it.each(['DEXES', 'LENDING', 'STAKING'] as const)(
  '%s includes destination tokens independently on every supported network within policy limits',
  (category) => {
    const result = agenticPresets.get(category, options);
    expect(result.rules.length).toBeGreaterThan(0);
    for (const rule of result.rules) {
      expect(rule.assets!.length).toBeGreaterThan(0);
      expect(rule.assets!.length).toBeLessThanOrEqual(8);
      expect(rule.allowedCalls.length).toBeLessThanOrEqual(32);
      expect(
        rule.allowedCalls.reduce((n, c) => n + (c.pins?.length ?? 0), 0)
      ).toBeLessThanOrEqual(32);
      expect(
        rule.assets!.every(
          (a) =>
            a.maxPerCall > BigInt(0) &&
            (a.maxTotal ?? BigInt(0)) >= a.maxPerCall
        )
      ).toBe(true);
    }
    expect(result.readiness.chains.every((c) => c.configurationReady)).toBe(
      true
    );
    expect(result.readiness.chains.every((c) => c.configurationReady)).toBe(
      true
    );
  }
);

it('selects protocol-specific testnet tokens rather than reusing the DEX pair for lending', () => {
  const lending = agenticPresets.get('LENDING', {
    chainNamespace: 'eip155:11155111',
  }).rules[0];
  const dex = agenticPresets.get('DEXES', { chainNamespace: 'eip155:11155111' })
    .rules[0];
  expect(lending.assets!.map((a) => a.token)).toEqual([
    getAddress('0xf8Fb3713D459D7C1018BD0A49D19b4C44290EBE5'),
  ]);
  expect(dex.assets!.map((a) => a.token)).toEqual([
    getAddress('0xfff9976782d46cc05630d1f6ebab18b2324d6b14'),
    getAddress('0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238'),
  ]);
  expect(
    agenticPresets.get('STAKING', { chainNamespace: 'eip155:11155111' })
      .rules[0].assets![0].token
  ).toBe(getAddress('0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9'));
});

it('preserves an explicit empty list instead of silently repopulating tokens', () => {
  const result = agenticPresets.get('DEXES', { ...options, assets: [] });
  expect(
    result.rules.every(
      (r) => r.assets?.length === 0 && r.allowedCalls.length === 2
    )
  ).toBe(true);
  expect(
    result.readiness.chains.every((c) =>
      c.issues.some((i) => i.code === 'ASSETS_REQUIRED')
    )
  ).toBe(true);
});

it('an explicit selection replaces defaults on all chains without filling other networks', () => {
  const assets = [
    {
      chainNamespace: 'eip155:11155111' as const,
      token: ADDR.target,
      maxPerCall: BigInt(2),
    },
  ];
  const result = agenticPresets.get('STAKING', { ...options, assets });
  expect(
    result.rules.find((r) => r.chainNamespace === 'eip155:11155111')!.assets
  ).toEqual([
    { token: ADDR.target, maxPerCall: BigInt(2), maxTotal: BigInt(0) },
  ]);
  expect(
    result.rules.find((r) => r.chainNamespace === 'eip155:1')!.assets
  ).toEqual([]);
  expect(assets).toHaveLength(1);
});

it('regenerates token constraints and approvals from returned default assets with supplied caps', () => {
  const request = { ...options, chainNamespace: 'eip155:11155111' as const };
  const preview = agenticPresets.get('LENDING', request);
  const result = agenticPresets.get('LENDING', {
    ...request,
    assets: preview.rules[0].assets!.map((a) => ({
      ...a,
      maxPerCall: BigInt(5),
      maxTotal: BigInt(10),
    })),
  });
  expect(result.readiness.chains.every((c) => c.configurationReady)).toBe(true);
  expect(
    result.rules[0].allowedCalls.every((c) =>
      c.pins?.some((p) => p.max === BigInt(5))
    )
  ).toBe(true);
  expect(preview.rules[0].assets![0].maxPerCall).toBe(BigInt(10) ** BigInt(18));
});

it('isolates defaults from returned assets, caller mutations and input catalog mutations', () => {
  const catalog: PresetDefinition[] = [
    {
      constant: 'STAKING',
      name: 'Fixture',
      chains: [
        {
          chainNamespace: 'eip155:11155111',
          defaultTokens: [
            getAddress('0xf8Fb3713D459D7C1018BD0A49D19b4C44290EBE5'),
          ],
          allowedCalls: [
            {
              target: ADDR.other,
              selector: 'deposit(uint256)',
              budget: {
                kind: 'fixed-token',
                token: getAddress('0xf8Fb3713D459D7C1018BD0A49D19b4C44290EBE5'),
                amountArg: 0,
              },
            },
          ],
        },
      ],
    },
  ];
  const api = buildPresetApi(catalog);
  const first = api.get('STAKING');
  first.rules[0].assets![0].token = ADDR.other;
  first.rules[0].assets!.push({ token: ADDR.agent, maxPerCall: BigInt(1) });
  first.readiness.chains[0].knownTokens.length = 0;
  catalog[0].chains[0].defaultTokens = [ADDR.other];
  expect(api.get('STAKING').rules[0].assets).toEqual([
    {
      token: getAddress('0xf8Fb3713D459D7C1018BD0A49D19b4C44290EBE5'),
      maxPerCall: BigInt(10) ** BigInt(18),
      maxTotal: BigInt(10) ** BigInt(19),
    },
  ]);
});

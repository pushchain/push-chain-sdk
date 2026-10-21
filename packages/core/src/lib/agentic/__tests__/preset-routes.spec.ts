import { agenticPresets } from '../presets';
import { CHAIN, PUSH_NETWORK } from '../../constants/enums';
import { MOVEABLE_TOKEN_CONSTANTS } from '../../constants/tokens';
import { ADDR } from './fake-chain';

const options = { chainNamespace: CHAIN.ETHEREUM_SEPOLIA, agent: ADDR.agent };
it('reports unmapped source tokens without silently changing the default Push grant', () => {
  const res = agenticPresets.get('LENDING', options);
  expect(res.readiness.ready).toBe(false);
  const state = res.readiness.chains[0];
  expect(state.configurationReady).toBe(true);
  expect(state.issues).toContainEqual(
    expect.objectContaining({
      code: 'BRIDGE_ASSET_UNAVAILABLE',
      token: '0xf8Fb3713D459D7C1018BD0A49D19b4C44290EBE5',
    })
  );
  expect(res.rules[0].assets).toEqual(state.selectedAssets);
  expect(res.rules[0].assets).toHaveLength(1);
});
it('preserves assets and rejects the removed funding option instead of silently changing permissions', () => {
  const result = agenticPresets.get('DEXES', options);
  // WETH and Circle USDC both have exact node routes on Sepolia.
  expect(result.readiness.ready).toBe(true);
  expect(result.rules[0].assets).toEqual(
    result.readiness.chains[0].selectedAssets
  );
  result.readiness.chains[0].selectedAssets[0].maxPerCall = BigInt(0);
  expect(result.rules[0].assets?.[0].maxPerCall).toBeGreaterThan(BigInt(0));
  for (const funding of ['push', 'destination', 'auto']) {
    expect(() =>
      agenticPresets.get('DEXES', {
        ...options,
        // @ts-expect-error funding is not part of the public preset API
        funding,
      })
    ).toThrow(/funding option is no longer supported/);
  }
});
it('an explicitly selected mapped source token can be ready for Push funding', () => {
  const token = MOVEABLE_TOKEN_CONSTANTS.BNB_TESTNET.USDT;
  const res = agenticPresets.get('DEXES', {
    chainNamespace: CHAIN.BNB_TESTNET,
    agent: ADDR.agent,
    assets: [
      {
        token: MOVEABLE_TOKEN_CONSTANTS.BNB_TESTNET.USDC,
        maxPerCall: BigInt(5),
        maxTotal: BigInt(10),
      },
      { token, maxPerCall: BigInt(5), maxTotal: BigInt(10) },
    ],
  });
  expect(res.readiness.ready).toBe(true);
  expect(
    res.readiness.chains[0].bridgeAssets.every((a) => a.status === 'registered')
  ).toBe(true);
});
it('never treats a mainnet template or undeployed Push generation as executable', () => {
  const mainnet = agenticPresets.get('DEXES', {
    agent: ADDR.agent,
    chainNamespace: CHAIN.ETHEREUM_MAINNET,
  });
  expect(mainnet.readiness.ready).toBe(false);
  expect(mainnet.readiness.chains[0].issues).toContainEqual(
    expect.objectContaining({ code: 'DESTINATION_UNAVAILABLE' })
  );
  const missing = agenticPresets.get('LENDING', {
    ...options,
    network: PUSH_NETWORK.MAINNET,
  });
  expect(missing.readiness.ready).toBe(false);
  expect(missing.readiness.chains[0].issues).toContainEqual(
    expect.objectContaining({ code: 'AGW_NETWORK_UNAVAILABLE' })
  );
});
it('supports the TESTNET alias, rejects invalid modes and preserves empty selections', () => {
  expect(
    agenticPresets.get('LENDING', {
      ...options,
      network: PUSH_NETWORK.TESTNET,
    }).readiness
  ).toEqual(agenticPresets.get('LENDING', options).readiness);
  expect(() =>
    agenticPresets.get('LENDING', { ...options, network: 'OTHER' as never })
  ).toThrow(/network/);
  const empty = agenticPresets.get('LENDING', {
    ...options,
    assets: [],
  });
  expect(empty.readiness.chains[0].selectedAssets).toEqual([]);
  expect(empty.readiness.ready).toBe(false);
});

it('explains empty tokens without expanding them into unrestricted permissions', () => {
  const res = agenticPresets.get('LENDING', { ...options, assets: [] });
  expect(res.rules[0].assets).toEqual([]);
  expect(res.readiness.ready).toBe(false);
  expect(res.readiness.chains[0].issues).toContainEqual(
    expect.objectContaining({
      code: 'ASSETS_REQUIRED',
      message: expect.stringContaining(
        'transfers from Push are disabled, not unrestricted'
      ),
    })
  );
});
it('reports exact unavailable assets across all nine testnet preset combinations', () => {
  const chains = [
    CHAIN.ETHEREUM_SEPOLIA,
    CHAIN.BASE_SEPOLIA,
    CHAIN.ARBITRUM_SEPOLIA,
    CHAIN.BNB_TESTNET,
  ];
  const routed = new Set([
    `DEXES:${CHAIN.ETHEREUM_SEPOLIA}`,
    `LENDING:${CHAIN.ARBITRUM_SEPOLIA}`,
  ]);
  let checked = 0;
  for (const category of ['DEXES', 'LENDING', 'STAKING'] as const) {
    const entry = agenticPresets
      .list()
      .presets.find((p) => p.constant === category)!;
    for (const chainNamespace of entry.chains.filter((c) =>
      chains.includes(c as never)
    )) {
      const res = agenticPresets.get(category, {
        agent: ADDR.agent,
        chainNamespace,
      });
      expect(res.readiness.ready).toBe(
        routed.has(`${category}:${chainNamespace}`)
      );
      const state = res.readiness.chains[0];
      expect(res.rules[0].assets).toEqual(state.selectedAssets);
      for (const asset of state.bridgeAssets.filter(
        (a) => a.status === 'unavailable'
      )) {
        expect(state.issues).toContainEqual(
          expect.objectContaining({
            code: 'BRIDGE_ASSET_UNAVAILABLE',
            token: asset.token,
            message: expect.stringContaining(
              'only if the selected app supports that exact token address'
            ),
          })
        );
      }
      checked++;
    }
  }
  expect(checked).toBe(9);
});

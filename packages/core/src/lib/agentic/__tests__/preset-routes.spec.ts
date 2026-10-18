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
  expect(state.funding).toBe('push');
  expect(state.issues).toContainEqual(
    expect.objectContaining({
      code: 'BRIDGE_ASSET_UNAVAILABLE',
      token: '0xf8Fb3713D459D7C1018BD0A49D19b4C44290EBE5',
    })
  );
  expect(res.rules[0].assets).toEqual(state.selectedAssets);
  expect(res.rules[0].assets).toHaveLength(1);
});
it('supports the explicit destination-funded grant with preserved token/amount pins and review metadata', () => {
  const push = agenticPresets.get('DEXES', options);
  const dest = agenticPresets.get('DEXES', {
    ...options,
    funding: 'destination',
  });
  expect(push.readiness.ready).toBe(false);
  expect(dest.readiness.ready).toBe(true);
  expect(dest.rules[0].assets).toEqual([]);
  expect(dest.readiness.chains[0].selectedAssets).toEqual(push.rules[0].assets);
  expect(dest.rules[0].allowedCalls).toEqual(push.rules[0].allowedCalls);
  expect(dest.readiness.chains[0].bridgeAssets.map((a) => a.status)).toEqual([
    'registered',
    'unavailable',
  ]);
  const returned = dest.readiness.chains[0].selectedAssets[0];
  returned.maxPerCall = BigInt(0);
  expect(
    agenticPresets.get('DEXES', options).rules[0].assets?.[0].maxPerCall
  ).toBeGreaterThan(BigInt(0));
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
    funding: 'destination',
  });
  expect(mainnet.readiness.ready).toBe(false);
  expect(mainnet.readiness.chains[0].issues).toContainEqual(
    expect.objectContaining({ code: 'DESTINATION_UNAVAILABLE' })
  );
  const missing = agenticPresets.get('LENDING', {
    ...options,
    funding: 'destination',
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
      funding: 'destination',
      network: PUSH_NETWORK.TESTNET,
    }).readiness.ready
  ).toBe(true);
  expect(() =>
    agenticPresets.get('LENDING', { ...options, funding: 'auto' as never })
  ).toThrow(/funding/);
  expect(() =>
    agenticPresets.get('LENDING', { ...options, network: 'OTHER' as never })
  ).toThrow(/network/);
  const empty = agenticPresets.get('LENDING', {
    ...options,
    funding: 'destination',
    assets: [],
  });
  expect(empty.readiness.chains[0].selectedAssets).toEqual([]);
  expect(empty.readiness.ready).toBe(false);
});

import { getAddress } from 'viem';
import { agenticPresets } from '../presets';
import { PUSH_NETWORK } from '../../constants/enums';
import { SYNTHETIC_PUSH_ERC20 } from '../../constants/chain';
import { resolveAgenticPrc20 } from '../token-routes';
import { assetAddress } from '../presets/operation-limits';

// Presets ship only what Push can send today, so this offline check replaces
// the removed readiness report: every default asset resolves to a Push PRC20.
const GAS_PRC20 = {
  'eip155:11155111': 'pETH',
  'eip155:84532': 'pETH_BASE',
  'eip155:421614': 'pETH_ARB',
} as const;
it.each(
  agenticPresets
    .list()
    .presets.flatMap((p) => p.chains.map((c) => [p.constant, c] as const))
)('%s %s sends only ETH, routed as the chain gas PRC20', (preset, chain) => {
  const { rules } = agenticPresets.get(preset, { chainNamespace: chain });
  expect(rules[0].assets).toHaveLength(1);
  const prc20 = resolveAgenticPrc20(
    { chain, address: assetAddress(rules[0].assets![0]) },
    PUSH_NETWORK.TESTNET_DONUT
  );
  expect(prc20.address).toBe(
    getAddress(
      SYNTHETIC_PUSH_ERC20[PUSH_NETWORK.TESTNET_DONUT][
        GAS_PRC20[chain as keyof typeof GAS_PRC20]
      ]
    )
  );
});
it('rejects the removed funding option instead of silently changing permissions', () => {
  for (const funding of ['push', 'destination', 'auto'])
    expect(() =>
      agenticPresets.get('DEXES', {
        chainNamespace: 'eip155:11155111',
        // @ts-expect-error funding is not part of the public preset API
        funding,
      })
    ).toThrow(/funding option is no longer supported/);
});

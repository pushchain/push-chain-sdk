import { getAddress } from 'viem';
import { CHAIN, PUSH_NETWORK } from '../../constants/enums';
import { SYNTHETIC_PUSH_ERC20 } from '../../constants/chain';
import type { Orchestrator } from '../../orchestrator/orchestrator';
import { createAgenticRuntime } from '../runtime';
import { exactAgenticRoute, resolveAgenticPrc20 } from '../token-routes';

const CIRCLE = {
  [CHAIN.ETHEREUM_SEPOLIA]: [
    '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
    '0x387b9C8Db60E74999aAAC5A2b7825b400F12d68E',
  ],
  [CHAIN.BASE_SEPOLIA]: [
    '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    '0x84B62e44F667F692F7739Ca6040cD17DA02068A8',
  ],
  [CHAIN.ARBITRUM_SEPOLIA]: [
    '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
    '0xa261A10e94aE4bA88EE8c5845CbE7266bD679DD6',
  ],
} as const;
const runtime = () =>
  createAgenticRuntime(
    {
      getNetwork: () => PUSH_NETWORK.TESTNET_DONUT,
      getRpcUrls: () => ({}),
    } as unknown as Orchestrator,
    false
  );

it.each(Object.entries(CIRCLE))(
  'maps the exact node-registered Circle USDC on %s',
  (chain, [source, prc20]) => {
    expect(
      resolveAgenticPrc20(
        { chain, address: source.toLowerCase() },
        PUSH_NETWORK.TESTNET_DONUT
      )
    ).toEqual({ address: getAddress(prc20), symbol: 'USDC', decimals: 6 });
    expect(runtime().resolvePrc20(source, chain as CHAIN)).toBe(
      getAddress(prc20)
    );
    expect(exactAgenticRoute(chain, source, PUSH_NETWORK.TESTNET)?.prc20).toBe(
      prc20
    );
  }
);
it('never matches by symbol, by another chain or on another network', () => {
  const donut = SYNTHETIC_PUSH_ERC20[PUSH_NETWORK.TESTNET_DONUT];
  // The SDK's routed Sepolia mock USDC keeps its own PRC20.
  expect(
    resolveAgenticPrc20(
      {
        chain: CHAIN.ETHEREUM_SEPOLIA,
        address: '0x97F477B7f970D47a87B42869ceeace218106152a',
      },
      PUSH_NETWORK.TESTNET_DONUT
    ).address
  ).toBe(getAddress(donut.USDC_ETH));
  const sepoliaCircle = CIRCLE[CHAIN.ETHEREUM_SEPOLIA][0];
  expect(
    exactAgenticRoute(
      CHAIN.BASE_SEPOLIA,
      sepoliaCircle,
      PUSH_NETWORK.TESTNET_DONUT
    )
  ).toBeUndefined();
  expect(() =>
    runtime().resolvePrc20(sepoliaCircle, CHAIN.BASE_SEPOLIA)
  ).toThrow();
  expect(
    exactAgenticRoute(
      CHAIN.ETHEREUM_SEPOLIA,
      sepoliaCircle,
      PUSH_NETWORK.MAINNET
    )
  ).toBeUndefined();
  expect(
    exactAgenticRoute(CHAIN.ETHEREUM_SEPOLIA, 'USDC', PUSH_NETWORK.TESTNET)
  ).toBeUndefined();
});

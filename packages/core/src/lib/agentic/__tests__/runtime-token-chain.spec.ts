import { getAddress } from 'viem';
import { createAgenticRuntime } from '../runtime';
import { CHAIN, PUSH_NETWORK } from '../../constants/enums';
import { SYNTHETIC_PUSH_ERC20 } from '../../constants/chain';
import {
  MOVEABLE_TOKEN_CONSTANTS,
  type PushChainMoveableToken,
} from '../../constants/tokens';
import type { Orchestrator } from '../../orchestrator/orchestrator';
const runtime = () =>
  createAgenticRuntime(
    {
      getNetwork: () => PUSH_NETWORK.TESTNET_DONUT,
      getRpcUrls: () => ({}),
    } as unknown as Orchestrator,
    false
  );
const addresses = SYNTHETIC_PUSH_ERC20[PUSH_NETWORK.TESTNET_DONUT];
it.each([
  [
    CHAIN.ETHEREUM_SEPOLIA,
    MOVEABLE_TOKEN_CONSTANTS.ETHEREUM_SEPOLIA.ETH,
    addresses.pETH,
  ],
  [
    CHAIN.BASE_SEPOLIA,
    MOVEABLE_TOKEN_CONSTANTS.BASE_SEPOLIA.ETH,
    addresses.pETH_BASE,
  ],
  [
    CHAIN.ARBITRUM_SEPOLIA,
    MOVEABLE_TOKEN_CONSTANTS.ARBITRUM_SEPOLIA.ETH,
    addresses.pETH_ARB,
  ],
] as const)(
  'resolves explicit native ETH on %s to the same burn token as omitted native funds',
  (chain, token, expected) => {
    const rt = runtime();
    expect(rt.resolvePrc20(token, chain)).toBe(getAddress(expected));
    expect(rt.resolvePrc20({ ...token }, chain)).toBe(
      rt.resolvePrc20(undefined, chain)
    );
    expect(rt.resolvePrc20(token.address, chain)).toBe(getAddress(expected));
  }
);
it('does not infer a token from a different destination chain', () => {
  expect(() =>
    runtime().resolvePrc20(
      MOVEABLE_TOKEN_CONSTANTS.BASE_SEPOLIA.USDC,
      CHAIN.ARBITRUM_SEPOLIA
    )
  ).toThrow();
});
it('preserves a matching explicit Push PRC20 reference and rejects a different destination', () => {
  const token: PushChainMoveableToken = {
    symbol: 'pETH_ARB',
    decimals: 18,
    mechanism: 'approve',
    address: addresses.pETH_ARB,
    prc20Address: addresses.pETH_ARB,
    sourceChain: CHAIN.ARBITRUM_SEPOLIA,
  };
  expect(runtime().resolvePrc20(token, CHAIN.ARBITRUM_SEPOLIA)).toBe(
    getAddress(addresses.pETH_ARB)
  );
  expect(() => runtime().resolvePrc20(token, CHAIN.BASE_SEPOLIA)).toThrow(
    'source chain must match'
  );
});

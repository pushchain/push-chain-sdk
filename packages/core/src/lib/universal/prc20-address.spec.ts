import { getAddress } from 'viem';
import { getPRC20Address } from './prc20-address';
import { CHAIN, PUSH_NETWORK } from '../constants/enums';
import { MOVEABLE_TOKEN_CONSTANTS } from '../constants/tokens';
import { SYNTHETIC_PUSH_ERC20 } from '../constants/chain';

const addresses = SYNTHETIC_PUSH_ERC20[PUSH_NETWORK.TESTNET_DONUT];
it.each([
  ['WETH', '0xfff9976782d46cc05630d1f6ebab18b2324d6b14', addresses.WETH_ETH],
  ['stETH', '0x3e3FE7dBc6B4C189E7128855dD526361c49b40Af', addresses.stETH_ETH],
] as const)(
  'resolves verified Sepolia %s for lowercase/checksummed address input',
  (symbol, address, prc20) => {
    for (const input of [address.toLowerCase(), getAddress(address)]) {
      expect(
        getPRC20Address({ chain: CHAIN.ETHEREUM_SEPOLIA, address: input })
      ).toMatchObject({
        chain: CHAIN.ETHEREUM_SEPOLIA,
        symbol,
        address: prc20,
        decimals: 18,
      });
    }
  }
);
it('preserves case-sensitive Solana identities while accepting EVM casing variations', () => {
  const token = MOVEABLE_TOKEN_CONSTANTS.BASE_SEPOLIA.USDC;
  expect(
    getPRC20Address({
      chain: CHAIN.BASE_SEPOLIA,
      address: token.address.toLowerCase(),
    }).address
  ).toBe(addresses.USDC_BASE);
  const mint = MOVEABLE_TOKEN_CONSTANTS.SOLANA_DEVNET.USDC;
  expect(() =>
    getPRC20Address({
      chain: CHAIN.SOLANA_DEVNET,
      address: mint.address.toLowerCase(),
    })
  ).toThrow(/infer/);
  expect(
    getPRC20Address({ chain: CHAIN.SOLANA_DEVNET, address: mint.address })
      .address
  ).toBe(addresses.USDC_SOL);
});
it('never aliases mainnet ETH/WETH or a different chain WETH to Sepolia', () => {
  expect(() =>
    getPRC20Address({
      chain: CHAIN.ETHEREUM_MAINNET,
      address: MOVEABLE_TOKEN_CONSTANTS.ETHEREUM_MAINNET.ETH.address,
    })
  ).toThrow(/Unsupported ETH origin/);
  expect(() =>
    getPRC20Address({
      chain: CHAIN.ETHEREUM_MAINNET,
      address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    })
  ).toThrow(/Unsupported WETH origin/);
  expect(() =>
    getPRC20Address({
      chain: CHAIN.ARBITRUM_SEPOLIA,
      address: '0x980B62Da83eFf3D4576C647993b0c1D7faf17c73',
    })
  ).toThrow(/Unsupported WETH origin/);
});

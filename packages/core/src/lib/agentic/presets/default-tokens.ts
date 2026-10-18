import { getAddress, zeroAddress, type Address } from 'viem';

/** Curated subsets of the reviewed catalog. Addresses are destination tokens,
 * not a promise that a Push PRC20 route or protocol liquidity is available.
 * Keep these sets within the policy's 32-call/32-pin limits after expansion.
 * Testnet DEX pairs and lending/staking assets match the live preset fixtures.
 * Mainnet addresses share the catalog's October 15 read-only source baseline.
 * Spending caps are intentionally separate from token selection.
 */
const addresses = (...values: string[]): readonly Address[] =>
  values.map((value) => getAddress(value.toLowerCase()));

export const DEX_DEFAULT_TOKENS: Readonly<Record<string, readonly Address[]>> =
  {
    'eip155:1': addresses(
      '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
    ),
    'eip155:8453': addresses(
      '0x4200000000000000000000000000000000000006',
      '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
    ),
    'eip155:42161': addresses(
      '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
      '0xaf88d065e77c8cC2239327C5EDb3A432268e5831'
    ),
    'eip155:56': addresses(
      '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
      '0x55d398326f99059fF775485246999027B3197955'
    ),
    'eip155:11155111': addresses(
      '0xfff9976782d46cc05630d1f6ebab18b2324d6b14',
      '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238'
    ),
    'eip155:84532': addresses(
      '0x4200000000000000000000000000000000000006',
      '0x036CbD53842c5426634e7929541eC2318f3dCF7e'
    ),
    'eip155:421614': addresses(
      '0x980B62Da83eFf3D4576C647993b0c1D7faf17c73',
      '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d'
    ),
    'eip155:97': addresses(
      '0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd',
      '0xA11c8D9DC9b66E209Ef60F0C8D969D3CD988782c'
    ),
  };

export const LENDING_DEFAULT_TOKENS: Readonly<
  Record<string, readonly Address[]>
> = {
  'eip155:1': DEX_DEFAULT_TOKENS['eip155:1'],
  // One shared reserve/market token keeps Aave + Moonwell/Venus within 32 pins.
  'eip155:8453': addresses('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'),
  'eip155:42161': DEX_DEFAULT_TOKENS['eip155:42161'],
  'eip155:56': addresses('0x55d398326f99059fF775485246999027B3197955'),
  // Protocol testnet reserves differ from Circle USDC and DEX wrapped ETH.
  'eip155:11155111': addresses('0xf8Fb3713D459D7C1018BD0A49D19b4C44290EBE5'),
  'eip155:84532': addresses(
    '0x810D46F9a9027E28F9B01F75E2bdde839dA61115',
    '0x4616975f7E6045FD9737e95bC527e9e14c727BD2',
    '0x663A6F02d547dFd639BF689FED298712f2FB69Fb'
  ),
  'eip155:421614': addresses('0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d'),
  'eip155:97': addresses(
    '0xA11c8D9DC9b66E209Ef60F0C8D969D3CD988782c',
    '0x16227D60f7a0e586C66B005219dfc887D13C9531'
  ),
};

export const STAKING_DEFAULT_TOKENS: Readonly<
  Record<string, readonly Address[]>
> = {
  'eip155:1': addresses(
    zeroAddress,
    '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84',
    '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0'
  ),
  'eip155:11155111': addresses('0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9'),
};

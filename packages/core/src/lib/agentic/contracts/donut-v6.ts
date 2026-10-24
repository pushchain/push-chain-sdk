import type { Address } from 'viem';

/** Source ffd567d; code sizes and wiring checked at Donut block 24244801. */
export const V6_SOURCE_COMMIT = 'ffd567d3e49b2d27c6f50ad36093274dbac3090f';
export const DONUT_V6_START_BLOCK = BigInt(24229957);
export const DONUT_V6_ADDRESSES = {
  factory: '0xFBBEB6a365178fAaA81A9789a5f64b300c37e5bc',
  walletImplementation: '0x536D3EA48219ff743ac663C6c224920e9eB476A5',
  sessionEngine: '0xf63DC0628fe1B25049FE3E3a3585Ef051CB98c1d',
  rulesPolicy: '0xBA32e7A1500cb34311a31127bcD40CA52C8CFd36',
  sessionValidator: '0xBf08d8335c1cE41a577DB70666816027814737dD',
  gateway: '0x00000000000000000000000000000000000000C1',
} as const satisfies Record<string, Address>;

import type { Address } from 'viem';

/** Source e8db748; code/proxy wiring checked at Donut block 23931055. */
export const V4_SOURCE_COMMIT = 'e8db74815cfbbf5389593805e464fe8d85f7f735';
export const DONUT_V4_START_BLOCK = BigInt(23923806);
export const DONUT_V4_ADDRESSES = {
  factory: '0xaF88D0FD947afAe7bBb8F34e8417DCfc165e1aaF',
  walletImplementation: '0x96D69ec7e6cDdaD414e656B5c9DCA24587DF713c',
  sessionEngine: '0x165A5E6782f39D30B38c7D97e1303e4CB2aD102a',
  rulesPolicy: '0x603E7f0aF6e1aAFf46DDfb28b1e99364f8BC59af',
  sessionValidator: '0x068EE2388475A98EE1f5a434C58bFF3444fffFe6',
  gateway: '0x00000000000000000000000000000000000000C1',
} as const satisfies Record<string, Address>;

import type { Address } from 'viem';

/** Source 2e61e13; code/proxy wiring checked at Donut block 23991912. */
export const V5_SOURCE_COMMIT = '2e61e133e641b4e0e1ddbdc9306b0903b60e4dbb';
export const DONUT_V5_START_BLOCK = BigInt(23989983);
export const DONUT_V5_ADDRESSES = {
  factory: '0x8137F96A50EBF41d904e3678c84c391a0D1BCcc5',
  walletImplementation: '0x4D459Da499C14548aa16c46c57fD92880A88EBb4',
  sessionEngine: '0x165A5E6782f39D30B38c7D97e1303e4CB2aD102a',
  rulesPolicy: '0x603E7f0aF6e1aAFf46DDfb28b1e99364f8BC59af',
  sessionValidator: '0x068EE2388475A98EE1f5a434C58bFF3444fffFe6',
  gateway: '0x00000000000000000000000000000000000000C1',
} as const satisfies Record<string, Address>;

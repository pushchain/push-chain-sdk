import {
  decodeAbiParameters,
  encodeAbiParameters,
  type Address,
  type Hex,
} from 'viem';

export interface AssetCapWire {
  token: Address;
  maxPerCall: bigint;
  maxTotal: bigint;
}
export interface AllowedCallWire {
  target: Address;
  selector: Hex;
  beneficiaryOffset: number;
  hasBeneficiary: boolean;
  maxValue: bigint;
}
export interface UniversalTermsWire {
  validUntil: number;
  expectedCEA: Address;
  assets: readonly AssetCapWire[];
  maxGasPerCall: bigint;
  allowedCalls: readonly AllowedCallWire[];
}
export const UNIVERSAL_TERMS_PARAM = {
  type: 'tuple',
  components: [
    { name: 'validUntil', type: 'uint48' },
    { name: 'expectedCEA', type: 'address' },
    {
      name: 'assets',
      type: 'tuple[]',
      components: [
        { name: 'token', type: 'address' },
        { name: 'maxPerCall', type: 'uint256' },
        { name: 'maxTotal', type: 'uint256' },
      ],
    },
    { name: 'maxGasPerCall', type: 'uint256' },
    {
      name: 'allowedCalls',
      type: 'tuple[]',
      components: [
        { name: 'target', type: 'address' },
        { name: 'selector', type: 'bytes4' },
        { name: 'beneficiaryOffset', type: 'uint16' },
        { name: 'hasBeneficiary', type: 'bool' },
        { name: 'maxValue', type: 'uint256' },
      ],
    },
  ],
} as const;
export function encodeUniversalTerms(terms: UniversalTermsWire): Hex {
  return encodeAbiParameters([UNIVERSAL_TERMS_PARAM], [terms]);
}
export function decodeUniversalTerms(body: Hex): UniversalTermsWire {
  return decodeAbiParameters([UNIVERSAL_TERMS_PARAM], body)[0];
}

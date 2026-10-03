import {
  decodeAbiParameters,
  encodeAbiParameters,
  type AbiParameter,
  type Address,
  type Hex,
} from 'viem';

/**
 * HISTORICAL, INTERNAL-ONLY single-asset UniversalTerms codec for the reviewed
 * e704d5b generation (Types.sol:217-225). It operates on wire terms, never on
 * the public `UniversalRule` (assets[]), and is not exported from the package.
 * It exists so the local contract harness and the agent-door outbound composer
 * can be exercised against real pinned contracts. Do not route the advertised
 * public API through it (A05).
 */
export interface UniversalTermsE704d5b {
  validUntil: number;
  expectedCEA: Address;
  asset: Address;
  maxAmountPerCall: bigint;
  /** type(uint256).max = unlimited at e704d5b (differs from the proposed 0-unlimited). */
  maxAmountTotal: bigint;
  maxPCPerCall: bigint;
  allowedCalls: readonly {
    target: Address;
    selector: Hex;
    beneficiaryOffset: number;
    hasBeneficiary: boolean;
    maxValue: bigint;
  }[];
}

export const UNIVERSAL_TERMS_E704D5B_PARAM: AbiParameter = {
  type: 'tuple',
  components: [
    { name: 'validUntil', type: 'uint48' },
    { name: 'expectedCEA', type: 'address' },
    { name: 'asset', type: 'address' },
    { name: 'maxAmountPerCall', type: 'uint256' },
    { name: 'maxAmountTotal', type: 'uint256' },
    { name: 'maxPCPerCall', type: 'uint256' },
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
};

export function encodeUniversalTermsE704d5b(terms: UniversalTermsE704d5b): Hex {
  return encodeAbiParameters([UNIVERSAL_TERMS_E704D5B_PARAM], [terms]);
}

export function decodeUniversalTermsE704d5b(body: Hex): UniversalTermsE704d5b {
  const [terms] = decodeAbiParameters([UNIVERSAL_TERMS_E704D5B_PARAM], body);
  return terms as unknown as UniversalTermsE704d5b;
}

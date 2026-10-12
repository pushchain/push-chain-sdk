import type { Address } from 'viem';
import type { RuleCall, ForeignChainNamespace } from '../agentic.types';
import type { PresetCategory } from './types';

/** Internal catalog: reviewed addresses and explicit calls only; never fetched at runtime. */
export interface PresetChainDefinition {
  chainNamespace: ForeignChainNamespace;
  allowedCalls: readonly RuleCall[];
  /** Exact spenders that need an approval for each non-native supplied asset. */
  approvals?: readonly { spender: Address; app: string }[];
  maxGasPerCall?: bigint;
}
export interface PresetDefinition {
  constant: PresetCategory;
  name: string;
  chains: readonly PresetChainDefinition[];
}
/** No approved app/address catalog yet. Empty categories must be hidden by UIs. */
export const PRESET_CATALOG: readonly PresetDefinition[] = [
  { constant: 'DEXES', name: 'Popular DEXes', chains: [] },
  { constant: 'LENDING', name: 'Lending', chains: [] },
  { constant: 'PREDICTION', name: 'Prediction markets', chains: [] },
];

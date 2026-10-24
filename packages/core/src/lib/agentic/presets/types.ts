import type { Address } from 'viem';
import type { Rule, RuleAsset, ForeignChainNamespace } from '../agentic.types';

export type PresetCategory = 'DEXES' | 'LENDING' | 'STAKING';
export interface Preset {
  type: 'CATEGORY';
  constant: PresetCategory;
  name: string;
  chains: ForeignChainNamespace[];
}
/** Presets generate expiry; optional fields retain editable-template compatibility. */
export type PresetRuleTemplate = Omit<Rule, 'agent' | 'validUntil'> & {
  agent?: Address;
  validUntil?: number;
};
/** Presets send native ETH from Push only: the zero address, a native
 * MoveableToken (for example CONSTANTS.MOVEABLE.TOKEN.BASE_SEPOLIA.ETH). */
export interface PresetAsset {
  chainNamespace?: ForeignChainNamespace;
  token: RuleAsset['token'];
  /** Per Push outbound and per allowed operation, in wei. Required and positive.
   * Does not aggregate multiple destination calls in one transaction. */
  maxPerCall: bigint;
  /** Cumulative Push-outbound amount, in wei. Required and positive. */
  maxTotal: bigint;
}
export interface PresetOptions {
  /** Push-PC budget ceiling per outbound; omitted uses the catalog policy (20 PC).
   * Explicit zero is preserved. This is not the fee charged. */
  maxGasPerCall?: bigint;
  chainNamespace?: ForeignChainNamespace;
  agent?: Address;
  /** Omitted: seven days from generation time. Explicit expiry is preserved. */
  validUntil?: number;
  /** Omitted: each chain gets the catalog's ETH limits. Supplied: exactly one
   * native ETH asset for every selected chain. */
  assets?: PresetAsset[];
}
export interface ReadyPresetOptions extends PresetOptions {
  agent: Address;
}
export interface PresetResult<
  T extends PresetRuleTemplate = PresetRuleTemplate
> {
  rules: T[];
}
export interface AgenticPresets {
  list(options?: { type?: 'CATEGORY' }): { presets: Preset[] };
  get(preset: PresetCategory, options: ReadyPresetOptions): PresetResult<Rule>;
  get(preset: PresetCategory, options?: PresetOptions): PresetResult;
}

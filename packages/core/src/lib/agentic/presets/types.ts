import type { Address } from 'viem';
import type { Rule, RuleAsset, ForeignChainNamespace } from '../agentic.types';

export type PresetCategory = 'DEXES' | 'LENDING' | 'PREDICTION';
export interface Preset {
  type: 'CATEGORY';
  constant: PresetCategory;
  name: string;
  chains: ForeignChainNamespace[];
}
/** An editable review-screen template; both identity and expiry are required by create. */
export type PresetRuleTemplate = Omit<Rule, 'agent' | 'validUntil'> & {
  agent?: Address;
  validUntil?: number;
};
export interface PresetAsset {
  chainNamespace?: ForeignChainNamespace;
  token: RuleAsset['token'];
  /** Omitted caps are zero, by the user's October 12 decision. */
  maxPerCall?: bigint;
  maxTotal?: bigint;
}
export interface PresetOptions {
  chainNamespace?: ForeignChainNamespace;
  agent?: Address;
  validUntil?: number;
  assets?: PresetAsset[];
}
export interface ReadyPresetOptions extends PresetOptions {
  agent: Address;
  validUntil: number;
}
export interface AgenticPresets {
  list(options?: { type?: 'CATEGORY' }): { presets: Preset[] };
  get(preset: PresetCategory, options: ReadyPresetOptions): { rules: Rule[] };
  get(
    preset: PresetCategory,
    options?: PresetOptions
  ): { rules: PresetRuleTemplate[] };
}

import type { Address } from 'viem';
import type {
  Rule,
  RuleAsset,
  RuleCall,
  ForeignChainNamespace,
} from '../agentic.types';

export type PresetCategory = 'DEXES' | 'LENDING' | 'STAKING' | 'PREDICTION';
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
  /** Per allowed operation and per Push outbound, in raw token units. Omitted = 0.
   * Does not aggregate multiple destination calls in one transaction. */
  maxPerCall?: bigint;
  /** Cumulative Push-outbound amount only; not lifetime activity on destination-held assets. Omitted = 0. */
  maxTotal?: bigint;
}
export interface PresetOptions {
  /** Explicit Push-PC gas budget per outbound; omitted = zero. */
  maxGasPerCall?: bigint;
  chainNamespace?: ForeignChainNamespace;
  agent?: Address;
  validUntil?: number;
  /** DEX swaps with fewer than two tokens are zero-input-cap review templates.
   * Call get again with a complete pair to generate token pins and amount limits. */
  assets?: PresetAsset[];
}
export interface ReadyPresetOptions extends PresetOptions {
  agent: Address;
  validUntil: number;
}
/** Offline configuration only: does not check deployment, reserves, balances or liquidity. */
export interface PresetConfigurationIssue {
  code:
    | 'AGENT_REQUIRED'
    | 'EXPIRY_REQUIRED'
    | 'GAS_BUDGET_REQUIRED'
    | 'ASSETS_REQUIRED'
    | 'TOKEN_PAIR_REQUIRED'
    | 'NO_ENABLED_OPERATION';
  message: string;
}
export interface PresetCallIssue {
  target: string;
  selector: RuleCall['selector'];
  app?: string;
  reason:
    | 'TOKEN_REQUIRED'
    | 'ZERO_CAP'
    | 'UNSELECTED_TOKEN'
    | 'SHARE_AMOUNT'
    | 'DYNAMIC_AMOUNT'
    | 'POSITION_AMOUNT';
  token?: string;
  alternative?: RuleCall['selector'];
}
export interface PresetChainReadiness {
  chainNamespace: ForeignChainNamespace;
  ready: boolean;
  issues: PresetConfigurationIssue[];
  /** Calls present in the rule but disabled by a zero amount/value maximum. */
  disabledCalls: PresetCallIssue[];
  /** Calls deliberately omitted, including operations with incompatible amount units. */
  excludedCalls: PresetCallIssue[];
  /** Known fixed-token/reserve addresses in this catalog, not selected defaults. */
  knownTokens: string[];
  /** Selected tokens with a zero Push-outbound budget; destination-held assets are separate. */
  zeroBridgeLimits: string[];
}
export interface PresetResult<
  T extends PresetRuleTemplate = PresetRuleTemplate
> {
  rules: T[];
  readiness: { ready: boolean; chains: PresetChainReadiness[] };
}
export interface AgenticPresets {
  list(options?: { type?: 'CATEGORY' }): { presets: Preset[] };
  get(preset: PresetCategory, options: ReadyPresetOptions): PresetResult<Rule>;
  get(preset: PresetCategory, options?: PresetOptions): PresetResult;
}

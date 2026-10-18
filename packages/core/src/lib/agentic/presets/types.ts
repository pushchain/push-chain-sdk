import type { Address } from 'viem';
import type { PUSH_NETWORK } from '../../constants/enums';
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
/** Presets generate expiry; optional fields retain editable-template compatibility. */
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
  /** Offline route/deployment checks; defaults to TESTNET_DONUT. */
  network?: PUSH_NETWORK;
  /** Push funding requires PRC20 routes. Destination funding explicitly emits
   * empty bridge assets while preserving selected token/call limits in metadata.
   * The CEA must already hold the required destination assets. Default: push. */
  funding?: 'push' | 'destination';
  /** Push-PC budget ceiling per outbound; omitted uses the catalog policy (20 PC).
   * Explicit zero is preserved. This is not the fee charged. */
  maxGasPerCall?: bigint;
  chainNamespace?: ForeignChainNamespace;
  agent?: Address;
  /** Omitted: seven days from generation time. Explicit expiry is preserved. */
  validUntil?: number;
  /** Omitted: include the catalog's curated tokens and explicit spending policy.
   * An explicit array replaces all defaults (including [] to select no tokens).
   * Supplied assets retain zero for omitted caps; no policy is guessed for them.
   * DEX swaps with fewer than two tokens remain zero-input-cap review templates. */
  assets?: PresetAsset[];
}
export interface ReadyPresetOptions extends PresetOptions {
  agent: Address;
}
/** Offline configuration/registry checks; chain state and balances are not checked. */
export interface PresetConfigurationIssue {
  code:
    | 'AGENT_REQUIRED'
    | 'EXPIRY_REQUIRED'
    | 'GAS_BUDGET_REQUIRED'
    | 'ASSETS_REQUIRED'
    | 'TOKEN_PAIR_REQUIRED'
    | 'NO_ENABLED_OPERATION'
    | 'AGW_NETWORK_UNAVAILABLE'
    | 'DESTINATION_UNAVAILABLE'
    | 'BRIDGE_ASSET_UNAVAILABLE';
  message: string;
  token?: string;
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
  configurationReady: boolean;
  funding: 'push' | 'destination';
  /** Selected destination permissions, retained even when bridge assets is empty. */
  selectedAssets: RuleAsset[];
  /** Registry presence only; grant preparation verifies exact on-chain identity. */
  bridgeAssets: {
    token: string;
    status: 'registered' | 'unavailable';
    prc20?: Address;
  }[];
  issues: PresetConfigurationIssue[];
  /** Calls present in the rule but disabled by a zero amount/value maximum. */
  disabledCalls: PresetCallIssue[];
  /** Calls deliberately omitted, including operations with incompatible amount units. */
  excludedCalls: PresetCallIssue[];
  /** Known catalog token addresses, including the curated default subset. */
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

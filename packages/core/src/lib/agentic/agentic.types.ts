import type { ArgPinWire } from './codec/pins';
/** Public section-6 rules and internal adapters for the deployed v6 wire format.
 * Source snapshot: October 12, 2026. Internal normalized types are not package exports.
 */
import type { Idl } from '@coral-xyz/anchor';
import type { SvmTermsWire } from './codec/svm-terms';
import type { MoveableToken, MoveableTokenSet } from '../constants/tokens';
import type { UniversalTxResponse } from '../orchestrator/orchestrator.types';
import type { ProgressEvent } from '../progress-hook/progress-hook.types';

export type AgenticAddress = `0x${string}`;
export type AgenticHex = `0x${string}`;
export type ForeignChainNamespace = `eip155:${string}` | `solana:${string}`;
export type AgenticProgressHook = (event: ProgressEvent) => void;

/** '0x617ba037' or 'supply(address,uint256,address,uint16)'. */
export type Selector = AgenticHex | `${string}(${string})`;

/** One Push function a native rule allows, with its own limits and counters. */
export interface NativeAction {
  wirePins?: ArgPinWire[];
  target: AgenticAddress;
  selector: Selector | 'value-only';
  /** Default 0: no native PC value allowance. */
  maxValuePerCall?: bigint;
  /** Default 0: no native PC value allowance. */
  maxValueTotal?: bigint;
  /** Default 0 (unlimited calls until expiry). */
  maxCalls?: number;
  pins?: ArgPin[];
  /** `maxTotal` default uint256 max (unlimited total). */
  amount?: AmountLimit;
  /**
   * Overrides the rule's `validUntil` for this action. Decoded rules set it
   * only when stored actions expire at different times.
   */
  validUntil?: number;
}

interface NativeRuleCommon {
  /** Push address: an EOA, or the UEA of an external key. Never the owner. */
  agent: AgenticAddress;
  /** Omitted = the connected Push chain. */
  chainNamespace?: never;
  /** Unix seconds. */
  validUntil: number;
}

/** A native rule allowing one function (shorthand for a one-entry `actions`). */
export interface NativeSingleRule
  extends NativeRuleCommon,
    Omit<NativeAction, 'validUntil'> {
  actions?: never;
}

/**
 * A native rule allowing 1..8 functions under ONE rule ID. Each action keeps
 * its own limits and counters on-chain; (target, selector) pairs must be
 * unique. One rule per agent on Push keeps send-time selection unambiguous.
 * Internal normalized representation; public callers use Rule.allowedCalls.
 */
export interface NativeMultiRule extends NativeRuleCommon {
  actions: NativeAction[];
  target?: never;
  selector?: never;
  maxValuePerCall?: never;
  maxValueTotal?: never;
  maxCalls?: never;
  pins?: never;
  amount?: never;
}

export type NativeRule = NativeSingleRule | NativeMultiRule;

/**
 * Where a pin or amount sits in the calldata. `arg` is the argument index in
 * the selector signature (requires the signature form of `selector`).
 * `offset` is the raw calldata byte offset, selector included — the form the
 * contracts store; decoded rules (rules.get/list, decodeRules) always use it
 * because stored terms carry no ABI. Advanced input form; ABI argument indexes are preferred for authoring.
 */
export type ArgPin =
  | {
      arg: number;
      offset?: never;
      expected: AgenticHex | AgenticAddress | bigint;
    }
  | { offset: number; arg?: never; expected: AgenticHex };

export type AmountLimit = (
  | { arg: number; offset?: never }
  | { offset: number; arg?: never }
) & {
  maxPerCall: bigint;
  maxTotal?: bigint;
};

export interface AssetCap {
  /** The destination chain's token (MOVEABLE constant) or native marker. */
  token: MoveableToken | AgenticAddress;
  maxPerCall: bigint;
  /** Omitted = zero. Explicit zero forbids movement. */
  maxTotal?: bigint;
}

export interface AllowedCall {
  pins?: ArgPinWire[];
  target: AgenticAddress;
  selector: Selector;
  /** Argument index whose address must be the wallet's destination account. */
  beneficiary?: number;
  /** Exact stored calldata offset for lossless decoded rules; mutually exclusive with beneficiary. Approved advanced input form. */
  beneficiaryOffset?: number;
  /** Default 0. */
  maxValue?: bigint;
}

export interface UniversalRule {
  agent: AgenticAddress;
  chainNamespace: `eip155:${string}`;
  assets: AssetCap[];
  /** PC (wei) per outbound for the destination leg. */
  maxGasPerCall: bigint;
  validUntil: number;
  /** 1..32, all on chainNamespace. */
  allowedCalls: AllowedCall[];
}

/** An address may be base58 or a 32-byte hex Solana public key. */
export type SvmAccountRef =
  | { kind: 'walletCEA' }
  | { kind: 'walletATA'; token: string }
  | { kind: 'address'; address: string };
export type SvmFieldConstraint =
  | { name: string; equals: AgenticHex | bigint | boolean }
  | { name: string; min: bigint }
  | { name: string; max: bigint }
  | {
      numerator: string;
      denominator: string;
      minRatio: { num: bigint; den: bigint };
    };
export interface SvmInstructionRule {
  /** Internal wire override: 0 means no exact account-count constraint. */
  maxAccounts?: number;
  program: string;
  instruction: { idl: Idl; name: string };
  /** Top-level account names from a supported Anchor IDL; optional/nested accounts are rejected. */
  accounts: { name: string; expected: SvmAccountRef }[];
  /** Fixed-width fields only; unsupported/variable layouts fail before signing. */
  fields?: SvmFieldConstraint[];
}
export interface SolanaRule {
  agent: AgenticAddress;
  chainNamespace: `solana:${string}`;
  validUntil: number;
  assets: {
    token: MoveableToken | string;
    maxPerCall: bigint;
    maxTotal?: bigint;
  }[];
  maxGasPerCall: bigint;
  /** Additional output mints whose wallet ATAs must be protected. */
  outputTokens?: string[];
  allowedInstructions: SvmInstructionRule[];
}
/** Lossless stored Solana layout, accepted by update without an invented IDL. */
export interface DecodedSolanaRule extends Omit<SvmTermsWire, 'assets'> {
  format: 'decoded';
  agent: AgenticAddress;
  chainNamespace: `solana:${string}`;
  assets: { token: string; maxPerCall: bigint; maxTotal: bigint }[];
}
export type InternalRule = NativeRule | UniversalRule | SolanaRule;

export interface InternalRulesRecord {
  rulesId: AgenticHex;
  enabled: boolean;
  chainNamespace: string;
  agent: AgenticAddress;
  validUntil: number;
  rule: InternalRule | DecodedSolanaRule;
}

/** Current SDK section 6 public rule shape; contract wire types above are internal. */
export type WalletMarker = 'agentic:wallet';
/** Top-level ABI argument, or a path through static tuple/fixed-array fields. */
export type ArgumentPath = number | readonly number[];
export type Pin =
  | {
      arg: ArgumentPath;
      expected: AgenticHex | AgenticAddress | bigint | WalletMarker;
      max?: never;
      account?: never;
    }
  | { arg: ArgumentPath; max: bigint; expected?: never; account?: never }
  | {
      account: number;
      expected: string | WalletMarker;
      token?: MoveableToken | string;
      arg?: never;
      max?: never;
    };
export interface RuleCall {
  target: string;
  selector: Selector | 'value-only';
  pins?: Pin[];
  maxValue?: bigint;
  app?: string;
  label?: string;
}
export interface RuleAsset {
  token: MoveableToken | string;
  maxPerCall: bigint;
  maxTotal?: bigint;
}
/** Authoring form of a rule asset: `CONSTANTS.MOVEABLE.TOKEN.<CHAIN>.ALL`
 * expands to every routable token with its default limits, so it takes no caps. */
export type RuleAssetInput =
  | RuleAsset
  | { token: MoveableTokenSet; maxPerCall?: never; maxTotal?: never };
export interface Rule {
  agent: AgenticAddress;
  chainNamespace?: ForeignChainNamespace;
  validUntil: number;
  assets?: RuleAsset[];
  maxGasPerCall?: bigint;
  allowedCalls: RuleCall[];
}
/** What create, rules.add and rules.update accept. Every Rule is valid input. */
export interface AuthoredRule extends Omit<Rule, 'assets' | 'allowedCalls'> {
  assets?: RuleAssetInput[];
  /** 1..8 for Push-chain rules, 1..32 for other chains. Omit (or leave empty)
   * on an EVM rule with ERC20 assets to allow only transfers of those tokens
   * back to the owner, plus any `transferTo` recipients. */
  allowedCalls?: RuleCall[];
  /** Tokens-only EVM rules: extra recipients the agent may transfer each asset
   * to, besides the owner. Refused together with allowedCalls. */
  transferTo?: AgenticAddress[];
}
export type RuleInput = AuthoredRule | DecodedSolanaRule;
export type Spent =
  | {
      kind: 'native';
      valueSpent: bigint;
      amountSpent: bigint;
      callsUsed: number;
    }
  | {
      kind: 'native';
      actions: {
        target: AgenticAddress;
        selector: Selector | 'value-only';
        valueSpent: bigint;
        amountSpent: bigint;
        callsUsed: number;
      }[];
    }
  | { kind: 'universal'; assets: { token: string; spent: bigint }[] };
export interface RulesRecord extends Omit<InternalRulesRecord, 'rule'> {
  rule: Rule | DecodedSolanaRule;
  spent: Spent;
}
export interface InternalCreateOptions {
  rules: InternalRule[];
  progressHook?: AgenticProgressHook;
}

export interface CreateOptions {
  rules: RuleInput[];
  progressHook?: AgenticProgressHook;
}

export interface CreateResult {
  wallet: AgenticAddress;
  index: number;
  rulesIds: AgenticHex[];
  tx: UniversalTxResponse;
}

export interface WalletSummary {
  address: AgenticAddress;
  index: number;
  label: string;
  deployed: boolean;
  rulesCount: number;
}

export interface WalletInfo {
  address: AgenticAddress;
  label: string;
  index: number;
  owner: AgenticAddress;
  deployed: boolean;
  rulesCount: number;
}

export type CheckpointKind = 'OWNER_ACTION' | 'RULES_GRANTED' | 'RULES_REVOKED';

export interface Checkpoint {
  seq: number;
  kind: CheckpointKind;
  ref: AgenticHex;
  blockNumber: bigint;
  txHash: AgenticHex;
}

export interface AgenticWallet {
  address: AgenticAddress;
  info(): Promise<WalletInfo>;
  owner(): Promise<{ owner: AgenticAddress }>;
  /** Owner-only rename, at most 64 UTF-8 bytes. Empty resets the default label. */
  setLabel(
    label: string,
    opts?: { progressHook?: AgenticProgressHook }
  ): Promise<UniversalTxResponse>;
  checkpoints(opts?: {
    sinceBlock?: bigint;
  }): Promise<{ checkpoints: Checkpoint[] }>;
  rules: {
    /** Enabled rules only; expired-but-enabled rules remain visible. Includes policy spend counters. */
    list(): Promise<{ rules: RulesRecord[] }>;
    /** Unknown and revoked IDs both return RULE_NOT_FOUND; v1 has no historical records. */
    get(rulesId: AgenticHex): Promise<RulesRecord>;
    add(
      rules: RuleInput[],
      opts?: { progressHook?: AgenticProgressHook }
    ): Promise<{ rulesIds: AgenticHex[]; tx: UniversalTxResponse }>;
    update(params: {
      rules: { rulesId: AgenticHex; rule: RuleInput }[];
      progressHook?: AgenticProgressHook;
    }): Promise<{
      rules: { rulesId: AgenticHex; replaced: AgenticHex }[];
      tx: UniversalTxResponse;
    }>;
    delete(
      rulesIds: AgenticHex[],
      opts?: { progressHook?: AgenticProgressHook }
    ): Promise<UniversalTxResponse>;
    delete(params: {
      all: true;
      progressHook?: AgenticProgressHook;
    }): Promise<UniversalTxResponse>;
  };
}

export interface AgenticNamespace {
  derive(opts?: {
    index?: number;
  }): Promise<{ address: AgenticAddress; index: number; deployed: boolean }>;
  create(label: string, options: CreateOptions): Promise<CreateResult>;
  list(): Promise<{ wallets: WalletSummary[] }>;
  wallet(address: AgenticAddress): AgenticWallet;
}

/** Door the client uses in agenticWallet mode. */
export type AgenticDoor = 'owner' | 'agent';

/** AGW metadata attached to responses produced by an agentic client. */
export interface AgenticTxMetadata {
  wallet: AgenticAddress;
  door: AgenticDoor;
  /** Rule selected for an agent-door send. */
  rulesId?: AgenticHex;
  /** Destination CAIP-2 chain for the selected rule / outbound. */
  chainNamespace?: string;
  /** The wallet's destination account (CEA) for an outbound. */
  destinationAccount?: AgenticAddress;
  /**
   * Ordered calls encoded for the destination CEA. Outbound response
   * to/data/value summarize the first call, including an SDK-generated token
   * transfer. Replay uses the same representation; it cannot recover which
   * calls were supplied explicitly versus generated from funds.
   */
  destinationCalls?: readonly {
    to: AgenticAddress;
    data: AgenticHex;
    value: bigint;
  }[];
  /** SVM instruction executed by the wallet's destination CEA. */
  destinationInstruction?: {
    program: AgenticHex;
    data: AgenticHex;
    accounts: readonly { pubkey: AgenticHex; isWritable: boolean }[];
  };
  /** Funds-only Solana transfer. token is the burned PRC20 on Push. */
  destinationTransfer?: {
    recipient: AgenticHex;
    token: AgenticAddress;
    amount: bigint;
  };
  /** Ordered actions in a native agent batch; to/data/value summarize its first action. */
  nativeCalls?: readonly {
    to: AgenticAddress;
    data: AgenticHex;
    value: bigint;
  }[];
  /** Account the signer's transaction actually called (wallet or outer sender account). */
  rawTo: string;
  /** Calldata the signer's transaction actually carried. */
  rawData: string;
}

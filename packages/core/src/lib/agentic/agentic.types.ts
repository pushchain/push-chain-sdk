/**
 * Public AGW types — AGW SDK page section 3 (Notion export 2026-10-03 13:23 IST).
 *
 * Provisional items are tagged with the plan assumption that must close before
 * they are final (plan/agw/implementation-plan.md, A01–A08).
 */
import type { MoveableToken } from '../constants/tokens';
import type { UniversalTxResponse } from '../orchestrator/orchestrator.types';
import type { ProgressEvent } from '../progress-hook/progress-hook.types';

export type AgenticAddress = `0x${string}`;
export type AgenticHex = `0x${string}`;
export type ForeignChainNamespace = `eip155:${string}` | `solana:${string}`;
export type AgenticProgressHook = (event: ProgressEvent) => void;

/** '0x617ba037' or 'supply(address,uint256,address,uint16)'. */
export type Selector = AgenticHex | `${string}(${string})`;

export interface NativeRule {
  /** Push address: an EOA, or the UEA of an external key. Never the owner. */
  agent: AgenticAddress;
  /** Emitted in RulesGranted when the generation supports it (A07). */
  ref?: AgenticHex;
  /** Omitted = the connected Push chain. */
  chainNamespace?: never;
  target: AgenticAddress;
  selector: Selector | 'value-only';
  /** Unix seconds. */
  validUntil: number;
  /** Default 0 (no native value) — provisional, A03. */
  maxValuePerCall?: bigint;
  /** Default 0 (no native value) — provisional, A03. */
  maxValueTotal?: bigint;
  /** Default 0 (unlimited calls until expiry) — provisional, A03. */
  maxCalls?: number;
  /** `arg` is the argument index in the selector signature. */
  pins?: { arg: number; expected: AgenticHex | AgenticAddress | bigint }[];
  /** `maxTotal` default uint256 max (unlimited total) — provisional, A03. */
  amount?: { arg: number; maxPerCall: bigint; maxTotal?: bigint };
}

export interface AssetCap {
  /** The destination chain's token (MOVEABLE constant) or native marker. */
  token: MoveableToken | AgenticAddress;
  maxPerCall: bigint;
  /** Omitted = 0 = unlimited in the proposed multi-asset ABI — provisional, A03/A05. */
  maxTotal?: bigint;
}

export interface AllowedCall {
  target: AgenticAddress;
  selector: Selector;
  /** Argument index whose address must be the wallet's destination account. */
  beneficiary?: number;
  /** Default 0 — provisional, A03. */
  maxValue?: bigint;
}

export interface UniversalRule {
  agent: AgenticAddress;
  ref?: AgenticHex;
  chainNamespace: ForeignChainNamespace;
  assets: AssetCap[];
  /** PC (wei) per outbound for the destination leg. */
  maxGasPerCall: bigint;
  validUntil: number;
  /** 1..32, all on chainNamespace. */
  allowedCalls: AllowedCall[];
}

export type Rule = NativeRule | UniversalRule;

/**
 * Spend counters for a rule. PROVISIONAL (A05, Harsh H4.2): the universal
 * scalar `amountSpent` cannot represent multi-asset rules; the per-token
 * shape is pending.
 */
export type Spent =
  | { kind: 'universal'; amountSpent: bigint }
  | { kind: 'native'; valueSpent: bigint; amountSpent: bigint; callsUsed: number };

export interface RulesRecord {
  rulesId: AgenticHex;
  enabled: boolean;
  chainNamespace: string;
  agent: AgenticAddress;
  validUntil: number;
  ref: AgenticHex;
  rule: Rule;
  spent: Spent;
}

export interface CreateOptions {
  rules: Rule[];
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
  /** PROPOSED (page 1 item 10); capability-gated, A07. */
  setLabel(
    label: string,
    opts?: { progressHook?: AgenticProgressHook }
  ): Promise<UniversalTxResponse>;
  checkpoints(opts?: { sinceBlock?: bigint }): Promise<{ checkpoints: Checkpoint[] }>;
  rules: {
    list(): Promise<{ rules: RulesRecord[] }>;
    get(rulesId: AgenticHex): Promise<RulesRecord>;
    add(
      rules: Rule[],
      opts?: { progressHook?: AgenticProgressHook }
    ): Promise<{ rulesIds: AgenticHex[]; tx: UniversalTxResponse }>;
    update(params: {
      rules: { rulesId: AgenticHex; rule: Rule }[];
      progressHook?: AgenticProgressHook;
    }): Promise<{ rules: { rulesId: AgenticHex; replaced: AgenticHex }[]; tx: UniversalTxResponse }>;
    revoke(
      rulesIds: AgenticHex[],
      opts?: { progressHook?: AgenticProgressHook }
    ): Promise<UniversalTxResponse>;
    revoke(params: { all: true; progressHook?: AgenticProgressHook }): Promise<UniversalTxResponse>;
  };
}

export interface AgenticNamespace {
  derive(opts?: { index?: number }): Promise<{ address: AgenticAddress; index: number; deployed: boolean }>;
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
  /** Account the signer's transaction actually called (the wallet). */
  rawTo: string;
  /** Calldata the signer's transaction actually carried. */
  rawData: string;
}

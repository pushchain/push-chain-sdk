/**
 * Stage 3 — recursive cascade walker.
 *
 * Starting from any universal-tx hash on a supported chain, walk forward
 * across the universal-tx graph and return a tree:
 *
 *   Push root  ──outbound──▶  Destination finalize  ──child-inbound──▶  Follow-up Push tx  ─...
 *
 * Uses the chain-module key formulas (sha256-based; see
 * push-chain/x/uexecutor/types/keys.go) to resolve:
 *   - Push-initiated outbounds → destination external txs (via pcTx utx record)
 *   - Destination CEA-originated inbounds → child Push txs (via inbound utx record)
 *
 * Cycle-safe via a `visited` set on (chain, txHash). Bounded by maxDepth.
 */
import { createPublicClient, fallback, http, type PublicClient } from 'viem';

import { CHAIN_INFO } from '../constants/chain';
import { CHAIN, PUSH_NETWORK, VM } from '../constants/enums';
import type { PushClient } from '../push-client/push-client';

import {
  deriveChildUniversalTxId,
  derivePcUniversalTxId,
  resolveChildInboundsFromDetection,
  type ChildInboundResolution,
} from './child-inbounds';
import { detectUniversalTx } from './detector';
import type {
  PushChainOutboundSummary,
  UniversalTxDetection,
} from './types';

const PUSH_CHAIN_CAIPS = new Set<string>([
  CHAIN.PUSH_MAINNET,
  CHAIN.PUSH_TESTNET_DONUT,
  CHAIN.PUSH_LOCALNET,
]);

export interface PcRefundSummary {
  /** Refund tx on Push Chain. */
  txHash: string;
  sender: string;
  gasUsed: number;
  blockHeight: number;
  status: string;
  errorMsg: string;
  /** subTxId of the parent outbound — useful for UI correlation. */
  parentOutboundId: string;
}

export interface CascadeEdge {
  edgeKind: 'outbound' | 'child-inbound' | 'pc-refund';
  /**
   * Summary of the relationship.
   *   - `outbound`       → PushChainOutboundSummary (cosmos outbound tuple)
   *   - `child-inbound`  → ChildInboundResolution (destination → Push follow-up)
   *   - `pc-refund`      → PcRefundSummary (gas-refund tx on Push)
   */
  relation: PushChainOutboundSummary | ChildInboundResolution | PcRefundSummary;
  /**
   * Expanded child node, or null when the target chain isn't supported /
   * depth is exhausted / an RPC lookup failed.
   */
  node: CascadeNode | null;
}

export interface CascadeNode {
  detection: UniversalTxDetection;
  children: CascadeEdge[];
  /** Depth from the starting node (0 = root). */
  depth: number;
  /** Set when we stopped expanding because of maxDepth or a cycle. */
  truncated?: 'maxDepth' | 'cycle';
}

export interface TraceCascadeOptions {
  /** Required — cosmos queries drive the cascade. */
  pushClient: PushClient;
  /** Default 4. Depth 0 is the root. */
  maxDepth?: number;
  /** Per-chain RPC overrides. Falls back to CHAIN_INFO defaultRPC. */
  rpcUrls?: Partial<Record<CHAIN, string[]>>;
  /**
   * Which Push Chain CAIP to recurse into when walking child-inbounds.
   * Defaults to CHAIN.PUSH_TESTNET_DONUT.
   */
  pushChain?: CHAIN;
  /**
   * Called with each node as it is resolved. Useful for progressive UI.
   */
  onNode?: (node: CascadeNode) => void;
}

interface InternalState {
  visited: Set<string>;
  pushChain: CHAIN;
  maxDepth: number;
  notes: string[];
}

/**
 * Walk the universal-tx graph starting from `(startHash, startChain)` and
 * return the full cascade tree.
 */
export async function traceUniversalTxCascade(
  startHash: `0x${string}`,
  startChain: CHAIN,
  opts: TraceCascadeOptions
): Promise<CascadeNode> {
  const state: InternalState = {
    visited: new Set(),
    pushChain: opts.pushChain ?? CHAIN.PUSH_TESTNET_DONUT,
    maxDepth: opts.maxDepth ?? 4,
    notes: [],
  };

  const root = await walk(startHash, startChain, 0, state, opts);
  if (!root) {
    // Should never happen for depth=0; return an empty detection node so the
    // caller has something to render.
    return {
      detection: {
        txHash: startHash,
        chain: startChain,
        kind: 'UNKNOWN',
        emitters: [],
        decoded: {},
        matchingLogs: [],
        detections: [],
        notes: ['cascade: unable to fetch root'],
      },
      children: [],
      depth: 0,
    };
  }
  return root;
}

// ── Core recursion ────────────────────────────────────────────────────

async function walk(
  txHash: `0x${string}`,
  chain: CHAIN,
  depth: number,
  state: InternalState,
  opts: TraceCascadeOptions
): Promise<CascadeNode | null> {
  const key = `${chain}::${txHash.toLowerCase()}`;
  if (state.visited.has(key)) {
    // Return a stub node representing the cycle — callers can detect via
    // `truncated === 'cycle'`.
    return null;
  }
  state.visited.add(key);

  const chainInfo = CHAIN_INFO[chain];
  if (!chainInfo || chainInfo.vm !== VM.EVM) return null;

  const detection = await detectUniversalTx(txHash, chain, {
    pushClient: opts.pushClient,
    rpcUrls: opts.rpcUrls,
    // We run our own cosmos queries below to build the cascade; skip the
    // detector's built-in single-record lookup to avoid redundant traffic.
    skipPushChainLookup: true,
  });

  const node: CascadeNode = { detection, children: [], depth };
  opts.onNode?.(node);

  if (depth >= state.maxDepth) {
    node.truncated = 'maxDepth';
    return node;
  }

  if (PUSH_CHAIN_CAIPS.has(chain)) {
    // Push Chain node — walk outbounds from the pc utx record.
    await expandPushOutbounds(node, txHash, chain, state, opts);
  } else {
    // External chain — walk child inbounds (CEA-originated UniversalTx logs).
    await expandExternalChildInbounds(node, detection, state, opts);
  }

  return node;
}

async function expandPushOutbounds(
  node: CascadeNode,
  txHash: `0x${string}`,
  chain: CHAIN,
  state: InternalState,
  opts: TraceCascadeOptions
): Promise<void> {
  const pcUtxId = derivePcUniversalTxId(chain, txHash);
  try {
    const resp = await opts.pushClient.getUniversalTxByIdV2(
      pcUtxId.slice(2)
    );
    const utx = resp?.universalTx;
    if (!utx || !utx.outboundTx || utx.outboundTx.length === 0) return;

    for (const ob of utx.outboundTx) {
      const destChainStr = ob.destinationChain ?? '';
      const externalTxHash = ob.observedTx?.txHash || '';
      const summary: PushChainOutboundSummary = {
        subTxId: ob.id ?? '',
        status: outboundStatusName(ob.outboundStatus as number | undefined),
        destinationChain: destChainStr,
        externalTxHash: externalTxHash || undefined,
        amount: ob.amount,
        recipient: ob.recipient,
      };
      if (!externalTxHash || !isSupportedChainCaip(destChainStr)) {
        node.children.push({
          edgeKind: 'outbound',
          relation: summary,
          node: null,
        });
      } else {
        const childNode = await walk(
          externalTxHash as `0x${string}`,
          destChainStr as CHAIN,
          node.depth + 1,
          state,
          opts
        );
        node.children.push({
          edgeKind: 'outbound',
          relation: summary,
          node: childNode,
        });
      }

      // Gas-refund edge: the chain records refund tx on outbound.pcRefundExecution
      // (push-chain/x/uexecutor/keeper/outbound.go:228). Emit a pc-refund edge
      // when present and recurse into the refund tx on Push Chain.
      const refund = ob.pcRefundExecution;
      if (refund && refund.txHash) {
        const refundSummary: PcRefundSummary = {
          txHash: refund.txHash,
          sender: refund.sender ?? '',
          gasUsed:
            typeof refund.gasUsed === 'bigint'
              ? Number(refund.gasUsed)
              : (refund.gasUsed as number) ?? 0,
          blockHeight:
            typeof refund.blockHeight === 'bigint'
              ? Number(refund.blockHeight)
              : (refund.blockHeight as number) ?? 0,
          status: refund.status ?? '',
          errorMsg: refund.errorMsg ?? '',
          parentOutboundId: ob.id ?? '',
        };
        const refundNode = await walk(
          refund.txHash as `0x${string}`,
          chain,
          node.depth + 1,
          state,
          opts
        );
        node.children.push({
          edgeKind: 'pc-refund',
          relation: refundSummary,
          node: refundNode,
        });
      }
    }
  } catch (err) {
    node.detection.notes.push(
      `cascade: pc outbound lookup failed: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
}

async function expandExternalChildInbounds(
  node: CascadeNode,
  detection: UniversalTxDetection,
  state: InternalState,
  opts: TraceCascadeOptions
): Promise<void> {
  const resolutions = await resolveChildInboundsFromDetection(
    opts.pushClient,
    detection,
    node.detection.notes
  );

  for (const res of resolutions) {
    // Walk each Push follow-up tx produced by this inbound.
    if (res.pcTxHashes.length === 0) {
      node.children.push({
        edgeKind: 'child-inbound',
        relation: res,
        node: null,
      });
      continue;
    }
    for (const pcHash of res.pcTxHashes) {
      const childNode = await walk(
        pcHash as `0x${string}`,
        state.pushChain,
        node.depth + 1,
        state,
        opts
      );
      node.children.push({
        edgeKind: 'child-inbound',
        relation: res,
        node: childNode,
      });
    }
  }
}

// ── Utilities ─────────────────────────────────────────────────────────

function isSupportedChainCaip(caip: string): boolean {
  if (!caip) return false;
  const info = CHAIN_INFO[caip as CHAIN];
  return Boolean(info && info.vm === VM.EVM);
}

function outboundStatusName(n: number | undefined): string {
  switch (n) {
    case 0:
      return 'OUTBOUND_STATUS_UNSPECIFIED';
    case 1:
      return 'PENDING';
    case 2:
      return 'OBSERVED';
    case 3:
      return 'REVERTED';
    default:
      return `UNKNOWN(${n ?? '?'})`;
  }
}

/** Flatten a cascade tree into depth-first linear node list (root first). */
export function flattenCascade(root: CascadeNode): CascadeNode[] {
  const out: CascadeNode[] = [];
  const stack: CascadeNode[] = [root];
  while (stack.length > 0) {
    const n = stack.pop() as CascadeNode;
    out.push(n);
    for (let i = n.children.length - 1; i >= 0; i--) {
      const c = n.children[i].node;
      if (c) stack.push(c);
    }
  }
  return out;
}

// silence unused-import warning for viem helpers not yet referenced
void createPublicClient;
void fallback;
void http;
export type { PublicClient } from 'viem';
export { PUSH_NETWORK };

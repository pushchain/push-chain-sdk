/**
 * Unit tests for the detector module's user-facing normalization pass.
 *
 * Contract: `normalize*ForUser` helpers convert SVM `externalTxHash` from
 * `0x`-prefixed hex to base58 at the public-API boundary, leave EVM hashes
 * unchanged, and preserve referential identity when no rewrite is needed
 * (so EVM-only graphs incur near-zero allocation).
 */
import { bs58 } from '../../internal/bs58';
import { CHAIN } from '../../constants/enums';
import {
  normalizeOutboundSummaryForUser,
  normalizeDetectionForUser,
  normalizeChildInboundResolutionForUser,
  normalizeCascadeNodeForUser,
} from '../normalize';
import type {
  PushChainOutboundSummary,
  UniversalTxDetection,
  PushChainCrossRef,
} from '../types';
import type { CascadeNode } from '../cascade';
import type { ChildInboundResolution } from '../child-inbounds';

// 64-byte Solana signature in `0x`-hex form (matches what Cosmos delivers
// for an SVM outbound). Encoded base58 below for comparison.
const SVM_HEX =
  ('0x' + 'ab'.repeat(64)) as `0x${string}`;
const SVM_BASE58 = bs58.encode(
  Buffer.from(SVM_HEX.slice(2), 'hex')
);

const EVM_HEX_32 =
  '0xdeadbeef00000000000000000000000000000000000000000000000000000000';

function makeOutbound(
  destinationChain: string,
  externalTxHash?: string
): PushChainOutboundSummary {
  return {
    subTxId: 'sub-1',
    status: 'OBSERVED',
    destinationChain,
    externalTxHash,
    amount: '0',
    recipient: '0xaaaa',
  };
}

function makeDetection(
  pushChainTx?: PushChainCrossRef
): UniversalTxDetection {
  return {
    txHash: EVM_HEX_32 as `0x${string}`,
    chain: CHAIN.PUSH_TESTNET_DONUT,
    kind: 'OUTBOUND_INITIATED',
    emitters: [],
    decoded: {},
    matchingLogs: [],
    detections: [],
    pushChainTx,
    notes: [],
  };
}

describe('normalize — PushChainOutboundSummary.externalTxHash for SVM', () => {
  describe('normalizeOutboundSummaryForUser', () => {
    it('returns the SAME reference for an EVM destination (passthrough)', () => {
      const s = makeOutbound('eip155:11155111', EVM_HEX_32);
      const next = normalizeOutboundSummaryForUser(s);
      expect(next).toBe(s);
      expect(next.externalTxHash).toBe(EVM_HEX_32);
    });

    it('converts 0x-hex → base58 for Solana Devnet destination', () => {
      const s = makeOutbound('solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1', SVM_HEX);
      const next = normalizeOutboundSummaryForUser(s);
      expect(next).not.toBe(s); // new object
      expect(next.externalTxHash).toBe(SVM_BASE58);
      expect(next.externalTxHash?.startsWith('0x')).toBe(false);
      // All other fields preserved as-is.
      expect(next.subTxId).toBe(s.subTxId);
      expect(next.destinationChain).toBe(s.destinationChain);
      expect(next.amount).toBe(s.amount);
      expect(next.recipient).toBe(s.recipient);
    });

    it('is idempotent — running the helper twice yields the same value', () => {
      const s = makeOutbound('solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1', SVM_HEX);
      const once = normalizeOutboundSummaryForUser(s);
      const twice = normalizeOutboundSummaryForUser(once);
      // Second pass should be a no-op (input is already base58).
      expect(twice).toBe(once);
      expect(twice.externalTxHash).toBe(SVM_BASE58);
    });

    it('passes through a value that already lacks 0x prefix (already base58)', () => {
      const s = makeOutbound('solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1', SVM_BASE58);
      const next = normalizeOutboundSummaryForUser(s);
      expect(next).toBe(s);
    });

    it('passes through when externalTxHash is undefined', () => {
      const s = makeOutbound('solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1', undefined);
      const next = normalizeOutboundSummaryForUser(s);
      expect(next).toBe(s);
      expect(next.externalTxHash).toBeUndefined();
    });

    it('does not mutate the input', () => {
      const s = makeOutbound('solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1', SVM_HEX);
      const snapshot = { ...s };
      normalizeOutboundSummaryForUser(s);
      expect(s).toEqual(snapshot);
    });
  });

  describe('normalizeDetectionForUser', () => {
    it('returns same reference when pushChainTx is undefined', () => {
      const d = makeDetection(undefined);
      expect(normalizeDetectionForUser(d)).toBe(d);
    });

    it('returns same reference when no nested outbound needs normalization (EVM only)', () => {
      const d = makeDetection({
        id: 'utx-1',
        status: 2,
        statusName: 'OBSERVED',
        pcTxHashes: [EVM_HEX_32],
        outboundHashes: [makeOutbound('eip155:11155111', EVM_HEX_32)],
      });
      expect(normalizeDetectionForUser(d)).toBe(d);
    });

    it('rewrites SVM externalTxHash inside pushChainTx.outboundHashes', () => {
      const svmSummary = makeOutbound(
        'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
        SVM_HEX
      );
      const d = makeDetection({
        id: 'utx-1',
        status: 2,
        statusName: 'OBSERVED',
        pcTxHashes: [EVM_HEX_32],
        outboundHashes: [svmSummary],
      });
      const next = normalizeDetectionForUser(d);
      expect(next).not.toBe(d);
      expect(next.pushChainTx?.outboundHashes[0].externalTxHash).toBe(
        SVM_BASE58
      );
      // pcTxHashes (Push Chain EVM) untouched.
      expect(next.pushChainTx?.pcTxHashes).toEqual([EVM_HEX_32]);
      expect(next.pushChainTx?.pcTxHashes).toBe(d.pushChainTx!.pcTxHashes);
    });
  });

  describe('normalizeChildInboundResolutionForUser', () => {
    const baseRes: ChildInboundResolution = {
      universalTxId:
        '0x031dd1d75de2d4fd989752eb05c27b6a77aa40d038323cd9da3c7b51fb209819',
      sourceLogIndex: 0,
      sourceEventName: 'UniversalTx',
      status: 2,
      statusName: 'OBSERVED',
      pcTxHashes: [EVM_HEX_32],
      outboundHashes: [],
    };

    it('passes through pcTxHashes unchanged', () => {
      const r = {
        ...baseRes,
        outboundHashes: [],
      };
      const next = normalizeChildInboundResolutionForUser(r);
      expect(next).toBe(r);
      expect(next.pcTxHashes).toEqual([EVM_HEX_32]);
    });

    it('rewrites SVM externalTxHash inside outboundHashes', () => {
      const r = {
        ...baseRes,
        outboundHashes: [
          makeOutbound('solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1', SVM_HEX),
          makeOutbound('eip155:11155111', EVM_HEX_32),
        ],
      };
      const next = normalizeChildInboundResolutionForUser(r);
      expect(next).not.toBe(r);
      expect(next.outboundHashes[0].externalTxHash).toBe(SVM_BASE58);
      // EVM entry unchanged (same reference).
      expect(next.outboundHashes[1]).toBe(r.outboundHashes[1]);
      // universalTxId and pcTxHashes preserved.
      expect(next.universalTxId).toBe(baseRes.universalTxId);
      expect(next.pcTxHashes).toBe(r.pcTxHashes);
    });
  });

  describe('normalizeCascadeNodeForUser', () => {
    function makeNode(
      detection: UniversalTxDetection,
      children: CascadeNode['children'] = [],
      depth = 0
    ): CascadeNode {
      return { detection, children, depth };
    }

    it('returns same reference when nothing in the tree needs normalization', () => {
      const root = makeNode(makeDetection(undefined));
      expect(normalizeCascadeNodeForUser(root)).toBe(root);
    });

    it('rewrites SVM externalTxHash in edge.relation (outbound) and recurses into edge.node', () => {
      const svmSummary = makeOutbound(
        'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
        SVM_HEX
      );
      // Child node carries an SVM outbound nested inside its own detection too.
      const childDetection = makeDetection({
        id: 'utx-2',
        status: 2,
        statusName: 'OBSERVED',
        pcTxHashes: [],
        outboundHashes: [svmSummary],
      });
      const childNode = makeNode(childDetection, [], 1);
      const root: CascadeNode = makeNode(makeDetection(undefined), [
        {
          edgeKind: 'outbound',
          relation: svmSummary,
          node: childNode,
        },
      ]);

      const next = normalizeCascadeNodeForUser(root);
      expect(next).not.toBe(root);

      // Edge-level relation normalized.
      const edge = next.children[0];
      expect(edge.relation).not.toBe(svmSummary);
      expect(
        (edge.relation as PushChainOutboundSummary).externalTxHash
      ).toBe(SVM_BASE58);

      // Child node's nested detection.pushChainTx.outboundHashes also normalized.
      expect(edge.node).not.toBeNull();
      expect(
        edge.node!.detection.pushChainTx?.outboundHashes[0].externalTxHash
      ).toBe(SVM_BASE58);

      // Tree structure preserved (depths, lengths).
      expect(next.depth).toBe(0);
      expect(next.children).toHaveLength(1);
      expect(edge.node!.depth).toBe(1);
    });

    it('does not mutate the input tree', () => {
      const svmSummary = makeOutbound(
        'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
        SVM_HEX
      );
      const root: CascadeNode = makeNode(makeDetection(undefined), [
        { edgeKind: 'outbound', relation: svmSummary, node: null },
      ]);
      normalizeCascadeNodeForUser(root);
      // Original summary still in raw hex form.
      expect(svmSummary.externalTxHash).toBe(SVM_HEX);
      expect(root.children[0].relation).toBe(svmSummary);
    });
  });
});

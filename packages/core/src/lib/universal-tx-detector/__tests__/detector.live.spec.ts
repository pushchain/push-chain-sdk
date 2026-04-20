/**
 * Live e2e for detectUniversalTx against real public RPCs + real tx hashes.
 *
 * Opt-in: skipped unless ACTIVE_CHAINS is set.
 *   ACTIVE_CHAINS=bnb_testnet,sepolia npx nx test core \
 *     --testPathPattern="universal-tx-detector.*live" --skip-nx-cache
 *
 * The tests do NOT hardcode expected kinds — they assert that the detector
 * returns a valid, non-UNKNOWN classification with coherent identifiers. The
 * live tx hashes come from a session where we captured real reverted + success
 * traffic on BSC Testnet and Sepolia.
 */
import { detectUniversalTx } from '../detector';
import { resolveChildInboundsFromDetection } from '../child-inbounds';
import { traceUniversalTxCascade, flattenCascade } from '../cascade';
import { detectUniversalTxAuto } from '../auto-detect';
import { CHAIN, PUSH_NETWORK } from '../../constants/enums';
import { PushClient } from '../../push-client/push-client';
import type { UniversalTxDetection, UniversalTxKind } from '../types';

const active = (process.env['ACTIVE_CHAINS'] ?? '').toLowerCase();
const bnbEnabled = active.includes('bnb');
const sepoliaEnabled = active.includes('sepolia');
const solanaEnabled = active.includes('solana');

const maybeBnb = bnbEnabled ? it : it.skip;
const maybeSepolia = sepoliaEnabled ? it : it.skip;
const maybeSolana = solanaEnabled ? it : it.skip;

// Set via env: SOLANA_SVM_R3_SIG=<base58 signature from a real R3 CEA→Push run>
const SOLANA_SVM_R3_SIG = process.env['SOLANA_SVM_R3_SIG'] ?? '';

// Session-captured hashes (Apr 19 2026). See /Users/shoaibmohammed/.claude/plans/agile-painting-dragon.md.
const USER_BSC_HASH =
  '0x80fc70302f8eaac02649b18fe5a09b1580d0f6190b420d3a1058c39ecbf53443' as const;
const SEPOLIA_FUNDS_R3_SUCCESS =
  '0x9c40ac52cf6d88602c7e8f0a36d08ec06774450c8e30d2739ee81b5ebd0dee79' as const;

const KNOWN_KINDS: ReadonlyArray<UniversalTxKind> = [
  'INBOUND_FROM_EOA',
  'INBOUND_FROM_CEA',
  'OUTBOUND_INITIATED',
  'OUTBOUND_FINALIZED',
  'OUTBOUND_REVERTED',
  'INBOUND_REVERTED',
  'EXECUTED_ON_DEST',
  'RESCUED_FUNDS',
  'UNKNOWN',
];

jest.setTimeout(60_000);

describe('detectUniversalTx (live)', () => {
  maybeBnb(
    'user-supplied BSC Testnet hash decodes into a known kind',
    async () => {
      const out = await detectUniversalTx(USER_BSC_HASH, CHAIN.BNB_TESTNET);
      // eslint-disable-next-line no-console
      console.log('[live] BSC', JSON.stringify(summarize(out), null, 2));
      expect(KNOWN_KINDS).toContain(out.kind);
      expect(out.txHash).toBe(USER_BSC_HASH);
      if (out.kind !== 'UNKNOWN') {
        expect(out.matchingLogs.length).toBeGreaterThan(0);
      }
    }
  );

  maybeSepolia(
    'Sepolia FUNDS R3 success decodes as OUTBOUND_FINALIZED with subTxId + universalTxId',
    async () => {
      const out = await detectUniversalTx(
        SEPOLIA_FUNDS_R3_SUCCESS,
        CHAIN.ETHEREUM_SEPOLIA
      );
      // eslint-disable-next-line no-console
      console.log('[live] Sepolia', JSON.stringify(summarize(out), null, 2));
      expect(out.kind).toBe('OUTBOUND_FINALIZED');
      expect(out.decoded.subTxId).toMatch(/^0x[0-9a-f]{64}$/);
      expect(out.decoded.universalTxId).toMatch(/^0x[0-9a-f]{64}$/);
      expect(out.decoded.pushAccount).toMatch(/^0x[a-fA-F0-9]{40}$/);

      // Stage 1 — receipt carries BOTH the Vault finalize AND a CEA-originated
      // UniversalTx (R3 round-trip-back). Surface both via `detections`.
      const kinds = out.detections.map((d) => d.kind);
      expect(kinds).toEqual(
        expect.arrayContaining(['OUTBOUND_FINALIZED', 'INBOUND_FROM_CEA'])
      );
      const inbound = out.detections.find((d) => d.kind === 'INBOUND_FROM_CEA');
      expect(inbound?.decoded.fromCEA).toBe(true);
    }
  );

  // Stage 2 — Sepolia outbound's CEA-originated UniversalTx (log 249) resolves
  // to the follow-up Push tx via the deterministic sha256(caip:hash:logIndex)
  // formula (matches push-chain/x/uexecutor/types/keys.go:49-53).
  maybeSepolia(
    'Stage 2 — Sepolia detection resolves child inbound → follow-up Push Chain tx',
    async () => {
      const pushClient = new PushClient({
        network: PUSH_NETWORK.TESTNET_DONUT,
        rpcUrls: ['https://evm.donut.rpc.push.org/'],
      });
      const detection = await detectUniversalTx(
        SEPOLIA_FUNDS_R3_SUCCESS,
        CHAIN.ETHEREUM_SEPOLIA,
        { pushClient, skipPushChainLookup: true }
      );
      const children = await resolveChildInboundsFromDetection(
        pushClient,
        detection
      );
      // eslint-disable-next-line no-console
      console.log('[live] stage2 children', JSON.stringify(children, null, 2));
      expect(children.length).toBeGreaterThanOrEqual(1);
      const allPushHashes = children.flatMap((c) => c.pcTxHashes);
      expect(
        allPushHashes.some((h) => h.toLowerCase().startsWith('0xd938ea'))
      ).toBe(true);
    }
  );

  // Stage 3 — full cascade walker from the Push root.
  // Expects a 3-node linear tree matching the explorer Journey view:
  //   Push root 0x80fc70…  ──outbound──▶  Sepolia 0x9c40ac…  ──child-inbound──▶  Push 0xd938ea…
  const PUSH_ROOT =
    '0x80fc70302f8eaac02649b18fe5a09b1580d0f6190b420d3a1058c39ecbf53443' as const;
  const PUSH_FOLLOW_UP_PREFIX = '0xd938ea';

  maybeSepolia(
    'Stage 3 — full cascade from Push root → Sepolia → follow-up Push tx',
    async () => {
      const pushClient = new PushClient({
        network: PUSH_NETWORK.TESTNET_DONUT,
        rpcUrls: ['https://evm.donut.rpc.push.org/'],
      });
      const root = await traceUniversalTxCascade(
        PUSH_ROOT,
        CHAIN.PUSH_TESTNET_DONUT,
        { pushClient }
      );
      const flat = flattenCascade(root);
      // eslint-disable-next-line no-console
      console.log(
        '[live] cascade',
        JSON.stringify(
          flat.map((n) => ({
            depth: n.depth,
            chain: n.detection.chain,
            txHash: n.detection.txHash,
            kind: n.detection.kind,
          })),
          null,
          2
        )
      );

      expect(flat.length).toBeGreaterThanOrEqual(3);
      expect(flat[0].detection.txHash.toLowerCase()).toBe(
        PUSH_ROOT.toLowerCase()
      );
      expect(flat[0].detection.kind).toBe('OUTBOUND_INITIATED');

      const sepolia = flat.find(
        (n) => n.detection.chain === CHAIN.ETHEREUM_SEPOLIA
      );
      expect(sepolia).toBeDefined();
      expect(sepolia?.detection.kind).toBe('OUTBOUND_FINALIZED');

      const followUp = flat.find((n) =>
        n.detection.txHash.toLowerCase().startsWith(PUSH_FOLLOW_UP_PREFIX)
      );
      expect(followUp).toBeDefined();
      expect(followUp?.detection.chain).toBe(CHAIN.PUSH_TESTNET_DONUT);

      // Stage 4b — gas-refund edge. outbound.pcRefundExecution carries the
      // refund tx on Push Chain; expect an `pc-refund` edge hanging off the
      // Push root whose node is the refund tx (0xa74970…375248).
      const refundEdge = root.children.find((c) => c.edgeKind === 'pc-refund');
      expect(refundEdge).toBeDefined();
      const refundRel = refundEdge!.relation as {
        txHash: string;
        gasUsed: number;
        status: string;
      };
      expect(refundRel.txHash.toLowerCase()).toBe(
        '0xa74970a9905b9ef233e489f6def62c75f78c7469c769d41929ceda76fd375248'
      );
      expect(refundRel.gasUsed).toBe(182769);
      expect(refundRel.status).toBe('SUCCESS');
    }
  );

  // Stage 4a — auto chain detection. Callers pass only a hash; probe all
  // registered EVM chains in parallel, Push-first.
  maybeSepolia(
    'Stage 4a — detectUniversalTxAuto resolves Push root without explicit chain',
    async () => {
      const res = await detectUniversalTxAuto(PUSH_ROOT);
      // eslint-disable-next-line no-console
      console.log(
        '[live] auto attempts',
        JSON.stringify(res.attempts, null, 2)
      );
      expect(res.detection).toBeDefined();
      expect(res.detection?.chain).toBe(CHAIN.PUSH_TESTNET_DONUT);
      expect(res.detection?.kind).toBe('OUTBOUND_INITIATED');
    }
  );

  maybeSepolia(
    'Stage 4a — detectUniversalTxAuto resolves Sepolia finalize without explicit chain',
    async () => {
      const res = await detectUniversalTxAuto(SEPOLIA_FUNDS_R3_SUCCESS);
      expect(res.detection?.chain).toBe(CHAIN.ETHEREUM_SEPOLIA);
      expect(res.detection?.kind).toBe('OUTBOUND_FINALIZED');
    }
  );

  // Stage 5 — advanced fan-out cascade with Solana recursion leg.
  // Root Push tx emits two BSC Testnet outbounds (FUNDS_AND_PAYLOAD) and the
  // second one's CEA-originated UniversalTx triggers a follow-up Push tx that
  // itself fans out to Solana Devnet. Expected tree (matches the Universal-Tx
  // Explorer Journey view for 0xd976be…53102b):
  //
  //   PC 0xd976be…  (OUTBOUND_INITIATED, d0)
  //   ├── outbound → BSC 0x0ca1b5…  (OUTBOUND_FINALIZED, d1)
  //   ├── pc-refund → PC 0xed3b65…  (9.41524e-5 PC, d1)
  //   ├── outbound → BSC 0xb09880…  (OUTBOUND_FINALIZED + INBOUND_FROM_CEA, d1)
  //   │     └── child-inbound → PC 0xdf11b6…  (OUTBOUND_INITIATED, d2)
  //   │            └── outbound → Solana 0xae8f8b…  (summary only; node=null)
  //   └── pc-refund → PC 0xfd60af…  (1.487105e-5 PC, d1)
  const PUSH_FANOUT_ROOT =
    '0xd976bef7a3b0a398ee36f08d792dfb13aefe3bc7475db7fe1e8ac9629753102b' as const;
  const BSC_FANOUT_A_PREFIX = '0x0ca1b5';
  const BSC_FANOUT_B_PREFIX = '0xb09880';
  const PC_REFUND_A_PREFIX = '0xed3b65';
  const PC_REFUND_B_PREFIX = '0xfd60af';
  const PC_FOLLOW_UP_PREFIX = '0xdf11b6';
  const SOLANA_CHILD_PREFIX = '0xae8f8b';

  const maybeBnbSepolia = bnbEnabled && sepoliaEnabled ? it : it.skip;

  maybeBnbSepolia(
    'Stage 5 — advanced fan-out cascade (2 BSC outbounds + CEA follow-up → Solana leg)',
    async () => {
      const pushClient = new PushClient({
        network: PUSH_NETWORK.TESTNET_DONUT,
        rpcUrls: ['https://evm.donut.rpc.push.org/'],
      });
      const root = await traceUniversalTxCascade(
        PUSH_FANOUT_ROOT,
        CHAIN.PUSH_TESTNET_DONUT,
        { pushClient }
      );
      const flat = flattenCascade(root);
      // eslint-disable-next-line no-console
      console.log(
        '[live] stage5 cascade',
        JSON.stringify(
          flat.map((n) => ({
            depth: n.depth,
            chain: n.detection.chain,
            txHash: n.detection.txHash,
            kind: n.detection.kind,
          })),
          null,
          2
        )
      );

      // Root is the Push fan-out initiator.
      expect(root.depth).toBe(0);
      expect(root.detection.txHash.toLowerCase()).toBe(
        PUSH_FANOUT_ROOT.toLowerCase()
      );
      expect(root.detection.kind).toBe('OUTBOUND_INITIATED');

      // Root fans out to 2 BSC outbounds + 2 pc-refunds.
      const outbounds = root.children.filter((c) => c.edgeKind === 'outbound');
      const refunds = root.children.filter((c) => c.edgeKind === 'pc-refund');
      expect(outbounds).toHaveLength(2);
      expect(refunds).toHaveLength(2);

      // Both outbound legs land on BSC Testnet with the expected prefixes.
      const outboundHashes = outbounds
        .map((e) => e.node?.detection.txHash.toLowerCase() ?? '')
        .sort();
      expect(
        outboundHashes.some((h) => h.startsWith(BSC_FANOUT_A_PREFIX))
      ).toBe(true);
      expect(
        outboundHashes.some((h) => h.startsWith(BSC_FANOUT_B_PREFIX))
      ).toBe(true);
      for (const e of outbounds) {
        expect(e.node?.detection.chain).toBe(CHAIN.BNB_TESTNET);
        expect(e.node?.detection.kind).toBe('OUTBOUND_FINALIZED');
      }

      // Both refund edges present with distinct refund-tx prefixes.
      const refundHashes = refunds.map((e) =>
        (e.relation as { txHash: string }).txHash.toLowerCase()
      );
      expect(refundHashes.some((h) => h.startsWith(PC_REFUND_A_PREFIX))).toBe(
        true
      );
      expect(refundHashes.some((h) => h.startsWith(PC_REFUND_B_PREFIX))).toBe(
        true
      );

      // Only the CEA-carrying BSC leg (0xb09880…) produces a child-inbound.
      const ceaLeg = outbounds.find((e) =>
        e.node?.detection.txHash
          .toLowerCase()
          .startsWith(BSC_FANOUT_B_PREFIX)
      );
      expect(ceaLeg).toBeDefined();
      const childInbounds = ceaLeg!.node!.children.filter(
        (c) => c.edgeKind === 'child-inbound'
      );
      expect(childInbounds.length).toBeGreaterThanOrEqual(1);

      const followUp = childInbounds[0].node;
      expect(followUp).toBeDefined();
      expect(followUp!.detection.chain).toBe(CHAIN.PUSH_TESTNET_DONUT);
      expect(
        followUp!.detection.txHash.toLowerCase().startsWith(PC_FOLLOW_UP_PREFIX)
      ).toBe(true);
      expect(followUp!.detection.kind).toBe('OUTBOUND_INITIATED');
      expect(followUp!.depth).toBe(2);

      // Follow-up Push tx fans out to Solana Devnet. Non-EVM destinations
      // surface as summary-only edges (node=null, summary preserved).
      const solanaEdges = followUp!.children.filter(
        (c) => c.edgeKind === 'outbound'
      );
      expect(solanaEdges.length).toBeGreaterThanOrEqual(1);
      const solanaEdge = solanaEdges[0];
      expect(solanaEdge.node).toBeNull();
      const solanaSummary = solanaEdge.relation as {
        destinationChain: string;
        externalTxHash?: string;
      };
      expect(solanaSummary.destinationChain).toBe(CHAIN.SOLANA_DEVNET);
      expect(
        (solanaSummary.externalTxHash ?? '')
          .toLowerCase()
          .startsWith(SOLANA_CHILD_PREFIX)
      ).toBe(true);

      // The non-CEA BSC leg (0x0ca1b5…) should have no child-inbounds.
      const pureFundsLeg = outbounds.find((e) =>
        e.node?.detection.txHash
          .toLowerCase()
          .startsWith(BSC_FANOUT_A_PREFIX)
      );
      expect(pureFundsLeg).toBeDefined();
      const pureFundsChildren = pureFundsLeg!.node!.children.filter(
        (c) => c.edgeKind === 'child-inbound'
      );
      expect(pureFundsChildren).toHaveLength(0);

      // Flat traversal should include every resolved node in the tree:
      //   root + 2 BSC + 2 refunds + 1 follow-up Push = 6 resolved nodes.
      // (Solana edge is summary-only, so no node for it.)
      expect(flat.length).toBe(6);
    }
  );

  // Stage 6 — Push-rooted fan-out with two non-EVM (Solana Devnet) outbounds,
  // one delivered and one reverted, each with its own pc-refund tx back on
  // Push Chain. Verifies summary-only handling for non-EVM destinations plus
  // multi-refund attribution.
  //
  //   PC 0xf907b7…  (OUTBOUND_INITIATED, d0)
  //   ├── outbound → Solana 0xdb41c6…  (summary only, node=null)
  //   ├── outbound → Solana (reverted)  (summary only, node=null)
  //   ├── pc-refund → PC 0x9cf43a…c17564  (gas refund, d1)
  //   └── pc-refund → PC 0x2f5d54…6ac05d  (revert-funds refund, d1)
  const PUSH_SOLANA_FANOUT_ROOT =
    '0xf907b7d6a11017bd3d33b145e781a081a3bc7de9f02c1c618eea08d0e494dd9b' as const;
  const SOLANA_OBSERVED_PREFIX = '0xdb41c6';
  const PC_GAS_REFUND_PREFIX = '0x9cf43a';
  const PC_REVERT_REFUND_PREFIX = '0x2f5d54';

  maybeSepolia(
    'Stage 6 — Push fan-out to Solana: delivered + reverted legs with separate pc-refunds',
    async () => {
      const pushClient = new PushClient({
        network: PUSH_NETWORK.TESTNET_DONUT,
        rpcUrls: ['https://evm.donut.rpc.push.org/'],
      });
      const root = await traceUniversalTxCascade(
        PUSH_SOLANA_FANOUT_ROOT,
        CHAIN.PUSH_TESTNET_DONUT,
        { pushClient }
      );
      // eslint-disable-next-line no-console
      console.log(
        '[live] stage6 cascade',
        JSON.stringify(
          root.children.map((c) => ({
            edgeKind: c.edgeKind,
            relation: c.relation,
            nodeChain: c.node?.detection.chain,
            nodeHash: c.node?.detection.txHash,
            nodeKind: c.node?.detection.kind,
          })),
          null,
          2
        )
      );

      expect(root.depth).toBe(0);
      expect(root.detection.txHash.toLowerCase()).toBe(
        PUSH_SOLANA_FANOUT_ROOT.toLowerCase()
      );
      expect(root.detection.kind).toBe('OUTBOUND_INITIATED');

      // 2 Solana outbounds + 2 pc-refunds.
      const outbounds = root.children.filter((c) => c.edgeKind === 'outbound');
      const refunds = root.children.filter((c) => c.edgeKind === 'pc-refund');
      expect(outbounds).toHaveLength(2);
      expect(refunds).toHaveLength(2);

      // Both outbounds target Solana Devnet and are summary-only (non-EVM).
      for (const e of outbounds) {
        expect(e.node).toBeNull();
        const summary = e.relation as {
          destinationChain: string;
          externalTxHash?: string;
          status: string;
        };
        expect(summary.destinationChain).toBe(CHAIN.SOLANA_DEVNET);
      }
      const outboundExternalHashes = outbounds.map((e) =>
        (
          (e.relation as { externalTxHash?: string }).externalTxHash ?? ''
        ).toLowerCase()
      );
      expect(
        outboundExternalHashes.some((h) => h.startsWith(SOLANA_OBSERVED_PREFIX))
      ).toBe(true);

      // One outbound is OBSERVED (delivered), the other is REVERTED.
      const statuses = outbounds
        .map((e) => (e.relation as { status: string }).status)
        .sort();
      expect(statuses).toEqual(['OBSERVED', 'REVERTED']);

      // Refund edges: one gas refund + one revert-funds refund.
      const refundHashes = refunds.map((e) =>
        (e.relation as { txHash: string }).txHash.toLowerCase()
      );
      expect(
        refundHashes.some((h) => h.startsWith(PC_GAS_REFUND_PREFIX))
      ).toBe(true);
      expect(
        refundHashes.some((h) => h.startsWith(PC_REVERT_REFUND_PREFIX))
      ).toBe(true);
      for (const e of refunds) {
        expect(e.node?.detection.chain).toBe(CHAIN.PUSH_TESTNET_DONUT);
        expect(e.node?.depth).toBe(1);
      }

      // flattenCascade: root + 2 refund nodes = 3 (Solana edges are node:null).
      const flat = flattenCascade(root);
      expect(flat).toHaveLength(3);
    }
  );

  // Stage 7 — mixed-destination fan-out live placeholder. Unskip + paste a
  // real Push root hash whose outboundTx[] spans ≥3 distinct chains (e.g.
  // BSC + Sepolia EVM + Solana non-EVM). Mock coverage already lives in
  // scenarios.spec.ts (S-M).
  const PUSH_MIXED_FANOUT_ROOT: `0x${string}` | '' = '';
  (PUSH_MIXED_FANOUT_ROOT ? it : it.skip)(
    'Stage 7 — mixed-destination fan-out cascade across ≥3 chains',
    async () => {
      if (!PUSH_MIXED_FANOUT_ROOT) return;
      const pushClient = new PushClient({
        network: PUSH_NETWORK.TESTNET_DONUT,
        rpcUrls: ['https://evm.donut.rpc.push.org/'],
      });
      const root = await traceUniversalTxCascade(
        PUSH_MIXED_FANOUT_ROOT,
        CHAIN.PUSH_TESTNET_DONUT,
        { pushClient }
      );
      expect(root.detection.kind).toBe('OUTBOUND_INITIATED');
      const outbounds = root.children.filter((c) => c.edgeKind === 'outbound');
      expect(outbounds.length).toBeGreaterThanOrEqual(3);
      const destinations = new Set(
        outbounds.map(
          (e) => (e.relation as { destinationChain: string }).destinationChain
        )
      );
      expect(destinations.size).toBeGreaterThanOrEqual(3);
    }
  );

  // SVM R3 inbound — opt-in via SOLANA_SVM_R3_SIG. Confirms the dispatcher
  // routes to detectUniversalTxSvm and the Anchor IDL decoder produces a
  // matching-log set for a real source-chain R3 signature.
  const svmGuard =
    solanaEnabled && SOLANA_SVM_R3_SIG.length > 0 ? maybeSolana : it.skip;
  svmGuard('SVM R3 source signature decodes via the SVM branch', async () => {
    const out = await detectUniversalTx(
      SOLANA_SVM_R3_SIG as `0x${string}`,
      CHAIN.SOLANA_DEVNET,
      { skipPushChainLookup: true }
    );
    // eslint-disable-next-line no-console
    console.log('[live] SVM R3', JSON.stringify(summarize(out), null, 2));
    expect(KNOWN_KINDS).toContain(out.kind);
    if (out.kind !== 'UNKNOWN') {
      expect(out.matchingLogs.length).toBeGreaterThan(0);
      expect(
        out.matchingLogs.some((l) =>
          ['UniversalTx', 'UniversalTxFinalized', 'RevertUniversalTx', 'FundsRescued'].includes(l.eventName)
        )
      ).toBe(true);
    }
  });
});

function summarize(out: UniversalTxDetection) {
  return {
    kind: out.kind,
    emitters: out.emitters,
    matchingLogs: out.matchingLogs.map((l) => ({
      eventName: l.eventName,
      address: l.address,
    })),
    decoded: serializeBigints(out.decoded as unknown as Record<string, unknown>),
    notes: out.notes,
    pushChainTx: out.pushChainTx,
  };
}

function serializeBigints(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = typeof v === 'bigint' ? v.toString() : v;
  }
  return out;
}

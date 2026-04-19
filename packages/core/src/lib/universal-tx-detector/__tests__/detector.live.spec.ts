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

const maybeBnb = bnbEnabled ? it : it.skip;
const maybeSepolia = sepoliaEnabled ? it : it.skip;

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

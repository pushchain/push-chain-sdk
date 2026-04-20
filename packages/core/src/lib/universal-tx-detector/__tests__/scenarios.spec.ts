/**
 * Generic scenario driver — iterates the fixture catalogue and runs
 * classifier + cascade-walker assertions uniformly.
 *
 * Adding a new ScenarioFixture to fixtures/scenarios.ts automatically
 * extends coverage here via describe.each — no per-kind boilerplate.
 */
import type { TransactionReceipt } from 'viem';

type ViemExport = typeof import('viem');

const mockGetTransactionReceipt = jest.fn();
jest.mock('viem', () => {
  const real = jest.requireActual('viem') as ViemExport;
  return {
    ...real,
    createPublicClient: jest.fn(() => ({
      getTransactionReceipt: mockGetTransactionReceipt,
    })),
  };
});

// SVM path: the cascade now walks into SVM destinations. Mock the solana
// web3 Connection so no real RPC call happens — returning null yields an
// empty UNKNOWN detection (see detector-svm.ts emptyDetection path).
jest.mock('@solana/web3.js', () => {
  const real = jest.requireActual('@solana/web3.js');
  return {
    ...real,
    Connection: jest.fn().mockImplementation(() => ({
      getTransaction: jest.fn(async () => null),
    })),
  };
});

import { classify, classifyAll } from '../classify';
import { flattenCascade, traceUniversalTxCascade } from '../cascade';
import type { PushClient } from '../../push-client/push-client';

import {
  SCENARIOS,
  matchingLogsForFixture,
  receiptMap,
  utxRecordMap,
  type ScenarioFixture,
} from './fixtures/scenarios';

// ── Shared mocks ──────────────────────────────────────────────────────

const RECEIPTS: Map<string, TransactionReceipt> = receiptMap(SCENARIOS);
const UTX_RECORDS = utxRecordMap(SCENARIOS);

beforeEach(() => {
  mockGetTransactionReceipt.mockReset();
  mockGetTransactionReceipt.mockImplementation(
    async ({ hash }: { hash: string }) => {
      const entry = RECEIPTS.get((hash ?? '').toLowerCase());
      return entry ?? null;
    }
  );
});

function mockPushClient(): PushClient {
  return {
    getUniversalTxByIdV2: jest.fn(async (id: string) => {
      const key = id.toLowerCase().replace(/^0x/, '');
      if (UTX_RECORDS.has(key)) {
        const rec = UTX_RECORDS.get(key);
        return { universalTx: rec ?? null };
      }
      return { universalTx: null };
    }),
  } as unknown as PushClient;
}

// ── Classifier coverage ───────────────────────────────────────────────

describe.each(SCENARIOS)(
  'scenario $id — $name',
  (fixture: ScenarioFixture) => {
    it('classify() picks the expected primary kind', () => {
      const logs = matchingLogsForFixture(fixture);
      const out = classify(logs);
      expect(out.kind).toBe(fixture.kind);
    });

    if (fixture.expectedClassifyAll !== undefined) {
      it('classifyAll() yields the expected per-log kinds', () => {
        const logs = matchingLogsForFixture(fixture);
        const entries = classifyAll(logs);
        expect(entries.map((e) => e.kind)).toEqual(fixture.expectedClassifyAll);
      });
    }

    if (fixture.expectedDecoded) {
      it('classify() decodes expected identifiers', () => {
        const logs = matchingLogsForFixture(fixture);
        const out = classify(logs);
        for (const [key, expected] of Object.entries(fixture.expectedDecoded ?? {})) {
          const actual = (out.decoded as Record<string, unknown>)[key];
          if (typeof expected === 'string' && typeof actual === 'string') {
            expect(actual.toLowerCase()).toBe(expected.toLowerCase());
          } else {
            expect(actual).toEqual(expected);
          }
        }
      });
    }
  }
);

// ── Cascade walker coverage ───────────────────────────────────────────

const CASCADE_FIXTURES = SCENARIOS.filter((f) => f.expectedCascade);

describe.each(CASCADE_FIXTURES)(
  'cascade scenario $id — $name',
  (fixture: ScenarioFixture) => {
    it('walker resolves expected shape', async () => {
      const pushClient = mockPushClient();
      const root = await traceUniversalTxCascade(
        fixture.txHash,
        fixture.chain,
        { pushClient }
      );

      const exp = fixture.expectedCascade;
      if (!exp) return;

      if (exp.rootKind) expect(root.detection.kind).toBe(exp.rootKind);

      const outbounds = root.children.filter((c) => c.edgeKind === 'outbound');
      const refunds = root.children.filter((c) => c.edgeKind === 'pc-refund');
      const childInbounds = root.children.filter(
        (c) => c.edgeKind === 'child-inbound'
      );

      if (typeof exp.outboundCount === 'number') {
        expect(outbounds).toHaveLength(exp.outboundCount);
      }
      if (typeof exp.refundCount === 'number') {
        expect(refunds).toHaveLength(exp.refundCount);
      }
      if (typeof exp.childInboundCount === 'number') {
        expect(childInbounds).toHaveLength(exp.childInboundCount);
      }

      if (exp.outboundDestinations) {
        const actual = outbounds
          .map((o) => (o.relation as { destinationChain: string }).destinationChain)
          .sort();
        const expected = [...exp.outboundDestinations].sort();
        expect(actual).toEqual(expected);
      }

      if (typeof exp.totalFlatNodes === 'number') {
        const flat = flattenCascade(root);
        expect(flat).toHaveLength(exp.totalFlatNodes);
      }
    });
  }
);

/**
 * Unit tests for traceUniversalTxCascade.
 *
 * Mocks viem's createPublicClient (receipt fetch) and PushClient
 * (getUniversalTxByIdV2) to stage a three-node cascade without any network:
 *
 *   Push root  ──outbound──▶  Destination finalize  ──child-inbound──▶  Follow-up Push tx
 */
import {
  encodeAbiParameters,
  encodeEventTopics,
  type TransactionReceipt,
} from 'viem';

import {
  EVENT_UNIVERSAL_TX,
  EVENT_UNIVERSAL_TX_FINALIZED,
  EVENT_UNIVERSAL_TX_OUTBOUND,
} from '../events';
import { CHAIN } from '../../constants/enums';

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

import {
  traceUniversalTxCascade,
  flattenCascade,
} from '../cascade';
import {
  deriveChildUniversalTxId,
  derivePcUniversalTxId,
} from '../child-inbounds';
import type { PushClient } from '../../push-client/push-client';

// Real hashes from the live cascade (Apr 19 2026 session).
const PUSH_ROOT = '0x80fc70302f8eaac02649b18fe5a09b1580d0f6190b420d3a1058c39ecbf53443' as `0x${string}`;
const SEPOLIA_HASH = '0x9c40ac52cf6d88602c7e8f0a36d08ec06774450c8e30d2739ee81b5ebd0dee79' as `0x${string}`;
const PUSH_FOLLOW_UP = '0xd938ea14e1945ec47cb5a46b2db6debf57447acc50fda810d62df5c3ce56c459' as `0x${string}`;
const PUSH_REFUND = '0xa74970a9905b9ef233e489f6def62c75f78c7469c769d41929ceda76fd375248' as `0x${string}`;
const SUB_TX = '0xff757682928e2ccacab9ba0a216d635bd054473a9b02493e3fd219b1aa00c4ce' as `0x${string}`;
const UTX_PARENT = derivePcUniversalTxId(CHAIN.PUSH_TESTNET_DONUT, PUSH_ROOT);
const UTX_CHILD = deriveChildUniversalTxId(CHAIN.ETHEREUM_SEPOLIA, SEPOLIA_HASH, 249);

const UEA = '0x4A701114F991bf75685584c8156Db983c0DF95a0' as `0x${string}`;
const CEA = '0x30a9dB8E3cCe83e8A8720EB61B8728F98449ee6b' as `0x${string}`;
const USDT_PUSH = '0x7169D38820dfd117C3FA1f22a697dBA58d90BA06' as `0x${string}`;
const PC_GATEWAY = '0x00000000000000000000000000000000000000c1' as `0x${string}`;
const SEPOLIA_GATEWAY = '0x05bD7a3D18324c1F7e216f7fbf2b15985aE5281A' as `0x${string}`;
const SEPOLIA_VAULT = '0xD019Eb12D0d6eF8D299661f22B4B7d262eD4b965' as `0x${string}`;

// ── Fixture helpers ───────────────────────────────────────────────────

function buildLog(
  event: { name: string; inputs: readonly { indexed: boolean; type: string; name: string }[] },
  argsObj: Record<string, unknown>,
  address: `0x${string}`,
  logIndex: number
) {
  const topics = encodeEventTopics({
    abi: [event as unknown as Parameters<typeof encodeEventTopics>[0]['abi'][number]],
    eventName: event.name,
    args: indexedArgs(event, argsObj),
  });
  const nonIndexed = event.inputs.filter((i) => !i.indexed);
  const data =
    nonIndexed.length === 0
      ? '0x'
      : encodeAbiParameters(
          nonIndexed as unknown as Parameters<typeof encodeAbiParameters>[0],
          nonIndexed.map((i) => argsObj[i.name]) as unknown[]
        );
  return {
    address,
    topics,
    data,
    blockNumber: BigInt(1),
    transactionHash:
      '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`,
    transactionIndex: 0,
    blockHash:
      '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`,
    logIndex,
    removed: false,
  };
}

function indexedArgs(
  event: { inputs: readonly { indexed: boolean; name: string }[] },
  argsObj: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const i of event.inputs) if (i.indexed) out[i.name] = argsObj[i.name];
  return out;
}

function buildReceipt(
  logs: ReturnType<typeof buildLog>[],
  to: `0x${string}`
): TransactionReceipt {
  return {
    status: 'success',
    logs,
    blockNumber: BigInt(1),
    blockHash:
      '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`,
    contractAddress: null,
    cumulativeGasUsed: BigInt(0),
    effectiveGasPrice: BigInt(0),
    from: UEA,
    gasUsed: BigInt(0),
    logsBloom: '0x' as `0x${string}`,
    to,
    transactionHash:
      '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`,
    transactionIndex: 0,
    type: 'eip1559',
  } as unknown as TransactionReceipt;
}

// ── Stage receipts per-hash ───────────────────────────────────────────

function buildPushRootReceipt() {
  return buildReceipt(
    [
      buildLog(
        EVENT_UNIVERSAL_TX_OUTBOUND,
        {
          subTxId: SUB_TX,
          sender: UEA,
          chainNamespace: CHAIN.ETHEREUM_SEPOLIA,
          token: USDT_PUSH,
          recipient: '0x30a9db8e3cce83e8a8720eb61b8728f98449ee6b',
          amount: BigInt(0),
          gasToken: '0x0000000000000000000000000000000000000000',
          gasFee: BigInt(500901000000),
          gasLimit: BigInt(500000),
          payload: '0x',
          protocolFee: BigInt(0),
          revertRecipient: UEA,
          txType: 1,
          gasPrice: BigInt(0),
        },
        PC_GATEWAY,
        9
      ),
    ],
    PC_GATEWAY
  );
}

function buildSepoliaReceipt() {
  return buildReceipt(
    [
      buildLog(
        EVENT_UNIVERSAL_TX,
        {
          sender: CEA,
          recipient: UEA,
          token: USDT_PUSH,
          amount: BigInt(10000),
          payload: '0x',
          revertRecipient: UEA,
          txType: 2,
          signatureData: '0x',
          fromCEA: true,
        },
        SEPOLIA_GATEWAY,
        249
      ),
      buildLog(
        EVENT_UNIVERSAL_TX_FINALIZED,
        {
          subTxId: SUB_TX,
          universalTxId: UTX_PARENT,
          pushAccount: UEA,
          recipient: CEA,
          token: '0x0000000000000000000000000000000000000000',
          amount: BigInt(0),
          data: '0x',
        },
        SEPOLIA_VAULT,
        252
      ),
    ],
    SEPOLIA_VAULT
  );
}

function buildPushFollowUpReceipt() {
  // No universal-tx events — terminal node.
  return buildReceipt([], PC_GATEWAY);
}

function buildPushRefundReceipt() {
  return buildReceipt([], PC_GATEWAY);
}

// ── Mocked PushClient ─────────────────────────────────────────────────

function makeMockPushClient(): PushClient {
  const getUniversalTxByIdV2 = jest.fn(async (id: string) => {
    const hex = id.startsWith('0x') ? id : `0x${id}`;
    if (hex.toLowerCase() === UTX_PARENT.toLowerCase()) {
      return {
        universalTx: {
          id: UTX_PARENT.slice(2),
          universalStatus: 7,
          pcTx: [{ txHash: PUSH_ROOT }],
          outboundTx: [
            {
              id: SUB_TX.slice(2),
              outboundStatus: 2,
              destinationChain: CHAIN.ETHEREUM_SEPOLIA,
              observedTx: {
                txHash: SEPOLIA_HASH,
                success: true,
                gasFeeUsed: '202839859950',
              },
              amount: '0',
              recipient: CEA,
              gasFee: '500901000000',
              gasPrice: '1001802',
              gasToken: USDT_PUSH,
              pcRefundExecution: {
                txHash: PUSH_REFUND,
                sender: UEA,
                gasUsed: 182769,
                blockHeight: 13823481,
                status: 'SUCCESS',
                errorMsg: '',
              },
            },
          ],
        },
      };
    }
    if (hex.toLowerCase() === derivePcUniversalTxId(CHAIN.PUSH_TESTNET_DONUT, PUSH_REFUND).toLowerCase()) {
      // Refund tx has its own utx record with no outbounds — terminal node.
      return {
        universalTx: {
          id: hex.slice(2),
          universalStatus: 3,
          pcTx: [{ txHash: PUSH_REFUND }],
          outboundTx: [],
        },
      };
    }
    if (hex.toLowerCase() === UTX_CHILD.toLowerCase()) {
      return {
        universalTx: {
          id: UTX_CHILD.slice(2),
          universalStatus: 3,
          pcTx: [{ txHash: PUSH_FOLLOW_UP }],
          outboundTx: [],
          inboundTx: {
            txHash: SEPOLIA_HASH,
            sourceChain: CHAIN.ETHEREUM_SEPOLIA,
            amount: '10000',
            txType: 0,
          },
        },
      };
    }
    return { universalTx: null };
  });
  return { getUniversalTxByIdV2 } as unknown as PushClient;
}

// ── Receipt dispatcher ────────────────────────────────────────────────

beforeEach(() => {
  mockGetTransactionReceipt.mockReset();
  // Stage receipts — viem's mocked createPublicClient is called per chain,
  // but all share this mock. Dispatch by the requested hash.
  mockGetTransactionReceipt.mockImplementation(
    async ({ hash }: { hash: string }) => {
      const h = hash.toLowerCase();
      if (h === PUSH_ROOT.toLowerCase()) return buildPushRootReceipt();
      if (h === SEPOLIA_HASH.toLowerCase()) return buildSepoliaReceipt();
      if (h === PUSH_FOLLOW_UP.toLowerCase()) return buildPushFollowUpReceipt();
      if (h === PUSH_REFUND.toLowerCase()) return buildPushRefundReceipt();
      return null;
    }
  );
});

// ── Cases ─────────────────────────────────────────────────────────────

describe('traceUniversalTxCascade', () => {
  it('builds cascade: Push root → (outbound → Sepolia → child-inbound → follow-up) + (pc-refund → Push refund)', async () => {
    const pushClient = makeMockPushClient();
    const root = await traceUniversalTxCascade(
      PUSH_ROOT,
      CHAIN.PUSH_TESTNET_DONUT,
      { pushClient }
    );

    expect(root.depth).toBe(0);
    expect(root.detection.kind).toBe('OUTBOUND_INITIATED');
    // One outbound edge + one pc-refund edge.
    expect(root.children).toHaveLength(2);

    const outboundEdge = root.children.find((c) => c.edgeKind === 'outbound');
    expect(outboundEdge?.node?.detection.chain).toBe(CHAIN.ETHEREUM_SEPOLIA);
    expect(outboundEdge?.node?.detection.kind).toBe('OUTBOUND_FINALIZED');

    const refundEdge = root.children.find((c) => c.edgeKind === 'pc-refund');
    expect(refundEdge).toBeDefined();
    const refund = refundEdge!.relation as { txHash: string; gasUsed: number };
    expect(refund.txHash.toLowerCase()).toBe(PUSH_REFUND.toLowerCase());
    expect(refund.gasUsed).toBe(182769);
    expect(refundEdge!.node?.detection.chain).toBe(CHAIN.PUSH_TESTNET_DONUT);

    // Sepolia → child-inbound → follow-up Push tx
    const followUp = outboundEdge!.node!.children[0];
    expect(followUp.edgeKind).toBe('child-inbound');
    expect(followUp.node?.detection.txHash.toLowerCase()).toBe(
      PUSH_FOLLOW_UP.toLowerCase()
    );
  });

  it('flattenCascade returns nodes depth-first', async () => {
    const pushClient = makeMockPushClient();
    const root = await traceUniversalTxCascade(
      PUSH_ROOT,
      CHAIN.PUSH_TESTNET_DONUT,
      { pushClient }
    );
    const flat = flattenCascade(root);
    expect(flat.map((n) => n.detection.txHash.toLowerCase())).toEqual([
      PUSH_ROOT.toLowerCase(),
      SEPOLIA_HASH.toLowerCase(),
      PUSH_FOLLOW_UP.toLowerCase(),
      PUSH_REFUND.toLowerCase(),
    ]);
  });

  it('respects maxDepth', async () => {
    const pushClient = makeMockPushClient();
    const root = await traceUniversalTxCascade(
      PUSH_ROOT,
      CHAIN.PUSH_TESTNET_DONUT,
      { pushClient, maxDepth: 1 }
    );
    // Root (depth 0) + outbound child + pc-refund child at depth 1; both truncated.
    expect(root.children).toHaveLength(2);
    const outbound = root.children.find((c) => c.edgeKind === 'outbound')!.node;
    expect(outbound?.truncated).toBe('maxDepth');
    expect(outbound?.children).toHaveLength(0);
  });

  it('cycle-safe: revisiting a node does not recurse', async () => {
    const pushClient = makeMockPushClient();
    // Tweak the parent utx record so its outbound points back at PUSH_ROOT
    (pushClient.getUniversalTxByIdV2 as jest.Mock).mockImplementation(
      async (id: string) => {
        if (`0x${id}`.toLowerCase() === UTX_PARENT.toLowerCase()) {
          return {
            universalTx: {
              id: UTX_PARENT.slice(2),
              universalStatus: 7,
              pcTx: [],
              outboundTx: [
                {
                  id: SUB_TX.slice(2),
                  outboundStatus: 2,
                  destinationChain: CHAIN.PUSH_TESTNET_DONUT, // cycle!
                  observedTx: { txHash: PUSH_ROOT, success: true },
                },
              ],
            },
          };
        }
        return { universalTx: null };
      }
    );
    const root = await traceUniversalTxCascade(
      PUSH_ROOT,
      CHAIN.PUSH_TESTNET_DONUT,
      { pushClient }
    );
    expect(root.children).toHaveLength(1);
    // Cycle: child node is null because visited guard short-circuits.
    expect(root.children[0].node).toBeNull();
  });

  it('onNode callback fires per resolved node', async () => {
    const pushClient = makeMockPushClient();
    const seen: string[] = [];
    await traceUniversalTxCascade(PUSH_ROOT, CHAIN.PUSH_TESTNET_DONUT, {
      pushClient,
      onNode: (n) => seen.push(n.detection.txHash.toLowerCase()),
    });
    expect(seen).toEqual([
      PUSH_ROOT.toLowerCase(),
      SEPOLIA_HASH.toLowerCase(),
      PUSH_FOLLOW_UP.toLowerCase(),
      PUSH_REFUND.toLowerCase(),
    ]);
  });
});

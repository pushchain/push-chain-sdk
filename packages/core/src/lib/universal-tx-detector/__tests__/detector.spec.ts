/**
 * detector.spec.ts — integration unit tests for `detectUniversalTx`.
 *
 * Strategy: build real logs using viem's encodeEventTopics + encodeAbiParameters
 * and feed them through a stubbed publicClient.getTransactionReceipt. This
 * exercises the actual parseEventLogs path against our ABI constants, so a
 * schema drift in events.ts would fail here.
 *
 * PushClient is stubbed manually (no network).
 */
import {
  encodeAbiParameters,
  encodeEventTopics,
  type TransactionReceipt,
} from 'viem';

import {
  EVENT_REVERT_UNIVERSAL_TX,
  EVENT_UNIVERSAL_TX,
  EVENT_UNIVERSAL_TX_EXECUTED,
  EVENT_UNIVERSAL_TX_FINALIZED,
  EVENT_UNIVERSAL_TX_OUTBOUND,
  EVENT_UNIVERSAL_TX_REVERTED,
} from '../events';
import { CHAIN } from '../../constants/enums';

type ViemExport = typeof import('viem');

// Mock viem to control getTransactionReceipt without hitting network.
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

// SVM dispatch test needs a stub Connection so the detector-svm branch
// short-circuits without any real RPC traffic.
jest.mock('@solana/web3.js', () => {
  const real = jest.requireActual('@solana/web3.js');
  return {
    ...real,
    Connection: jest.fn().mockImplementation(() => ({
      getTransaction: jest.fn(async () => null),
    })),
  };
});

// Import under test AFTER the mock is declared.
import { detectUniversalTx } from '../detector';
import type { PushClient } from '../../push-client/push-client';

// ── Fixture helpers ───────────────────────────────────────────────────

const ADDR_GATEWAY_BSC = '0x44aFFC61983F4348DdddB886349eb992C061EaC0' as `0x${string}`;
const ADDR_VAULT_BSC = '0xE52AC4f8DD3e0263bDF748F3390cdFA1f02be881' as `0x${string}`;
const TX_HASH = '0x0000000000000000000000000000000000000000000000000000000000000001' as `0x${string}`;
const SUB_TX = '0x1111111111111111111111111111111111111111111111111111111111111111' as `0x${string}`;
const UTX = '0x2222222222222222222222222222222222222222222222222222222222222222' as `0x${string}`;
const SENDER = '0xaaaa000000000000000000000000000000000001' as `0x${string}`;
const RECIPIENT = '0xbbbb000000000000000000000000000000000002' as `0x${string}`;
const TOKEN_ZERO = '0x0000000000000000000000000000000000000000' as `0x${string}`;
const PUSH_ACCOUNT = '0xcccc000000000000000000000000000000000003' as `0x${string}`;
const REVERT_TO = '0xdddd000000000000000000000000000000000004' as `0x${string}`;

function buildLog(
  event: { name: string; inputs: readonly { indexed: boolean; type: string; name: string }[] },
  argsObj: Record<string, unknown>,
  address: `0x${string}`,
  logIndex: number
) {
  // Build indexed topics via viem (handles keccak of the signature).
  const topics = encodeEventTopics({
    abi: [event as unknown as Parameters<typeof encodeEventTopics>[0]['abi'][number]],
    eventName: event.name,
    args: indexedArgs(event, argsObj),
  });

  const nonIndexedInputs = event.inputs.filter((i) => !i.indexed);
  const data =
    nonIndexedInputs.length === 0
      ? '0x'
      : encodeAbiParameters(
          nonIndexedInputs as unknown as Parameters<typeof encodeAbiParameters>[0],
          nonIndexedInputs.map((i) => argsObj[i.name]) as unknown[]
        );

  return {
    address,
    topics,
    data,
    blockNumber: BigInt(1),
    transactionHash: TX_HASH,
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
  for (const input of event.inputs) {
    if (input.indexed) out[input.name] = argsObj[input.name];
  }
  return out;
}

function buildReceipt(logs: ReturnType<typeof buildLog>[]): TransactionReceipt {
  return {
    status: 'success',
    logs,
    blockNumber: BigInt(1),
    blockHash:
      '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`,
    contractAddress: null,
    cumulativeGasUsed: BigInt(0),
    effectiveGasPrice: BigInt(0),
    from: SENDER,
    gasUsed: BigInt(0),
    logsBloom: '0x' as `0x${string}`,
    to: ADDR_GATEWAY_BSC,
    transactionHash: TX_HASH,
    transactionIndex: 0,
    type: 'eip1559',
  } as unknown as TransactionReceipt;
}

beforeEach(() => {
  mockGetTransactionReceipt.mockReset();
});

// ── Cases ─────────────────────────────────────────────────────────────

describe('detectUniversalTx', () => {
  it('returns UNKNOWN when receipt has no logs', async () => {
    mockGetTransactionReceipt.mockResolvedValue(buildReceipt([]));
    const out = await detectUniversalTx(TX_HASH, CHAIN.BNB_TESTNET);
    expect(out.kind).toBe('UNKNOWN');
    expect(out.emitters).toEqual([]);
  });

  it('returns UNKNOWN when receipt is null', async () => {
    mockGetTransactionReceipt.mockResolvedValue(null);
    const out = await detectUniversalTx(TX_HASH, CHAIN.BNB_TESTNET);
    expect(out.kind).toBe('UNKNOWN');
    expect(out.notes).toContain('no receipt returned by RPC');
  });

  it('decodes UniversalTx (fromCEA=false) and derives universalTxId', async () => {
    const ul = buildLog(
      EVENT_UNIVERSAL_TX,
      {
        sender: SENDER,
        recipient: RECIPIENT,
        token: TOKEN_ZERO,
        amount: BigInt(1000),
        payload: '0xdeadbeef',
        revertRecipient: REVERT_TO,
        txType: 2,
        signatureData: '0x',
        fromCEA: false,
      },
      ADDR_GATEWAY_BSC,
      0
    );
    mockGetTransactionReceipt.mockResolvedValue(buildReceipt([ul]));

    const out = await detectUniversalTx(TX_HASH, CHAIN.BNB_TESTNET);
    expect(out.kind).toBe('INBOUND_FROM_EOA');
    expect(out.decoded.sender?.toLowerCase()).toBe(SENDER.toLowerCase());
    expect(out.decoded.amount).toBe(BigInt(1000));
    expect(out.decoded.txTypeName).toBe('FUNDS');
    expect(out.decoded.fromCEA).toBe(false);
    expect(out.decoded.universalTxId).toMatch(/^0x[0-9a-f]{64}$/);
    expect(
      out.notes.some((n) =>
        n.startsWith(`universalTxId derived via sha256("${CHAIN.BNB_TESTNET}:<txHash>:`)
      )
    ).toBe(true);
    expect(out.decoded.payloadLength).toBe(4);
  });

  it('decodes UniversalTx (fromCEA=true) as INBOUND_FROM_CEA', async () => {
    const ul = buildLog(
      EVENT_UNIVERSAL_TX,
      {
        sender: SENDER,
        recipient: RECIPIENT,
        token: TOKEN_ZERO,
        amount: BigInt(0),
        payload: '0x',
        revertRecipient: REVERT_TO,
        txType: 1,
        signatureData: '0x',
        fromCEA: true,
      },
      ADDR_GATEWAY_BSC,
      0
    );
    mockGetTransactionReceipt.mockResolvedValue(buildReceipt([ul]));

    const out = await detectUniversalTx(TX_HASH, CHAIN.BNB_TESTNET);
    expect(out.kind).toBe('INBOUND_FROM_CEA');
    expect(out.decoded.fromCEA).toBe(true);
    expect(out.decoded.txTypeName).toBe('GAS_AND_PAYLOAD');
  });

  it('decodes UniversalTxFinalized as OUTBOUND_FINALIZED with subTxId/universalTxId', async () => {
    const ul = buildLog(
      EVENT_UNIVERSAL_TX_FINALIZED,
      {
        subTxId: SUB_TX,
        universalTxId: UTX,
        pushAccount: PUSH_ACCOUNT,
        recipient: RECIPIENT,
        token: TOKEN_ZERO,
        amount: BigInt(42),
        data: '0x',
      },
      ADDR_VAULT_BSC,
      0
    );
    mockGetTransactionReceipt.mockResolvedValue(buildReceipt([ul]));

    const out = await detectUniversalTx(TX_HASH, CHAIN.BNB_TESTNET);
    expect(out.kind).toBe('OUTBOUND_FINALIZED');
    expect(out.decoded.subTxId).toBe(SUB_TX);
    expect(out.decoded.universalTxId).toBe(UTX);
    expect(out.decoded.pushAccount?.toLowerCase()).toBe(PUSH_ACCOUNT.toLowerCase());
    expect(out.decoded.amount).toBe(BigInt(42));
    expect(out.emitters).toEqual([ADDR_VAULT_BSC]);
  });

  it('decodes UniversalTxReverted as OUTBOUND_REVERTED and parses revertInstruction', async () => {
    const ul = buildLog(
      EVENT_UNIVERSAL_TX_REVERTED,
      {
        subTxId: SUB_TX,
        universalTxId: UTX,
        token: TOKEN_ZERO,
        amount: BigInt(7),
        revertInstruction: [REVERT_TO, '0xbeef'],
      },
      ADDR_VAULT_BSC,
      0
    );
    mockGetTransactionReceipt.mockResolvedValue(buildReceipt([ul]));

    const out = await detectUniversalTx(TX_HASH, CHAIN.BNB_TESTNET);
    expect(out.kind).toBe('OUTBOUND_REVERTED');
    expect(out.decoded.revertRecipient?.toLowerCase()).toBe(REVERT_TO.toLowerCase());
    expect(out.decoded.revertMsgPreview).toBe('0xbeef');
  });

  it('decodes RevertUniversalTx (gateway) as INBOUND_REVERTED', async () => {
    const ul = buildLog(
      EVENT_REVERT_UNIVERSAL_TX,
      {
        subTxId: SUB_TX,
        universalTxId: UTX,
        to: RECIPIENT,
        token: TOKEN_ZERO,
        amount: BigInt(1),
        revertInstruction: [REVERT_TO, '0xcafe'],
      },
      ADDR_GATEWAY_BSC,
      0
    );
    mockGetTransactionReceipt.mockResolvedValue(buildReceipt([ul]));

    const out = await detectUniversalTx(TX_HASH, CHAIN.BNB_TESTNET);
    expect(out.kind).toBe('INBOUND_REVERTED');
    expect(out.decoded.revertRecipient?.toLowerCase()).toBe(REVERT_TO.toLowerCase());
  });

  it('decodes UniversalTxOutbound as OUTBOUND_INITIATED', async () => {
    const ul = buildLog(
      EVENT_UNIVERSAL_TX_OUTBOUND,
      {
        subTxId: SUB_TX,
        sender: SENDER,
        chainNamespace: 'eip155:11155111',
        token: TOKEN_ZERO,
        recipient: '0xbeef',
        amount: BigInt(42),
        gasToken: TOKEN_ZERO,
        gasFee: BigInt(3),
        gasLimit: BigInt(100000),
        payload: '0x',
        protocolFee: BigInt(1),
        revertRecipient: REVERT_TO,
        txType: 3,
        gasPrice: BigInt(9),
      },
      '0x0000000000000000000000000000000000000099' as `0x${string}`,
      0
    );
    mockGetTransactionReceipt.mockResolvedValue(buildReceipt([ul]));

    const out = await detectUniversalTx(TX_HASH, CHAIN.BNB_TESTNET);
    expect(out.kind).toBe('OUTBOUND_INITIATED');
    expect(out.decoded.subTxId).toBe(SUB_TX);
    expect(out.decoded.destinationChainNamespace).toBe('eip155:11155111');
    expect(out.decoded.txTypeName).toBe('FUNDS_AND_PAYLOAD');
  });

  it('UniversalTxExecuted-only is classified as EXECUTED_ON_DEST', async () => {
    const ul = buildLog(
      EVENT_UNIVERSAL_TX_EXECUTED,
      {
        subTxId: SUB_TX,
        universalTxId: UTX,
        pushAccount: PUSH_ACCOUNT,
        target: RECIPIENT,
        token: TOKEN_ZERO,
        amount: BigInt(0),
        data: '0x',
      },
      ADDR_GATEWAY_BSC,
      0
    );
    mockGetTransactionReceipt.mockResolvedValue(buildReceipt([ul]));

    const out = await detectUniversalTx(TX_HASH, CHAIN.BNB_TESTNET);
    expect(out.kind).toBe('EXECUTED_ON_DEST');
    expect(out.decoded.universalTxId).toBe(UTX);
  });

  it('cross-references Push Chain when pushClient is provided', async () => {
    const ul = buildLog(
      EVENT_UNIVERSAL_TX_FINALIZED,
      {
        subTxId: SUB_TX,
        universalTxId: UTX,
        pushAccount: PUSH_ACCOUNT,
        recipient: RECIPIENT,
        token: TOKEN_ZERO,
        amount: BigInt(42),
        data: '0x',
      },
      ADDR_VAULT_BSC,
      0
    );
    mockGetTransactionReceipt.mockResolvedValue(buildReceipt([ul]));

    const getUniversalTxByIdV2 = jest.fn().mockResolvedValue({
      universalTx: {
        id: UTX.slice(2),
        universalStatus: 7, // OUTBOUND_SUCCESS
        pcTx: [{ txHash: '0xdeadbeef', gasUsed: '1', sender: '0x' }],
        outboundTx: [
          {
            id: SUB_TX.slice(2),
            outboundStatus: 2,
            destinationChain: 'eip155:97',
            observedTx: { txHash: TX_HASH, success: true, blockHeight: 1, errorMsg: '' },
            amount: '42',
            recipient: RECIPIENT,
          },
        ],
      },
    });
    const pushClient = { getUniversalTxByIdV2 } as unknown as PushClient;

    const out = await detectUniversalTx(TX_HASH, CHAIN.BNB_TESTNET, {
      pushClient,
    });
    expect(out.pushChainTx?.status).toBe(7);
    expect(out.pushChainTx?.statusName).toBe('OUTBOUND_SUCCESS');
    expect(out.pushChainTx?.pcTxHashes).toEqual(['0xdeadbeef']);
    expect(out.pushChainTx?.outboundHashes[0]?.externalTxHash).toBe(TX_HASH);
    expect(out.pushChainTx?.stuckObservation).toBeUndefined();
    expect(getUniversalTxByIdV2).toHaveBeenCalledWith(UTX.slice(2));
  });

  it('flags stuckObservation=UNSPECIFIED when cosmos status is UNSPECIFIED for inbound tx', async () => {
    const ul = buildLog(
      EVENT_UNIVERSAL_TX,
      {
        sender: SENDER,
        recipient: RECIPIENT,
        token: TOKEN_ZERO,
        amount: BigInt(1),
        payload: '0x',
        revertRecipient: REVERT_TO,
        txType: 2,
        signatureData: '0x',
        fromCEA: false,
      },
      ADDR_GATEWAY_BSC,
      0
    );
    mockGetTransactionReceipt.mockResolvedValue(buildReceipt([ul]));

    const getUniversalTxByIdV2 = jest.fn().mockResolvedValue({
      universalTx: {
        id: 'derived',
        universalStatus: 0,
        pcTx: [],
        outboundTx: [],
      },
    });
    const pushClient = { getUniversalTxByIdV2 } as unknown as PushClient;

    const out = await detectUniversalTx(TX_HASH, CHAIN.BNB_TESTNET, {
      pushClient,
    });
    expect(out.kind).toBe('INBOUND_FROM_EOA');
    expect(out.pushChainTx?.stuckObservation).toBe('UNSPECIFIED');
  });

  it('marks notFound when cosmos returns no universalTx record', async () => {
    const ul = buildLog(
      EVENT_UNIVERSAL_TX_FINALIZED,
      {
        subTxId: SUB_TX,
        universalTxId: UTX,
        pushAccount: PUSH_ACCOUNT,
        recipient: RECIPIENT,
        token: TOKEN_ZERO,
        amount: BigInt(0),
        data: '0x',
      },
      ADDR_VAULT_BSC,
      0
    );
    mockGetTransactionReceipt.mockResolvedValue(buildReceipt([ul]));

    const pushClient = {
      getUniversalTxByIdV2: jest.fn().mockResolvedValue({ universalTx: null }),
    } as unknown as PushClient;

    const out = await detectUniversalTx(TX_HASH, CHAIN.BNB_TESTNET, {
      pushClient,
    });
    expect(out.pushChainTx?.notFound).toBe(true);
  });

  it('records note when receipt fetch throws', async () => {
    mockGetTransactionReceipt.mockRejectedValue(new Error('rpc down'));
    const out = await detectUniversalTx(TX_HASH, CHAIN.BNB_TESTNET);
    expect(out.kind).toBe('UNKNOWN');
    expect(out.notes.some((n) => n.includes('receipt fetch failed'))).toBe(true);
  });

  it('dispatches SVM chain to the SVM detector (no legacy EVM-only throw)', async () => {
    // Full SVM decoding is covered by detector-svm.spec.ts + scenario
    // catalogue. Here we only assert the dispatch no longer throws
    // "only EVM chains" and returns the same detection shape.
    const out = await detectUniversalTx(TX_HASH, CHAIN.SOLANA_DEVNET, {
      skipPushChainLookup: true,
    });
    expect(out.kind).toBe('UNKNOWN');
    expect(out.chain).toBe(CHAIN.SOLANA_DEVNET);
  });

  it('UNKNOWN when only a non-universal log (e.g. an ERC20 Transfer)', async () => {
    const transferLog = {
      address: ADDR_GATEWAY_BSC,
      topics: [
        // keccak256("Transfer(address,address,uint256)")
        '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef' as `0x${string}`,
        '0x000000000000000000000000aaaa000000000000000000000000000000000001' as `0x${string}`,
        '0x000000000000000000000000bbbb000000000000000000000000000000000002' as `0x${string}`,
      ],
      data: '0x0000000000000000000000000000000000000000000000000000000000000001' as `0x${string}`,
      blockNumber: BigInt(1),
      transactionHash: TX_HASH,
      transactionIndex: 0,
      blockHash:
        '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`,
      logIndex: 0,
      removed: false,
    };
    mockGetTransactionReceipt.mockResolvedValue(
      buildReceipt([transferLog as unknown as ReturnType<typeof buildLog>])
    );

    const out = await detectUniversalTx(TX_HASH, CHAIN.BNB_TESTNET);
    expect(out.kind).toBe('UNKNOWN');
  });
});

/**
 * Unit tests for the pure classify() helper. No network, no viem mocks —
 * hand-rolled MatchingLog fixtures.
 */
import { classify, classifyAll } from '../classify';
import type { MatchingLog } from '../types';

const ADDR_GATEWAY = '0x44aFFC61983F4348DdddB886349eb992C061EaC0' as const;
const ADDR_VAULT = '0xE52AC4f8DD3e0263bDF748F3390cdFA1f02be881' as const;
const SUB_TX = '0x1111111111111111111111111111111111111111111111111111111111111111' as const;
const UTX = '0x2222222222222222222222222222222222222222222222222222222222222222' as const;

function log(
  eventName: string,
  args: Record<string, unknown>,
  address: `0x${string}` = ADDR_GATEWAY,
  logIndex = 0
): MatchingLog {
  return { eventName, address, logIndex, args };
}

describe('classify()', () => {
  it('returns UNKNOWN for empty logs', () => {
    const out = classify([]);
    expect(out.kind).toBe('UNKNOWN');
    expect(out.notes).toContain('no universal-tx events decoded');
  });

  it('classifies UniversalTx + fromCEA=false as INBOUND_FROM_EOA', () => {
    const out = classify([
      log('UniversalTx', {
        sender: '0xaaaa000000000000000000000000000000000001',
        recipient: '0xbbbb000000000000000000000000000000000002',
        token: '0x0000000000000000000000000000000000000000',
        amount: BigInt(1000),
        payload: '0x',
        revertRecipient: '0xcccc000000000000000000000000000000000003',
        txType: 2,
        signatureData: '0x',
        fromCEA: false,
      }),
    ]);
    expect(out.kind).toBe('INBOUND_FROM_EOA');
    expect(out.decoded.fromCEA).toBe(false);
    expect(out.decoded.txType).toBe(2);
    expect(out.decoded.txTypeName).toBe('FUNDS');
    expect(out.decoded.sender).toBe('0xaaaa000000000000000000000000000000000001');
    expect(out.decoded.amount).toBe(BigInt(1000));
  });

  it('classifies UniversalTx + fromCEA=true as INBOUND_FROM_CEA', () => {
    const out = classify([
      log('UniversalTx', {
        sender: '0xaaaa000000000000000000000000000000000001',
        recipient: '0xbbbb000000000000000000000000000000000002',
        token: '0x0000000000000000000000000000000000000000',
        amount: BigInt(0),
        payload: '0xdeadbeef',
        revertRecipient: '0xcccc000000000000000000000000000000000003',
        txType: 1,
        signatureData: '0x',
        fromCEA: true,
      }),
    ]);
    expect(out.kind).toBe('INBOUND_FROM_CEA');
    expect(out.decoded.fromCEA).toBe(true);
    expect(out.decoded.txTypeName).toBe('GAS_AND_PAYLOAD');
    expect(out.decoded.payloadLength).toBe(4);
    expect(out.decoded.payloadPreview).toBe('0xdeadbeef');
  });

  it('classifies UniversalTxOutbound as OUTBOUND_INITIATED', () => {
    const out = classify([
      log('UniversalTxOutbound', {
        subTxId: SUB_TX,
        sender: '0xaaaa000000000000000000000000000000000001',
        chainNamespace: 'eip155:11155111',
        token: '0xcccc000000000000000000000000000000000003',
        recipient: '0xdead',
        amount: BigInt(42),
        gasToken: '0x0000000000000000000000000000000000000000',
        gasFee: BigInt(7),
        gasLimit: BigInt(100_000),
        payload: '0x',
        protocolFee: BigInt(1),
        revertRecipient: '0xffff000000000000000000000000000000000004',
        txType: 3,
        gasPrice: BigInt(9),
      }),
    ]);
    expect(out.kind).toBe('OUTBOUND_INITIATED');
    expect(out.decoded.subTxId).toBe(SUB_TX);
    expect(out.decoded.destinationChainNamespace).toBe('eip155:11155111');
    expect(out.decoded.txTypeName).toBe('FUNDS_AND_PAYLOAD');
    expect(out.decoded.gasFee).toBe(BigInt(7));
  });

  it('classifies UniversalTxFinalized as OUTBOUND_FINALIZED and enriches pushAccount from sibling executed log', () => {
    const out = classify([
      log(
        'UniversalTxFinalized',
        {
          subTxId: SUB_TX,
          universalTxId: UTX,
          pushAccount: '0xaaaa000000000000000000000000000000000001',
          recipient: '0xbbbb000000000000000000000000000000000002',
          token: '0x0000000000000000000000000000000000000000',
          amount: BigInt(500),
          data: '0x',
        },
        ADDR_VAULT,
        0
      ),
      log(
        'UniversalTxExecuted',
        {
          subTxId: SUB_TX,
          universalTxId: UTX,
          pushAccount: '0xaaaa000000000000000000000000000000000001',
          target: '0xbbbb000000000000000000000000000000000002',
          token: '0x0000000000000000000000000000000000000000',
          amount: BigInt(500),
          data: '0x',
        },
        ADDR_GATEWAY,
        1
      ),
    ]);
    expect(out.kind).toBe('OUTBOUND_FINALIZED');
    expect(out.decoded.subTxId).toBe(SUB_TX);
    expect(out.decoded.universalTxId).toBe(UTX);
    expect(out.decoded.pushAccount).toBe('0xaaaa000000000000000000000000000000000001');
    expect(out.emitters).toEqual(expect.arrayContaining([ADDR_VAULT, ADDR_GATEWAY]));
  });

  it('classifies UniversalTxReverted as OUTBOUND_REVERTED', () => {
    const out = classify([
      log(
        'UniversalTxReverted',
        {
          subTxId: SUB_TX,
          universalTxId: UTX,
          token: '0x0000000000000000000000000000000000000000',
          amount: BigInt(999),
          revertInstruction: {
            revertRecipient: '0xeeee000000000000000000000000000000000005',
            revertMsg: '0xbeef',
          },
        },
        ADDR_VAULT
      ),
    ]);
    expect(out.kind).toBe('OUTBOUND_REVERTED');
    expect(out.decoded.subTxId).toBe(SUB_TX);
    expect(out.decoded.revertRecipient).toBe('0xeeee000000000000000000000000000000000005');
    expect(out.decoded.revertMsgPreview).toBe('0xbeef');
  });

  it('classifies RevertUniversalTx (gateway) as INBOUND_REVERTED with tuple array decode', () => {
    const out = classify([
      log('RevertUniversalTx', {
        subTxId: SUB_TX,
        universalTxId: UTX,
        to: '0xdddd000000000000000000000000000000000006',
        token: '0x0000000000000000000000000000000000000000',
        amount: BigInt(1),
        // viem may return tuples as positional arrays
        revertInstruction: ['0xeeee000000000000000000000000000000000005', '0xcafe'],
      }),
    ]);
    expect(out.kind).toBe('INBOUND_REVERTED');
    expect(out.decoded.revertRecipient).toBe('0xeeee000000000000000000000000000000000005');
    expect(out.decoded.revertMsgPreview).toBe('0xcafe');
  });

  it('priority: finalized beats executed-only', () => {
    const out = classify([
      log('UniversalTxExecuted', {
        subTxId: SUB_TX,
        universalTxId: UTX,
        pushAccount: '0xaaaa000000000000000000000000000000000001',
        target: '0xbbbb000000000000000000000000000000000002',
        token: '0x0000000000000000000000000000000000000000',
        amount: BigInt(0),
        data: '0x',
      }),
      log(
        'UniversalTxFinalized',
        {
          subTxId: SUB_TX,
          universalTxId: UTX,
          pushAccount: '0xaaaa000000000000000000000000000000000001',
          recipient: '0xbbbb000000000000000000000000000000000002',
          token: '0x0000000000000000000000000000000000000000',
          amount: BigInt(0),
          data: '0x',
        },
        ADDR_VAULT
      ),
    ]);
    expect(out.kind).toBe('OUTBOUND_FINALIZED');
  });

  it('returns UNKNOWN when no known universal event matches', () => {
    const out = classify([log('SomeRandomEvent', { foo: 'bar' })]);
    expect(out.kind).toBe('UNKNOWN');
    expect(out.notes).toContain('no known universal-tx event among decoded logs');
  });

  it('classifyAll surfaces every universal-tx log independently', () => {
    // Mirror the real Sepolia R3 receipt: UniversalTx(fromCEA=true) + UniversalTxFinalized
    const inboundLog = log(
      'UniversalTx',
      {
        sender: '0x30a9dB8E3cCe83e8A8720EB61B8728F98449ee6b',
        recipient: '0x4A701114F991bf75685584c8156Db983c0DF95a0',
        token: '0x7169D38820dfd117C3FA1f22a697dBA58d90BA06',
        amount: BigInt(10000),
        payload: '0x',
        revertRecipient: '0x4A701114F991bf75685584c8156Db983c0DF95a0',
        txType: 2,
        signatureData: '0x',
        fromCEA: true,
      },
      ADDR_GATEWAY,
      249
    );
    const finalizedLog = log(
      'UniversalTxFinalized',
      {
        subTxId: SUB_TX,
        universalTxId: UTX,
        pushAccount: '0x4A701114F991bf75685584c8156Db983c0DF95a0',
        recipient: '0x30a9dB8E3cCe83e8A8720EB61B8728F98449ee6b',
        token: '0x0000000000000000000000000000000000000000',
        amount: BigInt(0),
        data: '0x2cc2842d',
      },
      ADDR_VAULT,
      252
    );

    const out = classifyAll([inboundLog, finalizedLog]);
    expect(out).toHaveLength(2);
    expect(out[0].kind).toBe('INBOUND_FROM_CEA');
    expect(out[0].decoded.fromCEA).toBe(true);
    expect(out[0].decoded.amount).toBe(BigInt(10000));
    expect(out[0].log.logIndex).toBe(249);
    expect(out[1].kind).toBe('OUTBOUND_FINALIZED');
    expect(out[1].decoded.subTxId).toBe(SUB_TX);
    expect(out[1].log.logIndex).toBe(252);

    // Primary classify() still picks the winner (FINALIZED).
    const primary = classify([inboundLog, finalizedLog]);
    expect(primary.kind).toBe('OUTBOUND_FINALIZED');
  });

  it('classifyAll returns empty array when no logs', () => {
    expect(classifyAll([])).toEqual([]);
  });

  it('classifyAll drops unrecognized event names', () => {
    const out = classifyAll([log('SomethingElse', {})]);
    expect(out).toEqual([]);
  });

  it('maps unknown txType to UNKNOWN', () => {
    const out = classify([
      log('UniversalTx', {
        sender: '0xaaaa000000000000000000000000000000000001',
        recipient: '0xbbbb000000000000000000000000000000000002',
        token: '0x0',
        amount: BigInt(0),
        payload: '0x',
        revertRecipient: '0x0',
        txType: 99,
        signatureData: '0x',
        fromCEA: false,
      }),
    ]);
    expect(out.decoded.txTypeName).toBe('UNKNOWN');
  });
});

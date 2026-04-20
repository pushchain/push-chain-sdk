/**
 * Unit tests for the cascade (multichain) replay path in tx-transformer.ts.
 *
 * Focus: `reconstructProgressEvents` recovers the user-level hop count by
 * decoding the sendUniversalTxToUEA payload embedded in each R3 outbound.
 * Before this fix, replay reported `outboundTx.length` (2 external legs),
 * missing the Push-internal R1 hops that the orchestrator merged into the
 * R3 inbound's execution.
 */
import { encodeAbiParameters, encodeFunctionData } from 'viem';
import { OutboundStatus } from '../../generated/uexecutor/v2/types';
import { UniversalTxStatus } from '../../generated/uexecutor/v1/types';
import type { UniversalTxV2 } from '../../generated/uexecutor/v2/types';
import { CEA_EVM } from '../../constants/abi/cea.evm';
import { UEA_MULTICALL_SELECTOR, ZERO_ADDRESS } from '../../constants/selectors';
import {
  buildCeaMulticallPayload,
  buildInboundUniversalPayload,
} from '../payload-builders';
import type { UniversalTxResponse } from '../orchestrator.types';
import { reconstructProgressEvents } from '../internals/tx-transformer';

const ZERO_EVM = '0x0000000000000000000000000000000000000000' as `0x${string}`;
const CEA = '0xed13B7229fFF1996957762325a7fD8fbFa5d67C0' as `0x${string}`;
const TARGET = '0x1234567890123456789012345678901234567890' as `0x${string}`;

// Build an R3 outbound payload whose embedded Push-side multicall has
// exactly `innerCount` merged R1 calls (all simple native transfers).
function buildR3OutboundPayload(innerCount: number): string {
  const pushMulticalls = Array.from({ length: innerCount }, (_, i) => ({
    to: TARGET,
    value: BigInt(1000 * (i + 1)),
    data: '0x' as `0x${string}`,
  }));
  const pushMulticallData = buildCeaMulticallPayload(pushMulticalls);
  const universalPayloadBytes = buildInboundUniversalPayload(pushMulticallData);

  const sendUniversalTxToUeaCalldata = encodeFunctionData({
    abi: CEA_EVM,
    functionName: 'sendUniversalTxToUEA',
    args: [ZERO_EVM, BigInt(0), universalPayloadBytes, CEA],
  });
  return buildCeaMulticallPayload([
    { to: CEA, value: BigInt(0), data: sendUniversalTxToUeaCalldata },
  ]);
}

function makeResponse(): UniversalTxResponse {
  return {
    hash: '0xdeadbeef',
    from: '0x0000000000000000000000000000000000000001',
    to: CEA,
    chain: 'eip155:42101',
    chainNamespace: 'eip155:42101',
    origin: 'eip155:42101:0x0000000000000000000000000000000000000001',
    gasLimit: BigInt(0),
    gasPrice: BigInt(0),
    route: undefined,
    raw: {},
  } as unknown as UniversalTxResponse;
}

function makeCascadeV2(
  legs: Array<{ chain: string; payload: string; status?: OutboundStatus }>
): UniversalTxV2 {
  return {
    id: 'utxid',
    pcTx: [],
    outboundTx: legs.map((leg) => ({
      destinationChain: leg.chain,
      recipient: CEA,
      amount: '0',
      externalAssetAddr: '',
      prc20AssetAddr: '',
      sender: '',
      payload: leg.payload,
      gasLimit: '0',
      txType: 0 as unknown as UniversalTxV2['outboundTx'][number]['txType'],
      id: '',
      outboundStatus: leg.status ?? OutboundStatus.OBSERVED,
      gasPrice: '0',
      gasFee: '0',
      refundSwapError: '',
      gasToken: '',
      abortReason: '',
    })),
    universalStatus: UniversalTxStatus.UNIVERSAL_TX_STATUS_UNSPECIFIED,
  };
}

describe('reconstructProgressEvents — cascade multichain replay', () => {
  it('recovers user-level hopCount from an R3 leg with merged R1 calls', () => {
    // 1 R2 leg + 1 R3 leg whose embedded Push multicall has 2 merged calls.
    // User-level hopCount should be (2 outbounds - 1 r3) + 2 merged = 3.
    const r2Payload = buildCeaMulticallPayload([
      { to: TARGET, value: BigInt(0), data: '0xabcdabcd' },
    ]);
    const r3Payload = buildR3OutboundPayload(2);
    const data = makeCascadeV2([
      { chain: 'eip155:97', payload: r2Payload },
      { chain: 'eip155:97', payload: r3Payload },
    ]);

    const events = reconstructProgressEvents(makeResponse(), data);
    const init = events.find((e) => e.id === 'SEND-TX-001')!;
    const term = events.find((e) => e.id === 'SEND-TX-999-01')!;
    expect(init).toBeDefined();
    expect(term).toBeDefined();
    expect((init.response as { hopCount: number }).hopCount).toBe(3);
    expect((term.response as { hopCount: number }).hopCount).toBe(3);
  });

  it('falls back to outboundTx.length when no R3 legs (pure R2 cascade)', () => {
    const r2a = buildCeaMulticallPayload([
      { to: TARGET, value: BigInt(0), data: '0xdead' },
    ]);
    const r2b = buildCeaMulticallPayload([
      { to: TARGET, value: BigInt(0), data: '0xbeef' },
    ]);
    const data = makeCascadeV2([
      { chain: 'eip155:97', payload: r2a },
      { chain: 'eip155:97', payload: r2b },
    ]);

    const events = reconstructProgressEvents(makeResponse(), data);
    const init = events.find((e) => e.id === 'SEND-TX-001')!;
    expect((init.response as { hopCount: number }).hopCount).toBe(2);
  });

  it('clamps defensively — never reports fewer hops than external legs visible', () => {
    // R3 leg with malformed embedded payload (can't decode inner multicall).
    // Fallback: assume 1 merged hop per R3, so hopCount stays at outbounds.length.
    const r2Payload = buildCeaMulticallPayload([
      { to: TARGET, value: BigInt(0), data: '0xabcd' },
    ]);
    // Build an R3-looking payload (contains sendUniversalTxToUEA selector)
    // but with garbage inside that won't decode cleanly.
    const fakeR3 = buildCeaMulticallPayload([
      { to: CEA, value: BigInt(0), data: `0xe7c1e3fc${'00'.repeat(64)}` as `0x${string}` },
    ]);
    const data = makeCascadeV2([
      { chain: 'eip155:97', payload: r2Payload },
      { chain: 'eip155:97', payload: fakeR3 },
    ]);

    const events = reconstructProgressEvents(makeResponse(), data);
    const init = events.find((e) => e.id === 'SEND-TX-001')!;
    const hopCount = (init.response as { hopCount: number }).hopCount;
    expect(hopCount).toBeGreaterThanOrEqual(2);
  });

  it('emits SEND-TX-999-02 with failedAt on a reverted leg', () => {
    const r2Payload = buildCeaMulticallPayload([
      { to: TARGET, value: BigInt(0), data: '0xabcd' },
    ]);
    const data = makeCascadeV2([
      { chain: 'eip155:97', payload: r2Payload, status: OutboundStatus.REVERTED },
      { chain: 'eip155:97', payload: r2Payload },
    ]);

    const events = reconstructProgressEvents(makeResponse(), data);
    const fail = events.find((e) => e.id === 'SEND-TX-999-02');
    const ok = events.find((e) => e.id === 'SEND-TX-999-01');
    expect(fail).toBeDefined();
    expect(ok).toBeUndefined();
    expect((fail!.response as { failedAt: number }).failedAt).toBe(1);
  });
});

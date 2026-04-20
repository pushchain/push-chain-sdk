/**
 * Unit tests for the OBSERVED-gate on `waitForOutboundTx`.
 *
 * Before the fix: `waitForOutboundTx` returned FOUND as soon as cosmos
 * reported `observedTx.txHash`, regardless of `outboundStatus`. A tx that
 * later reverted (cosmos eventually sets `outboundStatus = REVERTED`) was
 * still classified as success because the SDK had already returned.
 *
 * After the fix: the FOUND branch requires both `observedTx.txHash` AND
 * `outboundStatus === OutboundStatus.OBSERVED`. REVERTED is handled by the
 * existing per-outbound failure branch; UNSPECIFIED/PENDING keep polling.
 */
import {
  waitForOutboundTx,
  OutboundTimeoutError,
  OutboundFailedError,
} from '../internals/outbound-sync';
import type { OrchestratorContext } from '../internals/context';
import { OutboundStatus } from '../../generated/uexecutor/v2/types';
import { UniversalTxStatus } from '../../generated/uexecutor/v1/types';

type CosmosResponse = {
  universalTx: {
    universalStatus: UniversalTxStatus;
    outboundTx: Array<{
      destinationChain: string;
      recipient: string;
      amount: string;
      externalAssetAddr: string;
      outboundStatus: OutboundStatus;
      observedTx?: { txHash: string; errorMsg?: string };
    }>;
  };
};

function makeCtx(
  responses: CosmosResponse[]
): OrchestratorContext {
  let pollIdx = 0;
  return {
    pushClient: {
      getUniversalTxByIdV2: jest.fn(async () => {
        // Return sequential responses; after exhausting, keep returning the
        // last one (covers polls beyond the scripted transitions).
        const idx = Math.min(pollIdx, responses.length - 1);
        pollIdx += 1;
        return responses[idx];
      }),
      publicClient: { getTransactionReceipt: jest.fn() },
    },
    printTraces: false,
    pushNetwork: 'TESTNET_DONUT',
    // No rpcUrls — disables the source-chain RPC tiebreaker so unit tests
    // don't accidentally hit live testnet RPCs.
  } as unknown as OrchestratorContext;
}

// Cosmos response scaffold — callers override outboundStatus / observedTx.
function outbound(
  outboundStatus: OutboundStatus,
  txHash?: string,
  destinationChain = 'eip155:97' // BNB Testnet — matches ETHEREUM_SEPOLIA origin shape
): CosmosResponse['universalTx']['outboundTx'][number] {
  return {
    destinationChain,
    recipient: '0xreceiver',
    amount: '0',
    externalAssetAddr: '0x0000000000000000000000000000000000000000',
    outboundStatus,
    observedTx: txHash ? { txHash } : undefined,
  };
}

function response(
  outbounds: Array<ReturnType<typeof outbound>>,
  universalStatus: UniversalTxStatus = UniversalTxStatus.UNIVERSAL_TX_STATUS_UNSPECIFIED
): CosmosResponse {
  return { universalTx: { universalStatus, outboundTx: outbounds } };
}

describe('waitForOutboundTx OBSERVED gate', () => {
  it('does NOT return FOUND when outboundStatus is UNSPECIFIED even if txHash is set', async () => {
    const ctx = makeCtx([
      response([
        outbound(OutboundStatus.OUTBOUND_STATUS_UNSPECIFIED, '0xextA'),
      ]),
    ]);

    // Short timeout so the test stays fast; stream stays UNSPECIFIED so we
    // must hit the timeout path. Before the fix this would return FOUND on
    // poll #1.
    await expect(
      waitForOutboundTx(ctx, '0xpushtx', {
        initialWaitMs: 0,
        pollingIntervalMs: 20,
        timeout: 300,
      })
    ).rejects.toBeInstanceOf(OutboundTimeoutError);
  });

  it('does NOT return FOUND when outboundStatus is PENDING even if txHash is set', async () => {
    const ctx = makeCtx([
      response([outbound(OutboundStatus.PENDING, '0xextB')]),
    ]);

    await expect(
      waitForOutboundTx(ctx, '0xpushtx', {
        initialWaitMs: 0,
        pollingIntervalMs: 20,
        timeout: 300,
      })
    ).rejects.toBeInstanceOf(OutboundTimeoutError);
  });

  it('returns FOUND once outboundStatus transitions to OBSERVED', async () => {
    const ctx = makeCtx([
      // Poll 1 — txHash reported but still UNSPECIFIED: do NOT return yet
      response([
        outbound(OutboundStatus.OUTBOUND_STATUS_UNSPECIFIED, '0xextC'),
      ]),
      // Poll 2 — cosmos confirms OBSERVED with same hash: return FOUND
      response([outbound(OutboundStatus.OBSERVED, '0xextC')]),
    ]);

    const details = await waitForOutboundTx(ctx, '0xpushtx', {
      initialWaitMs: 0,
      pollingIntervalMs: 20,
      timeout: 2000,
    });
    expect(details.externalTxHash).toBe('0xextC');
    // CHAIN enum values are CAIP-2 namespaces (see constants/enums.ts:28),
    // so destinationChain resolves back to the same 'eip155:97' string.
    expect(details.destinationChain).toBe('eip155:97');
  });

  it('throws OutboundFailedError when outboundStatus transitions to REVERTED (existing behavior preserved)', async () => {
    const ctx = makeCtx([
      response([
        outbound(OutboundStatus.OUTBOUND_STATUS_UNSPECIFIED, '0xextD'),
      ]),
      response([
        {
          ...outbound(OutboundStatus.REVERTED, '0xextD'),
          observedTx: { txHash: '0xextD', errorMsg: 'execution reverted' },
        },
      ]),
    ]);

    try {
      await waitForOutboundTx(ctx, '0xpushtx', {
        initialWaitMs: 0,
        pollingIntervalMs: 20,
        timeout: 2000,
      });
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(OutboundFailedError);
      const typed = err as OutboundFailedError;
      expect(typed.code).toBe('OUTBOUND_FAILED');
      expect(typed.destinationChain).toBe('eip155:97');
      expect(typed.message).toContain('execution reverted');
    }
  });

  it('multi-outbound: picks the OBSERVED entry even when an UNSPECIFIED entry with txHash appears first in the array', async () => {
    const ctx = makeCtx([
      response([
        // UNSPECIFIED + txHash first — pre-fix code would have returned this
        outbound(
          OutboundStatus.OUTBOUND_STATUS_UNSPECIFIED,
          '0xunspec',
          'eip155:97'
        ),
        // Real confirmed tx on the expected chain
        outbound(OutboundStatus.OBSERVED, '0xobserved', 'eip155:11155111'),
      ]),
    ]);

    const details = await waitForOutboundTx(ctx, '0xpushtx', {
      initialWaitMs: 0,
      pollingIntervalMs: 20,
      timeout: 1000,
    });
    expect(details.externalTxHash).toBe('0xobserved');
  });
});

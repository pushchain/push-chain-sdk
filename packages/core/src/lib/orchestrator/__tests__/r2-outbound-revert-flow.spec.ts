/**
 * Full-chain integration unit test for Route 2 outbound REVERTED handling.
 *
 * Bridges two layers that are otherwise tested in isolation:
 *   - `waitForOutboundTx` (outbound-sync.ts) throwing `OutboundFailedError`
 *     when cosmos transitions `outboundStatus` to REVERTED.
 *   - `pickWaitHooks(UOA_TO_CEA).failed()` emitting `SEND-TX-299-02` and the
 *     response-builder's receipt-annotation pattern stamping
 *     `externalStatus: 'failed'` + `externalError`.
 *
 * The outbound-confirmation-gate spec already covers the error-throwing side;
 * outbound-error-classification covers the classification side. This test
 * glues them so a regression in either layer surfaces end-to-end.
 */
import {
  waitForOutboundTx,
  OutboundFailedError,
  OutboundTimeoutError,
} from '../internals/outbound-sync';
import type { OrchestratorContext } from '../internals/context';
import { OutboundStatus } from '../../generated/uexecutor/v2/types';
import { UniversalTxStatus } from '../../generated/uexecutor/v1/types';
import { pickWaitHooks } from '../internals/progress-route-hooks';
import { TransactionRoute } from '../route-detector';
import { PROGRESS_HOOK } from '../../progress-hook/progress-hook.types';
import { CHAIN } from '../../constants/enums';

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

function makeCtx(responses: CosmosResponse[]): OrchestratorContext {
  let pollIdx = 0;
  return {
    pushClient: {
      getUniversalTxByIdV2: jest.fn(async () => {
        const idx = Math.min(pollIdx, responses.length - 1);
        pollIdx += 1;
        return responses[idx];
      }),
      publicClient: { getTransactionReceipt: jest.fn() },
    },
    printTraces: false,
    pushNetwork: 'TESTNET_DONUT',
  } as unknown as OrchestratorContext;
}

// Simulates response-builder.wait()'s catch block for outbound errors:
//   isTimeout = err instanceof OutboundTimeoutError
//   emit(isTimeout ? hooks.timeout(...) : hooks.failed(chain, errMsg))
//   receipt = { ...receipt, externalStatus: isTimeout ? 'timeout' : 'failed', externalError: errMsg }
function classifyAndBuildReceipt(
  error: unknown,
  targetChain: string,
  timeoutMs: number,
  baseReceipt: Record<string, unknown>
) {
  const hooks = pickWaitHooks(TransactionRoute.UOA_TO_CEA);
  const errMsg = error instanceof Error ? error.message : String(error);
  const isTimeout = error instanceof OutboundTimeoutError;
  const event = isTimeout
    ? hooks.timeout(targetChain, timeoutMs)
    : hooks.failed(targetChain, errMsg);
  const receipt = {
    ...baseReceipt,
    externalStatus: isTimeout ? 'timeout' : 'failed',
    externalError: errMsg,
  };
  return { event, receipt, errMsg, isTimeout };
}

describe('R2 outbound REVERTED → 299-02 + externalStatus=failed (full-chain)', () => {
  it('cosmos REVERTED transition drives OutboundFailedError → 299-02 + failed receipt', async () => {
    const reverted: CosmosResponse = {
      universalTx: {
        universalStatus: UniversalTxStatus.UNIVERSAL_TX_STATUS_UNSPECIFIED,
        outboundTx: [
          {
            destinationChain: 'eip155:11155111',
            recipient: '0xdead0000dead0000dead0000dead0000dead0001',
            amount: '10000',
            externalAssetAddr: '0xtoken',
            outboundStatus: OutboundStatus.REVERTED,
            observedTx: {
              txHash: '0xr2extRevertedHash',
              errorMsg: 'ERC20: transfer amount exceeds balance',
            },
          },
        ],
      },
    };
    const unspecified: CosmosResponse = {
      universalTx: {
        universalStatus: UniversalTxStatus.UNIVERSAL_TX_STATUS_UNSPECIFIED,
        outboundTx: [
          {
            destinationChain: 'eip155:11155111',
            recipient: '0xdead0000dead0000dead0000dead0000dead0001',
            amount: '10000',
            externalAssetAddr: '0xtoken',
            outboundStatus: OutboundStatus.OUTBOUND_STATUS_UNSPECIFIED,
            observedTx: undefined,
          },
        ],
      },
    };

    const ctx = makeCtx([unspecified, reverted]);

    let thrown: unknown;
    try {
      await waitForOutboundTx(ctx, '0xpushtxR2', {
        initialWaitMs: 0,
        pollingIntervalMs: 20,
        timeout: 2000,
      });
      throw new Error('expected throw');
    } catch (err) {
      thrown = err;
    }

    // Error side — must be OutboundFailedError with correct fields.
    expect(thrown).toBeInstanceOf(OutboundFailedError);
    const typed = thrown as OutboundFailedError;
    expect(typed.code).toBe('OUTBOUND_FAILED');
    expect(typed.destinationChain).toBe('eip155:11155111');
    expect(typed.message).toContain(
      'ERC20: transfer amount exceeds balance'
    );

    // Classification side — drives the response-builder's catch branch.
    const { event, receipt, isTimeout } = classifyAndBuildReceipt(
      thrown,
      CHAIN.ETHEREUM_SEPOLIA,
      180_000,
      { status: 1, hash: '0xpushtxR2' }
    );

    expect(isTimeout).toBe(false);
    expect(event.id).toBe(PROGRESS_HOOK.SEND_TX_299_02);
    expect(event.level).toBe('ERROR');
    expect(
      (event.response as { error: string; chain: string }).error
    ).toContain('ERC20: transfer amount exceeds balance');
    expect(receipt.externalStatus).toBe('failed');
    expect((receipt.externalError as string)).toContain(
      'transfer amount exceeds balance'
    );
  });

  it('cosmos timeout (UNSPECIFIED forever) drives OutboundTimeoutError → 299-03 + timeout receipt', async () => {
    const stuck: CosmosResponse = {
      universalTx: {
        universalStatus: UniversalTxStatus.UNIVERSAL_TX_STATUS_UNSPECIFIED,
        outboundTx: [
          {
            destinationChain: 'eip155:11155111',
            recipient: '0xdead',
            amount: '0',
            externalAssetAddr: '0x0000000000000000000000000000000000000000',
            outboundStatus: OutboundStatus.OUTBOUND_STATUS_UNSPECIFIED,
            observedTx: { txHash: '0xhashButNotObserved' },
          },
        ],
      },
    };
    const ctx = makeCtx([stuck]);

    let thrown: unknown;
    try {
      await waitForOutboundTx(ctx, '0xpushtxR2', {
        initialWaitMs: 0,
        pollingIntervalMs: 20,
        timeout: 200,
      });
      throw new Error('expected throw');
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(OutboundTimeoutError);
    const { event, receipt, isTimeout } = classifyAndBuildReceipt(
      thrown,
      CHAIN.ETHEREUM_SEPOLIA,
      200,
      { status: 1, hash: '0xpushtxR2' }
    );
    expect(isTimeout).toBe(true);
    expect(event.id).toBe(PROGRESS_HOOK.SEND_TX_299_03);
    expect(receipt.externalStatus).toBe('timeout');
    expect(receipt.externalError as string).toContain('Timeout');
  });
});

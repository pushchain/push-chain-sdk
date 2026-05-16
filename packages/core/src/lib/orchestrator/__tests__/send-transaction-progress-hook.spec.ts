/**
 * Tests for the per-call `progressHook` option on
 * `pushChain.universal.sendTransaction(params, { progressHook })`.
 *
 * The underlying Route 1 executor is mocked so this verifies the orchestrator
 * hook wiring without signing or touching RPC.
 */

import { Orchestrator } from '../orchestrator';
import { CHAIN, PUSH_NETWORK } from '../../constants/enums';
import type { UniversalSigner } from '../../universal/universal.types';
import {
  PROGRESS_HOOK,
  ProgressEvent,
} from '../../progress-hook/progress-hook.types';
import type { UniversalTxResponse } from '../orchestrator.types';
import { fireProgressHook } from '../internals/context';

jest.mock('../internals/execute-standard', () => {
  const actual = jest.requireActual('../internals/execute-standard');
  return {
    ...actual,
    executeStandardPayload: jest.fn(),
  };
});

jest.mock('../internals/route-handlers', () => {
  const actual = jest.requireActual('../internals/route-handlers');
  return {
    ...actual,
    executeMultiChain: jest.fn(),
  };
});

jest.mock('../internals', () => {
  const actual = jest.requireActual('../internals');
  const mockedExecuteStandard = jest.requireMock('../internals/execute-standard');
  const mockedRouteHandlers = jest.requireMock('../internals/route-handlers');
  return {
    ...actual,
    executeStandardPayload: mockedExecuteStandard.executeStandardPayload,
    executeMultiChain: mockedRouteHandlers.executeMultiChain,
  };
});

import { executeStandardPayload as _mockedExecuteStandardPayload } from '../internals/execute-standard';
import { executeMultiChain as _mockedExecuteMultiChain } from '../internals/route-handlers';
const mockedExecuteStandardPayload =
  _mockedExecuteStandardPayload as unknown as jest.Mock;
const mockedExecuteMultiChain =
  _mockedExecuteMultiChain as unknown as jest.Mock;

const mockSigner: UniversalSigner = {
  account: {
    address: '0x35B84d6848D16415177c64D64504663b998A6ab4',
    chain: CHAIN.ETHEREUM_SEPOLIA,
  },
  signMessage: async (data: Uint8Array) => data,
  signAndSendTransaction: async (unsignedTx: Uint8Array) => unsignedTx,
};

const fakeResponse = {
  hash: '0x1111111111111111111111111111111111111111111111111111111111111111',
  wait: jest.fn(),
  progressHook: jest.fn(),
  _setProgressHookNoReplay: jest.fn(),
} as unknown as UniversalTxResponse;

function makeOrchestrator(
  initHook?: (e: ProgressEvent) => void
): Orchestrator {
  const orchestrator = new Orchestrator(
    mockSigner,
    PUSH_NETWORK.TESTNET_DONUT,
    {},
    false,
    initHook
  );
  (orchestrator as any).accountStatusCache = {
    uea: {
      loaded: true,
      deployed: false,
      requiresUpgrade: false,
    },
  };
  return orchestrator;
}

function mockSuccessfulRoute1Execution(): void {
  mockedExecuteStandardPayload.mockImplementation(async (ctx) => {
    fireProgressHook(
      ctx,
      PROGRESS_HOOK.SEND_TX_101,
      CHAIN.ETHEREUM_SEPOLIA,
      mockSigner.account.address
    );
    fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_199_01, [fakeResponse]);
    return fakeResponse;
  });
}

describe('Orchestrator.execute — sendTransaction per-call progressHook', () => {
  beforeEach(() => {
    mockedExecuteStandardPayload.mockReset();
    mockedExecuteMultiChain.mockReset();
    (fakeResponse._setProgressHookNoReplay as jest.Mock).mockReset();
    mockSuccessfulRoute1Execution();
  });

  it('fans progress events to both init-time and per-call hooks', async () => {
    const initHook = jest.fn();
    const perCallHook = jest.fn();
    const orchestrator = makeOrchestrator(initHook);

    await orchestrator.execute(
      {
        to: '0x35B84d6848D16415177c64D64504663b998A6ab4',
        value: BigInt(1),
      },
      { progressHook: perCallHook }
    );

    const initIds = initHook.mock.calls.map((call) => call[0].id);
    const perCallIds = perCallHook.mock.calls.map((call) => call[0].id);

    expect(initIds).toEqual([
      PROGRESS_HOOK.SEND_TX_101,
      PROGRESS_HOOK.SEND_TX_199_01,
    ]);
    expect(perCallIds).toEqual(initIds);
    expect(fakeResponse._setProgressHookNoReplay).toHaveBeenCalledWith(
      perCallHook
    );
    expect(orchestrator.getProgressHook()).toBe(initHook);
  });

  it('does not double-fire when the per-call hook is the init-time hook', async () => {
    const sharedHook = jest.fn();
    const orchestrator = makeOrchestrator(sharedHook);

    await orchestrator.execute(
      {
        to: '0x35B84d6848D16415177c64D64504663b998A6ab4',
        value: BigInt(1),
      },
      { progressHook: sharedHook }
    );

    expect(sharedHook).toHaveBeenCalledTimes(2);
    expect(sharedHook.mock.calls.map((call) => call[0].id)).toEqual([
      PROGRESS_HOOK.SEND_TX_101,
      PROGRESS_HOOK.SEND_TX_199_01,
    ]);
  });

  it('delivers per-call events when no init-time hook is configured', async () => {
    const perCallHook = jest.fn();
    const orchestrator = makeOrchestrator(undefined);

    await orchestrator.execute(
      {
        to: '0x35B84d6848D16415177c64D64504663b998A6ab4',
        value: BigInt(1),
      },
      { progressHook: perCallHook }
    );

    expect(perCallHook.mock.calls.map((call) => call[0].id)).toEqual([
      PROGRESS_HOOK.SEND_TX_101,
      PROGRESS_HOOK.SEND_TX_199_01,
    ]);
    expect(orchestrator.getProgressHook()).toBeUndefined();
  });

  it('restores the init-time hook when execution rejects', async () => {
    const initHook = jest.fn();
    const perCallHook = jest.fn();
    const orchestrator = makeOrchestrator(initHook);

    mockedExecuteStandardPayload.mockImplementationOnce(async (ctx) => {
      fireProgressHook(
        ctx,
        PROGRESS_HOOK.SEND_TX_101,
        CHAIN.ETHEREUM_SEPOLIA,
        mockSigner.account.address
      );
      throw new Error('mock route failure');
    });

    await expect(
      orchestrator.execute(
        {
          to: '0x35B84d6848D16415177c64D64504663b998A6ab4',
          value: BigInt(1),
        },
        { progressHook: perCallHook }
      )
    ).rejects.toThrow('mock route failure');

    expect(initHook.mock.calls.map((call) => call[0].id)).toEqual([
      PROGRESS_HOOK.SEND_TX_101,
      PROGRESS_HOOK.SEND_TX_199_02,
    ]);
    expect(perCallHook.mock.calls.map((call) => call[0].id)).toEqual([
      PROGRESS_HOOK.SEND_TX_101,
      PROGRESS_HOOK.SEND_TX_199_02,
    ]);
    expect(fakeResponse._setProgressHookNoReplay).not.toHaveBeenCalled();
    expect(orchestrator.getProgressHook()).toBe(initHook);
  });

  it('keeps the per-call hook active across multi-chain outer and recursive inner execute paths', async () => {
    const initHook = jest.fn();
    const perCallHook = jest.fn();
    const orchestrator = makeOrchestrator(initHook);

    mockedExecuteMultiChain.mockImplementation(async (ctx, _params, executeFn) => {
      fireProgressHook(
        ctx,
        PROGRESS_HOOK.SEND_TX_201,
        CHAIN.BNB_TESTNET,
        '0x1234567890123456789012345678901234567890'
      );
      const response = await executeFn({
        to: '0x35B84d6848D16415177c64D64504663b998A6ab4',
        value: BigInt(1),
      });
      fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_204_01);
      return response;
    });

    await orchestrator.execute(
      {
        to: {
          address: '0x1234567890123456789012345678901234567890',
          chain: CHAIN.BNB_TESTNET,
        },
        value: BigInt(1),
      },
      { progressHook: perCallHook }
    );

    const initIds = initHook.mock.calls.map((call) => call[0].id);
    const perCallIds = perCallHook.mock.calls.map((call) => call[0].id);

    expect(initIds).toEqual([
      PROGRESS_HOOK.SEND_TX_201,
      PROGRESS_HOOK.SEND_TX_204_01,
    ]);
    expect(perCallIds).toEqual(initIds);
    expect(fakeResponse._setProgressHookNoReplay).toHaveBeenCalledWith(
      perCallHook
    );
    expect(orchestrator.getProgressHook()).toBe(initHook);
  });
});

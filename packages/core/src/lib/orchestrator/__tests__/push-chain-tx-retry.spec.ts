/**
 * Unit tests for sendUniversalTx retry on InvalidEVMSignature (0xc7dbd31d).
 *
 * UEA_EVM.getUniversalPayloadHash uses the contract's live storage `nonce`,
 * so if UEA.nonce advances between our getUEANonce() read and Cosmos
 * inclusion, the recovered signer mismatches and the tx reverts with
 * InvalidEVMSignature(). sendUniversalTx must detect the selector in
 * tx.rawLog, invoke resignFn, and re-broadcast.
 */
import { sendUniversalTx } from '../internals/push-chain-tx';
import { CHAIN, PUSH_NETWORK, VM } from '../../constants/enums';
import { VerificationType } from '../../generated/v1/tx';
import type { UniversalPayload } from '../../generated/v1/tx';
import type { OrchestratorContext } from '../internals/context';

const ALICE = '0xabCDEF1234567890ABcDEF1234567890aBCDeF12' as `0x${string}`;
const BOB = '0x1111111111111111111111111111111111111111' as `0x${string}`;

function makePayload(overrides?: Partial<UniversalPayload>): UniversalPayload {
  return {
    to: BOB,
    value: '1000',
    data: '0xdeadbeef',
    gasLimit: '100000',
    maxFeePerGas: '10000000000',
    maxPriorityFeePerGas: '0',
    nonce: '42',
    deadline: '9999999999',
    vType: VerificationType.signedVerification,
    ...overrides,
  } as unknown as UniversalPayload;
}

function makeCtx(broadcastImpl: jest.Mock): OrchestratorContext {
  return {
    pushClient: {
      getSignerAddress: () => ({ cosmosAddress: 'push1foo', evmAddress: ALICE }),
      createMsgExecutePayload: jest.fn().mockReturnValue({ typeUrl: '/push.Msg', value: new Uint8Array() }),
      createCosmosTxBody: jest.fn().mockResolvedValue({}),
      signCosmosTx: jest.fn().mockResolvedValue({}),
      broadcastCosmosTx: broadcastImpl,
      getTransaction: jest.fn().mockResolvedValue({ hash: '0xabc', from: ALICE } as any),
    },
    universalSigner: {
      account: { chain: CHAIN.ETHEREUM_SEPOLIA, address: ALICE },
      signTypedData: jest.fn(),
      signMessage: jest.fn(),
      signAndSendTransaction: jest.fn(),
    },
    pushNetwork: PUSH_NETWORK.TESTNET_DONUT,
    rpcUrls: {},
    printTraces: false,
    progressHook: undefined,
    accountStatusCache: null,
  } as unknown as OrchestratorContext;
}

const SUCCESS_TX = {
  code: 0,
  transactionHash: '0xpushcosmos',
  height: 123,
  gasUsed: BigInt(1000),
  gasWanted: BigInt(2000),
  rawLog: '',
  events: [
    {
      type: 'ethereum_tx',
      attributes: [{ key: 'ethereumTxHash', value: '0xabc' }],
    },
  ],
};

const SIG_MISMATCH_TX = {
  code: 1,
  transactionHash: '0xfailed',
  height: 122,
  gasUsed: BigInt(500),
  gasWanted: BigInt(2000),
  rawLog:
    "failed to execute message; message index: 0: contract call failed: method 'executeUniversalTx', contract '0xUEA': execution reverted: ret 0xc7dbd31d: evm transaction execution failed",
  events: [],
};

const OTHER_FAILURE_TX = {
  code: 1,
  transactionHash: '0xfailed2',
  height: 122,
  gasUsed: BigInt(500),
  gasWanted: BigInt(2000),
  rawLog: "execution reverted: ret 0xf4d678b8: insufficient balance",
  events: [],
};

describe('sendUniversalTx — InvalidEVMSignature retry', () => {
  const transformFn = jest.fn().mockResolvedValue({ hash: '0xabc' } as any);

  beforeEach(() => {
    transformFn.mockClear();
  });

  it('retries once with fresh signature when first broadcast fails with 0xc7dbd31d', async () => {
    const broadcast = jest.fn()
      .mockResolvedValueOnce(SIG_MISMATCH_TX)
      .mockResolvedValueOnce(SUCCESS_TX);
    const ctx = makeCtx(broadcast);

    const freshPayload = makePayload({ nonce: '43' });
    const resignFn = jest.fn().mockResolvedValue({
      universalPayload: freshPayload,
      verificationData: '0xfeedface' as `0x${string}`,
    });

    const result = await sendUniversalTx(
      ctx,
      true,
      undefined,
      makePayload({ nonce: '42' }),
      '0xstalesig' as `0x${string}`,
      [],
      transformFn,
      resignFn,
    );

    expect(broadcast).toHaveBeenCalledTimes(2);
    expect(resignFn).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(1);

    // Second broadcast must have used the resigned payload (freshPayload + fresh sig).
    const secondMsg = (ctx.pushClient.createMsgExecutePayload as jest.Mock).mock.calls[1][0];
    expect(secondMsg.universalPayload).toBe(freshPayload);
    expect(secondMsg.verificationData).toBe('0xfeedface');
  });

  it('does not retry when resignFn is undefined even if selector matches', async () => {
    const broadcast = jest.fn().mockResolvedValueOnce(SIG_MISMATCH_TX);
    const ctx = makeCtx(broadcast);

    await expect(
      sendUniversalTx(
        ctx,
        true,
        undefined,
        makePayload(),
        '0xstalesig' as `0x${string}`,
        [],
        transformFn,
        undefined,
      )
    ).rejects.toThrow(/c7dbd31d/);

    expect(broadcast).toHaveBeenCalledTimes(1);
  });

  it('does not retry when revert selector is different (e.g. InsufficientBalance)', async () => {
    const broadcast = jest.fn().mockResolvedValueOnce(OTHER_FAILURE_TX);
    const ctx = makeCtx(broadcast);
    const resignFn = jest.fn();

    await expect(
      sendUniversalTx(
        ctx,
        true,
        undefined,
        makePayload(),
        '0xsig' as `0x${string}`,
        [],
        transformFn,
        resignFn,
      )
    ).rejects.toThrow(/f4d678b8/);

    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(resignFn).not.toHaveBeenCalled();
  });

  it('gives up after MAX_SIG_RETRIES and throws the last rawLog', async () => {
    const broadcast = jest.fn()
      .mockResolvedValueOnce(SIG_MISMATCH_TX)
      .mockResolvedValueOnce(SIG_MISMATCH_TX)
      .mockResolvedValueOnce(SIG_MISMATCH_TX);
    const ctx = makeCtx(broadcast);

    const resignFn = jest.fn().mockResolvedValue({
      universalPayload: makePayload({ nonce: '99' }),
      verificationData: '0xfeedface' as `0x${string}`,
    });

    await expect(
      sendUniversalTx(
        ctx,
        true,
        undefined,
        makePayload(),
        '0xstalesig' as `0x${string}`,
        [],
        transformFn,
        resignFn,
      )
    ).rejects.toThrow(/c7dbd31d/);

    expect(broadcast).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
    expect(resignFn).toHaveBeenCalledTimes(2);
  });

  it('does not retry on first-attempt success', async () => {
    const broadcast = jest.fn().mockResolvedValueOnce(SUCCESS_TX);
    const ctx = makeCtx(broadcast);
    const resignFn = jest.fn();

    await sendUniversalTx(
      ctx,
      true,
      undefined,
      makePayload(),
      '0xsig' as `0x${string}`,
      [],
      transformFn,
      resignFn,
    );

    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(resignFn).not.toHaveBeenCalled();
  });
});

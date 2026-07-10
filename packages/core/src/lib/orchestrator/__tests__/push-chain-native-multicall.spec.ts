import { CHAIN, PUSH_NETWORK } from '../../constants/enums';
import { construct, toUniversal } from '../../universal/signer/signer';
import { EIP7702NotSupportedError } from '../../vm-client/evm-client';
import type { OrchestratorContext } from '../internals/context';
import { sendPushTx } from '../internals/push-chain-tx';
import type { ExecuteParams, MultiCall } from '../orchestrator.types';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;
const TOKEN = '0x1111111111111111111111111111111111111111' as const;
const PUSHPAY_CORE = '0x6a03976df2ae697b642c4310b22ee224cc70f384' as const;
const HASH_1 = `0x${'11'.repeat(32)}` as `0x${string}`;
const HASH_2 = `0x${'22'.repeat(32)}` as `0x${string}`;

const calls: MultiCall[] = [
  { to: TOKEN, value: BigInt(0), data: '0x095ea7b3' },
  { to: PUSHPAY_CORE, value: BigInt(0), data: '0x12345678' },
];

const execute: ExecuteParams = {
  to: ZERO_ADDRESS,
  value: BigInt(0),
  data: calls,
};

function makeContext(signer: OrchestratorContext['universalSigner']) {
  const waitForTransactionReceipt = jest.fn().mockImplementation(({ hash }) =>
    Promise.resolve({
      status: 'success',
      blockNumber: hash === HASH_1 ? BigInt(101) : BigInt(102),
    })
  );
  const pushClient = {
    sendBatch7702: jest.fn().mockResolvedValue(HASH_2),
    sendTransaction: jest
      .fn()
      .mockResolvedValueOnce(HASH_1)
      .mockResolvedValueOnce(HASH_2),
    getTransaction: jest.fn().mockImplementation((hash) =>
      Promise.resolve({
        hash,
        from: signer.account.address,
      })
    ),
    publicClient: {
      getTransactionCount: jest.fn().mockResolvedValue(41),
      waitForTransactionReceipt,
      call: jest.fn(),
    },
  };

  const ctx = {
    pushClient,
    universalSigner: signer,
    pushNetwork: PUSH_NETWORK.TESTNET_DONUT,
    rpcUrls: {},
    printTraces: false,
    accountStatusCache: null,
  } as unknown as OrchestratorContext;

  return { ctx, pushClient };
}

const transformFn = jest.fn().mockImplementation((tx) =>
  Promise.resolve({
    hash: tx.hash,
    atomic: true,
  })
);

describe('sendPushTx native multicall routing', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    transformFn.mockClear();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('uses the atomic EIP-7702 route for a constructed signer', async () => {
    const signerSkeleton = construct(
      {
        chain: CHAIN.PUSH_TESTNET_DONUT,
        address: '0x3333333333333333333333333333333333333333',
      },
      {
        signMessage: async (data) => data,
        signAndSendTransaction: async (data) => data,
        signAuthorization: jest.fn(),
      }
    );
    const signer = await toUniversal(signerSkeleton);
    const { ctx, pushClient } = makeContext(signer);

    const response = await sendPushTx(ctx, execute, [], transformFn);

    expect(pushClient.sendBatch7702).toHaveBeenCalledWith({
      executor: '0x0106BF2F9B02f32203A83a3bDaD79fE8818f3796',
      calls,
      signer,
    });
    expect(pushClient.sendTransaction).not.toHaveBeenCalled();
    expect(response).toEqual(expect.objectContaining({ hash: HASH_2 }));
  });

  it('estimates gas per operation in the sequential fallback', async () => {
    const signer = await toUniversal(
      construct(
        {
          chain: CHAIN.PUSH_TESTNET_DONUT,
          address: '0x3333333333333333333333333333333333333333',
        },
        {
          signMessage: async (data) => data,
          signAndSendTransaction: async (data) => data,
        }
      )
    );
    const { ctx, pushClient } = makeContext(signer);

    const response = await sendPushTx(ctx, execute, [], transformFn);

    expect(pushClient.sendTransaction).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        to: TOKEN,
        nonce: 41,
        signer,
      })
    );
    expect(pushClient.sendTransaction).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        to: PUSHPAY_CORE,
        nonce: 42,
        signer,
      })
    );
    for (const [params] of pushClient.sendTransaction.mock.calls) {
      expect(params).not.toHaveProperty('gas');
    }
    expect(response.atomic).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('separate, non-atomic transactions')
    );
  });

  it('falls back when authorization is unsupported before broadcast', async () => {
    const signer = await toUniversal(
      construct(
        {
          chain: CHAIN.PUSH_TESTNET_DONUT,
          address: '0x3333333333333333333333333333333333333333',
        },
        {
          signMessage: async (data) => data,
          signAndSendTransaction: async (data) => data,
          signAuthorization: jest.fn(),
        }
      )
    );
    const { ctx, pushClient } = makeContext(signer);
    pushClient.sendBatch7702.mockRejectedValueOnce(
      new EIP7702NotSupportedError()
    );

    const response = await sendPushTx(ctx, execute, [], transformFn);

    expect(pushClient.sendBatch7702).toHaveBeenCalledTimes(1);
    expect(pushClient.sendTransaction).toHaveBeenCalledTimes(2);
    expect(response.atomic).toBe(false);
  });
});

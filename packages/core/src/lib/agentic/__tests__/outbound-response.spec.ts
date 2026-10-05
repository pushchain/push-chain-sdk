import { encodeFunctionData, getAddress, type Hex } from 'viem';
import { CHAIN, PUSH_NETWORK } from '../../constants/enums';
import { ERC20_EVM } from '../../constants/abi';
import { TransactionRoute } from '../../orchestrator/route-detector';
import type { UniversalExecuteParams } from '../../orchestrator/orchestrator.types';
import { transformToUniversalTxReceipt } from '../../orchestrator/internals/tx-transformer';
import { transformToUniversalTxResponse } from '../../orchestrator/internals/response-builder';
import { adaptTrackedResponse } from '../response';
import { composeOutbound, type DestinationCall } from '../execution/outbound';
import { agenticSend } from '../execution/send';
import { v4 } from '../contracts/v4';
import { currentGeneration, resetAgenticGenerations } from '../deployments';
import type { AgenticExecutionContext } from '../context';
import { ADDR, FakeChain, registerFakeGeneration, ruleId } from './fake-chain';
import { mockRuntime, fakeResponse } from './mock-runtime';

jest.mock('../../universal/account/account', () => ({
  convertExecutorToOrigin: jest
    .fn()
    .mockResolvedValue({ account: null, exists: false }),
}));

afterEach(() => resetAgenticGenerations());

const USDC = {
  symbol: 'USDC',
  decimals: 6,
  address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' as Hex,
  mechanism: 'approve' as const,
};
const TRANSFER = encodeFunctionData({
  abi: ERC20_EVM,
  functionName: 'transfer',
  args: [ADDR.target, BigInt(10)],
});
const TOKEN_CALL: DestinationCall = {
  to: getAddress(USDC.address),
  data: TRANSFER,
  value: BigInt(0),
};
const APP_CALL: DestinationCall = {
  to: ADDR.target,
  data: '0xd09de08a',
  value: BigInt(0),
};
const PRC20 = ADDR.other;
const PUSH_HASH = `0x${'ab'.repeat(32)}` as Hex;
const EXTERNAL_HASH = `0x${'ef'.repeat(32)}` as Hex;

function fixture() {
  registerFakeGeneration();
  const fake = new FakeChain();
  const wallet = fake.addWallet(ADDR.owner, 'outbound-review');
  const gen = currentGeneration(PUSH_NETWORK.TESTNET_DONUT);
  const read = fake.readContract.bind(fake);
  fake.readContract = async (args) =>
    args.functionName === 'SOURCE_CHAIN_NAMESPACE'
      ? CHAIN.ETHEREUM_SEPOLIA
      : read(args);
  fake.balances.set(`pc:${wallet.address.toLowerCase()}`, BigInt(100000));
  fake.balances.set(`balanceOf:${PRC20.toLowerCase()}`, BigInt(1000));
  fake.balances.set(`allowance:${PRC20.toLowerCase()}`, BigInt(1000));
  const runtime = mockRuntime(fake, {
    signer: ADDR.owner,
    resolvePrc20: () => PRC20,
  });
  runtime.executeMock.mockImplementation(
    async (params: { to: string; data?: Hex }) =>
      fakeResponse({
        to: params.to,
        data: params.data ?? '0x',
        from: ADDR.owner,
        origin: `eip155:42101:${ADDR.owner}`,
      })
  );
  const context: AgenticExecutionContext = {
    wallet: wallet.address,
    generation: gen,
    door: 'owner',
    signerPushAccount: ADDR.owner,
    signerOrigin: { chain: CHAIN.PUSH_TESTNET_DONUT, address: ADDR.owner },
  };
  return { fake, wallet, gen, runtime, context };
}

const cases: {
  name: string;
  params: UniversalExecuteParams;
  calls: DestinationCall[];
}[] = [
  {
    name: 'explicit ERC20 transfer preserves its token target and calldata',
    params: {
      to: { address: USDC.address, chain: CHAIN.ETHEREUM_SEPOLIA },
      data: TRANSFER,
    },
    calls: [TOKEN_CALL],
  },
  {
    name: 'funds-only transfer describes the actual generated token call',
    params: {
      to: { address: ADDR.target, chain: CHAIN.ETHEREUM_SEPOLIA },
      funds: { amount: BigInt(10), token: USDC },
    },
    calls: [TOKEN_CALL],
  },
  {
    name: 'funds plus app call keeps the generated transfer and app call in order',
    params: {
      to: { address: ADDR.target, chain: CHAIN.ETHEREUM_SEPOLIA },
      funds: { amount: BigInt(10), token: USDC },
      data: APP_CALL.data,
    },
    calls: [TOKEN_CALL, APP_CALL],
  },
  {
    name: 'explicit call array retains all calls without guessing a primary action',
    params: {
      to: { address: ADDR.other, chain: CHAIN.ETHEREUM_SEPOLIA },
      data: [TOKEN_CALL, APP_CALL],
    },
    calls: [TOKEN_CALL, APP_CALL],
  },
  {
    name: 'native transfer preserves the actual destination value',
    params: {
      to: { address: ADDR.target, chain: CHAIN.ETHEREUM_SEPOLIA },
      value: BigInt(7),
    },
    calls: [{ to: ADDR.target, value: BigInt(7), data: '0x' }],
  },
];

describe('canonical outbound response on send and replay', () => {
  it.each(cases)('$name', async ({ params, calls }) => {
    const { wallet, runtime, context } = fixture();
    const live = await agenticSend(runtime, context, params);
    const submitted = runtime.executeMock.mock.calls[0][0];
    const replay = await adaptTrackedResponse(
      runtime,
      fakeResponse({
        to: submitted.to,
        data: submitted.data,
        origin: live.origin,
        from: ADDR.owner,
        route: TransactionRoute.UOA_TO_PUSH,
      })
    );
    const summary = calls[0];
    for (const response of [live, replay]) {
      expect(response).toMatchObject({
        from: wallet.address,
        origin: live.origin,
        ...summary,
        route: TransactionRoute.UOA_TO_CEA,
        chain: CHAIN.ETHEREUM_SEPOLIA,
      });
      expect(response.agentic?.destinationCalls).toEqual(calls);
      expect(response.agentic).toMatchObject({
        rawTo: wallet.address,
        rawData: submitted.data,
      });
      expect(await response.wait()).toMatchObject({
        from: wallet.address,
        to: summary.to,
      });
    }
  });
});

describe.each(['owner', 'agent'] as const)(
  'outbound replay wait on the %s door',
  (door) => {
    it.each(['success', 'reverted'] as const)(
      'handles an early Push-only route with a %s Push receipt',
      async (status) => {
        const { wallet, gen, runtime } = fixture();
        const out = await composeOutbound(
          runtime,
          gen,
          wallet.address,
          {
            to: { address: ADDR.target, chain: CHAIN.ETHEREUM_SEPOLIA },
            data: APP_CALL.data,
          },
          { door }
        );
        const input =
          door === 'owner'
            ? v4.encodeExecute([out.gatewayCall])
            : v4.encodeExecuteAsAgent(ruleId(1), out.gatewayCall);
        const signer = door === 'owner' ? ADDR.owner : ADDR.agent;
        const tx = {
          hash: PUSH_HASH,
          from: signer,
          to: wallet.address,
          input,
          value: BigInt(0),
          nonce: 1,
          gas: BigInt(160000),
          gasPrice: BigInt(1),
          blockNumber: BigInt(100),
          blockHash: `0x${'cd'.repeat(32)}`,
          transactionIndex: 0,
          type: 'eip1559',
          accessList: [],
          r: '0x1',
          s: '0x2',
          v: BigInt(0),
          wait: jest.fn().mockResolvedValue({
            transactionHash: PUSH_HASH,
            blockNumber: BigInt(100),
            blockHash: `0x${'cd'.repeat(32)}`,
            transactionIndex: 0,
            from: signer,
            to: wallet.address,
            contractAddress: null,
            gasUsed: BigInt(80000),
            cumulativeGasUsed: BigInt(80000),
            logs: [],
            logsBloom: '0x',
            status,
          }),
        };
        const waitForOutboundTx = jest.fn().mockResolvedValue({
          externalTxHash: EXTERNAL_HASH,
          destinationChain: CHAIN.ETHEREUM_SEPOLIA,
          recipient: ADDR.target,
          amount: '0',
          assetAddr: PRC20,
          explorerUrl: 'https://example.test/tx',
        });
        const initHook = jest.fn();
        const perCallHook = jest.fn();
        const response = await transformToUniversalTxResponse(
          {
            universalSigner: {
              account: { chain: CHAIN.PUSH_TESTNET_DONUT, address: signer },
            },
            progressHook: initHook,
          } as unknown as Parameters<typeof transformToUniversalTxResponse>[0],
          tx as unknown as Parameters<typeof transformToUniversalTxResponse>[1],
          [],
          {
            trackTransaction: jest.fn(),
            waitForOutboundTx,
            transformToUniversalTxReceipt,
            printLog: jest.fn(),
            outboundConstants: {
              initialWaitMs: 0,
              pollingIntervalMs: 1,
              maxTimeoutMs: 100,
            },
            inboundConstants: {
              initialWaitMs: 0,
              pollingIntervalMs: 1,
              maxTimeoutMs: 100,
            },
          }
        );
        response.route = TransactionRoute.UOA_TO_PUSH;
        response.chain = CHAIN.PUSH_TESTNET_DONUT;
        await adaptTrackedResponse(runtime, response);
        response.progressHook(perCallHook);
        const receipt = await response.wait();
        expect(response).toMatchObject({
          from: wallet.address,
          route: TransactionRoute.UOA_TO_CEA,
          chain: CHAIN.ETHEREUM_SEPOLIA,
        });
        expect(response.agentic).toMatchObject({
          door,
          destinationCalls: [APP_CALL],
        });
        expect(receipt.from).toBe(wallet.address);
        if (status === 'success') {
          expect(waitForOutboundTx).toHaveBeenCalledTimes(1);
          expect(waitForOutboundTx.mock.calls[0][0]).toBe(PUSH_HASH);
          expect(receipt).toMatchObject({
            status: 1,
            externalStatus: 'success',
            externalChain: CHAIN.ETHEREUM_SEPOLIA,
            externalTxHash: EXTERNAL_HASH,
          });
        } else {
          expect(waitForOutboundTx).not.toHaveBeenCalled();
          expect(receipt.status).toBe(0);
          expect(receipt.externalStatus).toBeUndefined();
        }
        const terminal =
          status === 'success' ? 'SEND-TX-299-01' : 'SEND-TX-299-02';
        for (const hook of [initHook, perCallHook]) {
          expect(
            hook.mock.calls.filter(([event]) => event.id === terminal)
          ).toHaveLength(1);
        }
      }
    );
  }
);

import { encodeFunctionData, type Hex } from 'viem';
import { CHAIN, PUSH_NETWORK } from '../../../../packages/core/src/lib/constants/enums';
import { ERC20_EVM } from '../../../../packages/core/src/lib/constants/abi';
import { TransactionRoute } from '../../../../packages/core/src/lib/orchestrator/route-detector';
import { transformToUniversalTxReceipt } from '../../../../packages/core/src/lib/orchestrator/internals/tx-transformer';
import { transformToUniversalTxResponse } from '../../../../packages/core/src/lib/orchestrator/internals/response-builder';
import { adaptTrackedResponse } from '../../../../packages/core/src/lib/agentic/response';
import { composeOutbound } from '../../../../packages/core/src/lib/agentic/execution/outbound';
import { e704d5b } from '../../../../packages/core/src/lib/agentic/contracts/e704d5b';
import { currentGeneration, resetAgenticGenerations } from '../../../../packages/core/src/lib/agentic/deployments';
import { ADDR, FakeChain, registerFakeGeneration } from '../../../../packages/core/src/lib/agentic/__tests__/fake-chain';
import { mockRuntime, fakeResponse } from '../../../../packages/core/src/lib/agentic/__tests__/mock-runtime';

jest.mock('../../../../packages/core/src/lib/universal/account/account', () => ({
  convertExecutorToOrigin: jest.fn().mockResolvedValue({ account: null, exists: false }),
}));
afterEach(() => resetAgenticGenerations());

function fixture() {
  registerFakeGeneration();
  const fake = new FakeChain();
  const w = fake.addWallet(ADDR.owner, 'followup');
  const gen = currentGeneration(PUSH_NETWORK.TESTNET_DONUT);
  const read = fake.readContract.bind(fake);
  fake.readContract = async (args) => args.functionName === 'SOURCE_CHAIN_NAMESPACE' ? CHAIN.ETHEREUM_SEPOLIA : read(args);
  return { fake, w, gen, rt: mockRuntime(fake, { signer: ADDR.owner }) };
}

it('R6 recognized outbound triggers real response-builder wait after an early Push-only route', async () => {
  const { w, gen, rt } = fixture();
  const out = await composeOutbound(rt, gen, w.address, { to: { address: ADDR.target, chain: CHAIN.ETHEREUM_SEPOLIA }, data: '0xd09de08a' }, { door: 'owner' });
  const hash = `0x${'ab'.repeat(32)}` as Hex;
  const tx = {
    hash, from: ADDR.owner, to: w.address, input: e704d5b.encodeExecute([out.gatewayCall]), value: BigInt(0), nonce: 1,
    gas: BigInt(160000), gasPrice: BigInt(1), blockNumber: BigInt(100), blockHash: `0x${'cd'.repeat(32)}`, transactionIndex: 0,
    type: 'eip1559', accessList: [], r: '0x1', s: '0x2', v: BigInt(0),
    wait: jest.fn().mockResolvedValue({ transactionHash: hash, blockNumber: BigInt(100), blockHash: `0x${'cd'.repeat(32)}`, transactionIndex: 0, from: ADDR.owner, to: w.address, contractAddress: null, gasUsed: BigInt(80000), cumulativeGasUsed: BigInt(80000), logs: [], logsBloom: '0x', status: 'success' }),
  };
  const waitForOutboundTx = jest.fn().mockResolvedValue({ externalTxHash: `0x${'ef'.repeat(32)}`, destinationChain: CHAIN.ETHEREUM_SEPOLIA, recipient: ADDR.target, amount: '0', assetAddr: ADDR.other, explorerUrl: 'https://example.test/tx' });
  const progressHook = jest.fn();
  const response = await transformToUniversalTxResponse({ universalSigner: { account: { chain: CHAIN.PUSH_TESTNET_DONUT, address: ADDR.owner } }, progressHook } as any, tx as any, [], {
    trackTransaction: jest.fn(), waitForOutboundTx, transformToUniversalTxReceipt, printLog: jest.fn(),
    outboundConstants: { initialWaitMs: 0, pollingIntervalMs: 1, maxTimeoutMs: 100 },
    inboundConstants: { initialWaitMs: 0, pollingIntervalMs: 1, maxTimeoutMs: 100 },
  });
  response.route = TransactionRoute.UOA_TO_PUSH;
  response.chain = CHAIN.PUSH_TESTNET_DONUT;
  await adaptTrackedResponse(rt, response);
  const receipt = await response.wait();
  expect(waitForOutboundTx).toHaveBeenCalledTimes(1);
  expect(response.chain).toBe(CHAIN.ETHEREUM_SEPOLIA);
  expect(receipt).toMatchObject({ from: w.address, externalStatus: 'success', externalChain: CHAIN.ETHEREUM_SEPOLIA });
});

it('F1 replay of an explicitly supplied ERC20 transfer retains the token target and calldata', async () => {
  const { w, gen, rt } = fixture();
  const data = encodeFunctionData({ abi: ERC20_EVM, functionName: 'transfer', args: [ADDR.other, BigInt(10)] });
  const out = await composeOutbound(rt, gen, w.address, { to: { address: ADDR.target, chain: CHAIN.ETHEREUM_SEPOLIA }, data }, { door: 'owner' });
  const response = fakeResponse({ to: w.address, data: e704d5b.encodeExecute([out.gatewayCall]) });
  await adaptTrackedResponse(rt, response);
  expect(response).toMatchObject({ to: ADDR.target, data });
});

import { encodeAbiParameters, type Hex } from 'viem';
import { CHAIN, PUSH_NETWORK } from '../../constants/enums';
import { PUSH_BATCH_EXECUTOR_ADDRESS } from '../../constants/chain';
import { convertExecutorToOrigin } from '../../universal/account/account';
import { adaptTrackedResponse } from '../response';
import { e704d5b, UEA_MULTICALL_PREFIX } from '../contracts/e704d5b';
import { resetAgenticGenerations } from '../deployments';
import { ADDR, FakeChain, registerFakeGeneration, ruleId } from './fake-chain';
import { fakeResponse, mockRuntime } from './mock-runtime';

jest.mock('../../universal/account/account', () => ({
  convertExecutorToOrigin: jest.fn(),
}));
afterEach(() => {
  resetAgenticGenerations();
  jest.clearAllMocks();
});

function fixture() {
  registerFakeGeneration();
  const fake = new FakeChain();
  const wallet = fake.addWallet(ADDR.owner, 'batch');
  const actions = [
    { target: ADDR.target, value: BigInt(0), data: '0xd09de08a' as Hex },
    { target: ADDR.target, value: BigInt(2), data: '0xd09de08a' as Hex },
  ];
  const outer = actions.map((c) => ({
    target: wallet.address,
    value: BigInt(0),
    data: e704d5b.encodeExecuteAsAgent(ruleId(1), c),
  }));
  const runtime = mockRuntime(fake);
  return { fake, wallet, actions, outer, runtime };
}

it('recognizes a verified 7702 self-call and retains every native agent action', async () => {
  const { fake, wallet, actions, outer, runtime } = fixture();
  const getCode = fake.getCode.bind(fake);
  fake.getCode = async (p) =>
    p.address === ADDR.agent
      ? (`0xef0100${PUSH_BATCH_EXECUTOR_ADDRESS[
          CHAIN.PUSH_TESTNET_DONUT
        ]!.slice(2)}` as Hex)
      : getCode(p);
  const result = await adaptTrackedResponse(
    runtime,
    fakeResponse({
      from: ADDR.agent,
      to: ADDR.agent,
      data: e704d5b.encodeExecute(outer),
    })
  );
  expect(result).toMatchObject({
    from: wallet.address,
    to: actions[0].target,
    agentic: {
      door: 'agent',
      rulesId: ruleId(1),
      rawTo: ADDR.agent,
      nativeCalls: actions.map((c) => ({
        to: c.target,
        value: c.value,
        data: c.data,
      })),
    },
  });
});

it('recognizes a verified UEA multicall carrying single agent-door entries', async () => {
  const { wallet, actions, outer, runtime } = fixture();
  (convertExecutorToOrigin as jest.Mock).mockResolvedValue({
    exists: true,
    account: { chain: CHAIN.ETHEREUM_SEPOLIA, address: ADDR.owner },
  });
  const data = (UEA_MULTICALL_PREFIX +
    encodeAbiParameters(
      [
        {
          type: 'tuple[]',
          components: [
            { name: 'to', type: 'address' },
            { name: 'value', type: 'uint256' },
            { name: 'data', type: 'bytes' },
          ],
        },
      ],
      [outer.map((c) => ({ to: c.target, value: c.value, data: c.data }))]
    ).slice(2)) as Hex;
  const result = await adaptTrackedResponse(
    runtime,
    fakeResponse({
      from: ADDR.agent,
      to: wallet.address,
      data,
      raw: {
        from: ADDR.other,
        to: ADDR.agent,
        nonce: 0,
        data,
        value: BigInt(0),
      },
    })
  );
  expect(result.from).toBe(wallet.address);
  expect(result.agentic?.nativeCalls).toEqual(
    actions.map((c) => ({ to: c.target, value: c.value, data: c.data }))
  );
});

it('does not label an arbitrary forwarding contract as a trusted sender batch', async () => {
  const { outer, runtime } = fixture();
  const response = fakeResponse({
    from: ADDR.agent,
    to: ADDR.other,
    data: e704d5b.encodeExecute(outer),
  });
  expect(await adaptTrackedResponse(runtime, response)).toBe(response);
  expect(response.agentic).toBeUndefined();
});

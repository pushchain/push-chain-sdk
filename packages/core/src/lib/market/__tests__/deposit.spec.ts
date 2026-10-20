import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  erc20Abi,
  zeroHash,
  type Address,
  type Hex,
} from 'viem';
import { depositJob, type DepositCheckpoint } from '../deposit';
import { DONUT_MARKETPLACE as D } from '../deployment';
import { MARKETPLACE_ABI } from '../contracts/UniversalMarketplace';
import { encodeAgentCardRules } from '../rules';
import {
  fakeResponse,
  mockRuntime,
} from '../../agentic/__tests__/mock-runtime';
import { FakeChain } from '../../agentic/__tests__/fake-chain';
import { buildJobSpec, encodeJobSpec } from '../../job-spec/codec';
import { prepareJobRead } from '../../job-spec/read';
import { specOrigin } from '../../job-spec/helpers';
import { PRINCIPAL } from '../../job-spec/constants';
import { CHAIN } from '../../constants/enums';
import type { AgentCard } from '../types';
import type { MarketSnapshot, StackRuntime } from '../runtime';

const sender = '0x1111111111111111111111111111111111111111' as Address;
const wallet = '0x2222222222222222222222222222222222222222' as Address;
const provider = '0x3333333333333333333333333333333333333333' as Address;
const principalToken = '0x4444444444444444444444444444444444444444' as Address;
function setup(sameToken = false) {
  const base = mockRuntime(new FakeChain(), { signer: sender });
  const balances = new Map<string, bigint>();
  const key = (token: string | undefined, a: string) =>
    `${token?.toLowerCase() ?? 'PC'}:${a.toLowerCase()}`;
  const token = sameToken ? D.paymentToken : principalToken;
  for (const t of [token, D.paymentToken, undefined])
    balances.set(key(t, sender), BigInt(1000));
  const state = {
    status: 0,
    spent: BigInt(0),
    receiptUnavailable: false,
    move: true,
  };
  const description = encodeJobSpec(
    buildJobSpec({
      reads: [
        prepareJobRead({
          chain: 'eip155:97',
          target: token,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [wallet],
        }),
      ],
      checks: [
        {
          read: 0,
          evaluation: 'COMPARE',
          operation: 'GREATER_OR_EQUAL',
          target: BigInt(1),
        },
      ],
      logic: 'ALL',
      executeBy: 1700000010,
      failFinalAt: 1700000020,
      origin: specOrigin(D.marketplace, BigInt(1), BigInt(1), BigInt(10)),
    })
  );
  const card = {
    cardId: BigInt(1),
    version: BigInt(1),
    provider,
    paymentToken: D.paymentToken,
    providerFee: BigInt(5),
    rules: { maxGasPerCall: BigInt(7) },
    rulesBytes: encodeAgentCardRules(
      {
        principalAsset: 0,
        maxGasPerCall: BigInt(7),
        assets: [
          {
            token: { prc20: token },
            maxPerCall: PRINCIPAL,
            maxTotal: PRINCIPAL,
          },
        ],
        allowedCalls: [{ target: token, selector: 'balanceOf(address)' }],
      },
      { chain: 'eip155:97' }
    ),
  } as unknown as AgentCard;
  const load = jest.fn(async (_id: bigint, _at: MarketSnapshot) => card);
  const read = jest.fn(
    async (r: {
      functionName: string;
      address: string;
      args?: readonly unknown[];
    }) => {
      switch (r.functionName) {
        case 'cardOfJob':
        case 'cardVersionOfJob':
          return BigInt(1);
        case 'agwOfJob':
          return wallet;
        case 'rulesOfJob':
          return zeroHash;
        case 'getJob':
          return {
            client: wallet,
            provider,
            status: state.status,
            expiredAt: 1800000000,
            description,
          };
        case 'paymentToken':
          return D.paymentToken;
        case 'isPermissionEnabled':
          return true;
        case 'getEnabledActions':
          return [zeroHash];
        case 'getConfig':
          return { initialized: true, assets: [{ spent: state.spent }] };
        case 'balanceOf':
          return balances.get(key(r.address, String(r.args?.[0]))) ?? BigInt(0);
        default:
          throw new Error(`Unexpected ${r.functionName}`);
      }
    }
  );
  const rt: StackRuntime = {
    agw: {
      ...base,
      reader: {
        ...base.reader,
        readContract: read,
        getBlockNumber: async () => BigInt(20),
        getBalance: async ({ address }) =>
          balances.get(key(undefined, address)) ?? BigInt(0),
        getLogs: async () =>
          [
            {
              address: D.marketplace,
              blockNumber: BigInt(10),
              data: encodeAbiParameters(
                [
                  { type: 'uint256' },
                  { type: 'bytes32' },
                  { type: 'uint256' },
                  { type: 'uint256' },
                ],
                [BigInt(1), zeroHash, BigInt(10), BigInt(1)]
              ),
              topics: encodeEventTopics({
                abi: MARKETPLACE_ABI,
                eventName: 'JobOpened',
                args: { cardId: BigInt(1), owner: sender, agw: wallet },
              }),
            },
          ] as never,
      },
    },
    account: () => sender,
    wallet: () => undefined,
    send: jest.fn(),
    signTypedData: jest.fn(),
    jobBlocks: new Map([[BigInt(1), BigInt(10)]]),
  };
  base.executeMock.mockImplementation(
    async (p: {
      to: Address;
      data?: Hex;
      value?: bigint;
      funds?: { amount: bigint };
    }) => {
      let asset: Address | undefined;
      let amount = p.value ?? BigInt(0);
      if (p.funds) {
        asset = D.paymentToken;
        amount = p.funds.amount;
      } else if (p.data && p.data !== '0x') {
        const call = decodeFunctionData({ abi: erc20Abi, data: p.data });
        if (call.functionName !== 'transfer' || call.args[0] !== wallet)
          throw new Error('Wrong transfer');
        asset = p.to;
        amount = call.args[1];
      }
      if (state.move) {
        balances.set(
          key(asset, wallet),
          (balances.get(key(asset, wallet)) ?? BigInt(0)) + amount
        );
        balances.set(
          key(asset, sender),
          (balances.get(key(asset, sender)) ?? BigInt(0)) - amount
        );
      }
      const tx = fakeResponse();
      const wait = tx.wait.bind(tx);
      return {
        ...tx,
        wait: async () => {
          if (state.receiptUnavailable) throw new Error('RPC timed out');
          return wait();
        },
      };
    }
  );
  const checkpoints = new Map<bigint, DepositCheckpoint>();
  const run = (options: Parameters<typeof depositJob>[2] = {}) =>
    depositJob(rt, BigInt(1), options, load, checkpoints);
  return {
    run,
    rt,
    balances,
    key,
    token,
    load,
    card,
    state,
    execute: base.executeMock,
    checkpoints,
  };
}
it('uses the opened version and original principal, not a newly updated card', async () => {
  const f = setup();
  const result = await f.run();
  expect(f.load.mock.calls[0][1].blockNumber).toBe(BigInt(10));
  expect(result.cardVersion).toBe(BigInt(1));
  expect(result.txs.map((t) => [t.step, t.amount])).toEqual([
    ['PRINCIPAL', BigInt(10)],
    ['PROVIDER_FEE', BigInt(5)],
    ['PC', BigInt(7)],
  ]);
  expect((await f.run()).txs).toEqual([]);
});
it('combines a shared principal/fee token before subtracting the existing balance', async () => {
  const f = setup(true);
  f.balances.set(f.key(f.token, wallet), BigInt(3));
  const result = await f.run({ pcAmount: BigInt(0) });
  expect(result.txs).toHaveLength(1);
  expect(result.txs[0]).toMatchObject({
    step: 'PRINCIPAL_AND_FEE',
    amount: BigInt(12),
  });
});
it('preflights every asset before sending any partial deposit', async () => {
  const f = setup();
  f.balances.set(f.key(D.paymentToken, sender), BigInt(0));
  await expect(f.run()).rejects.toMatchObject({
    code: 'DEPOSIT_INCOMPLETE',
    details: { causeCode: 'INSUFFICIENT_FUNDS', txs: [] },
  });
  expect(f.execute).not.toHaveBeenCalled();
});
it('resumes an uncertain receipt without resending the committed principal', async () => {
  const f = setup();
  f.state.receiptUnavailable = true;
  await expect(f.run()).rejects.toMatchObject({
    code: 'DEPOSIT_INCOMPLETE',
    details: { txs: [expect.objectContaining({ step: 'PRINCIPAL' })] },
  });
  expect(f.execute).toHaveBeenCalledTimes(1);
  // An unresolved prior receipt must still prevent another transaction.
  await expect(f.run()).rejects.toMatchObject({ code: 'DEPOSIT_INCOMPLETE' });
  expect(f.execute).toHaveBeenCalledTimes(1);
  f.state.receiptUnavailable = false;
  const resumed = await f.run();
  expect(resumed.txs.map((t) => t.step)).toEqual([
    'PRINCIPAL',
    'PROVIDER_FEE',
    'PC',
  ]);
  expect(f.execute).toHaveBeenCalledTimes(3);
});
it('refuses to replenish a resumed transfer that has since been consumed', async () => {
  const f = setup();
  f.state.receiptUnavailable = true;
  await expect(f.run()).rejects.toMatchObject({ code: 'DEPOSIT_INCOMPLETE' });
  f.state.receiptUnavailable = false;
  f.balances.set(f.key(f.token, wallet), BigInt(0));
  await expect(f.run()).rejects.toMatchObject({
    details: { causeCode: 'DEPOSIT_BALANCE_CHANGED' },
  });
  expect(f.execute).toHaveBeenCalledTimes(1);
});
it('fails closed if same-block updates hide the original card version', async () => {
  const f = setup();
  f.card.version = BigInt(2);
  await expect(f.run()).rejects.toMatchObject({ code: 'HISTORY_UNAVAILABLE' });
  expect(f.execute).not.toHaveBeenCalled();
});
it('refuses terminal jobs and permissions that have already moved assets', async () => {
  const f = setup();
  f.state.status = 1;
  await expect(f.run()).rejects.toMatchObject({ code: 'WRONG_STATUS' });
  f.state.status = 0;
  f.state.spent = BigInt(1);
  await expect(f.run()).rejects.toMatchObject({
    details: { causeCode: 'DEPOSIT_ALREADY_USED' },
  });
  expect(f.execute).not.toHaveBeenCalled();
});
it('retains a receipt when a token returns success without delivering the required balance', async () => {
  const f = setup();
  f.state.move = false;
  await expect(f.run()).rejects.toMatchObject({
    details: { causeCode: 'DEPOSIT_BALANCE_CHANGED', txs: [expect.anything()] },
  });
  expect(f.execute).toHaveBeenCalledTimes(1);
});
it('uses an explicit registered origin route and keeps its recipient outside AGW execution', async () => {
  const f = setup(true);
  f.rt.agw.signerIsPushNative = () => false;
  f.rt.agw.signerOrigin = () => ({
    chain: CHAIN.ETHEREUM_SEPOLIA,
    address: sender,
  });
  f.balances.set(f.key(D.paymentToken, sender), BigInt(0));
  const result = await f.run({ funding: 'origin', pcAmount: BigInt(0) });
  expect(result.txs[0]).toMatchObject({
    step: 'PRINCIPAL_AND_FEE',
    amount: BigInt(15),
  });
  expect(f.execute).toHaveBeenCalledWith(
    {
      to: wallet,
      funds: {
        token: expect.objectContaining({ symbol: 'USDC' }),
        amount: BigInt(15),
      },
    },
    expect.anything()
  );
});
it('refuses an origin token mismatch before sending any leg', async () => {
  const f = setup();
  f.rt.agw.signerIsPushNative = () => false;
  f.rt.agw.signerOrigin = () => ({
    chain: CHAIN.ETHEREUM_SEPOLIA,
    address: sender,
  });
  await expect(f.run({ funding: 'origin' })).rejects.toMatchObject({
    details: { causeCode: 'TOKEN_ROUTE_UNAVAILABLE' },
  });
  expect(f.execute).not.toHaveBeenCalled();
});
it('blocks retries when the transport reports a broadcast hash without returning a response', async () => {
  const f = setup();
  const hash = ('0x' + 'ab'.repeat(32)) as Hex;
  f.execute.mockImplementationOnce(async () => {
    f.balances.set(f.key(f.token, wallet), BigInt(10));
    throw Object.assign(new Error('Inbound confirmation unavailable'), {
      gatewayTxHash: hash,
    });
  });
  await expect(f.run()).rejects.toMatchObject({
    details: {
      txs: [],
      pending: { txHash: hash, token: f.token, amount: BigInt(10) },
    },
  });
  await expect(f.run()).rejects.toMatchObject({
    code: 'DEPOSIT_INCOMPLETE',
    details: { pending: { txHash: hash } },
  });
  expect(f.execute).toHaveBeenCalledTimes(1);
  const result = await f.run({
    resume: [
      {
        step: 'PRINCIPAL',
        token: f.token,
        amount: BigInt(10),
        tx: fakeResponse({ hash }),
      },
    ],
  });
  expect(result.txs.map((t) => t.step)).toEqual([
    'PRINCIPAL',
    'PROVIDER_FEE',
    'PC',
  ]);
  expect(f.execute).toHaveBeenCalledTimes(3);
});

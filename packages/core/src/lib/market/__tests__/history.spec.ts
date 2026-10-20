import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  keccak256,
  stringToHex,
  zeroHash,
  type Address,
  type Hex,
  type Log,
} from 'viem';
import { historicalCard } from '../history';
import { MARKETPLACE_ABI as ABI } from '../contracts/UniversalMarketplace';
import { DONUT_MARKETPLACE as D } from '../deployment';
import { encodeAgentCardRules } from '../rules';
import { PRINCIPAL } from '../../job-spec/constants';
import { FakeChain } from '../../agentic/__tests__/fake-chain';
import { mockRuntime } from '../../agentic/__tests__/mock-runtime';
import type { StackRuntime } from '../runtime';
const provider = '0x1111111111111111111111111111111111111111' as Address;
const hash = ('0x' + 'ab'.repeat(32)) as Hex;
function fixture() {
  const base = mockRuntime(new FakeChain());
  const rules = encodeAgentCardRules(
    {
      assets: [
        {
          token: { prc20: D.paymentToken },
          maxPerCall: PRINCIPAL,
          maxTotal: PRINCIPAL,
        },
      ],
      principalAsset: 0,
      maxGasPerCall: BigInt(17),
      allowedCalls: [{ target: provider, selector: 'balanceOf(address)' }],
    },
    { chain: 'eip155:97' }
  );
  const c = {
    provider,
    active: true,
    jobType: keccak256(stringToHex('test')),
    metadataURI: 'test',
    metadataHash: zeroHash,
    chainNamespace: 'eip155:97',
    providerFee: BigInt(7),
    paymentToken: D.paymentToken,
    principalMin: BigInt(1),
    principalMax: BigInt(20),
    minDuration: 3600,
    maxDuration: 86400,
    minExecuteWindow: 0,
    settleWindow: 60,
  };
  const data = encodeFunctionData({
    abi: ABI,
    functionName: 'registerAgentCard',
    args: [c, rules, '0x1234'],
  });
  const log = {
    address: D.marketplace,
    blockNumber: BigInt(24443653),
    transactionHash: hash,
    logIndex: 0,
    blockHash: zeroHash,
    transactionIndex: 0,
    removed: false,
    topics: encodeEventTopics({
      abi: ABI,
      eventName: 'AgentCardRegistered',
      args: { cardId: BigInt(1), provider, jobType: c.jobType },
    }),
    data: encodeAbiParameters(
      [
        { type: 'string' },
        { type: 'bytes32' },
        { type: 'bytes32' },
        { type: 'bytes32' },
        { type: 'uint256' },
      ],
      [
        c.chainNamespace,
        keccak256(rules),
        keccak256('0x1234'),
        zeroHash,
        BigInt(7),
      ]
    ),
  } as Log;
  const state = {
    input: ('0x12345678' +
      encodeAbiParameters([{ type: 'bytes' }], [data]).slice(2)) as Hex,
    blockNumber: log.blockNumber,
  };
  const logs = jest.fn(async () => [log]);
  const rt: StackRuntime = {
    agw: {
      ...base,
      reader: {
        ...base.reader,
        getBlockNumber: async () => BigInt(24443654),
        readContract: async () => ({ card: c }),
        getLogs: logs,
        getTransaction: async () => state,
      },
    },
    account: () => provider,
    wallet: () => undefined,
    send: jest.fn(),
    signTypedData: jest.fn(),
  };
  const load = jest.fn(async () => {
    throw new Error('Archive unavailable');
  });
  const run = () =>
    historicalCard(rt, BigInt(1), BigInt(1), BigInt(24443654), load);
  return { run, load, rt, state, rules, data, log, logs };
}
it('recovers an exact version from event hashes and wrapped transaction input without archive state', async () => {
  const f = fixture();
  expect(await f.run()).toMatchObject({
    version: BigInt(1),
    providerFee: BigInt(7),
    rulesBytes: f.rules,
    rules: { maxGasPerCall: BigInt(17) },
  });
});
it('uses matching historical state without scanning transaction history', async () => {
  const f = fixture();
  f.load.mockImplementation(async () => ({ version: BigInt(1) } as never));
  expect(await f.run()).toEqual({ version: BigInt(1) });
  expect(f.logs).not.toHaveBeenCalled();
});
it('rejects a selector-shaped decoy whose content hashes do not match the emitted version', async () => {
  const f = fixture();
  f.state.input = f.data.replace('1234', '4321') as Hex;
  await expect(f.run()).rejects.toMatchObject({ code: 'HISTORY_UNAVAILABLE' });
});
it('rejects history whose transaction is no longer mined in the event block', async () => {
  const f = fixture();
  f.state.blockNumber = BigInt(24443654);
  await expect(f.run()).rejects.toMatchObject({ code: 'HISTORY_UNAVAILABLE' });
});

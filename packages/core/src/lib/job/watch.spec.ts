import {
  encodeAbiParameters,
  encodeEventTopics,
  zeroHash,
  type Log,
} from 'viem';
import { watchJob } from './watch';
import { JOB_KERNEL_ABI as ABI } from '../market/contracts/AgenticCommerce';
import { DONUT_MARKETPLACE as D } from '../market/deployment';
import { FakeChain } from '../agentic/__tests__/fake-chain';
import { mockRuntime } from '../agentic/__tests__/mock-runtime';
import type { StackRuntime } from '../market/runtime';
import type { JobEvent } from './types';
const makeLog = (logIndex: number): Log =>
  ({
    address: D.kernel,
    blockNumber: BigInt(10),
    blockHash: zeroHash,
    logIndex,
    transactionIndex: 0,
    transactionHash: zeroHash,
    removed: false,
    topics: encodeEventTopics({
      abi: ABI,
      eventName: 'BudgetSet',
      args: { jobId: BigInt(1) },
    }),
    data: encodeAbiParameters([{ type: 'uint256' }], [BigInt(logIndex)]),
  } as Log);
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
function fixture() {
  const base = mockRuntime(new FakeChain());
  const state = {
    failed: false,
    logs: [makeLog(0), makeLog(1)],
    blockHash: zeroHash as string,
  };
  const getLogs = jest.fn(async ({ event }: { event: { name: string } }) => {
    if (state.failed) throw new Error('RPC unavailable');
    return event.name === 'BudgetSet' ? state.logs : [];
  });
  const rt: StackRuntime = {
    agw: {
      ...base,
      reader: {
        ...base.reader,
        getBlockNumber: async () => BigInt(10),
        getBlock: async () => ({
          timestamp: BigInt(1),
          hash: state.blockHash as `0x${string}`,
        }),
        getLogs,
      },
    },
    account: base.signerPushAccount,
    wallet: () => undefined,
    send: jest.fn(),
    signTypedData: jest.fn(),
  };
  return { rt, state, getLogs };
}
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());
it('deduplicates provider replay and resumes after an exact log within the same block', async () => {
  const f = fixture();
  f.state.logs.push(makeLog(1));
  const events: JobEvent[] = [];
  const stop = watchJob(f.rt, BigInt(1), (e) => events.push(e), {
    cursor: { blockNumber: BigInt(10), logIndex: 0, blockHash: zeroHash },
    pollIntervalMs: 25,
  });
  await flush();
  stop();
  expect(events.map((e) => e.cursor?.logIndex)).toEqual([1]);
});
it('does not rewind a delivered event when the consumer callback throws', async () => {
  const f = fixture();
  const events: JobEvent[] = [];
  const stop = watchJob(
    f.rt,
    BigInt(1),
    (e) => {
      events.push(e);
      if (e.kind !== 'Error') throw new Error('Consumer failed');
    },
    { fromBlock: BigInt(10), pollIntervalMs: 25 }
  );
  await flush();
  jest.advanceTimersByTime(25);
  await flush();
  stop();
  expect(events.filter((e) => e.kind === 'BudgetSet')).toHaveLength(2);
  expect(events.filter((e) => e.kind === 'Error')).toHaveLength(2);
});
it('retries RPC failures without skipping a range', async () => {
  const f = fixture();
  f.state.failed = true;
  const events: JobEvent[] = [];
  const stop = watchJob(f.rt, BigInt(1), (e) => events.push(e), {
    fromBlock: BigInt(10),
    pollIntervalMs: 25,
  });
  await flush();
  f.state.failed = false;
  jest.advanceTimersByTime(25);
  await flush();
  stop();
  expect(events.map((e) => e.kind)).toEqual([
    'Error',
    'BudgetSet',
    'BudgetSet',
  ]);
});
it('stops on a changed canonical cursor and suppresses callbacks after unsubscribe', async () => {
  const f = fixture();
  f.state.blockHash = '0x' + 'ab'.repeat(32);
  const events: JobEvent[] = [];
  const stop = watchJob(f.rt, BigInt(1), (e) => events.push(e), {
    cursor: { blockNumber: BigInt(10), logIndex: 0, blockHash: zeroHash },
    pollIntervalMs: 25,
  });
  await flush();
  expect(events[0]).toMatchObject({
    kind: 'Error',
    error: { code: 'WATCH_REORG' },
  });
  jest.advanceTimersByTime(25);
  await flush();
  expect(events).toHaveLength(1);
  stop();
  const callbacks = jest.fn();
  const cancel = watchJob(f.rt, BigInt(1), callbacks, {
    fromBlock: BigInt(10),
  });
  cancel();
  await flush();
  expect(callbacks).not.toHaveBeenCalled();
});

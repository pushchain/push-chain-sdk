import {
  decodeFunctionData,
  keccak256,
  parseAbi,
  zeroHash,
  type Hex,
} from 'viem';
import { JobNamespaceImpl } from './job';
import { EVALUATOR_ABI } from './UniversalEvaluator';
import { DONUT_MARKETPLACE as D } from '../market/deployment';
import { mockRuntime } from '../agentic/__tests__/mock-runtime';
import { FakeChain } from '../agentic/__tests__/fake-chain';
import { prePostJobUtils as utils } from '../job-spec/pre-post';
import { prepareJobRead } from '../job-spec/read';
import type { StackRuntime } from '../market/runtime';
const client = '0x1111111111111111111111111111111111111111',
  provider = '0x2222222222222222222222222222222222222222',
  evaluator = '0x3333333333333333333333333333333333333333',
  hook = '0x4444444444444444444444444444444444444444';
function fixture() {
  const base = mockRuntime(new FakeChain(), { signer: provider });
  const spec = utils.buildJobSpec({
      reads: [
        prepareJobRead({
          chain: 'eip155:97',
          target: client,
          abi: parseAbi(['function value() view returns(uint256)']),
          functionName: 'value',
        }),
      ],
      checks: [
        {
          left: [0],
          right: [],
          evaluation: 'COMPARE',
          operation: 'GREATER_OR_EQUAL',
          target: BigInt(1),
        },
      ],
      logic: 'ALL',
    }),
    bytes = utils.encodeJobSpec(spec);
  const state = {
    j: {
      client,
      provider,
      evaluator,
      hook,
      description: bytes,
      status: 2,
      expiredAt: 2000000000,
      budget: BigInt(0),
    },
    e: {
      endFixed: true,
      started: true,
      pending: 1,
      done: false,
      verdict: 0,
      applied: false,
      ownerCheck: 1,
    },
    code: '0x6000' as Hex,
    hash: keccak256(bytes),
    trackedHeight: BigInt(50),
    observedAt: BigInt(1800000000),
  };
  const read = jest.fn(
    async ({
      address,
      functionName,
    }: {
      address: string;
      functionName: string;
    }) => {
      switch (functionName) {
        case 'getJob':
          return state.j;
        case 'paymentToken':
          return D.paymentToken;
        case 'UNIVERSAL_CORE':
          return '0x5555555555555555555555555555555555555555';
        case 'MAX_HEIGHT_AGE':
          return BigInt(3600);
        case 'chainHeightByChainNamespace':
          return state.trackedHeight;
        case 'timestampObservedAtByChainNamespace':
          return state.observedAt;
        case 'KERNEL':
          return D.kernel;
        case 'HOOK':
          return hook;
        case 'EVALUATOR':
          return evaluator;
        case 'currentSpec':
          return '0x';
        case 'prefundCost':
          return [BigInt(2), BigInt(3)];
        case 'prepaidOf':
          return BigInt(1);
        case 'specHashOf':
          return state.hash;
        case 'ready':
          return true;
        case 'evaluationOf':
          return state.e;
        case 'answerOf':
          return [false, BigInt(0)];
        case 'requestOf':
          return BigInt(42);
        case 'fundHeightOf':
          return BigInt(1);
        case 'endHeightOf':
          return BigInt(2);
        case 'evidenceOf':
        case 'rulesOfJob':
          return zeroHash;
        default:
          throw new Error(`Unexpected ${address} ${functionName}`);
      }
    }
  );
  const rt: StackRuntime = {
    agw: {
      ...base,
      reader: {
        ...base.reader,
        readContract: read,
        getCode: async () => state.code,
        getLogs: async () => [],
        getBlockNumber: async () => BigInt(10),
        getBlock: async () => ({ timestamp: BigInt(1800000000) }),
      },
    },
    account: () => provider,
    wallet: () => undefined,
    send: jest.fn(),
    signTypedData: jest.fn(),
  };
  const original = new JobNamespaceImpl(rt),
    job = original.withEvaluator({ profile: 'pre-post-v1', evaluator, hook });
  return { rt, original, job, state, read, execute: base.executeMock };
}
it('keeps existing clients manual and scopes the new deployment without mutating the original', async () => {
  const f = fixture();
  await expect(f.original.verify(BigInt(1))).rejects.toMatchObject({
    code: 'CAPABILITY_UNAVAILABLE',
  });
  expect(f.read).not.toHaveBeenCalled();
  const quote = await f.job.quoteEvaluation(BigInt(1));
  expect(quote).toMatchObject({
    snapshot: BigInt(2),
    evaluation: BigInt(3),
    topUp: BigInt(4),
  });
});
it('rejects wrong wiring or code pin before sending a transaction', async () => {
  const f = fixture();
  await expect(
    f.original
      .withEvaluator({
        profile: 'pre-post-v1',
        evaluator,
        hook,
        evaluatorCodeHash: zeroHash,
      })
      .verify(BigInt(1))
  ).rejects.toMatchObject({ code: 'EVALUATOR_MISMATCH' });
  expect(f.execute).not.toHaveBeenCalled();
});
it('uses current phase-aware facts and a single evidence hash per read', async () => {
  const f = fixture();
  const j = await f.job.status(BigInt(1));
  expect(j.evaluation).toMatchObject({
    available: true,
    profile: 'pre-post-v1',
    reads: [
      { at: 'POST_EXECUTION', requestId: BigInt(42), evidence: zeroHash },
    ],
  });
  expect(j.jobSpec).toMatchObject({
    frozen: true,
    spec: { profile: 'pre-post-v1' },
  });
});
it('routes verification through public retryEvaluation rather than the hook-only submit entrypoint', async () => {
  const f = fixture();
  await f.job.verify(BigInt(1));
  expect(f.execute).toHaveBeenCalledTimes(1);
  const params = f.execute.mock.calls[0][0] as { data: Hex };
  expect(
    decodeFunctionData({ abi: EVALUATOR_ABI, data: params.data }).functionName
  ).toBe('retryEvaluation');
});
it('recovers a decided but unapplied verdict with public settlement', async () => {
  const f = fixture();
  f.state.e = { ...f.state.e, done: true, verdict: 1 };
  await f.job.verify(BigInt(1));
  const params = f.execute.mock.calls[0][0] as { data: Hex };
  expect(
    decodeFunctionData({ abi: EVALUATOR_ABI, data: params.data }).functionName
  ).toBe('settle');
});
it('never silently attaches retry fees and enforces explicit fee caps before signing', async () => {
  const f = fixture();
  await expect(
    f.job.verify(BigInt(1), { value: BigInt(1) })
  ).rejects.toMatchObject({ code: 'READ_FEE_CAP_REQUIRED' });
  await expect(
    f.job.verify(BigInt(1), { value: BigInt(2), maxReadFee: BigInt(1) })
  ).rejects.toMatchObject({ code: 'READ_FEE_EXCEEDED' });
  expect(f.execute).not.toHaveBeenCalled();
});
it('rejects snapshot retries after evaluation started and completed evaluation retries', async () => {
  const f = fixture();
  await expect(
    f.job.verify(BigInt(1), { action: 'retrySnapshot' })
  ).rejects.toMatchObject({ code: 'WRONG_STATUS' });
  f.state.e = { ...f.state.e, done: true, applied: true, verdict: 1 };
  await expect(f.job.verify(BigInt(1))).rejects.toMatchObject({
    code: 'WRONG_STATUS',
  });
  expect(f.execute).not.toHaveBeenCalled();
});
it('refuses submission until Push sees the actual work block, even when the tracked height moved after fund', async () => {
  const f = fixture();
  f.state.j.status = 1;
  f.state.trackedHeight = BigInt(49);
  await expect(
    f.job.submit(BigInt(1), {
      deliverable: 'worked',
      executionBlocks: { 'eip155:97': BigInt(50) },
    })
  ).rejects.toMatchObject({
    code: 'EXECUTION_BLOCK_NOT_TRACKED',
    details: {
      chain: 'eip155:97',
      requiredBlock: BigInt(50),
      trackedBlock: BigInt(49),
    },
  });
  expect(f.execute).not.toHaveBeenCalled();
  f.state.trackedHeight = BigInt(50);
  await f.job.submit(BigInt(1), {
    deliverable: 'worked',
    executionBlocks: { 'eip155:97': BigInt(50) },
  });
  expect(f.execute).toHaveBeenCalledTimes(1);
});
it('copies reviewed execution blocks before asynchronous reads', async () => {
  const f = fixture();
  f.state.j.status = 1;
  const executionBlocks = { 'eip155:97': BigInt(50) };
  const pending = f.job.submit(BigInt(1), {
    deliverable: 'worked',
    executionBlocks,
  });
  executionBlocks['eip155:97'] = BigInt(999);
  await pending;
  expect(f.execute).toHaveBeenCalledTimes(1);
});
it('refuses unrelated chains and stale tracked heights without submitting', async () => {
  const f = fixture();
  f.state.j.status = 1;
  await expect(
    f.job.submit(BigInt(1), {
      deliverable: 'worked',
      executionBlocks: { 'eip155:1': BigInt(50) },
    })
  ).rejects.toMatchObject({ code: 'EXECUTION_CHAIN_MISMATCH' });
  f.state.observedAt = BigInt(1);
  await expect(
    f.job.submit(BigInt(1), {
      deliverable: 'worked',
      executionBlocks: { 'eip155:97': BigInt(50) },
    })
  ).rejects.toMatchObject({ code: 'TRACKED_HEIGHT_STALE' });
  expect(f.execute).not.toHaveBeenCalled();
});
it('rejects empty, invalid and unsupported execution-block requests before reading or signing', async () => {
  const f = fixture();
  const invalidBlocks: Record<string, bigint>[] = [
    {},
    { 'eip155:97': BigInt(0) },
    { 'eip155:97': BigInt(1) << BigInt(64) },
  ];
  for (const executionBlocks of invalidBlocks)
    await expect(
      f.job.submit(BigInt(1), { deliverable: 'worked', executionBlocks })
    ).rejects.toMatchObject({ code: 'INVALID_EXECUTION_BLOCKS' });
  await expect(
    f.original.submit(BigInt(1), {
      deliverable: 'worked',
      executionBlocks: { 'eip155:97': BigInt(50) },
    })
  ).rejects.toMatchObject({ code: 'CAPABILITY_UNAVAILABLE' });
  expect(f.read).not.toHaveBeenCalled();
  expect(f.execute).not.toHaveBeenCalled();
});

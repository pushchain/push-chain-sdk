import { toHex, type Hex } from 'viem';
import { encodeEvmQueryEnvelope } from '../../read-state/envelopes';
import { READ_OUTCOME } from '../../read-state/read-state.types';
import { decodeJobAnswer } from '../preview';
import { encodeAbiParameters } from 'viem';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeAbiParameters, parseAbi, zeroHash } from 'viem';
import { prePostJobUtils as utils } from '../pre-post';
import { prepareJobRead } from '../read';
import { decodeJobSpec } from '../codec';
import { PRE_POST_SPEC_PARAM } from '../pre-post/schema';
import type { PrePostJobSpec } from '../pre-post/types';
const call = prepareJobRead({
  chain: 'eip155:11155111',
  target: '0x1111111111111111111111111111111111111111',
  abi: parseAbi(['function balanceOf(address) view returns (uint256)']),
  functionName: 'balanceOf',
  args: ['0x2222222222222222222222222222222222222222'],
});
const check = {
  left: [0],
  right: [],
  evaluation: 'COMPARE',
  operation: 'GREATER_OR_EQUAL',
  target: BigInt(499000000),
} as const;
function spec(): PrePostJobSpec {
  return utils.buildJobSpec({
    reads: [call],
    checks: [{ ...check, left: [0], right: [] }],
    logic: 'ALL',
  });
}
const vector = JSON.parse(
  readFileSync(resolve(__dirname, '../__fixtures__/pre-post-wire.json'), 'utf8')
);
it('roundtrips the pinned ABI layout and enforces return-shape validation', () => {
  // Research vectors exercise ABI layout only; replace their illustrative output codes
  // with a real ABI-derived shape before asserting semantic validation.
  const wire = decodeAbiParameters(
    [PRE_POST_SPEC_PARAM],
    vector.bytes
  )[0] as unknown as {
    reads: { outputs: `0x${string}` }[];
    allowedMutability: number;
    origin: `0x${string}`;
  };
  expect(() => utils.decodeJobSpec(vector.bytes, { format: 'spec' })).toThrow();
  wire.reads[0].outputs = call.outputs;
  const bytes = encodeAbiParameters([PRE_POST_SPEC_PARAM], [wire]);
  const decoded = utils.decodeJobSpec(bytes, { format: 'spec' });
  expect(decoded.allowedMutability).toBe('NONE');
  expect(decoded.logic[0].kind).toBe('CHECK');
  expect(utils.encodeJobSpec(decoded)).toBe(bytes);
  expect(() => decodeJobSpec(vector.bytes, { format: 'spec' })).toThrow();
});
it('does not serialize timing fields and refuses silently discarded legacy inputs', () => {
  const x = spec();
  expect(x).not.toHaveProperty('executeBy');
  expect(() => utils.buildJobSpec({ ...x, executeBy: 1 } as never)).toThrow();
  const wire = decodeAbiParameters(
    [PRE_POST_SPEC_PARAM],
    utils.encodeJobSpec(x)
  )[0] as { allowedMutability: number };
  expect(wire.allowedMutability).toBe(1);
  expect(() =>
    utils.decodeJobSpec((utils.encodeJobSpec(x) + '00') as `0x${string}`, {
      format: 'spec',
    })
  ).toThrow();
});
it('resolves the new template fills, summed checks, params and immutable marketplace criteria', () => {
  const read = prepareJobRead({
    chain: 'eip155:11155111',
    target: call.target,
    abi: parseAbi(['function balanceOf(address) view returns (uint256)']),
    functionName: 'balanceOf',
    args: ['agentic:wallet'],
  });
  const template = utils.buildJobSpecTemplate({
    reads: [read, { read, at: 'PRE_EXECUTION' }],
    checks: [
      {
        left: [0],
        right: [1],
        evaluation: 'NUMBER',
        operation: 'GREATER_OR_EQUAL',
        target: { principalBps: BigInt(9990) },
      },
    ],
    logic: 'ALL',
  });
  expect(template).not.toHaveProperty('allowedMutability');
  expect(
    utils.encodeJobSpec(
      utils.decodeJobSpec(utils.encodeJobSpec(template), { format: 'template' })
    )
  ).toBe(utils.encodeJobSpec(template));
  const resolved = utils.resolveJobSpec(template, {
    principal: BigInt(10000),
    params: [],
    accounts: {
      'eip155:11155111': '0x2222222222222222222222222222222222222222',
    },
    origin: zeroHash,
  });
  expect(resolved.allowedMutability).toBe('NONE');
  expect(resolved.checks[0].target).toBe(BigInt(9990));
  expect(resolved.reads[1].at).toBe('PRE_EXECUTION');
  expect(resolved.reads[0].fills).toBeUndefined();
  expect(
    resolved.reads[0].args.endsWith('2222222222222222222222222222222222222222')
  ).toBe(true);
});
it.each([
  [
    'zero target',
    (s: PrePostJobSpec) => {
      s.reads[0].target = '0x0000000000000000000000000000000000000000';
    },
  ],
  [
    'overlap',
    (s: PrePostJobSpec) => {
      s.checks[0].right = [0];
    },
  ],
  [
    'unused read',
    (s: PrePostJobSpec) => {
      s.reads.push({ ...s.reads[0] });
    },
  ],
  [
    'no POST',
    (s: PrePostJobSpec) => {
      s.reads[0].at = 'PRE_EXECUTION';
    },
  ],
  [
    'cycle',
    (s: PrePostJobSpec) => {
      s.logic[0].children = [0];
    },
  ],
  [
    'BOOLEAN target',
    (s: PrePostJobSpec) => {
      s.checks[0].evaluation = 'BOOLEAN';
    },
  ],
  [
    'logic limit',
    (s: PrePostJobSpec) => {
      s.logic = Array(33).fill(s.logic[0]);
    },
  ],
])('rejects %s before any payment', (_, mutate) => {
  const x = spec();
  mutate(x);
  expect(() => utils.encodeJobSpec(x)).toThrow();
});
it('preserves valid topological DAG bytes rather than flattening and changing signed criteria', () => {
  const x = spec();
  x.logic = [
    { kind: 'ALL', check: 8, children: [1, 2], k: 4 },
    { kind: 'ANY', check: 0, children: [2], k: 0 },
    { kind: 'CHECK', check: 0, children: [], k: 7 },
  ];
  const bytes = utils.encodeJobSpec(x);
  expect(
    utils.encodeJobSpec(utils.decodeJobSpec(bytes, { format: 'spec' }))
  ).toBe(bytes);
});
it('handles 32 reads and refuses a non-increasing or duplicated sum', () => {
  const x = utils.buildJobSpec({
    reads: Array(32).fill(call),
    checks: [
      { ...check, left: Array.from({ length: 32 }, (_, i) => i), right: [] },
    ],
    logic: 'ALL',
  });
  expect(x.reads).toHaveLength(32);
  x.checks[0].left = [1, 0];
  expect(() => utils.encodeJobSpec(x)).toThrow();
});
function paired() {
  return utils.buildJobSpec({
    reads: [call, { read: call, at: 'PRE_EXECUTION' }],
    checks: [
      {
        left: [0],
        right: [1],
        evaluation: 'PERCENTAGE',
        operation: 'GREATER_OR_EQUAL',
        target: BigInt(0),
      },
    ],
    logic: 'ALL',
  });
}
it('compares percentages exactly so a tiny loss cannot round to a passing zero', () => {
  const x = paired();
  expect(utils.judge(x, [BigInt(999999), BigInt(1000000)]).pass).toBe(false);
});
it('fails nonpositive denominators and keeps missing reads and int256 overflow unknown', () => {
  const x = paired();
  expect(utils.judge(x, [BigInt(1), BigInt(0)]).pass).toBe(false);
  expect(utils.judge(x, [BigInt(1), BigInt(-1)]).pass).toBe(false);
  expect(utils.judge(x, [null, BigInt(1)]).pass).toBe(null);
  expect(
    utils.judge(x, [(BigInt(1) << BigInt(255)) - BigInt(1), BigInt(1)]).pass
  ).toBe(null);
});
it('describes phase, sum, exact units and fixed-block judgment without inventing deadlines', () => {
  const x = paired();
  const d = utils.describeJobSpec(x);
  expect(d.checks[0]).toContain('PRE_EXECUTION');
  expect(d.timing).toContain('submit blocks');
  expect(d.timing).not.toContain('Execute by');
});
it('requires explicit baseline blocks before submitting paid reads', async () => {
  const prepareRead = jest.fn();
  await expect(
    utils.previewJobSpec(paired(), {
      client: { universal: { prepareRead } } as never,
    })
  ).rejects.toMatchObject({ code: 'PREVIEW_BLOCK_REQUIRED' });
  expect(prepareRead).not.toHaveBeenCalled();
});

function observations(values: bigint[] = [BigInt(110), BigInt(100)]) {
  const read = prepareJobRead({
    chain: 'eip155:97',
    target: call.target,
    abi: parseAbi(['function value() view returns(uint256)']),
    functionName: 'value',
  });
  const subject = utils.buildJobSpec({
    reads: [read, { read, at: 'PRE_EXECUTION' }],
    checks: [
      {
        left: [0],
        right: [1],
        evaluation: 'NUMBER',
        operation: 'GREATER_OR_EQUAL',
        target: BigInt(5),
      },
    ],
    logic: 'ALL',
  });
  const prepared: {
    target: string;
    options: { blockNumber?: bigint; callData: Hex };
  }[] = [];
  const prepareRead = jest.fn(
    async (
      target: string,
      options: { blockNumber?: bigint; callData: Hex }
    ) => {
      prepared.push({ target, options });
      return { value: BigInt(2) };
    }
  );
  const responses = values.map((value, i) => {
    const block = i === 0 ? BigInt(200) : BigInt(100);
    const response = {
      requestId: toHex(BigInt(i + 1), { size: 32 }),
      txHash: zeroHash,
      request: {
        spec: {
          account: { chainNamespace: 'eip155', chainId: '97' },
          minConfirmations: 1,
          blockNumber: block,
          query: encodeEvmQueryEnvelope(
            {
              type: 'contractCall',
              target: read.target,
              callData: read.selector,
            },
            { blockNumber: block }
          ).encoded,
        },
      },
      outcome: READ_OUTCOME.SUCCESS,
      raw: { resultData: encodeAbiParameters([{ type: 'uint256' }], [value]) },
      fees: { paid: BigInt(2) },
      wait: jest.fn(),
    };
    response.wait.mockResolvedValue(response);
    return response;
  });
  const executeReads = jest.fn(async () => ({ reads: responses }));
  const trackRead = jest.fn(async ({ requestId }: { requestId: Hex }) =>
    responses.find((r) => r.requestId === requestId)
  );
  return {
    subject,
    client: { universal: { prepareRead, executeReads, trackRead } } as never,
    prepared,
    prepareRead,
    executeReads,
    responses,
  };
}
it('pins PRE observations and recovers paid reads with no new payment, rejecting another baseline height', async () => {
  const f = observations(),
    options = {
      client: f.client,
      blockNumbers: { 1: BigInt(100) },
      maxTotalFee: BigInt(4),
    };
  const first = await utils.previewJobSpec(f.subject, options);
  expect(first.pass).toBe(true);
  expect(f.prepared[1].options.blockNumber).toBe(BigInt(100));
  f.executeReads.mockClear();
  f.prepareRead.mockClear();
  const resume = first.reads.map((r) => r.response.requestId);
  expect(
    (await utils.previewJobSpec(f.subject, { ...options, resume })).fees
      .newlyPaid
  ).toBe(BigInt(0));
  expect(f.executeReads).not.toHaveBeenCalled();
  expect(f.prepareRead).not.toHaveBeenCalled();
  await expect(
    utils.previewJobSpec(f.subject, {
      ...options,
      resume,
      blockNumbers: { 1: BigInt(101) },
    })
  ).rejects.toMatchObject({ code: 'PREVIEW_REQUEST_MISMATCH' });
});
it('checks the aggregate paid-read quote before any submission', async () => {
  const f = observations();
  await expect(
    utils.previewJobSpec(f.subject, {
      client: f.client,
      blockNumbers: { 1: BigInt(100) },
      maxTotalFee: BigInt(3),
    })
  ).rejects.toMatchObject({ code: 'PREVIEW_FEE_EXCEEDED' });
  expect(f.executeReads).not.toHaveBeenCalled();
});
it('treats oversize evaluator answers as unknown', async () => {
  const f = observations();
  f.responses[0].raw.resultData = ('0x' + '00'.repeat(4097)) as Hex;
  const result = await utils.previewJobSpec(f.subject, {
    client: f.client,
    blockNumbers: { 1: BigInt(100) },
  });
  expect(result.pass).toBe(null);
  expect(result.reads[0].decoded).toBe(null);
});
it('rejects a forged dynamic-array length even when its length word exists', () => {
  const r = prepareJobRead({
    chain: 'eip155:97',
    target: call.target,
    abi: parseAbi(['function values() view returns(uint256[])']),
    functionName: 'values',
  });
  const forged = encodeAbiParameters(
    [{ type: 'uint256' }, { type: 'uint256' }],
    [BigInt(32), BigInt(999)]
  );
  expect(() =>
    decodeJobAnswer({ ...r, minConfirmations: 1, field: [0] }, forged, {
      maxBytes: 4096,
      strictArrayLength: true,
    })
  ).toThrow();
});

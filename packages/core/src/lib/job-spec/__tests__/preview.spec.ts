import {
  encodeAbiParameters,
  keccak256,
  parseAbi,
  parseAbiParameters,
  stringToHex,
  toHex,
  type Hex,
} from 'viem';
import { buildJobSpec, buildJobSpecTemplate } from '../codec';
import { prepareJobRead } from '../read';
import {
  bindJobPreviewAccounts,
  decodeJobAnswer,
  previewJobSpec,
} from '../preview';
import { READ_OUTCOME } from '../../read-state/read-state.types';
import { PRINCIPAL } from '../constants';
import { encodeEvmQueryEnvelope } from '../../read-state/envelopes';
import type { PreviewJobSpecOptions, JobSpec } from '../types';
const target = '0x1111111111111111111111111111111111111111';
const word = (n: bigint): Hex => encodeAbiParameters([{ type: 'int256' }], [n]);
const abi = parseAbi(['function value() view returns (uint256)']);
const read = prepareJobRead({
  chain: 'eip155:97',
  target,
  abi,
  functionName: 'value',
});
function spec(
  evaluation: 'COMPARE' | 'NUMBER' | 'PERCENTAGE' = 'COMPARE'
): JobSpec {
  return buildJobSpec({
    reads: [read],
    checks: [
      {
        read: 0,
        evaluation,
        operation: 'GREATER_OR_EQUAL',
        target: evaluation === 'PERCENTAGE' ? BigInt(2500) : BigInt(5),
      },
    ],
    logic: 'ALL',
    executeBy: 1800000000,
    failFinalAt: 1800000060,
  });
}
function fixture(values: (Hex | null)[] = [word(BigInt(5))]) {
  const prepareRead = jest.fn(async () => ({ value: BigInt(2) }));
  const responses = values.map((resultData, i) => {
    const response = {
      requestId: toHex(BigInt(i + 1), { size: 32 }),
      txHash: toHex(BigInt(99), { size: 32 }),
      request: {
        spec: {
          account: { chainNamespace: 'eip155', chainId: '97' },
          minConfirmations: 1,
          blockNumber: BigInt(1),
          query: encodeEvmQueryEnvelope(
            { type: 'contractCall', target, callData: read.selector },
            { blockNumber: BigInt(1) }
          ).encoded,
        },
      },
      outcome:
        resultData === null ? READ_OUTCOME.SOURCE_ERROR : READ_OUTCOME.SUCCESS,
      raw: resultData === null ? null : { resultData },
      fees: { paid: BigInt(2) },
      errorMsg: '',
      wait: jest.fn(),
    };
    response.wait.mockResolvedValue(response);
    return response;
  });
  const executeReads = jest.fn(async () => ({ reads: responses }));
  const trackRead = jest.fn(async () => responses[0]);
  const options = {
    client: { universal: { prepareRead, executeReads, trackRead } },
  } as unknown as PreviewJobSpecOptions;
  return { options, prepareRead, executeReads, responses, trackRead };
}
it('prepares raw calls through universal reads, pays the batch and evaluates comparisons', async () => {
  const f = fixture();
  const result = await previewJobSpec(spec(), {
    ...f.options,
    maxTotalFee: BigInt(2),
  });
  expect(f.prepareRead).toHaveBeenCalledWith(
    target,
    expect.objectContaining({
      chain: 'eip155:97',
      callData: read.selector,
      minConfirmations: 1,
    })
  );
  expect(f.executeReads).toHaveBeenCalledWith(
    [{ value: BigInt(2) }],
    expect.objectContaining({ waitForCompletion: false })
  );
  expect(result).toMatchObject({
    pass: true,
    checks: [{ value: BigInt(5), pass: true }],
    fees: { quoted: BigInt(2), paid: BigInt(2) },
  });
});
it('checks the total fee cap after preparation and before any paid request', async () => {
  const f = fixture();
  await expect(
    previewJobSpec(spec(), { ...f.options, maxTotalFee: BigInt(1) })
  ).rejects.toMatchObject({ code: 'PREVIEW_FEE_EXCEEDED' });
  expect(f.executeReads).not.toHaveBeenCalled();
});
it('retains all request IDs after a wait timeout and resumes with no additional payment', async () => {
  const f = fixture();
  f.responses[0].wait.mockRejectedValueOnce(new Error('Polling timed out'));
  await expect(previewJobSpec(spec(), f.options)).rejects.toMatchObject({
    code: 'PREVIEW_INCOMPLETE',
    details: { requestIds: [f.responses[0].requestId] },
  });
  const result = await previewJobSpec(spec(), {
    ...f.options,
    resume: [f.responses[0].requestId],
    maxTotalFee: BigInt(0),
  });
  expect(result).toMatchObject({
    pass: true,
    fees: { paid: BigInt(2), newlyPaid: BigInt(0) },
  });
  expect(f.executeReads).toHaveBeenCalledTimes(1);
});
it('rejects a recorded request for a different call before evaluating its result', async () => {
  const f = fixture();
  const changed = spec();
  changed.reads[0].target = '0x2222222222222222222222222222222222222222';
  await expect(
    previewJobSpec(changed, {
      ...f.options,
      resume: [f.responses[0].requestId],
    })
  ).rejects.toMatchObject({ code: 'PREVIEW_REQUEST_MISMATCH' });
  expect(f.prepareRead).not.toHaveBeenCalled();
  expect(f.executeReads).not.toHaveBeenCalled();
  expect(f.responses[0].wait).not.toHaveBeenCalled();
});
it('does not invent baselines or treat unavailable source reads as failures of the criteria', async () => {
  const f = fixture();
  expect(await previewJobSpec(spec('NUMBER'), f.options)).toMatchObject({
    pass: null,
    checks: [{ pass: null, value: null, reason: 'BASELINE_REQUIRED' }],
  });
  const failed = fixture([null]);
  expect(await previewJobSpec(spec(), failed.options)).toMatchObject({
    pass: null,
    reads: [{ decoded: null }],
    checks: [{ reason: 'READ_UNAVAILABLE' }],
  });
});
it('uses explicit baseline values for signed changes and basis-point percentages', async () => {
  const f = fixture([word(BigInt(125))]);
  expect(
    await previewJobSpec(spec('PERCENTAGE'), {
      ...f.options,
      baseline: [BigInt(100)],
    })
  ).toMatchObject({ pass: true, checks: [{ value: BigInt(2500) }] });
  expect(
    await previewJobSpec(spec('PERCENTAGE'), {
      ...f.options,
      baseline: [BigInt(0)],
    })
  ).toMatchObject({ pass: null, checks: [{ reason: 'ZERO_BASELINE' }] });
  const falling = fixture([word(BigInt(5))]);
  expect(
    await previewJobSpec(spec('NUMBER'), {
      ...falling.options,
      baseline: [BigInt(10)],
    })
  ).toMatchObject({ pass: false, checks: [{ value: BigInt(-5) }] });
});
it('propagates unknowns with ALL, ANY and AT_LEAST without hiding conclusive results', async () => {
  const s = spec();
  s.reads.push({ ...s.reads[0] });
  s.checks.push({ ...s.checks[0], read: 1 });
  const f = fixture([word(BigInt(5)), null]);
  s.logic = { kind: 'ANY', of: [0, 1] };
  expect((await previewJobSpec(s, f.options)).pass).toBe(true);
  s.logic = { kind: 'ALL', of: [0, 1] };
  expect((await previewJobSpec(s, f.options)).pass).toBeNull();
  s.logic = { kind: 'AT_LEAST', k: 1, of: [0, 1] };
  expect((await previewJobSpec(s, f.options)).pass).toBe(true);
  const no = fixture([word(BigInt(0)), null]);
  s.logic = { kind: 'ALL', of: [0, 1] };
  expect((await previewJobSpec(s, no.options)).pass).toBe(false);
});
it('resolves template accounts explicitly and refuses missing principal before preparing reads', async () => {
  const hole = prepareJobRead({
    chain: 'eip155:97',
    target,
    abi: parseAbi(['function balanceOf(address) view returns (uint256)']),
    functionName: 'balanceOf',
    args: ['agentic:wallet'],
  });
  const template = buildJobSpecTemplate({
    reads: [hole],
    checks: [
      {
        read: 0,
        evaluation: 'COMPARE',
        operation: 'GREATER_OR_EQUAL',
        target: PRINCIPAL,
      },
    ],
    logic: 'ALL',
  });
  const f = fixture();
  await expect(previewJobSpec(template, f.options)).rejects.toMatchObject({
    code: 'UNFILLED_PLACEHOLDER',
  });
  expect(f.prepareRead).not.toHaveBeenCalled();
  await expect(
    previewJobSpec(template, {
      ...f.options,
      principal: BigInt(5),
      wallet: target,
    })
  ).rejects.toMatchObject({ code: 'UNFILLED_PLACEHOLDER' });
  const result = await previewJobSpec(template, {
    ...f.options,
    principal: BigInt(5),
    accounts: { 'eip155:97': target },
  });
  expect(result.pass).toBe(true);
  expect(f.prepareRead).toHaveBeenCalledWith(
    target,
    expect.objectContaining({
      callData: '0x70a08231' + target.slice(2).padStart(64, '0'),
    })
  );
});
it('decodes ABI offsets across tuples, dynamic tuple arrays and fixed arrays', () => {
  const complex = prepareJobRead({
    chain: 'eip155:97',
    target,
    abi: parseAbi([
      'function result() view returns ((uint256,address)[],uint256[2],string)',
    ]),
    functionName: 'result',
  });
  const data = encodeAbiParameters(
    parseAbiParameters('(uint256,address)[],uint256[2],string'),
    [
      [
        [BigInt(7), target],
        [BigInt(9), target],
      ],
      [BigInt(4), BigInt(8)],
      'ok',
    ]
  );
  const decode = (field: number[]) =>
    decodeJobAnswer({ ...complex, field, minConfirmations: 1 }, data);
  expect(decode([0])).toBe(BigInt(2));
  expect(decode([0, 1, 0])).toBe(BigInt(9));
  expect(decode([1, 1])).toBe(BigInt(8));
  expect(decode([2])).toBe(
    BigInt.asIntN(256, BigInt(keccak256(stringToHex('ok'))))
  );
});
it('rejects truncated return data, invalid bools, unsigned overflow and out-of-range dynamic fields', () => {
  const r = { ...read, field: [0], minConfirmations: 1 };
  expect(() => decodeJobAnswer(r, '0x')).toThrow();
  expect(() => decodeJobAnswer(r, word(BigInt(-1)))).toThrow();
  expect(() =>
    decodeJobAnswer({ ...r, outputs: '0x080103' }, word(BigInt(2)))
  ).toThrow();
  expect(decodeJobAnswer({ ...r, outputs: '0x080102' }, word(BigInt(-1)))).toBe(
    BigInt(-1)
  );
});
it('resolves template holes with the configured client and snapshots criteria before paid reads', async () => {
  const f = fixture();
  const destination = '0x2222222222222222222222222222222222222222' as const;
  const resolve = jest.fn(async () => destination);
  bindJobPreviewAccounts(f.options.client.universal, resolve);
  const hole = prepareJobRead({
    chain: 'eip155:97',
    target,
    abi: parseAbi(['function balanceOf(address) view returns (uint256)']),
    functionName: 'balanceOf',
    args: ['agentic:wallet'],
  });
  const template = buildJobSpecTemplate({
    reads: [hole],
    checks: [
      {
        read: 0,
        evaluation: 'COMPARE',
        operation: 'GREATER_OR_EQUAL',
        target: BigInt(5),
      },
    ],
    logic: 'ALL',
  });
  f.prepareRead.mockImplementation(async () => {
    template.checks[0].target = BigInt(999);
    return { value: BigInt(2) };
  });
  const result = await previewJobSpec(template, {
    ...f.options,
    wallet: target,
  });
  expect(resolve).toHaveBeenCalledWith(target, 'eip155:97');
  expect(f.prepareRead).toHaveBeenCalledWith(
    target,
    expect.objectContaining({
      callData: '0x70a08231' + destination.slice(2).padStart(64, '0'),
    })
  );
  expect(result.pass).toBe(true);
});

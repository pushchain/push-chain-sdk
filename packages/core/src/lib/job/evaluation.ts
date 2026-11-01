import {
  getAddress,
  keccak256,
  zeroAddress,
  zeroHash,
  type Address,
  type Hex,
} from 'viem';
import { EVALUATOR_ABI } from './UniversalEvaluator';
import { EVALUATION_HOOK_ABI } from './UniversalHook';
import { JobError } from '../market/errors';
import type { MarketSnapshot, StackRuntime } from '../market/runtime';
import { decodePrePostJobSpec } from '../job-spec/pre-post/codec';
import type {
  JobEvaluation,
  JobEvaluationQuote,
  JobEvaluatorConfig,
} from './types';
export interface EvaluatedKernelJob {
  evaluator: Address;
  hook: Address;
  description: Hex;
  status: number;
}
export function evaluatorConfig(
  config: JobEvaluatorConfig
): Readonly<JobEvaluatorConfig> {
  if (config.profile !== 'pre-post-v1')
    throw new JobError(
      'UNSUPPORTED_JOB_SPEC',
      'Choose the pre-post-v1 evaluator profile explicitly.'
    );
  const result = {
    ...config,
    evaluator: getAddress(config.evaluator),
    hook: getAddress(config.hook),
    ...(config.kernel ? { kernel: getAddress(config.kernel) } : {}),
  };
  if (
    result.evaluator === zeroAddress ||
    result.hook === zeroAddress ||
    result.kernel === zeroAddress ||
    (result.startBlock !== undefined &&
      (typeof result.startBlock !== 'bigint' || result.startBlock < BigInt(0)))
  )
    throw new JobError(
      'INVALID_EVALUATOR_CONFIG',
      'Use nonzero deployed addresses and a nonnegative deployment block.'
    );
  for (const hash of [result.evaluatorCodeHash, result.hookCodeHash])
    if (hash !== undefined && !/^0x[\da-f]{64}$/i.test(hash))
      throw new JobError(
        'INVALID_EVALUATOR_CONFIG',
        'Code hashes must be bytes32 values.'
      );
  return Object.freeze(result);
}
export function matchesEvaluator(
  j: EvaluatedKernelJob,
  c: JobEvaluatorConfig | undefined
): boolean {
  return (
    !!c &&
    getAddress(j.evaluator) === getAddress(c.evaluator) &&
    getAddress(j.hook) === getAddress(c.hook)
  );
}
export async function validateEvaluator(
  rt: StackRuntime,
  s: MarketSnapshot,
  kernel: Address,
  c: JobEvaluatorConfig
): Promise<void> {
  const [ek, eh, hk, he, ec, hc] = await Promise.all([
    s.read<Address>(c.evaluator, EVALUATOR_ABI, 'KERNEL'),
    s.read<Address>(c.evaluator, EVALUATOR_ABI, 'HOOK'),
    s.read<Address>(c.hook, EVALUATION_HOOK_ABI, 'KERNEL'),
    s.read<Address>(c.hook, EVALUATION_HOOK_ABI, 'EVALUATOR'),
    rt.agw.reader.getCode({ address: c.evaluator, blockNumber: s.blockNumber }),
    rt.agw.reader.getCode({ address: c.hook, blockNumber: s.blockNumber }),
  ]);
  if (
    getAddress(ek) !== getAddress(kernel) ||
    getAddress(eh) !== getAddress(c.hook) ||
    getAddress(hk) !== getAddress(kernel) ||
    getAddress(he) !== getAddress(c.evaluator) ||
    !ec ||
    ec === '0x' ||
    !hc ||
    hc === '0x' ||
    (c.evaluatorCodeHash && keccak256(ec) !== c.evaluatorCodeHash) ||
    (c.hookCodeHash && keccak256(hc) !== c.hookCodeHash)
  )
    throw new JobError(
      'EVALUATOR_MISMATCH',
      'The configured evaluator/hook do not match the job kernel, wiring or code hashes.'
    );
}
export async function evaluationSpec(
  s: MarketSnapshot,
  c: JobEvaluatorConfig,
  jobId: bigint,
  j: EvaluatedKernelJob
) {
  const replacement = await s.read<Hex>(
    c.evaluator,
    EVALUATOR_ABI,
    'currentSpec',
    [jobId]
  );
  const bytes = replacement === '0x' ? j.description : replacement;
  return { spec: decodePrePostJobSpec(bytes, { format: 'spec' }), bytes };
}
export async function evaluationQuote(
  s: MarketSnapshot,
  c: JobEvaluatorConfig,
  jobId: bigint,
  j: EvaluatedKernelJob
): Promise<JobEvaluationQuote> {
  const [spec, [before, after], prepaid] = await Promise.all([
    evaluationSpec(s, c, jobId, j),
    s.read<readonly [bigint, bigint]>(
      c.evaluator,
      EVALUATOR_ABI,
      'prefundCost',
      [jobId]
    ),
    s.read<bigint>(c.evaluator, EVALUATOR_ABI, 'prepaidOf', [jobId]),
  ]);
  const required = before + after;
  return {
    blockNumber: s.blockNumber,
    specHash: keccak256(spec.bytes),
    snapshot: before,
    evaluation: after,
    prepaid,
    required,
    topUp: required > prepaid ? required - prepaid : BigInt(0),
  };
}
export async function evaluationStatus(
  s: MarketSnapshot,
  c: JobEvaluatorConfig,
  jobId: bigint,
  j: EvaluatedKernelJob
): Promise<{
  jobSpec: Awaited<ReturnType<typeof evaluationSpec>> & { frozen: boolean };
  evaluation: JobEvaluation;
}> {
  const [jobSpec, specHash, ready, prepaid, e] = await Promise.all([
    evaluationSpec(s, c, jobId, j),
    s.read<Hex>(c.evaluator, EVALUATOR_ABI, 'specHashOf', [jobId]),
    s.read<boolean>(c.evaluator, EVALUATOR_ABI, 'ready', [jobId]),
    s.read<bigint>(c.evaluator, EVALUATOR_ABI, 'prepaidOf', [jobId]),
    s.read<{
      endFixed: boolean;
      started: boolean;
      pending: number;
      done: boolean;
      verdict: number;
      applied: boolean;
      ownerCheck: number;
    }>(c.evaluator, EVALUATOR_ABI, 'evaluationOf', [jobId]),
  ]);
  const frozen = specHash !== zeroHash;
  if (
    (frozen &&
      specHash.toLowerCase() !== keccak256(jobSpec.bytes).toLowerCase()) ||
    !['NONE', 'PASS', 'FAIL', 'INCONCLUSIVE'][e.verdict] ||
    !['UNKNOWN', 'CLEAN', 'TOUCHED'][e.ownerCheck]
  )
    throw new JobError(
      'INCONSISTENT_READ',
      'The evaluator facts do not match its frozen criteria.'
    );
  const reads = await Promise.all(
    jobSpec.spec.reads.map(async (r, i) => {
      const [answer, requestId, fundHeight, endHeight, evidence] =
        await Promise.all([
          s.read<readonly [boolean, bigint]>(
            c.evaluator,
            EVALUATOR_ABI,
            'answerOf',
            [jobId, BigInt(i)]
          ),
          s.read<bigint>(c.evaluator, EVALUATOR_ABI, 'requestOf', [
            jobId,
            BigInt(i),
          ]),
          s.read<bigint>(c.evaluator, EVALUATOR_ABI, 'fundHeightOf', [
            jobId,
            BigInt(i),
          ]),
          s.read<bigint>(c.evaluator, EVALUATOR_ABI, 'endHeightOf', [
            jobId,
            BigInt(i),
          ]),
          s.read<Hex>(c.evaluator, EVALUATOR_ABI, 'evidenceOf', [
            jobId,
            BigInt(i),
          ]),
        ]);
      return {
        at: r.at,
        ok: answer[0],
        value: answer[1],
        requestId,
        fundHeight,
        endHeight,
        evidence,
      };
    })
  );
  return {
    jobSpec: { ...jobSpec, frozen },
    evaluation: {
      available: true,
      profile: 'pre-post-v1',
      evaluator: c.evaluator,
      specHash,
      ready,
      prepaid,
      endFixed: e.endFixed,
      started: e.started,
      pending: e.pending,
      done: e.done,
      verdict: (['NONE', 'PASS', 'FAIL', 'INCONCLUSIVE'] as const)[e.verdict],
      applied: e.applied,
      ownerCheck: (['UNKNOWN', 'CLEAN', 'TOUCHED'] as const)[e.ownerCheck],
      reads,
    },
  };
}

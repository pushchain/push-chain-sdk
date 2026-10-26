import { DONUT_MARKETPLACE } from '../market/deployment';
import {
  evaluatorConfig,
  matchesEvaluator,
  validateEvaluator,
  evaluationQuote,
  evaluationStatus,
  evaluationSpec,
} from './evaluation';
import { EVALUATOR_ABI } from './UniversalEvaluator';
import { EVALUATION_HOOK_ABI } from './UniversalHook';
import { decodePrePostJobSpec } from '../job-spec/pre-post/codec';
import type { PrePostJobSpec } from '../job-spec/pre-post/types';
import {
  decodeEventLog,
  encodeAbiParameters,
  encodeFunctionData,
  erc20Abi,
  getAbiItem,
  getAddress,
  keccak256,
  parseAbi,
  stringToHex,
  zeroAddress,
  zeroHash,
  type Address,
  type Hex,
} from 'viem';
import { JOB_KERNEL_ABI as ABI } from '../market/contracts/AgenticCommerce';
import { RULES_HOOK_ABI } from '../market/contracts/RulesBindingHook';
import { MARKETPLACE_ABI } from '../market/contracts/UniversalMarketplace';
import { KERNEL_READ_ABI, encodeCreateJob } from '../market/kernel-wire';
import {
  deployment,
  eventArgs,
  ownerBatch,
  snapshot,
  write,
  type MarketSnapshot,
  type StackRuntime,
} from '../market/runtime';
import { JobError, unavailable } from '../market/errors';
import { currentGeneration } from '../agentic/deployments';
import { getRule } from '../agentic/reads/rules';
import { Snapshot, scanLogs } from '../agentic/reads/snapshot';
import { decodeJobSpec } from '../job-spec/codec';
import type { JobSpec } from '../job-spec/types';
import type { Call } from '../agentic/contracts/v6';
import { watchJob } from './watch';
import type {
  CreateJobOptions,
  FundJobOptions,
  Job,
  JobEvent,
  JobNamespace,
  JobStatus,
  JobWriteOptions,
  JobWatchOptions,
  JobEvaluatorConfig,
  SubmitJobOptions,
  VerifyJobOptions,
} from './types';

const STATES: JobStatus[] = [
  'Open',
  'Funded',
  'Submitted',
  'Completed',
  'Rejected',
  'Expired',
];
interface KernelJob {
  client: Address;
  status: number;
  provider: Address;
  expiredAt: number;
  evaluator: Address;
  hook: Address;
  budget: bigint;
  description: Hex;
}
function validId(jobId: bigint): void {
  if (typeof jobId !== 'bigint' || jobId < BigInt(1))
    throw new JobError('INVALID_JOB_ID', 'Job IDs are positive bigint values.');
}
function amount(n: bigint): void {
  if (typeof n !== 'bigint' || n < BigInt(0) || n >= BigInt(1) << BigInt(256))
    throw new JobError('INVALID_AMOUNT', 'The amount must fit uint256.');
}

export class JobNamespaceImpl<S extends JobSpec | PrePostJobSpec = JobSpec>
  implements JobNamespace<S>
{
  constructor(
    private readonly rt: StackRuntime,
    private readonly evaluator?: Readonly<JobEvaluatorConfig>
  ) {}
  withEvaluator(
    config: JobEvaluatorConfig
  ): JobNamespace<JobSpec | PrePostJobSpec> {
    const c = evaluatorConfig(config);
    let d;
    try {
      d = deployment(this.rt);
    } catch (error) {
      if (!c.kernel) throw error;
      d = {
        ...DONUT_MARKETPLACE,
        marketplace: zeroAddress,
        hook: zeroAddress,
        evaluator: zeroAddress,
      };
    }
    const customKernel =
      !!c.kernel && getAddress(c.kernel) !== getAddress(d.kernel);
    return new JobNamespaceImpl<JobSpec | PrePostJobSpec>(
      {
        ...this.rt,
        deployment: {
          ...d,
          ...(customKernel
            ? {
                marketplace: zeroAddress,
                hook: zeroAddress,
                evaluator: zeroAddress,
              }
            : {}),
          kernel: c.kernel ?? d.kernel,
          startBlock: c.startBlock ?? d.startBlock,
        },
        jobBlocks:
          c.kernel && getAddress(c.kernel) !== getAddress(d.kernel)
            ? new Map()
            : this.rt.jobBlocks,
      },
      c
    );
  }
  private async requireEvaluator(
    j: KernelJob,
    s: MarketSnapshot
  ): Promise<Readonly<JobEvaluatorConfig>> {
    const c = this.evaluator;
    if (!c || !matchesEvaluator(j, c))
      return unavailable('Automatic evaluation for this job');
    await validateEvaluator(this.rt, s, deployment(this.rt).kernel, c);
    return c;
  }
  async quoteEvaluation(jobId: bigint) {
    if (!this.evaluator)
      return unavailable(
        'Automatic evaluation; configure a compatible deployment with withEvaluator'
      );
    const s = await snapshot(this.rt),
      j = await this.raw(jobId, s);
    const c = await this.requireEvaluator(j, s);
    return evaluationQuote(s, c, jobId, j);
  }
  async claimReadFees(jobId: bigint, options: JobWriteOptions = {}) {
    if (!this.evaluator) return unavailable('Evaluator prepaid-fee recovery');
    const s = await snapshot(this.rt),
      j = await this.raw(jobId, s),
      c = await this.requireEvaluator(j, s);
    if (
      j.status === 1 ||
      j.status === 2 ||
      (j.status === 0 && j.expiredAt > s.timestamp)
    )
      throw new JobError(
        'WRONG_STATUS',
        'Read fees are recoverable only after the job ends or an Open job expires.'
      );
    return write(
      this.rt,
      {
        target: c.evaluator,
        value: BigInt(0),
        data: encodeFunctionData({
          abi: EVALUATOR_ABI,
          functionName: 'claimPrepaid',
          args: [jobId],
        }),
      },
      options.progressHook,
      'JOB',
      true
    );
  }
  private async raw(jobId: bigint, s: MarketSnapshot): Promise<KernelJob> {
    validId(jobId);
    const j = await s.read<KernelJob>(
      deployment(this.rt).kernel,
      KERNEL_READ_ABI,
      'getJob',
      [jobId]
    );
    if (getAddress(j.client) === zeroAddress || !STATES[j.status])
      throw new JobError('JOB_NOT_FOUND', 'This job does not exist.');
    return j;
  }
  private async jobAt(jobId: bigint, s: MarketSnapshot): Promise<Job<S>> {
    const d = deployment(this.rt);
    const j = await this.raw(jobId, s);
    const paymentToken = await s.read<Address>(d.kernel, ABI, 'paymentToken');
    const evaluated = matchesEvaluator(j, this.evaluator);
    let evaluatedFacts:
      | Awaited<ReturnType<typeof evaluationStatus>>
      | undefined;
    if (evaluated) {
      const c = await this.requireEvaluator(j, s);
      evaluatedFacts = await evaluationStatus(s, c, jobId, j);
    }
    let spec: JobSpec | undefined;
    let decodeError: string | undefined;
    if (!evaluated && j.description !== '0x') {
      try {
        spec = decodeJobSpec(j.description, { format: 'spec' }) as JobSpec;
      } catch (e) {
        decodeError = (e as Error).message;
      }
    }
    const rulesId = evaluated
      ? await s.read<Hex>(j.hook, EVALUATION_HOOK_ABI, 'rulesOfJob', [jobId])
      : d.hook !== zeroAddress && getAddress(j.hook) === getAddress(d.hook)
      ? await s.read<Hex>(d.hook, RULES_HOOK_ABI, 'rulesOfJob', [jobId])
      : undefined;
    let deliverable: Hex | undefined;
    if (j.status >= 2) {
      const logs = await scanLogs(
        this.rt.agw.reader,
        {
          address: d.kernel,
          event: getAbiItem({ abi: ABI, name: 'JobSubmitted' }),
          args: { jobId },
        },
        this.rt.jobBlocks?.get(jobId) ?? d.startBlock,
        s.blockNumber
      );
      if (logs.length > 1)
        throw new JobError(
          'INCONSISTENT_READ',
          'The job has multiple submission events.'
        );
      if (logs.length === 1) {
        const event = decodeEventLog({
          abi: ABI,
          eventName: 'JobSubmitted',
          data: logs[0].data,
          topics: logs[0].topics,
        });
        deliverable = event.args.deliverable;
      }
    }
    return {
      ...j,
      jobId,
      status: STATES[j.status],
      paymentToken,
      ...(deliverable ? { deliverable } : {}),
      ...(rulesId && rulesId !== zeroHash ? { rulesId } : {}),
      ...(spec ? { jobSpec: { spec, bytes: j.description } } : {}),
      ...(decodeError ? { jobSpecDecodeError: decodeError } : {}),
      evaluation: evaluatedFacts?.evaluation ?? {
        available: false,
        reason:
          getAddress(j.evaluator) === getAddress(d.evaluator)
            ? 'MANUAL_EVALUATOR'
            : 'UNVERIFIED_EVALUATOR',
      },
      ...(evaluatedFacts ? { jobSpec: evaluatedFacts.jobSpec } : {}),
    } as Job<S>;
  }
  async status(jobId: bigint): Promise<Job<S>> {
    return this.jobAt(jobId, await snapshot(this.rt));
  }
  async list(
    options: {
      client?: Address;
      provider?: Address;
      status?: JobStatus;
      fromJobId?: bigint;
    } = {}
  ): Promise<{ jobs: Job<S>[] }> {
    const s = await snapshot(this.rt);
    const count = await s.read<bigint>(
      deployment(this.rt).kernel,
      ABI,
      'jobCounter'
    );
    const from = options.fromJobId ?? BigInt(1);
    validId(from);
    const jobs: Job<S>[] = [];
    for (let i = from; i <= count; i += BigInt(8)) {
      const rows = await Promise.all(
        Array.from(
          {
            length: Number(
              count - i + BigInt(1) > BigInt(8)
                ? BigInt(8)
                : count - i + BigInt(1)
            ),
          },
          (_, n) => this.jobAt(i + BigInt(n), s)
        )
      );
      jobs.push(
        ...rows.filter(
          (j) =>
            (!options.client ||
              getAddress(options.client) === getAddress(j.client)) &&
            (!options.provider ||
              getAddress(options.provider) === getAddress(j.provider)) &&
            (!options.status || options.status === j.status)
        )
      );
    }
    return { jobs };
  }
  async create(options: CreateJobOptions) {
    options = { ...options };
    const d = deployment(this.rt);
    const s = await snapshot(this.rt);
    const token = await s.read<Address>(d.kernel, ABI, 'paymentToken');
    if (getAddress(options.paymentToken) !== getAddress(token))
      throw new JobError(
        'TOKEN_MISMATCH',
        'The job token must equal this kernel’s payment token.'
      );
    if (
      !options.jobSpec &&
      this.evaluator &&
      getAddress(options.evaluator) === getAddress(this.evaluator.evaluator) &&
      getAddress(options.hook) === getAddress(this.evaluator.hook)
    )
      throw new JobError(
        'INVALID_JOB_SPEC',
        'An evaluated job requires an explicitly encoded pre-post-v1 JobSpec.'
      );
    if (options.jobSpec) {
      const evaluated = matchesEvaluator(
        { ...options, description: options.jobSpec, status: 0 },
        this.evaluator
      );
      if (evaluated)
        await this.requireEvaluator(
          {
            ...options,
            client: this.rt.account(),
            status: 0,
            budget: BigInt(0),
            description: options.jobSpec,
          },
          s
        );
      const spec = evaluated
        ? decodePrePostJobSpec(options.jobSpec, { format: 'spec' })
        : (decodeJobSpec(options.jobSpec, { format: 'spec' }) as JobSpec);
      if (spec.allowedMutability !== 'NONE')
        unavailable('Mutable job criteria');
      if (spec.origin !== zeroHash)
        throw new JobError(
          'INVALID_JOB_SPEC',
          'A plain job must have a zero marketplace origin.'
        );
      if ('failFinalAt' in spec && spec.failFinalAt >= options.expiredAt)
        throw new JobError(
          'INVALID_JOB_SPEC',
          'The failure deadline must precede expiry.'
        );
    }
    const min = await s.read<bigint>(d.kernel, ABI, 'MIN_EXPIRY_WINDOW');
    if (
      !Number.isSafeInteger(options.expiredAt) ||
      options.expiredAt <= s.timestamp + Number(min) ||
      options.expiredAt >= 2 ** 48
    )
      throw new JobError(
        'EXPIRY_TOO_SHORT',
        'Choose a future expiry beyond the kernel minimum window.'
      );
    const call = {
      target: d.kernel,
      value: BigInt(0),
      data: encodeCreateJob(
        getAddress(options.provider),
        getAddress(options.evaluator),
        options.expiredAt,
        options,
        getAddress(options.hook)
      ),
    };
    const wallet = this.rt.wallet();
    const tx = wallet
      ? await ownerBatch(this.rt, wallet, [call], options.progressHook)
      : await write(this.rt, call, options.progressHook, 'JOB', true);
    const e = await eventArgs(this.rt, tx, d.kernel, ABI, 'JobCreated');
    if (getAddress(e['client'] as Address) !== getAddress(this.rt.account()))
      throw new JobError(
        'RECEIPT_MISMATCH',
        'The created job has a different client.',
        { txHash: tx.hash }
      );
    return { jobId: e['jobId'] as bigint, tx };
  }
  private provider(j: KernelJob): void {
    if (getAddress(j.provider) !== getAddress(this.rt.agw.signerPushAccount()))
      throw new JobError('NOT_PROVIDER', 'Connect this job’s provider.');
  }
  private open(j: KernelJob, now: number): void {
    if (j.status !== 0 || j.expiredAt <= now)
      throw new JobError('WRONG_STATUS', 'The job must be Open and unexpired.');
  }
  async setBudget(
    jobId: bigint,
    budget: bigint,
    options: JobWriteOptions & { jobSpec?: Hex } = {}
  ) {
    if (options.jobSpec !== undefined)
      unavailable('Replacement JobSpec proposals');
    amount(budget);
    const s = await snapshot(this.rt);
    const j = await this.raw(jobId, s);
    this.provider(j);
    this.open(j, s.timestamp);
    const d = deployment(this.rt);
    return write(
      this.rt,
      {
        target: d.kernel,
        value: BigInt(0),
        data: encodeFunctionData({
          abi: ABI,
          functionName: 'setBudget',
          args: [jobId, budget, '0x'],
        }),
      },
      options.progressHook,
      'JOB',
      true
    );
  }
  async fund(jobId: bigint, options: FundJobOptions = {}) {
    options = {
      ...options,
      ...(options.evaluation ? { evaluation: { ...options.evaluation } } : {}),
    };
    const rt = this.rt;
    const d = deployment(rt);
    const s = await snapshot(rt);
    const j = await this.raw(jobId, s);
    this.open(j, s.timestamp);
    const evaluated = matchesEvaluator(j, this.evaluator);
    const c = evaluated ? await this.requireEvaluator(j, s) : undefined;
    if (options.evaluation && !c)
      throw new JobError(
        'EVALUATOR_MISMATCH',
        'Evaluation funding options require the configured evaluator and hook.'
      );
    const gen = currentGeneration(rt.agw.network);
    const isWallet = await s.read<boolean>(
      gen.addresses.factory,
      gen.contracts.abis.factory,
      'isWallet',
      [j.client]
    );
    if (isWallet) {
      const owner = await s.read<Address>(
        j.client,
        gen.contracts.abis.wallet,
        'owner'
      );
      if (getAddress(owner) !== getAddress(rt.agw.signerPushAccount()))
        throw new JobError('NOT_CLIENT', 'Connect the job wallet’s owner.');
    } else if (getAddress(j.client) !== getAddress(rt.agw.signerPushAccount()))
      throw new JobError('NOT_CLIENT', 'Connect this job’s client.');
    let expected = options.expectedBudget;
    const cardId =
      !evaluated &&
      d.marketplace !== zeroAddress &&
      getAddress(j.hook) === getAddress(d.hook)
        ? await s.read<bigint>(d.marketplace, MARKETPLACE_ABI, 'cardOfJob', [
            jobId,
          ])
        : BigInt(0);
    let rulesId = options.rulesId;
    if (cardId) {
      const [version, view, recordedRules] = await Promise.all([
        s.read<bigint>(d.marketplace, MARKETPLACE_ABI, 'cardVersionOfJob', [
          jobId,
        ]),
        s.read<{ version: bigint; card: { providerFee: bigint } }>(
          d.marketplace,
          MARKETPLACE_ABI,
          'getAgentCard',
          [cardId]
        ),
        s.read<Hex>(d.marketplace, MARKETPLACE_ABI, 'rulesOfJob', [jobId]),
      ]);
      if (rulesId && rulesId !== recordedRules)
        throw new JobError(
          'RULES_MISMATCH',
          'Use the permission recorded when this job was opened.'
        );
      rulesId = recordedRules;
      if (expected === undefined && version === view.version)
        expected = view.card.providerFee;
    }
    if (expected === undefined)
      throw new JobError(
        'EXPECTED_BUDGET_REQUIRED',
        'Pass the exact budget you reviewed; this SDK does not silently accept the latest provider quote.'
      );
    amount(expected);
    if (expected !== j.budget)
      throw new JobError(
        'BUDGET_MISMATCH',
        'The provider’s current price differs from the budget you reviewed.',
        { expectedBudget: expected, currentBudget: j.budget }
      );
    let optParams: Hex = '0x';
    if (
      evaluated ||
      (d.hook !== zeroAddress && getAddress(j.hook) === getAddress(d.hook))
    ) {
      if (!isWallet || !rulesId || !/^0x[\da-f]{64}$/i.test(rulesId))
        throw new JobError(
          'RULES_REQUIRED',
          'This rules hook needs an AGW client and its rulesId.'
        );
      const record = await getRule(
        new Snapshot(rt.agw.reader, s.blockNumber),
        gen,
        j.client,
        rulesId,
        rt.agw.pushChainNamespace
      );
      if (
        getAddress(record.agent) !== getAddress(j.provider) ||
        record.validUntil < j.expiredAt
      )
        throw new JobError(
          'RULES_MISMATCH',
          'The live rule must authorize this provider through the job expiry.'
        );
      if (
        await s.read<bigint>(
          j.hook,
          evaluated ? EVALUATION_HOOK_ABI : RULES_HOOK_ABI,
          'activeJobOf',
          [j.client]
        )
      )
        throw new JobError(
          'WALLET_HAS_ACTIVE_JOB',
          'This wallet already has a funded job under the rules hook.'
        );
      optParams = encodeAbiParameters([{ type: 'bytes32' }], [rulesId]);
    } else if (rulesId)
      throw new JobError(
        'HOOK_MISMATCH',
        'A rulesId payload is supported only for the verified rules hook.'
      );
    const token = await s.read<Address>(d.kernel, ABI, 'paymentToken');
    const calls: Call[] = [];
    if (expected > BigInt(0)) {
      const [balance, allowance] = await Promise.all([
        s.read<bigint>(token, erc20Abi, 'balanceOf', [j.client]),
        s.read<bigint>(token, erc20Abi, 'allowance', [j.client, d.kernel]),
      ]);
      if (balance < expected)
        throw new JobError(
          'INSUFFICIENT_FUNDS',
          'The job client lacks the payment tokens required for escrow.'
        );
      if (allowance < expected) {
        if (allowance > BigInt(0))
          calls.push({
            target: token,
            value: BigInt(0),
            data: encodeFunctionData({
              abi: erc20Abi,
              functionName: 'approve',
              args: [d.kernel, BigInt(0)],
            }),
          });
        calls.push({
          target: token,
          value: BigInt(0),
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: 'approve',
            args: [d.kernel, expected],
          }),
        });
      }
    }
    if (c) {
      if (!rulesId)
        throw new JobError(
          'RULES_REQUIRED',
          'The evaluated job requires its rulesId.'
        );
      const acceptance = options.evaluation;
      if (!acceptance || !/^0x[\da-f]{64}$/i.test(acceptance.expectedSpecHash))
        throw new JobError(
          'EXPECTED_SPEC_HASH_REQUIRED',
          'Pass the exact criteria hash you reviewed before funding.'
        );
      amount(acceptance.maxReadFee);
      const quote = await evaluationQuote(s, c, jobId, j);
      if (
        quote.specHash.toLowerCase() !==
        acceptance.expectedSpecHash.toLowerCase()
      )
        throw new JobError(
          'SPEC_HASH_MISMATCH',
          'The current criteria differ from the criteria you reviewed.'
        );
      const selected = decodePrePostJobSpec(j.description, { format: 'spec' });
      if (selected.allowedMutability !== 'NONE')
        return unavailable('Mutable job criteria');
      const topUp = acceptance.prefundAmount ?? quote.topUp;
      amount(topUp);
      if (
        quote.required > acceptance.maxReadFee ||
        topUp > acceptance.maxReadFee
      )
        throw new JobError(
          'READ_FEE_EXCEEDED',
          'The quoted reads or explicit PC addition exceed maxReadFee.'
        );
      if (quote.prepaid + topUp < quote.required)
        throw new JobError(
          'INSUFFICIENT_READ_FEES',
          'Prepay enough PC for the baseline and evaluation reads.'
        );
      if (
        (await rt.agw.reader.getBalance({
          address: j.client,
          blockNumber: s.blockNumber,
        })) < topUp
      )
        throw new JobError(
          'INSUFFICIENT_FUNDS',
          'The job wallet needs PC for evaluator reads.'
        );
      if (topUp > BigInt(0))
        calls.push({
          target: c.evaluator,
          value: topUp,
          data: encodeFunctionData({
            abi: EVALUATOR_ABI,
            functionName: 'prefund',
            args: [jobId],
          }),
        });
      optParams = encodeAbiParameters(
        [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes' }],
        [rulesId, acceptance.expectedSpecHash, '0x']
      );
    }
    calls.push({
      target: d.kernel,
      value: BigInt(0),
      data: encodeFunctionData({
        abi: ABI,
        functionName: 'fund',
        args: [jobId, expected, optParams],
      }),
    });
    if (isWallet) return ownerBatch(rt, j.client, calls, options.progressHook);
    if (calls.length === 1)
      return write(rt, calls[0], options.progressHook, 'JOB', true);
    if (rt.agw.isReadOnly)
      throw new JobError('READ_ONLY', 'Connect a signer to fund escrow.');
    // No sequential fallback: allowance and acceptance must belong to one atomic batch.
    return rt.agw.executeAtomicBatch(
      {
        to: d.kernel,
        value: BigInt(0),
        data: calls.map((c) => ({
          to: c.target,
          value: c.value,
          data: c.data,
        })),
      },
      { progressHook: options.progressHook }
    );
  }
  async submit(jobId: bigint, options: SubmitJobOptions) {
    options = {
      ...options,
      ...(options.executionBlocks
        ? { executionBlocks: { ...options.executionBlocks } }
        : {}),
    };
    if (options.executionBlocks !== undefined) {
      const entries = Object.entries(options.executionBlocks);
      if (
        entries.length < 1 ||
        entries.length > 32 ||
        entries.some(
          ([chain, block]) =>
            !/^eip155:[1-9]\d*$/.test(chain) ||
            typeof block !== 'bigint' ||
            block <= BigInt(0) ||
            block >= BigInt(1) << BigInt(64)
        )
      )
        throw new JobError(
          'INVALID_EXECUTION_BLOCKS',
          'Provide 1..32 destination chains with positive uint64 execution blocks.'
        );
      if (!this.evaluator)
        return unavailable(
          'Submit execution-block checks; configure the compatible evaluator first'
        );
    }
    const s = await snapshot(this.rt);
    const j = await this.raw(jobId, s);
    this.provider(j);
    if (j.status !== 1 || j.expiredAt <= s.timestamp)
      throw new JobError(
        'WRONG_STATUS',
        'Only an unexpired Funded job can be submitted.'
      );
    if (options.executionBlocks !== undefined) {
      const c = await this.requireEvaluator(j, s);
      const [{ spec, bytes }, frozenHash, core, maxAge] = await Promise.all([
        evaluationSpec(s, c, jobId, j),
        s.read<Hex>(c.evaluator, EVALUATOR_ABI, 'specHashOf', [jobId]),
        s.read<Address>(c.evaluator, EVALUATOR_ABI, 'UNIVERSAL_CORE'),
        s.read<bigint>(c.evaluator, EVALUATOR_ABI, 'MAX_HEIGHT_AGE'),
      ]);
      if (
        frozenHash === zeroHash ||
        frozenHash.toLowerCase() !== keccak256(bytes).toLowerCase()
      )
        throw new JobError(
          'SPEC_HASH_MISMATCH',
          'Execution blocks must be checked against the frozen criteria.'
        );
      const postChains = new Set(
        spec.reads
          .filter((read) => read.at === 'POST_EXECUTION')
          .map((read) => `${read.chainNamespace}:${read.chainId}`)
      );
      const heightAbi = parseAbi([
        'function chainHeightByChainNamespace(string) view returns (uint256)',
        'function timestampObservedAtByChainNamespace(string) view returns (uint256)',
      ]);
      for (const [chain, requiredBlock] of Object.entries(
        options.executionBlocks
      )) {
        if (!postChains.has(chain))
          throw new JobError(
            'EXECUTION_CHAIN_MISMATCH',
            'An execution block must name a chain measured by the job’s POST criteria.',
            { chain }
          );
        const [trackedBlock, observedAt] = await Promise.all([
          s.read<bigint>(core, heightAbi, 'chainHeightByChainNamespace', [
            chain,
          ]),
          s.read<bigint>(
            core,
            heightAbi,
            'timestampObservedAtByChainNamespace',
            [chain]
          ),
        ]);
        if (
          trackedBlock < requiredBlock ||
          trackedBlock >= BigInt(1) << BigInt(64)
        )
          throw new JobError(
            'EXECUTION_BLOCK_NOT_TRACKED',
            'Wait for Push to track the destination work block before submitting.',
            { chain, requiredBlock, trackedBlock, snapshotBlock: s.blockNumber }
          );
        if (maxAge > BigInt(0) && observedAt + maxAge < BigInt(s.timestamp))
          throw new JobError(
            'TRACKED_HEIGHT_STALE',
            'Wait for a fresh destination-height update before submitting.',
            { chain, trackedBlock, observedAt, snapshotBlock: s.blockNumber }
          );
      }
    }
    const deliverable = /^0x[\da-f]{64}$/i.test(options.deliverable)
      ? (options.deliverable as Hex)
      : keccak256(stringToHex(options.deliverable));
    return write(
      this.rt,
      {
        target: deployment(this.rt).kernel,
        value: BigInt(0),
        data: encodeFunctionData({
          abi: ABI,
          functionName: 'submit',
          args: [jobId, deliverable, '0x'],
        }),
      },
      options.progressHook,
      'JOB',
      true
    );
  }
  async cancel(jobId: bigint, options: JobWriteOptions = {}) {
    const rt = this.rt;
    const d = deployment(rt);
    const s = await snapshot(rt);
    const j = await this.raw(jobId, s);
    if (j.status !== 0)
      throw new JobError(
        'WRONG_STATUS',
        'Only an Open job can be cancelled by its client.'
      );
    const gen = currentGeneration(rt.agw.network);
    const isWallet = await s.read<boolean>(
      gen.addresses.factory,
      gen.contracts.abis.factory,
      'isWallet',
      [j.client]
    );
    const calls: Call[] = [
      {
        target: d.kernel,
        value: BigInt(0),
        data: encodeFunctionData({
          abi: ABI,
          functionName: 'reject',
          args: [jobId, zeroHash, '0x'],
        }),
      },
    ];
    if (isWallet) {
      const wallet =
        d.marketplace === zeroAddress
          ? zeroAddress
          : await s.read<Address>(d.marketplace, MARKETPLACE_ABI, 'agwOfJob', [
              jobId,
            ]);
      const rulesId =
        d.marketplace === zeroAddress
          ? zeroHash
          : await s.read<Hex>(d.marketplace, MARKETPLACE_ABI, 'rulesOfJob', [
              jobId,
            ]);
      if (
        getAddress(wallet) === getAddress(j.client) &&
        rulesId !== zeroHash &&
        (await s.read<boolean>(
          gen.addresses.sessionEngine,
          gen.contracts.abis.engine,
          'isPermissionEnabled',
          [rulesId, j.client]
        ))
      )
        calls.push({
          target: j.client,
          value: BigInt(0),
          data: gen.contracts.encodeRevokeRules(rulesId),
        });
      return ownerBatch(rt, j.client, calls, options.progressHook);
    }
    if (getAddress(j.client) !== getAddress(rt.agw.signerPushAccount()))
      throw new JobError(
        'NOT_CLIENT',
        'Only the client can use this cancellation method.'
      );
    return write(rt, calls[0], options.progressHook, 'JOB', true);
  }
  async claimRefund(jobId: bigint, options: JobWriteOptions = {}) {
    const s = await snapshot(this.rt);
    const j = await this.raw(jobId, s);
    const d = deployment(this.rt);
    if (![0, 1, 2].includes(j.status))
      throw new JobError('WRONG_STATUS', 'This job is already terminal.');
    const grace =
      j.status === 2
        ? Number(await s.read<bigint>(d.kernel, ABI, 'EVALUATOR_GRACE_PERIOD'))
        : 0;
    if (s.timestamp < j.expiredAt + grace)
      throw new JobError(
        'REFUND_NOT_READY',
        'The expiry or evaluator grace window has not elapsed.'
      );
    return write(
      this.rt,
      {
        target: d.kernel,
        value: BigInt(0),
        data: encodeFunctionData({
          abi: ABI,
          functionName: 'claimRefund',
          args: [jobId],
        }),
      },
      options.progressHook,
      'JOB',
      true
    );
  }
  async verify(jobId: bigint, options: VerifyJobOptions = {}) {
    if (!this.evaluator)
      return unavailable(
        'Automatic job verification; the configured evaluator is manual'
      );
    options = { ...options };
    const s = await snapshot(this.rt),
      j = await this.raw(jobId, s),
      c = await this.requireEvaluator(j, s);
    const { evaluation: e } = await evaluationStatus(s, c, jobId, j);
    let action = options.action ?? 'auto';
    if (action === 'auto')
      action =
        e.done && !e.applied && (e.verdict === 'PASS' || e.verdict === 'FAIL')
          ? 'settle'
          : !e.started && !e.ready
          ? 'retrySnapshot'
          : 'retryEvaluation';
    if (!['settle', 'retrySnapshot', 'retryEvaluation'].includes(action))
      throw new JobError(
        'INVALID_VERIFY_ACTION',
        'Choose snapshot retry, evaluation retry or settlement.'
      );
    if (
      action === 'settle'
        ? !e.done || e.applied || (e.verdict !== 'PASS' && e.verdict !== 'FAIL')
        : action === 'retrySnapshot'
        ? e.started || e.ready || (j.status !== 1 && j.status !== 2)
        : j.status !== 2 ||
          !e.endFixed ||
          (e.done && e.verdict !== 'INCONCLUSIVE')
    )
      throw new JobError(
        'WRONG_STATUS',
        'This evaluation action is not available in the current job state.'
      );
    const value = options.value ?? BigInt(0);
    amount(value);
    if (value > BigInt(0)) {
      if (options.maxReadFee === undefined)
        throw new JobError(
          'READ_FEE_CAP_REQUIRED',
          'Set maxReadFee when adding PC for retries.'
        );
      amount(options.maxReadFee);
      if (value > options.maxReadFee)
        throw new JobError(
          'READ_FEE_EXCEEDED',
          'The retry payment exceeds maxReadFee.'
        );
    }
    if (action === 'settle' && value > BigInt(0))
      throw new JobError('INVALID_AMOUNT', 'Settlement accepts no PC payment.');
    const call: Call = {
      target: c.evaluator,
      value,
      data: encodeFunctionData({
        abi: EVALUATOR_ABI,
        functionName: action,
        args: [jobId],
      }),
    };
    if (
      action !== 'settle' &&
      getAddress(j.provider) !== getAddress(this.rt.agw.signerPushAccount())
    ) {
      const gen = currentGeneration(this.rt.agw.network);
      if (
        await s.read<boolean>(
          gen.addresses.factory,
          gen.contracts.abis.factory,
          'isWallet',
          [j.client]
        )
      )
        return ownerBatch(this.rt, j.client, [call], options.progressHook);
      if (getAddress(j.client) !== getAddress(this.rt.agw.signerPushAccount()))
        throw new JobError(
          'NOT_CLIENT_OR_PROVIDER',
          'Only this job’s client or provider can retry evaluation.'
        );
    }
    return write(this.rt, call, options.progressHook, 'JOB', true);
  }
  watch(
    jobId: bigint,
    callback: (event: JobEvent) => void,
    options: JobWatchOptions = {}
  ): () => void {
    validId(jobId);
    return watchJob(
      this.rt,
      jobId,
      callback,
      { ...options },
      this.evaluator
        ? async () => {
            const s = await snapshot(this.rt),
              j = await this.raw(jobId, s);
            if (!matchesEvaluator(j, this.evaluator)) return [];
            const c = await this.requireEvaluator(j, s);
            return [
              {
                address: c.evaluator,
                abi: EVALUATOR_ABI,
                names: [
                  'SpecFrozenHere',
                  'SnapshotRequested',
                  'SnapshotAnswered',
                  'SnapshotReady',
                  'EndBlocksFixed',
                  'ReadsSent',
                  'ReadsNotSent',
                  'ReadAnswered',
                  'Verified',
                  'SettleFailed',
                  'Prefunded',
                  'PrepaidRefunded',
                ],
              },
              {
                address: c.hook,
                abi: EVALUATION_HOOK_ABI,
                names: ['SpecFrozen', 'SpecReplaced', 'RulesBound'],
              },
            ];
          }
        : undefined
    );
  }
}

import {
  decodeEventLog,
  encodeAbiParameters,
  encodeFunctionData,
  erc20Abi,
  getAbiItem,
  getAddress,
  keccak256,
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
import type {
  CreateJobOptions,
  FundJobOptions,
  Job,
  JobEvent,
  JobNamespace,
  JobStatus,
  JobWriteOptions,
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

export class JobNamespaceImpl implements JobNamespace {
  constructor(private readonly rt: StackRuntime) {}
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
  private async jobAt(jobId: bigint, s: MarketSnapshot): Promise<Job> {
    const d = deployment(this.rt);
    const j = await this.raw(jobId, s);
    const paymentToken = await s.read<Address>(d.kernel, ABI, 'paymentToken');
    let spec: JobSpec | undefined;
    let decodeError: string | undefined;
    if (j.description !== '0x') {
      try {
        spec = decodeJobSpec(j.description, { format: 'spec' }) as JobSpec;
      } catch (e) {
        decodeError = (e as Error).message;
      }
    }
    const rulesId =
      getAddress(j.hook) === getAddress(d.hook)
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
      evaluation: {
        available: false,
        reason:
          getAddress(j.evaluator) === getAddress(d.evaluator)
            ? 'MANUAL_EVALUATOR'
            : 'UNVERIFIED_EVALUATOR',
      },
    };
  }
  async status(jobId: bigint): Promise<Job> {
    return this.jobAt(jobId, await snapshot(this.rt));
  }
  async list(
    options: {
      client?: Address;
      provider?: Address;
      status?: JobStatus;
      fromJobId?: bigint;
    } = {}
  ): Promise<{ jobs: Job[] }> {
    const s = await snapshot(this.rt);
    const count = await s.read<bigint>(
      deployment(this.rt).kernel,
      ABI,
      'jobCounter'
    );
    const from = options.fromJobId ?? BigInt(1);
    validId(from);
    const jobs: Job[] = [];
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
    const d = deployment(this.rt);
    const s = await snapshot(this.rt);
    const token = await s.read<Address>(d.kernel, ABI, 'paymentToken');
    if (getAddress(options.paymentToken) !== getAddress(token))
      throw new JobError(
        'TOKEN_MISMATCH',
        'The job token must equal this kernel’s payment token.'
      );
    if (options.jobSpec) {
      const spec = decodeJobSpec(options.jobSpec, {
        format: 'spec',
      }) as JobSpec;
      if (spec.allowedMutability !== 'NONE')
        unavailable('Mutable job criteria');
      if (spec.origin !== zeroHash)
        throw new JobError(
          'INVALID_JOB_SPEC',
          'A plain job must have a zero marketplace origin.'
        );
      if (spec.failFinalAt >= options.expiredAt)
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
    const rt = this.rt;
    const d = deployment(rt);
    const s = await snapshot(rt);
    const j = await this.raw(jobId, s);
    this.open(j, s.timestamp);
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
    const cardId = await s.read<bigint>(
      d.marketplace,
      MARKETPLACE_ABI,
      'cardOfJob',
      [jobId]
    );
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
    if (getAddress(j.hook) === getAddress(d.hook)) {
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
        await s.read<bigint>(d.hook, RULES_HOOK_ABI, 'activeJobOf', [j.client])
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
  async submit(
    jobId: bigint,
    options: JobWriteOptions & { deliverable: Hex | string }
  ) {
    const s = await snapshot(this.rt);
    const j = await this.raw(jobId, s);
    this.provider(j);
    if (j.status !== 1 || j.expiredAt <= s.timestamp)
      throw new JobError(
        'WRONG_STATUS',
        'Only an unexpired Funded job can be submitted.'
      );
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
      const wallet = await s.read<Address>(
        d.marketplace,
        MARKETPLACE_ABI,
        'agwOfJob',
        [jobId]
      );
      const rulesId = await s.read<Hex>(
        d.marketplace,
        MARKETPLACE_ABI,
        'rulesOfJob',
        [jobId]
      );
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
  async verify(_jobId: bigint, _options?: JobWriteOptions): Promise<never> {
    void _jobId;
    void _options;
    return unavailable(
      'Automatic job verification; the configured evaluator is manual'
    );
  }
  watch(
    jobId: bigint,
    callback: (event: JobEvent) => void,
    options: { fromBlock?: bigint; pollIntervalMs?: number } = {}
  ): () => void {
    validId(jobId);
    const d = deployment(this.rt);
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cursor = options.fromBlock;
    const interval = options.pollIntervalMs ?? 3000;
    if (
      !Number.isSafeInteger(interval) ||
      interval < 25 ||
      (cursor !== undefined && cursor < BigInt(0))
    )
      throw new JobError(
        'INVALID_WATCH_OPTIONS',
        'Use a nonnegative block and a polling interval of at least 25ms.'
      );
    const names = [
      'JobCreated',
      'BudgetSet',
      'JobFunded',
      'JobSubmitted',
      'JobCompleted',
      'JobRejected',
      'JobExpired',
      'Refunded',
    ] as const;
    const kinds = [
      'Created',
      'BudgetSet',
      'Funded',
      'Submitted',
      'Completed',
      'Rejected',
      'Expired',
      'Refunded',
    ];
    const poll = async () => {
      try {
        const head = await this.rt.agw.reader.getBlockNumber();
        if (stopped) return;
        if (cursor === undefined) cursor = head;
        const end = cursor + BigInt(999) < head ? cursor + BigInt(999) : head;
        if (cursor <= end) {
          const groups = await Promise.all(
            names.map((name) =>
              this.rt.agw.reader.getLogs({
                address: d.kernel,
                event: getAbiItem({ abi: ABI, name }),
                args: { jobId },
                fromBlock: cursor ?? head,
                toBlock: end,
              })
            )
          );
          const logs = groups
            .flat()
            .sort(
              (a, b) =>
                Number(
                  (a.blockNumber ?? BigInt(0)) - (b.blockNumber ?? BigInt(0))
                ) || (a.logIndex ?? 0) - (b.logIndex ?? 0)
            );
          for (const log of logs) {
            if (stopped) return;
            const e = decodeEventLog({
              abi: ABI,
              data: log.data,
              topics: log.topics,
            });
            callback({
              jobId,
              kind: kinds[names.indexOf(e.eventName as (typeof names)[number])],
              txHash: log.transactionHash ?? undefined,
              blockNumber: log.blockNumber ?? undefined,
              data: e.args,
            });
          }
          cursor = end + BigInt(1);
        }
      } catch (error) {
        if (!stopped) callback({ jobId, kind: 'Error', error });
      } finally {
        if (!stopped)
          timer = setTimeout(() => {
            void poll();
          }, interval);
      }
    };
    void poll();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }
}

import type { Address, Hex } from 'viem';
import type { UniversalTxResponse } from '../orchestrator/orchestrator.types';
import type { PrePostJobSpec } from '../job-spec/pre-post/types';
import type { JobSpec } from '../job-spec/types';
import type { StackProgressHook } from '../market/runtime';
export type JobStatus =
  | 'Open'
  | 'Funded'
  | 'Submitted'
  | 'Completed'
  | 'Rejected'
  | 'Expired';
export interface CreateJobOptions {
  provider: Address;
  evaluator: Address;
  hook: Address;
  expiredAt: number;
  paymentToken: Address;
  jobSpec?: Hex;
  description?: string;
  progressHook?: StackProgressHook;
}
export interface Job<S extends JobSpec | PrePostJobSpec = JobSpec> {
  jobId: bigint;
  client: Address;
  provider: Address;
  evaluator: Address;
  hook: Address;
  status: JobStatus;
  expiredAt: number;
  budget: bigint;
  paymentToken: Address;
  /** Raw Solidity string bytes, which may contain a binary JobSpec rather than UTF-8. */
  description: Hex;
  deliverable?: Hex;
  rulesId?: Hex;
  jobSpec?: {
    spec: S;
    bytes: Hex;
    /** Unavailable without a compatible evaluator. */ frozen?: boolean;
  };
  jobSpecDecodeError?: string;
  evaluation:
    | { available: false; reason: 'MANUAL_EVALUATOR' | 'UNVERIFIED_EVALUATOR' }
    | JobEvaluation;
}
export interface JobWriteOptions {
  progressHook?: StackProgressHook;
}
export interface SubmitJobOptions extends JobWriteOptions {
  deliverable: Hex | string;
  /** Optional destination work blocks. Refuse submission until Push tracks each block used by POST criteria. */
  executionBlocks?: Readonly<Record<string, bigint>>;
}
export interface FundJobOptions extends JobWriteOptions {
  rulesId?: Hex;
  /** The price the client reviewed. Required for plain jobs or an updated card version. */
  expectedBudget?: bigint;
  /** Required for an explicitly configured automatic evaluator; does not change manual-v2 funding. */
  evaluation?: {
    expectedSpecHash: Hex;
    maxReadFee: bigint;
    prefundAmount?: bigint;
  };
}
export interface JobEvent {
  jobId: bigint;
  kind: string;
  txHash?: Hex;
  blockNumber?: bigint;
  data?: unknown;
  error?: unknown;
  cursor?: JobWatchCursor;
}
/** Last delivered log; resume includes its block and excludes this log and earlier logs. */
export interface JobWatchCursor {
  blockNumber: bigint;
  logIndex: number;
  blockHash?: Hex;
}
export interface JobWatchOptions {
  fromBlock?: bigint;
  cursor?: JobWatchCursor;
  pollIntervalMs?: number;
}
export interface JobEvaluatorConfig {
  profile: 'pre-post-v1';
  evaluator: Address;
  hook: Address;
  /** Defaults to the current Donut kernel; custom kernels never consult its marketplace job mappings. */
  kernel?: Address;
  startBlock?: bigint;
  evaluatorCodeHash?: Hex;
  hookCodeHash?: Hex;
}
export interface JobEvaluation {
  available: true;
  profile: 'pre-post-v1';
  evaluator: Address;
  specHash: Hex;
  ready: boolean;
  prepaid: bigint;
  endFixed: boolean;
  started: boolean;
  pending: number;
  done: boolean;
  verdict: 'NONE' | 'PASS' | 'FAIL' | 'INCONCLUSIVE';
  applied: boolean;
  ownerCheck: 'UNKNOWN' | 'CLEAN' | 'TOUCHED';
  reads: {
    at: 'PRE_EXECUTION' | 'POST_EXECUTION';
    ok: boolean;
    value: bigint;
    requestId: bigint;
    fundHeight: bigint;
    endHeight: bigint;
    evidence: Hex;
  }[];
}
export interface JobEvaluationQuote {
  blockNumber: bigint;
  specHash: Hex;
  snapshot: bigint;
  evaluation: bigint;
  prepaid: bigint;
  required: bigint;
  topUp: bigint;
}
export interface VerifyJobOptions extends JobWriteOptions {
  action?: 'auto' | 'retrySnapshot' | 'retryEvaluation' | 'settle';
  /** Explicit PC addition; zero by default. Existing prepaid PC is otherwise used. */
  value?: bigint;
  maxReadFee?: bigint;
}
export interface JobNamespace<S extends JobSpec | PrePostJobSpec = JobSpec> {
  /** A new scoped namespace; the current client and existing manual jobs remain unchanged. */
  withEvaluator(
    config: JobEvaluatorConfig
  ): JobNamespace<JobSpec | PrePostJobSpec>;
  quoteEvaluation(jobId: bigint): Promise<JobEvaluationQuote>;
  claimReadFees(
    jobId: bigint,
    options?: JobWriteOptions
  ): Promise<UniversalTxResponse>;
  create(
    options: CreateJobOptions
  ): Promise<{ jobId: bigint; tx: UniversalTxResponse }>;
  setBudget(
    jobId: bigint,
    amount: bigint,
    options?: JobWriteOptions & { jobSpec?: Hex }
  ): Promise<UniversalTxResponse>;
  fund(jobId: bigint, options?: FundJobOptions): Promise<UniversalTxResponse>;
  submit(
    jobId: bigint,
    options: SubmitJobOptions
  ): Promise<UniversalTxResponse>;
  cancel(
    jobId: bigint,
    options?: JobWriteOptions
  ): Promise<UniversalTxResponse>;
  claimRefund(
    jobId: bigint,
    options?: JobWriteOptions
  ): Promise<UniversalTxResponse>;
  verify(
    jobId: bigint,
    options?: VerifyJobOptions
  ): Promise<UniversalTxResponse>;
  status(jobId: bigint): Promise<Job<S>>;
  list(options?: {
    client?: Address;
    provider?: Address;
    status?: JobStatus;
    fromJobId?: bigint;
  }): Promise<{ jobs: Job<S>[] }>;
  watch(
    jobId: bigint,
    callback: (event: JobEvent) => void,
    options?: JobWatchOptions
  ): () => void;
}

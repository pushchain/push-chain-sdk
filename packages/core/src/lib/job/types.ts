import type { Address, Hex } from 'viem';
import type { UniversalTxResponse } from '../orchestrator/orchestrator.types';
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
export interface Job {
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
    spec: JobSpec;
    bytes: Hex;
    /** Unavailable without a compatible evaluator. */ frozen?: boolean;
  };
  jobSpecDecodeError?: string;
  evaluation: {
    available: false;
    reason: 'MANUAL_EVALUATOR' | 'UNVERIFIED_EVALUATOR';
  };
}
export interface JobWriteOptions {
  progressHook?: StackProgressHook;
}
export interface FundJobOptions extends JobWriteOptions {
  rulesId?: Hex;
  /** The price the client reviewed. Required for plain jobs or an updated card version. */
  expectedBudget?: bigint;
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
export interface JobNamespace {
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
    options: JobWriteOptions & { deliverable: Hex | string }
  ): Promise<UniversalTxResponse>;
  cancel(
    jobId: bigint,
    options?: JobWriteOptions
  ): Promise<UniversalTxResponse>;
  claimRefund(
    jobId: bigint,
    options?: JobWriteOptions
  ): Promise<UniversalTxResponse>;
  verify(jobId: bigint, options?: JobWriteOptions): Promise<never>;
  status(jobId: bigint): Promise<Job>;
  list(options?: {
    client?: Address;
    provider?: Address;
    status?: JobStatus;
    fromJobId?: bigint;
  }): Promise<{ jobs: Job[] }>;
  watch(
    jobId: bigint,
    callback: (event: JobEvent) => void,
    options?: JobWatchOptions
  ): () => void;
}

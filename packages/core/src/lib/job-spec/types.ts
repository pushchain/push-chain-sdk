import type { Abi, Address, Hex } from 'viem';
import type { ArgumentPath, WalletMarker } from '../agentic/agentic.types';
import type { JOB_VOCABULARY, PRINCIPAL } from './constants';
import type { PushChain } from '../push-chain/push-chain';
export type Evaluation =
  (typeof JOB_VOCABULARY.EVALUATION)[keyof typeof JOB_VOCABULARY.EVALUATION];
export type Operation =
  (typeof JOB_VOCABULARY.OPERATION)[keyof typeof JOB_VOCABULARY.OPERATION];
export type LogicKind =
  (typeof JOB_VOCABULARY.LOGIC)[keyof typeof JOB_VOCABULARY.LOGIC];
export type AllowedMutability =
  (typeof JOB_VOCABULARY.ALLOWED_MUTABILITY)[keyof typeof JOB_VOCABULARY.ALLOWED_MUTABILITY];
export type PrincipalMarker = typeof PRINCIPAL;
export interface JobFill {
  word: number;
  source: 'WALLET' | 'PARAM';
  param?: number;
}
export interface PreparedJobRead {
  chainNamespace: string;
  chainId: string;
  target: Address;
  selector: Hex;
  args: Hex;
  outputs: Hex;
  /** Placeholder positions are explicit; zero argument values are never treated as holes. */
  fills?: JobFill[];
}
export interface JobRead extends PreparedJobRead {
  minConfirmations: number;
  field: number[];
}
export interface PrepareJobReadOptions {
  chain: string;
  target: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
}
export interface JobReadInput {
  read: PreparedJobRead;
  minConfirmations?: number;
  field?: number[];
}
export interface JobCheck {
  read: number;
  evaluation: Evaluation;
  operation: Operation;
  target: bigint;
}
export interface JobCheckTemplate extends Omit<JobCheck, 'target'> {
  target:
    | bigint
    | PrincipalMarker
    | WalletMarker
    | { principalBps: bigint }
    | { param: number };
}
export interface LogicTree {
  kind: LogicKind;
  of: (number | LogicTree)[];
  k?: number;
}
export interface JobSpec {
  reads: JobRead[];
  checks: JobCheck[];
  logic: LogicTree;
  allowedMutability: AllowedMutability;
  origin: Hex;
  executeBy: number;
  failFinalAt: number;
}
export interface JobSpecTemplate {
  reads: JobRead[];
  checks: JobCheckTemplate[];
  logic: LogicTree;
  allowedMutability: AllowedMutability;
  params: { min: bigint; max: bigint }[];
}
export interface BuildJobSpecOptions {
  reads: (PreparedJobRead | JobReadInput)[];
  checks: JobCheck[];
  logic: 'ALL' | 'ANY' | LogicTree;
  allowedMutability?: AllowedMutability;
  executeBy: number;
  failFinalAt: number;
  expiredAt?: number;
  origin?: Hex;
}
export interface BuildJobSpecTemplateOptions
  extends Omit<
    BuildJobSpecOptions,
    'checks' | 'executeBy' | 'failFinalAt' | 'expiredAt' | 'origin'
  > {
  checks: JobCheckTemplate[];
  params?: { min: bigint; max: bigint }[];
}
export interface PreviewJobSpecOptions {
  client: Pick<PushChain, 'universal'>;
  wallet?: Address;
  principal?: bigint;
  params?: bigint[];
  /** Required for cross-chain template holes: an AGW address is not its destination account. */
  accounts?: Record<string, Address>;
}
export interface JobSpecPreview {
  reads: { value: Hex; decoded: bigint }[];
  checks: { pass: boolean | null; value: bigint }[];
  pass: boolean | null;
}
export type JobArgumentPath = ArgumentPath;

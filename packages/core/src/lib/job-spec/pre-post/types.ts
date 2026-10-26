import type { Address, Hex } from 'viem';
import type {
  AllowedMutability,
  Evaluation,
  JobCheckTemplate,
  JobRead,
  JobReadInput,
  Operation,
  PreparedJobRead,
  PreviewJobSpecOptions,
} from '../types';

export const PRE_POST_PROFILE = 'pre-post-v1' as const;
export type ReadAt = 'POST_EXECUTION' | 'PRE_EXECUTION';
export interface PrePostRead extends JobRead {
  at: ReadAt;
}
export interface PrePostCheck {
  left: number[];
  right: number[];
  evaluation: Evaluation;
  operation: Operation;
  target: bigint;
}
export interface PrePostCheckTemplate extends Omit<PrePostCheck, 'target'> {
  target: JobCheckTemplate['target'];
}
/** Exact topological graph; entry 0 is the root and children follow their parent. */
export interface PrePostLogic {
  kind: 'CHECK' | 'ALL' | 'ANY' | 'AT_LEAST';
  check: number;
  children: number[];
  k: number;
}
export interface PrePostJobSpec {
  profile: typeof PRE_POST_PROFILE;
  reads: PrePostRead[];
  checks: PrePostCheck[];
  logic: PrePostLogic[];
  allowedMutability: AllowedMutability;
  origin: Hex;
}
export interface PrePostJobSpecTemplate {
  profile: typeof PRE_POST_PROFILE;
  reads: PrePostRead[];
  checks: PrePostCheckTemplate[];
  logic: PrePostLogic[];
  params: { min: bigint; max: bigint }[];
}
export interface PrePostReadInput extends JobReadInput {
  at?: ReadAt;
}
export interface BuildPrePostJobSpecOptions {
  reads: (PreparedJobRead | PrePostReadInput)[];
  checks: PrePostCheck[];
  logic: 'ALL' | 'ANY' | PrePostLogic[];
  allowedMutability?: AllowedMutability;
  origin?: Hex;
}
export interface BuildPrePostJobSpecTemplateOptions
  extends Omit<
    BuildPrePostJobSpecOptions,
    'checks' | 'origin' | 'allowedMutability'
  > {
  checks: PrePostCheckTemplate[];
  params?: { min: bigint; max: bigint }[];
}
export interface PrePostResolveOptions {
  principal: bigint;
  params: bigint[];
  accounts: Record<string, Address>;
  origin: Hex;
}
export interface PreviewPrePostJobSpecOptions
  extends Omit<PreviewJobSpecOptions, 'baseline'> {
  /** Historical baseline blocks must be explicit for every PRE read. POST defaults to a current observation. */
  blockNumbers?: Readonly<Record<number, bigint>>;
}

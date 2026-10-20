import type { Address, Hex } from 'viem';
import type { AgentCardRules } from './rules';
import type { JobSpec, JobSpecTemplate } from '../job-spec/types';
import type { SessionWire } from '../agentic/codec/session';
import type { StackProgressHook } from './runtime';
import type { UniversalTxResponse } from '../orchestrator/orchestrator.types';

export interface AgentCardInput {
  /** A name is hashed on write; reads retain the canonical bytes32 jobType. */
  jobType: string;
  metadataURI: string;
  metadataHash: Hex;
  chain: string;
  providerFee: bigint;
  paymentToken: Address;
  principalMin: bigint;
  principalMax: bigint;
  minDuration: number;
  maxDuration: number;
  minExecuteWindow: number;
  settleWindow: number;
}
export interface AgentCard extends AgentCardInput {
  cardId: bigint;
  provider: Address;
  active: boolean;
  version: bigint;
  verified: boolean;
  disabled: boolean;
  rating: bigint;
  rules: AgentCardRules;
  jobSpecTemplate: JobSpecTemplate;
  /** Canonical on-chain bytes retained for exact matching and unknown token metadata. */
  rulesBytes: Hex;
  jobSpecTemplateBytes: Hex;
}
export type AgentCardSummary = Omit<
  AgentCard,
  'rules' | 'jobSpecTemplate' | 'rulesBytes' | 'jobSpecTemplateBytes'
>;
export interface MarketJobInputs {
  principal: bigint;
  expiredAt: number;
  executeBy: number;
  params: bigint[];
}
export interface OwnerIntent {
  owner: Address;
  wallet: Address;
  executor: Address;
  index: bigint;
  sessionHash: Hex;
  mode: Hex;
  execCalldataHash: Hex;
  nonceKey: bigint;
  nonceSeq: bigint;
  grantNonce: bigint;
  deadline: number;
  signerChainId: bigint;
}
export interface JobPlan {
  cardId: bigint;
  cardVersion: bigint;
  wallet: Address;
  walletDeployed: boolean;
  session: SessionWire;
  intent: OwnerIntent;
  calldata: Hex;
  jobSpec: { spec: JobSpec; bytes: Hex };
  job: MarketJobInputs;
  label: string;
  /** Reference deposit amounts; no principal or fee is moved by openJob. */
  deposit: {
    principal: { prc20: Address; amount: bigint };
    providerFee: { token: Address; amount: bigint };
    pc: bigint;
  };
  preview: {
    mayDo: string[];
    mayMove: string[];
    judgedBy: string[];
    until: string;
  };
}
export interface MarketPreviewOptions extends Omit<MarketJobInputs, 'params'> {
  params?: bigint[];
  walletIndex?: number;
  deadline?: number;
  label?: string;
}
export interface MarketWriteOptions {
  progressHook?: StackProgressHook;
}
export interface MarketNamespace {
  cards(options?: {
    provider?: Address;
    chain?: string;
    active?: boolean;
  }): Promise<{ cards: AgentCardSummary[] }>;
  card(cardId: bigint): Promise<AgentCard>;
  preview(cardId: bigint, options: MarketPreviewOptions): Promise<JobPlan>;
  openJob(
    plan: JobPlan,
    options?: MarketWriteOptions & { relay?: boolean }
  ): Promise<{
    jobId: bigint;
    wallet: Address;
    rulesId: Hex;
    tx: UniversalTxResponse;
  }>;
  deposit(jobId: bigint, options?: MarketWriteOptions): Promise<never>;
  job(
    jobId: bigint
  ): Promise<{
    cardId: bigint;
    cardVersion: bigint;
    wallet: Address;
    rulesId: Hex;
  }>;
  activeJob(wallet: Address): Promise<{ jobId: bigint }>;
  agent: {
    register(
      card: AgentCardInput,
      options: MarketWriteOptions & {
        rules: AgentCardRules;
        jobSpecTemplate: JobSpecTemplate;
      }
    ): Promise<{ cardId: bigint; version: bigint; tx: UniversalTxResponse }>;
    update(
      cardId: bigint,
      card: AgentCardInput,
      options: MarketWriteOptions & {
        rules: AgentCardRules;
        jobSpecTemplate: JobSpecTemplate;
      }
    ): Promise<{ cardId: bigint; version: bigint; tx: UniversalTxResponse }>;
    setActive(
      cardId: bigint,
      active: boolean,
      options?: MarketWriteOptions
    ): Promise<UniversalTxResponse>;
    card(): Promise<AgentCard | undefined>;
  };
}

import {
  decodeEventLog,
  getAddress,
  type Abi,
  type Address,
  type Log,
  type TypedData,
  type TypedDataDomain,
} from 'viem';
import type { AgenticRuntime } from '../agentic/runtime';
import { confirmedLogs } from '../agentic/management/common';
import { currentGeneration } from '../agentic/deployments';
import type { Call } from '../agentic/contracts/v6';
import type {
  ExecuteParams,
  TransactionExecutionOptions,
  UniversalExecuteParams,
  UniversalTxResponse,
} from '../orchestrator/orchestrator.types';
import type { ProgressEvent } from '../progress-hook/progress-hook.types';
import { MarketError, stackError } from './errors';
import { marketplaceDeployment, type MarketDeployment } from './deployment';

export type StackProgressHook = (event: ProgressEvent) => void;
export interface StackRuntime {
  agw: AgenticRuntime;
  account(): Address;
  wallet(): Address | undefined;
  send(
    params: ExecuteParams | UniversalExecuteParams,
    options?: TransactionExecutionOptions
  ): Promise<UniversalTxResponse>;
  signTypedData(data: {
    domain: TypedDataDomain;
    types: TypedData;
    primaryType: string;
    message: Record<string, unknown>;
  }): Promise<string>;
  canSignTypedData?(): boolean;
  /** Internal fixture override; never a public initialization option. */
  deployment?: MarketDeployment;
  /** Receipt-confirmed creation blocks accelerate bounded event recovery. */
  jobBlocks?: Map<bigint, bigint>;
}
export function deployment(rt: StackRuntime): MarketDeployment {
  return rt.deployment ?? marketplaceDeployment(rt.agw.network);
}
export interface MarketSnapshot {
  blockNumber: bigint;
  timestamp: number;
  read<T>(
    address: Address,
    abi: Abi,
    name: string,
    args?: readonly unknown[]
  ): Promise<T>;
}
export async function snapshot(
  rt: StackRuntime,
  atBlock?: bigint
): Promise<MarketSnapshot> {
  const blockNumber = atBlock ?? (await rt.agw.reader.getBlockNumber());
  const timestamp = rt.agw.reader.getBlock
    ? Number((await rt.agw.reader.getBlock({ blockNumber })).timestamp)
    : rt.agw.nowSeconds();
  return {
    blockNumber,
    timestamp,
    read: async <T>(
      address: Address,
      abi: Abi,
      name: string,
      args: readonly unknown[] = []
    ) => {
      try {
        return (await rt.agw.reader.readContract({
          address,
          abi,
          functionName: name,
          args,
          blockNumber,
        })) as T;
      } catch (cause) {
        throw new MarketError(
          'READ_FAILED',
          `Could not load ${name} at block ${blockNumber}.`,
          { address, functionName: name, blockNumber },
          cause
        );
      }
    },
  };
}
export function progress(
  rt: StackRuntime,
  hook: StackProgressHook | undefined,
  id: string,
  message: string,
  response: object = {}
): void {
  rt.agw.emit(
    {
      id,
      title: message,
      message,
      level: id.endsWith('199-02') ? 'ERROR' : 'INFO',
      response,
      timestamp: new Date().toISOString(),
    },
    hook
  );
}
export async function write(
  rt: StackRuntime,
  call: Call,
  hook: StackProgressHook | undefined,
  family: 'MARKET' | 'JOB',
  signer = false
): Promise<UniversalTxResponse> {
  if (rt.agw.isReadOnly)
    throw new MarketError('READ_ONLY', 'Connect a signing wallet to continue.');
  progress(rt, hook, `${family}-TX-103`, 'Submitting transaction');
  try {
    const tx = await (signer
      ? rt.agw.execute(
          { to: call.target, value: call.value, data: call.data },
          { progressHook: hook }
        )
      : rt.send(
          { to: call.target, value: call.value, data: call.data },
          { progressHook: hook }
        ));
    const originalWait = tx.wait.bind(tx);
    let terminalReported = false;
    const wait: typeof tx.wait = async (...args) => {
      try {
        const receipt = await originalWait(...args);
        if (!terminalReported) {
          terminalReported = true;
          progress(
            rt,
            hook,
            `${family}-TX-199-${receipt.status === 1 ? '01' : '02'}`,
            receipt.status === 1
              ? 'Transaction confirmed'
              : 'Transaction reverted',
            { txHash: tx.hash }
          );
        }
        return receipt;
      } catch (error) {
        progress(
          rt,
          hook,
          `${family}-TX-199-02`,
          'Transaction confirmation unavailable',
          { txHash: tx.hash }
        );
        throw error;
      }
    };
    return { ...tx, wait };
  } catch (error) {
    const wrapped = stackError(error);
    progress(rt, hook, `${family}-TX-199-02`, 'Transaction failed', {
      error: wrapped,
    });
    throw wrapped;
  }
}
export async function ownerBatch(
  rt: StackRuntime,
  wallet: Address,
  calls: Call[],
  hook?: StackProgressHook
): Promise<UniversalTxResponse> {
  const gen = currentGeneration(rt.agw.network);
  const s = await snapshot(rt);
  const owner = getAddress(
    await s.read<Address>(wallet, gen.contracts.abis.wallet, 'owner')
  );
  if (owner !== getAddress(rt.agw.signerPushAccount()))
    throw new MarketError('NOT_CLIENT', 'Connect the owner of the job wallet.');
  return write(
    rt,
    {
      target: wallet,
      value: BigInt(0),
      data: gen.contracts.encodeExecute(calls),
    },
    hook,
    'JOB',
    true
  );
}
export async function eventArgs(
  rt: StackRuntime,
  tx: UniversalTxResponse,
  address: Address,
  abi: Abi,
  name: string
): Promise<Record<string, unknown>> {
  const result = await confirmedLogs(rt.agw, tx);
  const found: Record<string, unknown>[] = [];
  for (const log of result.logs as Log[]) {
    if (log.address.toLowerCase() !== address.toLowerCase()) continue;
    try {
      const e = decodeEventLog({
        abi,
        eventName: name,
        data: log.data,
        topics: log.topics,
        strict: true,
      });
      if (e.eventName === name) {
        found.push(e.args as unknown as Record<string, unknown>);
        const args = e.args as unknown as Record<string, unknown>;
        if (
          (name === 'JobCreated' || name === 'JobOpened') &&
          typeof args['jobId'] === 'bigint' &&
          log.blockNumber !== null
        )
          rt.jobBlocks?.set(args['jobId'], log.blockNumber);
      }
    } catch {
      /* Other contract events are expected in a receipt. */
    }
  }
  if (found.length !== 1)
    throw new MarketError(
      'RECEIPT_MISMATCH',
      `The submitted transaction did not produce one ${name} event.`,
      { txHash: tx.hash }
    );
  return found[0];
}

/**
 * Shared fixture builders for universal-tx-detector specs.
 *
 * These helpers encode viem-compatible logs and receipts so every spec
 * (classify, detector, cascade, scenarios) can build test data uniformly.
 *
 * Keep these pure — no jest mocks, no module-level state.
 */
import {
  encodeAbiParameters,
  encodeEventTopics,
  type TransactionReceipt,
} from 'viem';

export type EventDef = {
  name: string;
  inputs: readonly {
    indexed: boolean;
    type: string;
    name: string;
    components?: readonly unknown[];
  }[];
};

export type BuiltLog = {
  address: `0x${string}`;
  topics: ReadonlyArray<`0x${string}` | null>;
  data: `0x${string}`;
  blockNumber: bigint;
  transactionHash: `0x${string}`;
  transactionIndex: number;
  blockHash: `0x${string}`;
  logIndex: number;
  removed: false;
};

const ZERO_HASH =
  '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`;

export function indexedArgs(
  event: EventDef,
  argsObj: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const i of event.inputs) if (i.indexed) out[i.name] = argsObj[i.name];
  return out;
}

export function buildLog(
  event: EventDef,
  argsObj: Record<string, unknown>,
  address: `0x${string}`,
  logIndex: number,
  txHash: `0x${string}` = ZERO_HASH
): BuiltLog {
  const topics = encodeEventTopics({
    abi: [
      event as unknown as Parameters<typeof encodeEventTopics>[0]['abi'][number],
    ],
    eventName: event.name,
    args: indexedArgs(event, argsObj),
  }) as unknown as ReadonlyArray<`0x${string}` | null>;
  const nonIndexed = event.inputs.filter((i) => !i.indexed);
  const data =
    nonIndexed.length === 0
      ? ('0x' as `0x${string}`)
      : encodeAbiParameters(
          nonIndexed as unknown as Parameters<
            typeof encodeAbiParameters
          >[0],
          nonIndexed.map((i) => argsObj[i.name]) as unknown[]
        );
  return {
    address,
    topics,
    data,
    blockNumber: BigInt(1),
    transactionHash: txHash,
    transactionIndex: 0,
    blockHash: ZERO_HASH,
    logIndex,
    removed: false,
  };
}

export function buildReceipt(
  logs: BuiltLog[],
  to: `0x${string}`,
  txHash: `0x${string}` = ZERO_HASH
): TransactionReceipt {
  return {
    status: 'success',
    logs,
    blockNumber: BigInt(1),
    blockHash: ZERO_HASH,
    contractAddress: null,
    cumulativeGasUsed: BigInt(0),
    effectiveGasPrice: BigInt(0),
    from: to,
    gasUsed: BigInt(0),
    logsBloom: '0x' as `0x${string}`,
    to,
    transactionHash: txHash,
    transactionIndex: 0,
    type: 'eip1559',
  } as unknown as TransactionReceipt;
}

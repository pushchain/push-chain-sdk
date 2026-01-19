import type { Transaction as EvmTransaction } from 'viem';
import type { Connection } from '@solana/web3.js';

type OriginEvmTx = EvmTransaction | null;
type OriginSvmTx = Awaited<ReturnType<Connection['getTransaction']>>;

export type OriginChainTx = OriginEvmTx | OriginSvmTx;

export type ProgressEvent = {
  id: string;
  title: string;
  message: string;
  level: 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR';
  // Can be a structured object/array or a pre-serialized string for logging/UX
  response: null | object | string;
  timestamp: string; // ISO-8601, e.g. "2025-06-26T15:04:05.000Z"
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ProgressEventFunction = (...args: any[]) => ProgressEvent;

export type ProgressEventFunctionWithoutTimestamp = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ...args: any[]
) => Omit<ProgressEvent, 'timestamp'>;

export enum PROGRESS_HOOK {
  // 01–03: Common pre-execution flow
  SEND_TX_01 = 'SEND-TX-01',
  SEND_TX_02_01 = 'SEND-TX-02-01',
  SEND_TX_02_02 = 'SEND-TX-02-02',
  SEND_TX_03_01 = 'SEND-TX-03-01',
  SEND_TX_03_02 = 'SEND-TX-03-02',

  // 04-x: Payload / verification flow
  SEND_TX_04_01 = 'SEND-TX-04-01',
  SEND_TX_04_02 = 'SEND-TX-04-02',
  SEND_TX_04_03 = 'SEND-TX-04-03',
  SEND_TX_04_04 = 'SEND-TX-04-04',

  // 05-x: Gas funding flow
  SEND_TX_05_01 = 'SEND-TX-05-01',
  SEND_TX_05_02 = 'SEND-TX-05-02',

  // 06-x: Funds flow (origin chain + Push Chain credit)
  SEND_TX_06_01 = 'SEND-TX-06-01',
  SEND_TX_06_02 = 'SEND-TX-06-02',
  SEND_TX_06_03 = 'SEND-TX-06-03',
  SEND_TX_06_04 = 'SEND-TX-06-04',
  SEND_TX_06_03_01 = 'SEND-TX-06-03-01',
  SEND_TX_06_03_02 = 'SEND-TX-06-03-02',
  SEND_TX_06_05 = 'SEND-TX-06-05', // Syncing with Push Chain
  SEND_TX_06_06 = 'SEND-TX-06-06', // Funds Credited on Push Chain (was 06_05)

  // 07-x: Execution / broadcasting flow
  SEND_TX_07 = 'SEND-TX-07', // Broadcasting to Push Chain

  // 99-x: Final outcome
  SEND_TX_99_01 = 'SEND-TX-99-01',
  SEND_TX_99_02 = 'SEND-TX-99-02',
}

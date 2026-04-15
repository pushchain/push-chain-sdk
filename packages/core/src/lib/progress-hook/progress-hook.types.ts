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

  // 08-x: External chain polling (after Push Chain tx success, outbound routes)
  SEND_TX_08_01 = 'SEND-TX-08-01', // Awaiting External Chain
  SEND_TX_08_02 = 'SEND-TX-08-02', // Polling External Chain

  // 99-x: Final outcome
  SEND_TX_99_01 = 'SEND-TX-99-01',
  SEND_TX_99_02 = 'SEND-TX-99-02',
  SEND_TX_99_03 = 'SEND-TX-99-03', // External Chain Tx Confirmed (SUCCESS)
  SEND_TX_99_04 = 'SEND-TX-99-04', // External Chain Tx Timeout (WARNING)
  SEND_TX_99_05 = 'SEND-TX-99-05', // External Chain Tx Failed (ERROR)

  // UEA Migration hooks
  UEA_MIG_01 = 'UEA-MIG-01',
  UEA_MIG_02 = 'UEA-MIG-02',
  UEA_MIG_03 = 'UEA-MIG-03',
  UEA_MIG_9901 = 'UEA-MIG-9901',
  UEA_MIG_9902 = 'UEA-MIG-9902',
  UEA_MIG_9903 = 'UEA-MIG-9903',
}

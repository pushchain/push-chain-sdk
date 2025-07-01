export type ProgressEvent = {
  id: string;
  title: string;
  message: string;
  level: 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR';
  timestamp: string; // ISO-8601, e.g. "2025-06-26T15:04:05.000Z"
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ProgressEventFunction = (...args: any[]) => ProgressEvent;

export type ProgressEventFunctionWithoutTimestamp = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ...args: any[]
) => Omit<ProgressEvent, 'timestamp'>;

export enum PROGRESS_HOOK {
  SEND_TX_01 = 'SEND-TX-01',
  SEND_TX_02_01 = 'SEND-TX-02-01',
  SEND_TX_02_02 = 'SEND-TX-02-02',
  SEND_TX_03_01 = 'SEND-TX-03-01',
  SEND_TX_03_02 = 'SEND-TX-03-02',
  SEND_TX_04_01 = 'SEND-TX-04-01',
  SEND_TX_04_02 = 'SEND-TX-04-02',
  SEND_TX_05_01 = 'SEND-TX-05-01',
  SEND_TX_05_02 = 'SEND-TX-05-02',
  SEND_TX_05_03 = 'SEND-TX-05-03',
  SEND_TX_06 = 'SEND-TX-06',
  SEND_TX_99_01 = 'SEND-TX-99-01',
  SEND_TX_99_02 = 'SEND-TX-99-02',
}

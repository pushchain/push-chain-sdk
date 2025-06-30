export type ProgressEvent = {
  id: string;
  title: string;
  message: string;
  level: 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR';
  timestamp: string; // ISO-8601, e.g. "2025-06-26T15:04:05.000Z"
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ProgressHookTypeFunction = (...args: any[]) => ProgressEvent;

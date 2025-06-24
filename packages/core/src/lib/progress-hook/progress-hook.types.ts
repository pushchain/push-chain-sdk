export type ProgressHookType = {
  id: string;
  title: string;
  info: string;
  level: 'INFO' | 'SUCCESS' | 'WARN' | 'ERROR';
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ProgressHookTypeFunction = (...args: any[]) => ProgressHookType;

import {
  ProgressEvent,
  ProgressHookTypeFunction,
  ProgressHookTypeFunctionWithoutTimestamp,
  PROGRESS_HOOK,
} from './progress-hook.types';

// Helper to wrap a hook function with timestamp
const withTimestamp = (
  fn: ProgressHookTypeFunctionWithoutTimestamp
): ProgressHookTypeFunction => {
  return (...args: any[]) => ({
    ...fn(...args),
    timestamp: new Date().toISOString(),
  });
};

// Helper to create a hook entry (either static or dynamic)
const createHook = (
  value:
    | Omit<ProgressEvent, 'timestamp'>
    | ProgressHookTypeFunctionWithoutTimestamp
): ProgressEvent | ProgressHookTypeFunction => {
  if (typeof value === 'function') {
    return withTimestamp(value);
  }
  return {
    ...value,
    timestamp: new Date().toISOString(),
  };
};

const RAW_HOOKS: {
  [K in PROGRESS_HOOK]:
    | Omit<ProgressEvent, 'timestamp'>
    | ProgressHookTypeFunctionWithoutTimestamp;
} = {
  [PROGRESS_HOOK.SEND_TX_01]: (originChain: string) => ({
    id: PROGRESS_HOOK.SEND_TX_01,
    title: 'Origin Chain Detected',
    message: `Origin chain: ${originChain}`,
    level: 'INFO',
  }),
  [PROGRESS_HOOK.SEND_TX_02_01]: {
    id: PROGRESS_HOOK.SEND_TX_02_01,
    title: 'Estimating Gas',
    message: 'Estimating and fetching gas limit, gas price for TX…',
    level: 'INFO',
  },
  [PROGRESS_HOOK.SEND_TX_02_02]: (executionCost: bigint) => ({
    id: PROGRESS_HOOK.SEND_TX_02_02,
    title: 'Gas Estimated',
    message: `Total execution cost (Gas cost + value): ${executionCost} UPC`,
    level: 'SUCCESS',
  }),
  [PROGRESS_HOOK.SEND_TX_03_01]: {
    id: PROGRESS_HOOK.SEND_TX_03_01,
    title: 'Resolving UAE',
    message:
      'Resolving Execution Account (UEA) - Compunting address, checking deployment status, nonce and balance',
    level: 'INFO',
  },
  [PROGRESS_HOOK.SEND_TX_03_02]: (
    ueaAddress: `0x${string}`,
    deployed: boolean,
    balance: bigint,
    nonce: bigint
  ) => ({
    id: PROGRESS_HOOK.SEND_TX_03_02,
    title: 'UEA Resolved',
    message: `UEA: ${ueaAddress}, Deployed: ${deployed}, Balance: ${balance.toString()} UPC, Nonce: ${nonce.toString()}`,
    level: 'SUCCESS',
  }),
  [PROGRESS_HOOK.SEND_TX_04_01]: (hash: string) => ({
    id: PROGRESS_HOOK.SEND_TX_04_01,
    title: 'Awaiting Signature for Tx Execution',
    message: `Universal Payload Hash: ${hash}`,
    level: 'INFO',
  }),
  [PROGRESS_HOOK.SEND_TX_04_02]: (signature: string) => ({
    id: PROGRESS_HOOK.SEND_TX_04_02,
    title: 'Signature Completed',
    message: `Signature: ${signature}`,
    level: 'SUCCESS',
  }),
  [PROGRESS_HOOK.SEND_TX_05_01]: (feeAmount: bigint) => ({
    id: PROGRESS_HOOK.SEND_TX_05_01,
    title: 'Locking Origin Chain Fee',
    message: `Locking fee: ${feeAmount.toString()} UPC on origin chain`,
    level: 'INFO',
  }),
  [PROGRESS_HOOK.SEND_TX_05_02]: (txHash: string, confirmations: number) => ({
    id: PROGRESS_HOOK.SEND_TX_05_02,
    title: 'Awaiting Origin Chain Confirmations',
    message: `Tx sent: ${txHash}, waiting for ${confirmations} confirmations.`,
    level: 'SUCCESS',
  }),
  [PROGRESS_HOOK.SEND_TX_05_03]: {
    id: PROGRESS_HOOK.SEND_TX_05_03,
    title: 'Confirmations Received',
    message: 'Required confirmations received.',
    level: 'SUCCESS',
  },
  [PROGRESS_HOOK.SEND_TX_06]: {
    id: PROGRESS_HOOK.SEND_TX_06,
    title: 'Broadcasting to Push Chain',
    message: 'Sending Tx to Push Chain…',
    level: 'INFO',
  },
  [PROGRESS_HOOK.SEND_TX_99_01]: (stringifiedTxResponse: string) => ({
    id: PROGRESS_HOOK.SEND_TX_99_01,
    title: 'Push Chain Tx Success',
    message: stringifiedTxResponse,
    level: 'SUCCESS',
  }),
  [PROGRESS_HOOK.SEND_TX_99_02]: (errMessage: string) => ({
    id: PROGRESS_HOOK.SEND_TX_99_02,
    title: 'Push Chain Tx Failed',
    message: errMessage,
    level: 'ERROR',
  }),
};

// Build final hooks with timestamp injection
const PROGRESS_HOOKS: Record<string, ProgressEvent | ProgressHookTypeFunction> =
  Object.fromEntries(
    Object.entries(RAW_HOOKS).map(([key, value]) => [key, createHook(value)])
  );

export default PROGRESS_HOOKS;

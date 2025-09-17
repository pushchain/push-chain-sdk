import { UniversalTxResponse } from '../orchestrator/orchestrator.types';
import { Utils } from '../utils';
import {
  PROGRESS_HOOK,
  ProgressEventFunction,
  ProgressEventFunctionWithoutTimestamp,
} from './progress-hook.types';

// Helper to wrap a hook function with timestamp
const withTimestamp = (
  fn: ProgressEventFunctionWithoutTimestamp
): ProgressEventFunction => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (...args: any[]) => ({
    ...fn(...args),
    timestamp: new Date().toISOString(),
  });
};

const RAW_HOOKS: {
  [K in PROGRESS_HOOK]: ProgressEventFunctionWithoutTimestamp;
} = {
  [PROGRESS_HOOK.SEND_TX_01]: (originChain: string) => ({
    id: PROGRESS_HOOK.SEND_TX_01,
    title: 'Origin Chain Detected',
    message: `Origin chain: ${originChain}`,
    response: null,
    level: 'INFO',
  }),
  [PROGRESS_HOOK.SEND_TX_02_01]: () => ({
    id: PROGRESS_HOOK.SEND_TX_02_01,
    title: 'Estimating Gas',
    message: 'Estimating and fetching gas limit, gas price for Tx…',
    response: null,
    level: 'INFO',
  }),
  [PROGRESS_HOOK.SEND_TX_02_02]: (executionCost: bigint) => ({
    id: PROGRESS_HOOK.SEND_TX_02_02,
    title: 'Gas Estimated',
    message: `Total execution cost (Gas cost + value): ${executionCost} UPC`,
    response: null,
    level: 'SUCCESS',
  }),
  [PROGRESS_HOOK.SEND_TX_03_01]: () => ({
    id: PROGRESS_HOOK.SEND_TX_03_01,
    title: 'Resolving UAE',
    message:
      'Resolving Execution Account (UEA) - Compunting address, checking deployment status, nonce and balance',
    response: null,
    level: 'INFO',
  }),
  [PROGRESS_HOOK.SEND_TX_03_02]: (
    ueaAddress: `0x${string}`,
    deployed: boolean,
    balance: bigint,
    nonce: bigint
  ) => ({
    id: PROGRESS_HOOK.SEND_TX_03_02,
    title: 'UEA Resolved',
    message: `UEA: ${ueaAddress}, Deployed: ${deployed}, Balance: ${balance.toString()} UPC, Nonce: ${nonce.toString()}`,
    response: null,
    level: 'SUCCESS',
  }),
  [PROGRESS_HOOK.SEND_TX_04_01]: (hash: string) => ({
    id: PROGRESS_HOOK.SEND_TX_04_01,
    title: 'Awaiting Signature for Tx Execution',
    message: `Universal Payload Hash: ${hash}`,
    response: null,
    level: 'INFO',
  }),
  [PROGRESS_HOOK.SEND_TX_04_02]: (signature: string) => ({
    id: PROGRESS_HOOK.SEND_TX_04_02,
    title: 'Signature Completed',
    message: `Signature: ${signature}`,
    response: null,
    level: 'SUCCESS',
  }),
  // V2 Payload flow
  [PROGRESS_HOOK.SEND_TX_04_03]: () => ({
    id: PROGRESS_HOOK.SEND_TX_04_03,
    title: 'Verification Success',
    message: 'Verification completed via Transaction or Signature',
    response: null,
    level: 'SUCCESS',
  }),
  [PROGRESS_HOOK.SEND_TX_04_04]: () => ({
    id: PROGRESS_HOOK.SEND_TX_04_04,
    title: 'Verification Declined',
    message: 'Verification declined by user',
    response: null,
    level: 'ERROR',
  }),
  [PROGRESS_HOOK.SEND_TX_05_01]: (feeAmount: bigint) => ({
    id: PROGRESS_HOOK.SEND_TX_05_01,
    title: 'Locking Origin Chain Fee',
    message: `Locking fee: ${feeAmount.toString()} UPC on origin chain`,
    response: null,
    level: 'INFO',
  }),
  [PROGRESS_HOOK.SEND_TX_05_02]: (txHash: string, confirmations: number) => ({
    id: PROGRESS_HOOK.SEND_TX_05_02,
    title: 'Awaiting Origin Chain Confirmations',
    message: `Tx sent: ${txHash}, waiting for ${confirmations} confirmations.`,
    response: null,
    level: 'SUCCESS',
  }),
  [PROGRESS_HOOK.SEND_TX_05_03]: () => ({
    id: PROGRESS_HOOK.SEND_TX_05_03,
    title: 'Confirmations Received',
    message: 'Required confirmations received.',
    response: null,
    level: 'SUCCESS',
  }),
  [PROGRESS_HOOK.SEND_TX_06]: () => ({
    id: PROGRESS_HOOK.SEND_TX_06,
    title: 'Broadcasting to Push Chain',
    message: 'Sending Tx to Push Chain…',
    response: null,
    level: 'INFO',
  }),
  // V2 Funds flow
  [PROGRESS_HOOK.SEND_TX_06_01]: (
    amount: bigint,
    decimals: number,
    symbol: string
  ) => ({
    id: PROGRESS_HOOK.SEND_TX_06_01,
    title: 'Preparing Funds Transfer',
    message: `Preparing to move ${Utils.helpers.formatUnits(
      amount,
      decimals
    )} ${symbol} from origin chain`,
    response: null,
    level: 'INFO',
  }),
  [PROGRESS_HOOK.SEND_TX_06_02]: (
    txHash: string,
    amount: bigint,
    decimals: number,
    symbol: string
  ) => ({
    id: PROGRESS_HOOK.SEND_TX_06_02,
    title: 'Funds Lock Submitted',
    message: `Locking ${Utils.helpers.formatUnits(
      amount,
      decimals
    )} ${symbol} for transfer (Tx hash: ${txHash})`,
    response: null,
    level: 'INFO',
  }),
  [PROGRESS_HOOK.SEND_TX_06_03]: (required: number) => ({
    id: PROGRESS_HOOK.SEND_TX_06_03,
    title: 'Awaiting Confirmations',
    message: `Waiting for ${required} confirmations`,
    response: null,
    level: 'INFO',
  }),
  [PROGRESS_HOOK.SEND_TX_06_04]: (current: number, required: number) => ({
    id: PROGRESS_HOOK.SEND_TX_06_04,
    title: 'Confirmation #1 Received',
    message: `${current}/${required} confirmations received`,
    response: null,
    level: 'INFO',
  }),
  [PROGRESS_HOOK.SEND_TX_06_05]: (current: number, required: number) => ({
    id: PROGRESS_HOOK.SEND_TX_06_05,
    title: 'Confirmation #2 Received',
    message: `${current}/${required} confirmations received`,
    response: null,
    level: 'SUCCESS',
  }),
  [PROGRESS_HOOK.SEND_TX_06_06]: () => ({
    id: PROGRESS_HOOK.SEND_TX_06_06,
    title: 'Funds Confirmed',
    message: 'Origin chain lock confirmed',
    response: null,
    level: 'SUCCESS',
  }),
  [PROGRESS_HOOK.SEND_TX_06_07]: (
    amount: bigint,
    decimals: number,
    symbol: string
  ) => ({
    id: PROGRESS_HOOK.SEND_TX_06_07,
    title: 'Funds Credited on Push Chain',
    message: `Funds credited: ${Utils.helpers.formatUnits(
      amount,
      decimals
    )} ${symbol} (minus fees)`,
    response: null,
    level: 'SUCCESS',
  }),
  [PROGRESS_HOOK.SEND_TX_99_01]: (txResponse: UniversalTxResponse[]) => ({
    id: PROGRESS_HOOK.SEND_TX_99_01,
    title: 'Push Chain Tx Success',
    message: `Final Tx Hash: ${txResponse[txResponse.length - 1].hash}`,
    response: txResponse,
    level: 'SUCCESS',
  }),
  [PROGRESS_HOOK.SEND_TX_99_02]: (errMessage: string) => ({
    id: PROGRESS_HOOK.SEND_TX_99_02,
    title: 'Push Chain Tx Failed',
    message: errMessage,
    response: null,
    level: 'ERROR',
  }),
};

// Build final hooks with timestamp injection
const PROGRESS_HOOKS: Record<string, ProgressEventFunction> =
  Object.fromEntries(
    Object.entries(RAW_HOOKS).map(([key, value]) => [key, withTimestamp(value)])
  );

export default PROGRESS_HOOKS;

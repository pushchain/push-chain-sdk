import { UniversalTxResponse } from '../orchestrator/orchestrator.types';
import { Utils } from '../utils';
import {
  PROGRESS_HOOK,
  ProgressEventFunction,
  ProgressEventFunctionWithoutTimestamp,
  OriginChainTx,
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
  [PROGRESS_HOOK.SEND_TX_01]: (
    originChainNamespace: string,
    originChainAddress: string
  ) => ({
    id: PROGRESS_HOOK.SEND_TX_01,
    title: 'Origin Chain Detected',
    message: `Origin chain: ${
      Utils.chains.getChainName(originChainNamespace) ?? originChainNamespace
    } - Origin Address: ${originChainAddress}`,
    response: null,
    level: 'INFO',
  }),
  [PROGRESS_HOOK.SEND_TX_02_01]: () => ({
    id: PROGRESS_HOOK.SEND_TX_02_01,
    title: 'Estimating Gas',
    message: 'Estimating and fetching gas limit, gas price for TX',
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
    title: 'Resolving UEA',
    message:
      'Resolving Execution Account (UEA) – computing address, checking deployment status and balance',
    response: null,
    level: 'INFO',
  }),
  [PROGRESS_HOOK.SEND_TX_03_02]: (
    ueaAddress: `0x${string}`,
    deployed: boolean
  ) => ({
    id: PROGRESS_HOOK.SEND_TX_03_02,
    title: 'UEA Resolved',
    message: `UEA: ${ueaAddress}, Deployed: ${deployed}`,
    response: null,
    level: 'SUCCESS',
  }),
  // Payload flow (04-x)
  [PROGRESS_HOOK.SEND_TX_04_01]: () => ({
    id: PROGRESS_HOOK.SEND_TX_04_01,
    title: 'Awaiting Transaction',
    message: 'Awaiting user transaction on origin chain',
    response: null,
    level: 'INFO',
  }),
  [PROGRESS_HOOK.SEND_TX_04_02]: () => ({
    id: PROGRESS_HOOK.SEND_TX_04_02,
    title: 'Awaiting Signature',
    message: 'Awaiting user signature for universal payload',
    response: null,
    level: 'INFO',
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
  // Gas flow (05-x)
  [PROGRESS_HOOK.SEND_TX_05_01]: (
    originChainTxHash: string,
    originChainTx?: OriginChainTx
  ) => ({
    id: PROGRESS_HOOK.SEND_TX_05_01,
    title: 'Gas Funding In Progress',
    message: `Gas funding tx sent: ${originChainTxHash}`,
    // Attach the full origin-chain transaction object when provided
    response: originChainTx ?? null,
    level: 'INFO',
  }),
  [PROGRESS_HOOK.SEND_TX_05_02]: () => ({
    id: PROGRESS_HOOK.SEND_TX_05_02,
    title: 'Gas Funding Confirmed',
    message: 'Gas funding confirmed on origin chain',
    response: null,
    level: 'SUCCESS',
  }),

  // V2 Funds flow (06-x)
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
    symbol: string,
    originChainTx?: OriginChainTx
  ) => ({
    id: PROGRESS_HOOK.SEND_TX_06_02,
    title: 'Funds Lock Submitted',
    message: `Locking ${Utils.helpers.formatUnits(
      amount,
      decimals
    )} ${symbol} for transfer (Tx hash: ${txHash})`,
    // Attach the full origin-chain transaction object when available
    response: originChainTx ?? null,
    level: 'INFO',
  }),
  [PROGRESS_HOOK.SEND_TX_06_03]: (required: number) => ({
    id: PROGRESS_HOOK.SEND_TX_06_03,
    title: 'Awaiting Confirmations',
    message: `Waiting for ${required} confirmations`,
    response: null,
    level: 'INFO',
  }),
  [PROGRESS_HOOK.SEND_TX_06_03_01]: (current: number, required: number) => ({
    id: PROGRESS_HOOK.SEND_TX_06_03_01,
    title: `Confirmation ${current}/${required} received`,
    message: `${current}/${required} confirmations received`,
    response: null,
    level: 'INFO',
  }),
  [PROGRESS_HOOK.SEND_TX_06_03_02]: (current: number, required: number) => ({
    id: PROGRESS_HOOK.SEND_TX_06_03_02,
    title: `Confirmation ${current}/${required} received`,
    message: `${current}/${required} confirmations received`,
    response: null,
    level: 'SUCCESS',
  }),
  [PROGRESS_HOOK.SEND_TX_06_04]: () => ({
    id: PROGRESS_HOOK.SEND_TX_06_04,
    title: 'Funds Confirmed',
    message: 'Origin chain lock confirmed',
    response: null,
    level: 'SUCCESS',
  }),
  [PROGRESS_HOOK.SEND_TX_06_05]: () => ({
    id: PROGRESS_HOOK.SEND_TX_06_05,
    title: 'Syncing State with Push Chain',
    message: 'Waiting for transaction to appear on Push Chain',
    response: null,
    level: 'INFO',
  }),
  [PROGRESS_HOOK.SEND_TX_06_06]: (
    amount: bigint,
    decimals: number,
    symbol: string
  ) => ({
    id: PROGRESS_HOOK.SEND_TX_06_06,
    title: 'Funds Credited on Push Chain',
    message: `Funds credited: ${Utils.helpers.formatUnits(
      amount,
      decimals
    )} ${symbol}`,
    response: null,
    level: 'SUCCESS',
  }),

  // Execution flow (08-x)
  [PROGRESS_HOOK.SEND_TX_08]: () => ({
    id: PROGRESS_HOOK.SEND_TX_08,
    title: 'Broadcasting to Push Chain',
    message: 'Sending Tx to Push Chain',
    response: null,
    level: 'INFO',
  }),
  [PROGRESS_HOOK.SEND_TX_99_01]: (txResponse: UniversalTxResponse[]) => ({
    id: PROGRESS_HOOK.SEND_TX_99_01,
    title: 'Push Chain Tx Success',
    message: 'Tx executed successfully on Push Chain',
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

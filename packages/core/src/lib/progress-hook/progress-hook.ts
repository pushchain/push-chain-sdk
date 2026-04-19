import {
  OutboundTxDetails,
  UniversalTxReceipt,
  UniversalTxResponse,
} from '../orchestrator/orchestrator.types';
import { CHAIN } from '../constants/enums';
import { Utils } from '../utils';
import {
  PROGRESS_HOOK,
  PROGRESS_HOOK_MIG,
  PROGRESS_HOOK_MULTICHAIN,
  PROGRESS_HOOK_R1,
  PROGRESS_HOOK_R2,
  PROGRESS_HOOK_R3,
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

const friendlyChain = (chainOrNs: string | CHAIN | undefined): string => {
  if (!chainOrNs) return 'chain';
  const asString = String(chainOrNs);
  return Utils.chains.getChainName(asString) ?? asString;
};

/**
 * Shape of the `response` field emitted by `SEND_TX_104_04` (R1) and
 * `SEND_TX_204_04` (R2). Exported so consumers can read `isUserDecline`
 * without casting through `object`.
 */
export interface DeclineHookResponse {
  /** The underlying sign-time error message (decline copy when absent). */
  error: string;
  /** True if the error looks like a real wallet rejection. */
  isUserDecline: boolean;
}

/**
 * Classify a sign-time error as either a true wallet user-decline
 * (viem `UserRejectedRequestError`, ethers `ACTION_REJECTED`, EIP-1193 4001,
 * or textual "user rejected"/"user denied"/"declined by user") or a generic
 * signature failure (insufficient funds, RPC failure, contract revert
 * during sign, etc.). Shared by SEND_TX_104_04 (R1) and SEND_TX_204_04 (R2)
 * so the heuristic lives in one place.
 *
 * When `errorMessage` is omitted, treat it as a decline — the spec copy is
 * already the decline copy ("Verification declined by user"), so flipping
 * to "Signature Failed" would make the event self-contradict.
 */
export function classifyDeclineError(errorMessage?: string): {
  isUserDecline: boolean;
  title: string;
  message: string;
} {
  const msg = errorMessage ?? 'Verification declined by user';
  const isUserDecline =
    errorMessage === undefined ||
    /user\s*reject/i.test(msg) ||
    /user\s*denied/i.test(msg) ||
    /rejected\s*the\s*request/i.test(msg) ||
    /UserRejectedRequestError/i.test(msg) ||
    /ACTION_REJECTED/i.test(msg) ||
    /declined\s*by\s*user/i.test(msg) ||
    /\b4001\b/.test(msg);
  return {
    isUserDecline,
    title: isUserDecline ? 'Verification Declined' : 'Signature Failed',
    message: isUserDecline ? 'Verification declined by user' : msg,
  };
}

// =============================================================================
// Route 1 — UOA → Push Chain (101–199)
// =============================================================================

const RAW_HOOKS_R1: {
  [K in PROGRESS_HOOK_R1]: ProgressEventFunctionWithoutTimestamp;
} = {
  [PROGRESS_HOOK.SEND_TX_101]: (
    originChainNamespace: string,
    originChainAddress: string
  ) => ({
    id: PROGRESS_HOOK.SEND_TX_101,
    title: 'Origin Chain Detected',
    message: `Origin chain: ${friendlyChain(originChainNamespace)} — Address: ${originChainAddress}`,
    response: { chain: originChainNamespace, address: originChainAddress },
    level: 'INFO',
  }),
  [PROGRESS_HOOK.SEND_TX_102_01]: () => ({
    id: PROGRESS_HOOK.SEND_TX_102_01,
    title: 'Estimating Gas',
    message: 'Estimating and fetching gas limit, gas price for TX',
    response: { stage: 'estimating-gas' },
    level: 'INFO',
  }),
  [PROGRESS_HOOK.SEND_TX_102_02]: (executionCost: bigint) => ({
    id: PROGRESS_HOOK.SEND_TX_102_02,
    title: 'Gas Estimated',
    message: `Total execution cost: ${executionCost} UPC`,
    response: { totalCost: executionCost, currency: 'UPC' },
    level: 'SUCCESS',
  }),
  [PROGRESS_HOOK.SEND_TX_103_01]: () => ({
    id: PROGRESS_HOOK.SEND_TX_103_01,
    title: 'Resolving Universal Execution Account',
    message: 'Resolving UEA – computing address, checking deployment and balance',
    response: { stage: 'resolving-uea' },
    level: 'INFO',
  }),
  [PROGRESS_HOOK.SEND_TX_103_02]: (
    ueaAddress: `0x${string}`,
    deployed: boolean
  ) => ({
    id: PROGRESS_HOOK.SEND_TX_103_02,
    title: 'Universal Execution Account Resolved',
    message: `UEA: ${ueaAddress}, Deployed: ${deployed}`,
    response: { uea: ueaAddress, deployed },
    level: 'SUCCESS',
  }),
  [PROGRESS_HOOK.SEND_TX_104_01]: () => ({
    id: PROGRESS_HOOK.SEND_TX_104_01,
    title: 'Awaiting Transaction',
    message: 'Awaiting user transaction on origin chain',
    response: { stage: 'awaiting-transaction' },
    level: 'INFO',
  }),
  [PROGRESS_HOOK.SEND_TX_104_02]: () => ({
    id: PROGRESS_HOOK.SEND_TX_104_02,
    title: 'Awaiting Signature',
    message: 'Awaiting user signature for universal payload',
    response: { stage: 'awaiting-signature' },
    level: 'INFO',
  }),
  [PROGRESS_HOOK.SEND_TX_104_03]: () => ({
    id: PROGRESS_HOOK.SEND_TX_104_03,
    title: 'Verification Success',
    message: 'Verification completed via Transaction or Signature',
    response: { stage: 'verified' },
    level: 'SUCCESS',
  }),
  [PROGRESS_HOOK.SEND_TX_104_04]: (errorMessage?: string) => {
    const { isUserDecline, title, message } = classifyDeclineError(errorMessage);
    const response: DeclineHookResponse = {
      error: errorMessage ?? 'Verification declined by user',
      isUserDecline,
    };
    return {
      id: PROGRESS_HOOK.SEND_TX_104_04,
      title,
      message,
      response,
      level: 'ERROR',
    };
  },
  [PROGRESS_HOOK.SEND_TX_105_01]: (
    originChainTxHash: string,
    originChainTx?: OriginChainTx
  ) => ({
    id: PROGRESS_HOOK.SEND_TX_105_01,
    title: 'Gas Funding In Progress',
    message: `Gas funding tx sent: ${originChainTxHash}`,
    response: { txHash: originChainTxHash, originChainTx: originChainTx ?? null },
    level: 'INFO',
  }),
  [PROGRESS_HOOK.SEND_TX_105_02]: (txHash?: string) => ({
    id: PROGRESS_HOOK.SEND_TX_105_02,
    title: 'Gas Funding Confirmed',
    message: 'Gas funding confirmed on origin chain',
    response: { stage: 'gas-funded', txHash: txHash ?? null },
    level: 'SUCCESS',
  }),
  [PROGRESS_HOOK.SEND_TX_106_01]: (
    amount: bigint,
    decimals: number,
    symbol: string
  ) => ({
    id: PROGRESS_HOOK.SEND_TX_106_01,
    title: 'Preparing Funds Transfer',
    message: `Preparing to move ${Utils.helpers.formatUnits(amount, decimals)} ${symbol} from origin chain`,
    response: { amount, symbol },
    level: 'INFO',
  }),
  [PROGRESS_HOOK.SEND_TX_106_02]: (
    txHash: string,
    amount: bigint,
    decimals: number,
    symbol: string,
    originChainTx?: OriginChainTx
  ) => ({
    id: PROGRESS_HOOK.SEND_TX_106_02,
    title: 'Funds Lock Submitted',
    message: `Locking ${Utils.helpers.formatUnits(amount, decimals)} ${symbol} — Tx: ${txHash}`,
    response: {
      txHash,
      amount,
      symbol,
      originChainTx: originChainTx ?? null,
    },
    level: 'INFO',
  }),
  [PROGRESS_HOOK.SEND_TX_106_03]: (required: number) => ({
    id: PROGRESS_HOOK.SEND_TX_106_03,
    title: 'Awaiting Confirmations',
    message: `Waiting for ${required} confirmations`,
    response: { current: 0, required },
    level: 'INFO',
  }),
  [PROGRESS_HOOK.SEND_TX_106_03_01]: (current: number, required: number) => ({
    id: PROGRESS_HOOK.SEND_TX_106_03_01,
    title: `Confirmation ${current}/${required} Received`,
    message: `${current}/${required} confirmations received`,
    response: { current, required },
    level: 'INFO',
  }),
  [PROGRESS_HOOK.SEND_TX_106_03_02]: (current: number, required: number) => ({
    id: PROGRESS_HOOK.SEND_TX_106_03_02,
    title: `Confirmation ${current}/${required} Received`,
    message: `${current}/${required} confirmations received`,
    response: { current, required },
    level: 'SUCCESS',
  }),
  [PROGRESS_HOOK.SEND_TX_106_04]: (txHash?: string) => ({
    id: PROGRESS_HOOK.SEND_TX_106_04,
    title: 'Funds Confirmed',
    message: 'Origin chain lock confirmed',
    response: { stage: 'funds-confirmed', txHash: txHash ?? null },
    level: 'SUCCESS',
  }),
  [PROGRESS_HOOK.SEND_TX_106_05]: () => ({
    id: PROGRESS_HOOK.SEND_TX_106_05,
    title: 'Syncing with Push Chain',
    message: 'Waiting for transaction to appear on Push Chain',
    response: { stage: 'syncing-push-chain' },
    level: 'INFO',
  }),
  [PROGRESS_HOOK.SEND_TX_106_06]: (
    amount: bigint,
    decimals: number,
    symbol: string
  ) => ({
    id: PROGRESS_HOOK.SEND_TX_106_06,
    title: 'Funds Credited on Push Chain',
    message: `Funds credited: ${Utils.helpers.formatUnits(amount, decimals)} ${symbol}`,
    response: { amount, symbol },
    level: 'SUCCESS',
  }),
  [PROGRESS_HOOK.SEND_TX_106_07_01]: (
    originChain: string | CHAIN,
    pushGasUsd: bigint,
    paddedDepositUsd: bigint
  ) => ({
    id: PROGRESS_HOOK.SEND_TX_106_07_01,
    title: `${friendlyChain(originChain)} Push Gas Sizing: Case A`,
    message: `Push-chain gas < $1; padding deposit to $1 floor (pushGasUsd=${pushGasUsd}, paddedDepositUsd=${paddedDepositUsd})`,
    response: { category: 'A', pushGasUsd, paddedDepositUsd, chain: originChain },
    level: 'INFO',
  }),
  [PROGRESS_HOOK.SEND_TX_106_07_02]: (
    originChain: string | CHAIN,
    pushGasUsd: bigint,
    paddedDepositUsd: bigint
  ) => ({
    id: PROGRESS_HOOK.SEND_TX_106_07_02,
    title: `${friendlyChain(originChain)} Push Gas Sizing: Case B`,
    message: `Push-chain gas within $1–$10; happy path (pushGasUsd=${pushGasUsd}, paddedDepositUsd=${paddedDepositUsd})`,
    response: { category: 'B', pushGasUsd, paddedDepositUsd, chain: originChain },
    level: 'INFO',
  }),
  [PROGRESS_HOOK.SEND_TX_106_07_03]: (
    originChain: string | CHAIN,
    pushGasUsd: bigint,
    paddedDepositUsd: bigint
  ) => ({
    id: PROGRESS_HOOK.SEND_TX_106_07_03,
    title: `${friendlyChain(originChain)} Push Gas Sizing: Case C`,
    message: `Push-chain gas > $10; deposit passes through to origin gateway MAX_CAP_UNIVERSAL_TX_USD (pushGasUsd=${pushGasUsd}, paddedDepositUsd=${paddedDepositUsd})`,
    response: { category: 'C', pushGasUsd, paddedDepositUsd, chain: originChain },
    level: 'INFO',
  }),
  [PROGRESS_HOOK.SEND_TX_107]: () => ({
    id: PROGRESS_HOOK.SEND_TX_107,
    title: 'Broadcasting to Push Chain',
    message: 'Sending tx to Push Chain...',
    response: { stage: 'broadcasting', destination: 'push-chain' },
    level: 'INFO',
  }),
  [PROGRESS_HOOK.SEND_TX_199_01]: (
    txResponse: UniversalTxResponse[],
    receipt?: UniversalTxReceipt
  ) => {
    const first = Array.isArray(txResponse) ? txResponse[0] : undefined;
    const txHash = first?.hash ?? '';
    return {
      id: PROGRESS_HOOK.SEND_TX_199_01,
      title: 'Push Chain Tx Success',
      message: `Tx confirmed: ${txHash}`,
      response: { txHash, response: txResponse, receipt: receipt ?? null },
      level: 'SUCCESS',
    };
  },
  [PROGRESS_HOOK.SEND_TX_199_02]: (errMessage: string) => ({
    id: PROGRESS_HOOK.SEND_TX_199_02,
    title: 'Push Chain Tx Failed',
    message: errMessage,
    response: { error: errMessage },
    level: 'ERROR',
  }),
};

// =============================================================================
// Route 2 — UEA → UGPC → CEA on target chain (201–299, signature-only)
// =============================================================================

const RAW_HOOKS_R2: {
  [K in PROGRESS_HOOK_R2]: ProgressEventFunctionWithoutTimestamp;
} = {
  [PROGRESS_HOOK.SEND_TX_201]: (
    targetChain: string | CHAIN,
    targetAddress: string
  ) => ({
    id: PROGRESS_HOOK.SEND_TX_201,
    title: `${friendlyChain(targetChain)} Detected`,
    message: `External chain: ${targetChain} — Target address: ${targetAddress}`,
    response: { chain: targetChain, address: targetAddress },
    level: 'INFO',
  }),
  [PROGRESS_HOOK.SEND_TX_202_01]: (targetChain: string | CHAIN) => ({
    id: PROGRESS_HOOK.SEND_TX_202_01,
    title: `Estimating ${friendlyChain(targetChain)} Chain Gas`,
    message: 'Querying Push Chain gas and UGPC relay fee',
    response: { stage: 'estimating-gas', chain: targetChain },
    level: 'INFO',
  }),
  [PROGRESS_HOOK.SEND_TX_202_02]: (
    targetChain: string | CHAIN,
    pushGas: bigint,
    relayFee: bigint
  ) => ({
    id: PROGRESS_HOOK.SEND_TX_202_02,
    title: `${friendlyChain(targetChain)} Chain Gas Estimated`,
    message: `Push gas: ${pushGas} UPC + UGPC relay: ${relayFee} UPC = ${pushGas + relayFee} UPC`,
    response: {
      gasEstimate: pushGas,
      relayFee,
      totalCost: pushGas + relayFee,
      currency: 'UPC',
    },
    level: 'SUCCESS',
  }),
  [PROGRESS_HOOK.SEND_TX_203_01]: (targetChain: string | CHAIN) => ({
    id: PROGRESS_HOOK.SEND_TX_203_01,
    title: `Resolving ${friendlyChain(targetChain)} Execution Account`,
    message: `Resolving UEA on Push Chain and CEA on ${targetChain}`,
    response: { stage: 'resolving-cea', chain: targetChain },
    level: 'INFO',
  }),
  [PROGRESS_HOOK.SEND_TX_203_02]: (
    ueaAddr: `0x${string}`,
    ceaAddr: string,
    targetChain: string | CHAIN,
    deployed: boolean
  ) => ({
    id: PROGRESS_HOOK.SEND_TX_203_02,
    title: `${friendlyChain(targetChain)} Execution Account Ready`,
    message: `UEA: ${ueaAddr}. CEA: ${ceaAddr} on ${targetChain}. Deployed: ${deployed}`,
    response: { uea: ueaAddr, cea: ceaAddr, chain: targetChain, deployed },
    level: 'SUCCESS',
  }),
  [PROGRESS_HOOK.SEND_TX_204_01]: () => ({
    id: PROGRESS_HOOK.SEND_TX_204_01,
    title: 'Awaiting Signature',
    message: 'Awaiting user signature for universal payload',
    response: { stage: 'awaiting-signature' },
    level: 'INFO',
  }),
  [PROGRESS_HOOK.SEND_TX_204_02]: () => ({
    id: PROGRESS_HOOK.SEND_TX_204_02,
    title: 'Signature Received',
    message: 'Universal payload signed — preparing broadcast',
    response: { stage: 'signed' },
    level: 'SUCCESS',
  }),
  [PROGRESS_HOOK.SEND_TX_204_03]: () => ({
    id: PROGRESS_HOOK.SEND_TX_204_03,
    title: 'Verification Success',
    message: 'Verification completed',
    response: { stage: 'verified' },
    level: 'SUCCESS',
  }),
  [PROGRESS_HOOK.SEND_TX_204_04]: (errorMessage?: string) => {
    const { isUserDecline, title, message } = classifyDeclineError(errorMessage);
    const response: DeclineHookResponse = {
      error: errorMessage ?? 'Verification declined by user',
      isUserDecline,
    };
    return {
      id: PROGRESS_HOOK.SEND_TX_204_04,
      title,
      message,
      response,
      level: 'ERROR',
    };
  },
  [PROGRESS_HOOK.SEND_TX_207]: (targetChain: string | CHAIN) => ({
    id: PROGRESS_HOOK.SEND_TX_207,
    title: `Broadcasting from Push Chain → ${friendlyChain(targetChain)}`,
    message: 'Sending tx to Push Chain...',
    response: { chain: targetChain },
    level: 'INFO',
  }),
  [PROGRESS_HOOK.SEND_TX_209_01]: (targetChain: string | CHAIN) => ({
    id: PROGRESS_HOOK.SEND_TX_209_01,
    title: 'Awaiting Push Chain Relay',
    message: `Waiting for UGPC to relay execution to ${targetChain}`,
    response: { chain: targetChain },
    level: 'INFO',
  }),
  [PROGRESS_HOOK.SEND_TX_209_02]: (
    targetChain: string | CHAIN,
    elapsedMs: number
  ) => ({
    id: PROGRESS_HOOK.SEND_TX_209_02,
    title: `Syncing State with ${friendlyChain(targetChain)}`,
    message: `Polling ${targetChain} for CEA execution`,
    response: { chain: targetChain, elapsedMs },
    level: 'INFO',
  }),
  [PROGRESS_HOOK.SEND_TX_299_01]: (details: OutboundTxDetails) => ({
    id: PROGRESS_HOOK.SEND_TX_299_01,
    title: `${friendlyChain(details.destinationChain)} Tx Success`,
    message: `CEA executed on ${details.destinationChain} - tx: ${details.externalTxHash}`,
    response: { txHash: details.externalTxHash, ...details },
    level: 'SUCCESS',
  }),
  [PROGRESS_HOOK.SEND_TX_299_02]: (
    targetChain: string | CHAIN,
    errorMessage: string
  ) => ({
    id: PROGRESS_HOOK.SEND_TX_299_02,
    title: `${friendlyChain(targetChain)} Tx Failed`,
    message: errorMessage,
    response: { error: errorMessage, chain: targetChain },
    level: 'ERROR',
  }),
  [PROGRESS_HOOK.SEND_TX_299_03]: (
    targetChain: string | CHAIN,
    elapsedMs: number
  ) => ({
    id: PROGRESS_HOOK.SEND_TX_299_03,
    title: `Syncing State with ${friendlyChain(targetChain)} Timeout`,
    message: `Timed out waiting for UGPC relay to ${targetChain}`,
    response: { error: 'relay timeout', chain: targetChain, elapsedMs },
    level: 'ERROR',
  }),
  [PROGRESS_HOOK.SEND_TX_299_99]: (
    targetChain: string | CHAIN,
    txHash: string
  ) => ({
    id: PROGRESS_HOOK.SEND_TX_299_99,
    title: `${friendlyChain(targetChain)} Tx Completed`,
    message: `Intermediate ${friendlyChain(targetChain)} tx confirmed: ${txHash}, progressing to next phase`,
    response: { chain: targetChain, txHash },
    level: 'INFO',
  }),
};

// =============================================================================
// Route 3 — UEA → UGPC → CEA → sendUniversalTxToUEA → Push Chain (301–399)
// =============================================================================

const RAW_HOOKS_R3: {
  [K in PROGRESS_HOOK_R3]: ProgressEventFunctionWithoutTimestamp;
} = {
  [PROGRESS_HOOK.SEND_TX_199_99_99]: (txHash: string) => ({
    id: PROGRESS_HOOK.SEND_TX_199_99_99,
    title: 'Push Chain TX Completed',
    message: `Intermediate Push Chain tx confirmed: ${txHash}, progressing to next phase`,
    response: { txHash },
    level: 'INFO',
  }),
  [PROGRESS_HOOK.SEND_TX_301]: (
    sourceChain: string | CHAIN,
    ceaAddress: string
  ) => ({
    id: PROGRESS_HOOK.SEND_TX_301,
    title: `${friendlyChain(sourceChain)}'s Executor Account Detected`,
    message: `Source chain: ${sourceChain} — CEA: ${ceaAddress}`,
    response: { chain: sourceChain, address: ceaAddress },
    level: 'INFO',
  }),
  [PROGRESS_HOOK.SEND_TX_302_01]: (sourceChain: string | CHAIN) => ({
    id: PROGRESS_HOOK.SEND_TX_302_01,
    title: `Estimating ${friendlyChain(sourceChain)} Gas`,
    message: 'Querying Push Chain gas and UGPC relay fee',
    response: { stage: 'estimating-gas', chain: sourceChain },
    level: 'INFO',
  }),
  [PROGRESS_HOOK.SEND_TX_302_02]: (
    sourceChain: string | CHAIN,
    pushGas: bigint,
    relayFee: bigint
  ) => ({
    id: PROGRESS_HOOK.SEND_TX_302_02,
    title: `${friendlyChain(sourceChain)} Gas Estimated`,
    message: `Push gas: ${pushGas} UPC + UGPC relay: ${relayFee} UPC = ${pushGas + relayFee} UPC`,
    response: {
      gasEstimate: pushGas,
      relayFee,
      totalCost: pushGas + relayFee,
      currency: 'UPC',
    },
    level: 'SUCCESS',
  }),
  [PROGRESS_HOOK.SEND_TX_302_03_01]: (
    sourceChain: string | CHAIN,
    gasUsd: bigint,
    gasLegNativePc: bigint
  ) => ({
    id: PROGRESS_HOOK.SEND_TX_302_03_01,
    title: `${friendlyChain(sourceChain)} Gas Sizing: Case A`,
    message: `Gas cost < $1; padding to $1 minimum (gasUsd=${gasUsd}, gasLeg=${gasLegNativePc} UPC)`,
    response: { category: 'A', gasUsd, gasLegNativePc, chain: sourceChain },
    level: 'INFO',
  }),
  [PROGRESS_HOOK.SEND_TX_302_03_02]: (
    sourceChain: string | CHAIN,
    gasUsd: bigint,
    gasLegNativePc: bigint
  ) => ({
    id: PROGRESS_HOOK.SEND_TX_302_03_02,
    title: `${friendlyChain(sourceChain)} Gas Sizing: Case B`,
    message: `Gas cost within $1–$10 window; happy path (gasUsd=${gasUsd}, gasLeg=${gasLegNativePc} UPC)`,
    response: { category: 'B', gasUsd, gasLegNativePc, chain: sourceChain },
    level: 'INFO',
  }),
  [PROGRESS_HOOK.SEND_TX_302_03_03]: (
    sourceChain: string | CHAIN,
    gasUsd: bigint,
    gasLegNativePc: bigint,
    overflowNativePc: bigint
  ) => ({
    id: PROGRESS_HOOK.SEND_TX_302_03_03,
    title: `${friendlyChain(sourceChain)} Gas Sizing: Case C`,
    message: `Gas cost > $10; splitting into $10 gas leg + ${overflowNativePc} UPC overflow bridged as funds`,
    response: {
      category: 'C',
      gasUsd,
      gasLegNativePc,
      overflowNativePc,
      chain: sourceChain,
    },
    level: 'INFO',
  }),
  [PROGRESS_HOOK.SEND_TX_303_01]: (sourceChain: string | CHAIN) => ({
    id: PROGRESS_HOOK.SEND_TX_303_01,
    title: 'Resolving Execution Accounts on Chains',
    message: `Resolving UEA on Push Chain and CEA on ${sourceChain}`,
    response: { stage: 'resolving-cea-uea', chain: sourceChain },
    level: 'INFO',
  }),
  [PROGRESS_HOOK.SEND_TX_303_02]: (
    ueaAddr: `0x${string}`,
    ceaAddr: string,
    sourceChain: string | CHAIN
  ) => ({
    id: PROGRESS_HOOK.SEND_TX_303_02,
    title: 'Execution Accounts Resolved',
    message: `UEA: ${ueaAddr}. CEA: ${ceaAddr} on ${sourceChain}. Deployed: true`,
    response: { uea: ueaAddr, cea: ceaAddr, chain: sourceChain, deployed: true },
    level: 'SUCCESS',
  }),
  [PROGRESS_HOOK.SEND_TX_304_01]: () => ({
    id: PROGRESS_HOOK.SEND_TX_304_01,
    title: 'Awaiting Signature',
    message: 'Awaiting user signature for universal payload',
    response: { stage: 'awaiting-signature' },
    level: 'INFO',
  }),
  [PROGRESS_HOOK.SEND_TX_304_02]: () => ({
    id: PROGRESS_HOOK.SEND_TX_304_02,
    title: 'Signature Received',
    message: 'Universal payload signed — preparing broadcast',
    response: { stage: 'signed' },
    level: 'SUCCESS',
  }),
  [PROGRESS_HOOK.SEND_TX_304_03]: () => ({
    id: PROGRESS_HOOK.SEND_TX_304_03,
    title: 'Verification Success',
    message: 'Verification completed',
    response: { stage: 'verified' },
    level: 'SUCCESS',
  }),
  [PROGRESS_HOOK.SEND_TX_304_04]: (errorMessage?: string) => ({
    id: PROGRESS_HOOK.SEND_TX_304_04,
    title: 'Verification Declined',
    message: 'Verification declined by user',
    response: { error: errorMessage ?? 'Verification declined by user' },
    level: 'ERROR',
  }),
  [PROGRESS_HOOK.SEND_TX_307]: (sourceChain: string | CHAIN) => ({
    id: PROGRESS_HOOK.SEND_TX_307,
    title: `Broadcasting from Push Chain → ${friendlyChain(sourceChain)}`,
    message: 'Sending tx from Push Chain...',
    response: { chain: sourceChain },
    level: 'INFO',
  }),
  [PROGRESS_HOOK.SEND_TX_309_01]: (sourceChain: string | CHAIN) => ({
    id: PROGRESS_HOOK.SEND_TX_309_01,
    title: `Awaiting ${friendlyChain(sourceChain)} Relay`,
    message: `Waiting for UGPC to relay to CEA on ${sourceChain}`,
    response: { chain: sourceChain },
    level: 'INFO',
  }),
  [PROGRESS_HOOK.SEND_TX_309_02]: (
    sourceChain: string | CHAIN,
    elapsedMs: number
  ) => ({
    id: PROGRESS_HOOK.SEND_TX_309_02,
    title: `Syncing State with ${friendlyChain(sourceChain)}`,
    message: `Polling ${sourceChain} for CEA execution`,
    response: { chain: sourceChain, elapsedMs },
    level: 'INFO',
  }),
  [PROGRESS_HOOK.SEND_TX_309_03]: (
    sourceChain: string | CHAIN,
    txHash: string
  ) => ({
    id: PROGRESS_HOOK.SEND_TX_309_03,
    title: `${friendlyChain(sourceChain)} Tx Confirmed`,
    message: `CEA executed on ${sourceChain}: ${txHash} — return inbound initiated`,
    response: { chain: sourceChain, txHash },
    level: 'INFO',
  }),
  [PROGRESS_HOOK.SEND_TX_310_01]: (sourceChain: string | CHAIN) => ({
    id: PROGRESS_HOOK.SEND_TX_310_01,
    title: `${friendlyChain(sourceChain)} → Push Chain Inbound Tx Submitted`,
    message: `CEA initiated return — waiting for Push Chain inbound from ${sourceChain}`,
    response: { chain: sourceChain },
    level: 'INFO',
  }),
  [PROGRESS_HOOK.SEND_TX_310_02]: (
    sourceChain: string | CHAIN,
    elapsedMs: number
  ) => ({
    id: PROGRESS_HOOK.SEND_TX_310_02,
    title: 'Syncing State with Push Chain for Inbound Tx',
    message: `Polling Push Chain for inbound from ${sourceChain}`,
    response: { chain: sourceChain, elapsedMs },
    level: 'INFO',
  }),
  [PROGRESS_HOOK.SEND_TX_399_01]: (
    sourceChain: string | CHAIN,
    txHash: string,
    receipt?: UniversalTxReceipt
  ) => ({
    id: PROGRESS_HOOK.SEND_TX_399_01,
    title: 'Push Chain Inbound Tx Success',
    message: `Inbound from ${sourceChain} confirmed · Push tx: ${txHash}`,
    response: { chain: sourceChain, txHash, receipt: receipt ?? null },
    level: 'SUCCESS',
  }),
  [PROGRESS_HOOK.SEND_TX_399_02]: (errorMessage: string) => ({
    id: PROGRESS_HOOK.SEND_TX_399_02,
    title: 'Push Chain Inbound Tx Failed',
    message: errorMessage,
    response: { error: errorMessage },
    level: 'ERROR',
  }),
  [PROGRESS_HOOK.SEND_TX_399_03]: (
    sourceChain: string | CHAIN,
    elapsedMs: number
  ) => ({
    id: PROGRESS_HOOK.SEND_TX_399_03,
    title: 'Push Chain Inbound Timeout',
    message: `Timed out waiting for inbound from ${sourceChain}`,
    response: { error: 'inbound timeout', chain: sourceChain, elapsedMs },
    level: 'ERROR',
  }),
};

// =============================================================================
// UEA Migration hooks (unchanged)
// =============================================================================

const RAW_HOOKS_MIG: {
  [K in PROGRESS_HOOK_MIG]: ProgressEventFunctionWithoutTimestamp;
} = {
  [PROGRESS_HOOK.UEA_MIG_01]: () => ({
    id: PROGRESS_HOOK.UEA_MIG_01,
    title: 'Checking UEA',
    message: 'Checking status for migration.',
    response: null,
    level: 'INFO',
  }),
  [PROGRESS_HOOK.UEA_MIG_02]: () => ({
    id: PROGRESS_HOOK.UEA_MIG_02,
    title: 'Awaiting Migration Signature',
    message: 'Awaiting wallet signature for upgrading account.',
    response: null,
    level: 'INFO',
  }),
  [PROGRESS_HOOK.UEA_MIG_03]: () => ({
    id: PROGRESS_HOOK.UEA_MIG_03,
    title: 'Broadcasting Migration TX',
    message: 'Broadcasting upgrade transaction to Push Chain...',
    response: null,
    level: 'INFO',
  }),
  [PROGRESS_HOOK.UEA_MIG_9901]: (newVersion: string) => ({
    id: PROGRESS_HOOK.UEA_MIG_9901,
    title: 'UEA Migration Successful',
    message: `UEA migration is successful. UEA is now version ${newVersion}.`,
    response: { version: newVersion },
    level: 'SUCCESS',
  }),
  [PROGRESS_HOOK.UEA_MIG_9902]: () => ({
    id: PROGRESS_HOOK.UEA_MIG_9902,
    title: 'UEA Migration Failed',
    message: 'UEA migration failed. Check transaction on explorer.',
    response: { error: 'UEA migration failed' },
    level: 'ERROR',
  }),
  [PROGRESS_HOOK.UEA_MIG_9903]: () => ({
    id: PROGRESS_HOOK.UEA_MIG_9903,
    title: 'UEA Migration Skipped',
    message: 'UEA migration skipped.',
    response: null,
    level: 'INFO',
  }),
};

// =============================================================================
// Multichain (multi-hop) cascade markers (001 / 002 / 999)
// =============================================================================

const RAW_HOOKS_MULTICHAIN: {
  [K in PROGRESS_HOOK_MULTICHAIN]: ProgressEventFunctionWithoutTimestamp;
} = {
  [PROGRESS_HOOK.SEND_TX_001]: (hopCount: number, chains: string[]) => ({
    id: PROGRESS_HOOK.SEND_TX_001,
    title: 'Multichain Transactions Initiated',
    message: `${hopCount}-hop transaction — ${chains.map(friendlyChain).join(' → ')}`,
    response: { hopCount, chains },
    level: 'INFO',
  }),
  [PROGRESS_HOOK.SEND_TX_002_01]: (
    n: number,
    total: number,
    fromChain: string,
    toChain: string
  ) => ({
    id: PROGRESS_HOOK.SEND_TX_002_01,
    title: `Starting Intermediate Transaction #${n}/${total}`,
    message: `Starting tx ${n} of ${total}: ${friendlyChain(fromChain)} → ${friendlyChain(toChain)}`,
    response: { n, total, fromChain, toChain },
    level: 'INFO',
  }),
  [PROGRESS_HOOK.SEND_TX_002_99_99]: (n: number, total: number) => ({
    id: PROGRESS_HOOK.SEND_TX_002_99_99,
    title: `Intermediate Transaction #${n}/${total} Complete`,
    message: `Tx ${n} of ${total} confirmed — proceeding to tx ${n + 1}`,
    response: { n, total },
    level: 'INFO',
  }),
  [PROGRESS_HOOK.SEND_TX_999_01]: (hopCount: number) => ({
    id: PROGRESS_HOOK.SEND_TX_999_01,
    title: 'All Multichain Transactions Successful',
    message: `${hopCount}-hop transaction confirmed across all chains`,
    response: { hopCount },
    level: 'SUCCESS',
  }),
  [PROGRESS_HOOK.SEND_TX_999_02]: (
    failedAt: number,
    total: number,
    errorMessage: string
  ) => ({
    id: PROGRESS_HOOK.SEND_TX_999_02,
    title: 'Multichain Transactions Failed',
    message: `Cascade failed at hop ${failedAt} of ${total}: ${errorMessage}`,
    response: { failedAt, total, error: errorMessage },
    level: 'ERROR',
  }),
  [PROGRESS_HOOK.SEND_TX_999_03]: (failedAt: number, total: number) => ({
    id: PROGRESS_HOOK.SEND_TX_999_03,
    title: 'Multichain Transactions Timeout',
    message: `Cascade timed out at hop ${failedAt} of ${total}`,
    response: { failedAt, total, error: 'cascade timeout' },
    level: 'ERROR',
  }),
};

// Combine all routes into the master record
const RAW_HOOKS: {
  [K in PROGRESS_HOOK]: ProgressEventFunctionWithoutTimestamp;
} = {
  ...RAW_HOOKS_R1,
  ...RAW_HOOKS_R2,
  ...RAW_HOOKS_R3,
  ...RAW_HOOKS_MULTICHAIN,
  ...RAW_HOOKS_MIG,
};

// Build final hooks with timestamp injection
const PROGRESS_HOOKS: Record<string, ProgressEventFunction> =
  Object.fromEntries(
    Object.entries(RAW_HOOKS).map(([key, value]) => [key, withTimestamp(value)])
  );

export default PROGRESS_HOOKS;

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
  // Always a structured object (or null). Never a string — txHash and other
  // values are exposed as `response.txHash`, etc., so consumers can read them
  // programmatically instead of parsing the message string.
  response: object | null;
  timestamp: string; // ISO-8601, e.g. "2025-06-26T15:04:05.000Z"
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ProgressEventFunction = (...args: any[]) => ProgressEvent;

export type ProgressEventFunctionWithoutTimestamp = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ...args: any[]
) => Omit<ProgressEvent, 'timestamp'>;

export enum PROGRESS_HOOK {
  // Route 1: UOA → Push Chain (101–199)
  SEND_TX_101 = 'SEND-TX-101',
  SEND_TX_102_01 = 'SEND-TX-102-01',
  SEND_TX_102_02 = 'SEND-TX-102-02',
  SEND_TX_103_01 = 'SEND-TX-103-01',
  SEND_TX_103_02 = 'SEND-TX-103-02',
  SEND_TX_104_01 = 'SEND-TX-104-01', // fee-lock path only
  SEND_TX_104_02 = 'SEND-TX-104-02', // signature path only
  SEND_TX_104_03 = 'SEND-TX-104-03',
  SEND_TX_104_04 = 'SEND-TX-104-04',
  SEND_TX_105_01 = 'SEND-TX-105-01',
  SEND_TX_105_02 = 'SEND-TX-105-02',
  SEND_TX_106_01 = 'SEND-TX-106-01',
  SEND_TX_106_02 = 'SEND-TX-106-02',
  SEND_TX_106_03 = 'SEND-TX-106-03',
  SEND_TX_106_03_01 = 'SEND-TX-106-03-01',
  SEND_TX_106_03_02 = 'SEND-TX-106-03-02',
  SEND_TX_106_04 = 'SEND-TX-106-04',
  SEND_TX_106_05 = 'SEND-TX-106-05',
  SEND_TX_106_06 = 'SEND-TX-106-06',
  SEND_TX_106_07_01 = 'SEND-TX-106-07-01', // R1 Sizer: Case A (push-gas < $1, padded to $1 floor)
  SEND_TX_106_07_02 = 'SEND-TX-106-07-02', // R1 Sizer: Case B (push-gas $1–$10, pass-through)
  SEND_TX_106_07_03 = 'SEND-TX-106-07-03', // R1 Sizer: Case C (push-gas > $10, pass-through to contract cap)
  SEND_TX_107 = 'SEND-TX-107',
  SEND_TX_199_01 = 'SEND-TX-199-01', // R1 terminal Push success
  SEND_TX_199_02 = 'SEND-TX-199-02', // R1 terminal Push failure
  SEND_TX_199_99_99 = 'SEND-TX-199-99-99', // R3 intermediate Push success

  // Route 2: UEA → UGPC → CEA on target chain (201–299)
  SEND_TX_201 = 'SEND-TX-201',
  SEND_TX_202_01 = 'SEND-TX-202-01',
  SEND_TX_202_02 = 'SEND-TX-202-02',
  SEND_TX_203_01 = 'SEND-TX-203-01',
  SEND_TX_203_02 = 'SEND-TX-203-02',
  SEND_TX_204_01 = 'SEND-TX-204-01',
  SEND_TX_204_02 = 'SEND-TX-204-02',
  SEND_TX_204_03 = 'SEND-TX-204-03',
  SEND_TX_204_04 = 'SEND-TX-204-04',
  SEND_TX_207 = 'SEND-TX-207',
  SEND_TX_209_01 = 'SEND-TX-209-01',
  SEND_TX_209_02 = 'SEND-TX-209-02',
  SEND_TX_299_01 = 'SEND-TX-299-01', // R2 terminal external success
  SEND_TX_299_02 = 'SEND-TX-299-02',
  SEND_TX_299_03 = 'SEND-TX-299-03',
  SEND_TX_299_99 = 'SEND-TX-299-99', // R2 intermediate Push success

  // Route 3: UEA → UGPC → CEA → sendUniversalTxToUEA → Push Chain (301–399)
  SEND_TX_301 = 'SEND-TX-301',
  SEND_TX_302_01 = 'SEND-TX-302-01',
  SEND_TX_302_02 = 'SEND-TX-302-02',
  SEND_TX_302_03_01 = 'SEND-TX-302-03-01', // Sizer: Case A (< $1, padded)
  SEND_TX_302_03_02 = 'SEND-TX-302-03-02', // Sizer: Case B ($1–$10, happy path)
  SEND_TX_302_03_03 = 'SEND-TX-302-03-03', // Sizer: Case C (> $10, split + overflow bridge)
  SEND_TX_303_01 = 'SEND-TX-303-01',
  SEND_TX_303_02 = 'SEND-TX-303-02',
  SEND_TX_304_01 = 'SEND-TX-304-01',
  SEND_TX_304_02 = 'SEND-TX-304-02',
  SEND_TX_304_03 = 'SEND-TX-304-03',
  SEND_TX_304_04 = 'SEND-TX-304-04',
  SEND_TX_307 = 'SEND-TX-307',
  SEND_TX_309_01 = 'SEND-TX-309-01',
  SEND_TX_309_02 = 'SEND-TX-309-02',
  SEND_TX_309_03 = 'SEND-TX-309-03',
  SEND_TX_310_01 = 'SEND-TX-310-01',
  SEND_TX_310_02 = 'SEND-TX-310-02',
  SEND_TX_399_01 = 'SEND-TX-399-01',
  SEND_TX_399_02 = 'SEND-TX-399-02',
  SEND_TX_399_03 = 'SEND-TX-399-03',

  // Multichain (multi-hop) cascade markers
  SEND_TX_001 = 'SEND-TX-001',
  SEND_TX_002_01 = 'SEND-TX-002-01',
  SEND_TX_002_99_99 = 'SEND-TX-002-99-99',
  SEND_TX_999_01 = 'SEND-TX-999-01',
  SEND_TX_999_02 = 'SEND-TX-999-02',
  SEND_TX_999_03 = 'SEND-TX-999-03',

  // UEA Migration hooks (unchanged)
  UEA_MIG_01 = 'UEA-MIG-01',
  UEA_MIG_02 = 'UEA-MIG-02',
  UEA_MIG_03 = 'UEA-MIG-03',
  UEA_MIG_9901 = 'UEA-MIG-9901',
  UEA_MIG_9902 = 'UEA-MIG-9902',
  UEA_MIG_9903 = 'UEA-MIG-9903',
}

// Route-scoped TYPE aliases — compile-time narrowing for new emission code.
// Use these when authoring per-route helpers so the wrong-route ID becomes
// a type error.
export type PROGRESS_HOOK_R1 =
  | PROGRESS_HOOK.SEND_TX_101
  | PROGRESS_HOOK.SEND_TX_102_01
  | PROGRESS_HOOK.SEND_TX_102_02
  | PROGRESS_HOOK.SEND_TX_103_01
  | PROGRESS_HOOK.SEND_TX_103_02
  | PROGRESS_HOOK.SEND_TX_104_01
  | PROGRESS_HOOK.SEND_TX_104_02
  | PROGRESS_HOOK.SEND_TX_104_03
  | PROGRESS_HOOK.SEND_TX_104_04
  | PROGRESS_HOOK.SEND_TX_105_01
  | PROGRESS_HOOK.SEND_TX_105_02
  | PROGRESS_HOOK.SEND_TX_106_01
  | PROGRESS_HOOK.SEND_TX_106_02
  | PROGRESS_HOOK.SEND_TX_106_03
  | PROGRESS_HOOK.SEND_TX_106_03_01
  | PROGRESS_HOOK.SEND_TX_106_03_02
  | PROGRESS_HOOK.SEND_TX_106_04
  | PROGRESS_HOOK.SEND_TX_106_05
  | PROGRESS_HOOK.SEND_TX_106_06
  | PROGRESS_HOOK.SEND_TX_106_07_01
  | PROGRESS_HOOK.SEND_TX_106_07_02
  | PROGRESS_HOOK.SEND_TX_106_07_03
  | PROGRESS_HOOK.SEND_TX_107
  | PROGRESS_HOOK.SEND_TX_199_01
  | PROGRESS_HOOK.SEND_TX_199_02;

export type PROGRESS_HOOK_R2 =
  | PROGRESS_HOOK.SEND_TX_201
  | PROGRESS_HOOK.SEND_TX_202_01
  | PROGRESS_HOOK.SEND_TX_202_02
  | PROGRESS_HOOK.SEND_TX_203_01
  | PROGRESS_HOOK.SEND_TX_203_02
  | PROGRESS_HOOK.SEND_TX_204_01
  | PROGRESS_HOOK.SEND_TX_204_02
  | PROGRESS_HOOK.SEND_TX_204_03
  | PROGRESS_HOOK.SEND_TX_204_04
  | PROGRESS_HOOK.SEND_TX_207
  | PROGRESS_HOOK.SEND_TX_209_01
  | PROGRESS_HOOK.SEND_TX_209_02
  | PROGRESS_HOOK.SEND_TX_299_01
  | PROGRESS_HOOK.SEND_TX_299_02
  | PROGRESS_HOOK.SEND_TX_299_03
  | PROGRESS_HOOK.SEND_TX_299_99;

export type PROGRESS_HOOK_R3 =
  | PROGRESS_HOOK.SEND_TX_199_99_99
  | PROGRESS_HOOK.SEND_TX_301
  | PROGRESS_HOOK.SEND_TX_302_01
  | PROGRESS_HOOK.SEND_TX_302_02
  | PROGRESS_HOOK.SEND_TX_302_03_01
  | PROGRESS_HOOK.SEND_TX_302_03_02
  | PROGRESS_HOOK.SEND_TX_302_03_03
  | PROGRESS_HOOK.SEND_TX_303_01
  | PROGRESS_HOOK.SEND_TX_303_02
  | PROGRESS_HOOK.SEND_TX_304_01
  | PROGRESS_HOOK.SEND_TX_304_02
  | PROGRESS_HOOK.SEND_TX_304_03
  | PROGRESS_HOOK.SEND_TX_304_04
  | PROGRESS_HOOK.SEND_TX_307
  | PROGRESS_HOOK.SEND_TX_309_01
  | PROGRESS_HOOK.SEND_TX_309_02
  | PROGRESS_HOOK.SEND_TX_309_03
  | PROGRESS_HOOK.SEND_TX_310_01
  | PROGRESS_HOOK.SEND_TX_310_02
  | PROGRESS_HOOK.SEND_TX_399_01
  | PROGRESS_HOOK.SEND_TX_399_02
  | PROGRESS_HOOK.SEND_TX_399_03;

export type PROGRESS_HOOK_MULTICHAIN =
  | PROGRESS_HOOK.SEND_TX_001
  | PROGRESS_HOOK.SEND_TX_002_01
  | PROGRESS_HOOK.SEND_TX_002_99_99
  | PROGRESS_HOOK.SEND_TX_999_01
  | PROGRESS_HOOK.SEND_TX_999_02
  | PROGRESS_HOOK.SEND_TX_999_03;

export type PROGRESS_HOOK_MIG =
  | PROGRESS_HOOK.UEA_MIG_01
  | PROGRESS_HOOK.UEA_MIG_02
  | PROGRESS_HOOK.UEA_MIG_03
  | PROGRESS_HOOK.UEA_MIG_9901
  | PROGRESS_HOOK.UEA_MIG_9902
  | PROGRESS_HOOK.UEA_MIG_9903;

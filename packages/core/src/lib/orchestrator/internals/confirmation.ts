/**
 * Transaction confirmation polling functions extracted from Orchestrator.
 */

import { bs58 } from '../../internal/bs58';
import { bytesToHex } from 'viem';
import { CHAIN_INFO } from '../../constants/chain';
import { getOriginEvmClient } from './context';
import { VM } from '../../constants/enums';
import { PROGRESS_HOOK } from '../../progress-hook/progress-hook.types';
import { EvmClient } from '../../vm-client/evm-client';
import { SvmClient } from '../../vm-client/svm-client';
import type { OrchestratorContext } from './context';
import { fireProgressHook } from './context';

export async function waitForEvmConfirmationsWithCountdown(
  ctx: OrchestratorContext,
  evmClient: EvmClient,
  txHash: `0x${string}`,
  confirmations: number,
  timeoutMs: number
): Promise<void> {
  if (confirmations <= 0) {
    fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_106_03_02, 0, 0);
    return;
  }

  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_106_03, confirmations);
  const start = Date.now();

  const receipt = await evmClient.publicClient.waitForTransactionReceipt({
    hash: txHash,
  });
  const targetBlock = receipt.blockNumber + BigInt(confirmations);
  let lastEmitted = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const currentBlock = await evmClient.publicClient.getBlockNumber();

    if (currentBlock >= targetBlock) {
      if (lastEmitted < confirmations) {
        fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_106_03_02, confirmations, confirmations);
      }
      return;
    }

    const remaining = Number(targetBlock - currentBlock);
    const completed = Math.max(1, confirmations - remaining + 1);

    if (completed > lastEmitted) {
      fireProgressHook(
        ctx,
        completed >= confirmations
          ? PROGRESS_HOOK.SEND_TX_106_03_02
          : PROGRESS_HOOK.SEND_TX_106_03_01,
        completed,
        confirmations
      );
      lastEmitted = completed;
      if (completed >= confirmations) return;
    }

    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `Timeout: transaction ${txHash} not confirmed with ${confirmations} confirmations within ${timeoutMs} ms`
      );
    }

    await new Promise((r) => setTimeout(r, 3000));
  }
}

export async function waitForSvmConfirmationsWithCountdown(
  ctx: OrchestratorContext,
  svmClient: SvmClient,
  txSignature: string,
  confirmations: number,
  timeoutMs: number
): Promise<void> {
  if (confirmations <= 0) {
    fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_106_03_02, 0, 0);
    return;
  }

  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_106_03, confirmations);
  const start = Date.now();

  let lastConfirmed = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const connection = (svmClient as any).connections[
      (svmClient as any).currentConnectionIndex
    ];
    const { value } = await connection.getSignatureStatuses([txSignature]);
    const status = value[0];

    if (status) {
      if (status.err) {
        throw new Error(
          `SVM transaction ${txSignature} failed: ${JSON.stringify(status.err)}`
        );
      }

      const rawConfirmations = status.confirmations;
      const hasNumericConfirmations = rawConfirmations != null;
      const currentConfirms = hasNumericConfirmations ? rawConfirmations : 0;

      const isFinalized =
        status.err === null &&
        (status.confirmationStatus === 'finalized' || status.confirmations === null);

      const hasEnoughConfirmations =
        hasNumericConfirmations && currentConfirms >= confirmations;

      if (currentConfirms > lastConfirmed) {
        const clamped = currentConfirms >= confirmations ? confirmations : currentConfirms;
        fireProgressHook(
          ctx,
          clamped >= confirmations
            ? PROGRESS_HOOK.SEND_TX_106_03_02
            : PROGRESS_HOOK.SEND_TX_106_03_01,
          Math.max(1, clamped),
          confirmations
        );
        lastConfirmed = currentConfirms;
      }

      if (hasEnoughConfirmations || isFinalized) {
        if (lastConfirmed < confirmations) {
          fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_106_03_02, confirmations, confirmations);
        }
        return;
      }
    }

    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `Timeout: transaction ${txSignature} not confirmed with ${confirmations} confirmations within ${timeoutMs} ms`
      );
    }

    await new Promise((r) => setTimeout(r, 500));
  }
}

export async function waitForLockerFeeConfirmation(
  ctx: OrchestratorContext,
  txHashBytes: Uint8Array
): Promise<void> {
  const chain = ctx.universalSigner.account.chain;
  const { vm, defaultRPC, fastConfirmations, timeout } = CHAIN_INFO[chain];

  // Poll silently — the fee-lock path fires SEND-TX-105-02 as its terminal
  // confirmation marker; emitting 106-xx here would leak funds-bridge hooks
  // into a non-funds-bridge path. Uses the same underlying RPC wait as the
  // funds-bridge confirmation helpers but without the 106-03 / 106-03-02
  // emissions.
  switch (vm) {
    case VM.EVM: {
      const evmClient = getOriginEvmClient(ctx);
      const txHash = bytesToHex(txHashBytes);
      const receipt = await evmClient.publicClient.waitForTransactionReceipt({
        hash: txHash,
      });
      if (fastConfirmations <= 1) return;
      const targetBlock = receipt.blockNumber + BigInt(fastConfirmations);
      const start = Date.now();
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const currentBlock = await evmClient.publicClient.getBlockNumber();
        if (currentBlock >= targetBlock) return;
        if (Date.now() - start > timeout) {
          throw new Error(
            `Timeout: fee-lock tx ${txHash} not confirmed with ${fastConfirmations} confirmations within ${timeout} ms`
          );
        }
        await new Promise((r) => setTimeout(r, 3000));
      }
    }

    case VM.SVM: {
      const rpcUrls = ctx.rpcUrls[chain] || defaultRPC;
      const svmClient = new SvmClient({ rpcUrls });
      const signature = bs58.encode(Buffer.from(txHashBytes));
      const start = Date.now();
      // eslint-disable-next-line no-constant-condition
      while (true) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const connection = (svmClient as any).connections[
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (svmClient as any).currentConnectionIndex
        ];
        const { value } = await connection.getSignatureStatuses([signature]);
        const status = value[0];
        if (status) {
          if (status.err) {
            throw new Error(
              `SVM fee-lock tx ${signature} failed: ${JSON.stringify(status.err)}`
            );
          }
          const isFinalized =
            status.confirmationStatus === 'finalized' ||
            status.confirmations === null;
          const hasEnough =
            status.confirmations != null &&
            status.confirmations >= fastConfirmations;
          if (isFinalized || hasEnough) return;
        }
        if (Date.now() - start > timeout) {
          throw new Error(
            `Timeout: fee-lock tx ${signature} not confirmed with ${fastConfirmations} confirmations within ${timeout} ms`
          );
        }
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    default:
      throw new Error(`Unsupported VM for tx confirmation: ${vm}`);
  }
}

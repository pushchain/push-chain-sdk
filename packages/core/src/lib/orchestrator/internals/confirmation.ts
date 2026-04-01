/**
 * Transaction confirmation polling functions extracted from Orchestrator.
 */

import { bs58 } from '../../internal/bs58';
import { bytesToHex } from 'viem';
import { CHAIN_INFO } from '../../constants/chain';
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
    fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_06_03_02, 0, 0);
    return;
  }

  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_06_03, confirmations);
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
        fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_06_03_02, confirmations, confirmations);
      }
      return;
    }

    const remaining = Number(targetBlock - currentBlock);
    const completed = Math.max(1, confirmations - remaining + 1);

    if (completed > lastEmitted) {
      fireProgressHook(
        ctx,
        completed >= confirmations
          ? PROGRESS_HOOK.SEND_TX_06_03_02
          : PROGRESS_HOOK.SEND_TX_06_03_01,
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

    await new Promise((r) => setTimeout(r, 12000));
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
    fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_06_03_02, 0, 0);
    return;
  }

  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_06_03, confirmations);
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
            ? PROGRESS_HOOK.SEND_TX_06_03_02
            : PROGRESS_HOOK.SEND_TX_06_03_01,
          Math.max(1, clamped),
          confirmations
        );
        lastConfirmed = currentConfirms;
      }

      if (hasEnoughConfirmations || isFinalized) {
        if (lastConfirmed < confirmations) {
          fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_06_03_02, confirmations, confirmations);
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
  const rpcUrls = ctx.rpcUrls[chain] || defaultRPC;

  switch (vm) {
    case VM.EVM: {
      const evmClient = new EvmClient({ rpcUrls });
      await waitForEvmConfirmationsWithCountdown(
        ctx,
        evmClient,
        bytesToHex(txHashBytes),
        fastConfirmations,
        timeout
      );
      return;
    }

    case VM.SVM: {
      const svmClient = new SvmClient({ rpcUrls });
      await waitForSvmConfirmationsWithCountdown(
        ctx,
        svmClient,
        bs58.encode(Buffer.from(txHashBytes)),
        fastConfirmations,
        timeout
      );
      return;
    }

    default:
      throw new Error(`Unsupported VM for tx confirmation: ${vm}`);
  }
}

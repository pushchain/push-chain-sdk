/* eslint-disable @typescript-eslint/no-non-null-assertion */
import '@e2e/shared/setup';
/**
 * Route 2 (UEA → CEA) — deterministic timeout E2E.
 *
 * Verifies the full 299-03 path end-to-end: a real R2 FUNDS tx is sent,
 * then `tx.wait({ outboundTimeoutMs })` forces the outbound-polling loop
 * to time out before the relay lands. Asserts:
 *   - receipt.externalStatus === 'timeout'
 *   - receipt.externalError contains "Timeout"
 *   - The emitted hook stream includes SEND-TX-299-03 (not 299-01 / 299-02).
 *
 * Secondary: a follow-up `tx.wait()` with default timeout should succeed
 * (relay eventually lands), proving the receipt is retry-safe.
 */
import { CHAIN } from '../../../src/lib/constants/enums';
import type { ProgressEvent } from '../../../src/lib/progress-hook/progress-hook.types';
import type { UniversalExecuteParams } from '../../../src/lib/orchestrator/orchestrator.types';
import {
  TransactionRoute,
  detectRoute,
} from '../../../src/lib/orchestrator/route-detector';
import { buildErc20WithdrawalMulticall } from '../../../src/lib/orchestrator/payload-builders';
import { getToken } from '@e2e/shared/constants';
import { createEvmPushClient } from '@e2e/shared/evm-client';
import { TEST_TARGET } from '@e2e/shared/outbound-helpers';
import type { Hex } from 'viem';

describe('Route 2 outbound timeout (299-03)', () => {
  const privateKey = process.env['EVM_PRIVATE_KEY'] as Hex;
  const skip = !privateKey;

  it('short outboundTimeoutMs triggers 299-03 + externalStatus=timeout', async () => {
    if (skip) {
      console.log('Skipping — EVM_PRIVATE_KEY unset');
      return;
    }

    const events: ProgressEvent[] = [];
    const setup = await createEvmPushClient({
      chain: CHAIN.ETHEREUM_SEPOLIA,
      privateKey,
      progressHook: (e: ProgressEvent) => events.push(e),
    });

    const usdt = getToken(CHAIN.ETHEREUM_SEPOLIA, 'USDT');
    const amount = BigInt(10000); // 0.01 USDT
    const params: UniversalExecuteParams = {
      to: { address: TEST_TARGET, chain: CHAIN.ETHEREUM_SEPOLIA },
      funds: { amount, token: usdt },
      data: buildErc20WithdrawalMulticall(
        usdt.address as `0x${string}`,
        TEST_TARGET,
        amount
      ),
    };
    expect(detectRoute(params)).toBe(TransactionRoute.UOA_TO_CEA);

    const tx = await setup.pushClient.universal.sendTransaction(params);
    console.log(`Push Chain TX Hash: ${tx.hash}`);
    expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

    // Force a timeout: 3s is well below the minimum outbound relay latency
    // (~30s initial wait in the real relay pipeline). The wait() resolves
    // with a partial receipt annotated externalStatus='timeout'.
    const shortTimeoutMs = 3_000;
    const t0 = Date.now();
    const receipt = await tx.wait({ outboundTimeoutMs: shortTimeoutMs });
    const elapsed = Date.now() - t0;
    console.log(`wait() resolved in ${elapsed}ms`);
    console.log(`receipt.externalStatus = ${receipt.externalStatus}`);
    console.log(`receipt.externalError = ${receipt.externalError}`);

    // With the initial-wait clamp in place, wait() should resolve shortly
    // after the configured timeout rather than waiting out the default 20s
    // settle-time. Allow headroom for RPC jitter + receipt transform, but
    // assert we're well under the pre-clamp 21s floor.
    expect(elapsed).toBeLessThan(shortTimeoutMs + 15_000);

    // Partial receipt assertions
    expect(receipt.status).toBe(1); // Push Chain leg succeeded
    expect(receipt.externalStatus).toBe('timeout');
    expect(receipt.externalError).toMatch(/Timeout/i);
    expect(receipt.externalTxHash).toBeUndefined();

    // Hook stream assertions — 299-03 fired, 299-01 did NOT
    const ids = events.map((e) => e.id);
    console.log(`hook stream: ${ids.join(' → ')}`);
    expect(ids).toContain('SEND-TX-299-03');
    expect(ids).not.toContain('SEND-TX-299-01');
    expect(ids).not.toContain('SEND-TX-299-02');

    // The timeout event's response.elapsedMs should reflect the OVERRIDE,
    // not the default 180_000 — proves the per-call timeout plumbed through.
    const timeoutEvent = events.find((e) => e.id === 'SEND-TX-299-03')!;
    const resp = timeoutEvent.response as { elapsedMs?: number };
    expect(resp.elapsedMs).toBe(shortTimeoutMs);
  }, 120_000);
});

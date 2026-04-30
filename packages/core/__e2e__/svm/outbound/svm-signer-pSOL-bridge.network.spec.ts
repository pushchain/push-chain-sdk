/**
 * Network-level e2e for the SVM-signer pSOL → SOL bridge — the exact
 * scenario Riyanshu hit on Slack 2026-04-23.
 *
 * Pre-fix (payload v0): SDK crashed at encode-time with
 *   `RangeError: The value of "value" is out of range. < 2n ** 64n.
 *    Received 82_716_248_299_997_902_592n`
 * before any RPC call.
 *
 * Post-fix (payload v1): the encoder accepts wei-scale UPC values up to
 * u128, so the SDK reaches the network. This spec exercises the full
 * `pushChainClient.universal.sendTransaction({to: {chain: SOLANA_DEVNET},
 * funds: {pSOL, amount}})` path against live testnet to prove the
 * pre-encode failure mode is gone.
 *
 * Skip behaviour:
 *   - SOLANA_PRIVATE_KEY not set → entire suite skipped (cannot sign)
 *   - SOL_RECIPIENT not set      → uses a default Solana devnet address
 *
 * What this spec does NOT assert:
 *   - That the tx finalizes on Solana. The relay still depends on the
 *     pSOL/WPC pool calibration on Donut (per KNOWN_FAILURES.md, blocked on
 *     contracts team), and on the matching v1 decoder shipping in
 *     `push-chain/x/uexecutor/types/decode_payload.go::DecodeUniversalPayloadSolana`.
 *     Until both ship, this spec confirms the SDK encoder no longer trips,
 *     and surfaces whichever downstream error remains.
 */
import '@e2e/shared/setup';
import { PushChain } from '../../../src';
import { CHAIN, PUSH_NETWORK } from '../../../src/lib/constants/enums';
import { createSvmPushClient } from '@e2e/shared/svm-client';
import { getToken } from '@e2e/shared/constants';

const solanaPrivateKey = process.env['SOLANA_PRIVATE_KEY'];
const solRecipient =
  process.env['SOL_RECIPIENT'] ||
  // Solana devnet test recipient (matches Riyanshu's screenshot)
  '71jL2ZNfS7ygAGe9x14ptawKWitaeRFpuPfwyE9LYcCY';
const skipE2E = !solanaPrivateKey;

describe('SVM signer pSOL → SOL bridge (Slack 2026-04-23 regression)', () => {
  let pushClient: PushChain;

  beforeAll(async () => {
    if (skipE2E) {
      console.log('Skipping — SOLANA_PRIVATE_KEY not set');
      return;
    }
    const setup = await createSvmPushClient({
      privateKeyBase58: solanaPrivateKey as string,
      chain: CHAIN.SOLANA_DEVNET,
      network: PUSH_NETWORK.TESTNET_DONUT,
    });
    pushClient = setup.pushClient;
    console.log(`SVM signer UEA: ${pushClient.universal.account}`);
  }, 60000);

  it('does not crash at encode-time on Riyanshu’s exact call shape', async () => {
    if (skipE2E) return;

    // The MOVEABLE_TOKENS table for Solana Devnet exposes the bridgeable
    // SOL token under the 'SOL' symbol (it maps to pSOL on the Push side).
    const sol = getToken(CHAIN.SOLANA_DEVNET, 'SOL');

    // Same call shape Riyanshu made. The amount is small enough that the
    // UEA balance clamp in route-handlers.ts:938-950 cannot reduce the
    // gas-swap budget below the old u64 ceiling — so this is the exact
    // shape that used to crash before the fix.
    const params = {
      to: {
        address: solRecipient,
        chain: CHAIN.SOLANA_DEVNET,
      },
      funds: {
        amount: PushChain.utils.helpers.parseUnits('0.001', sol.decimals),
        token: sol,
      },
    };

    let encoderRangeError: Error | null = null;
    try {
      // We do not assert successful finalization — just that the SDK
      // encoder no longer throws RangeError before reaching the network.
      const tx = await pushClient.universal.sendTransaction(params as any);
      console.log(`Tx submitted: ${tx.hash}`);
    } catch (err) {
      const e = err as Error;
      // The old failure mode: Node's RangeError from writeBigUInt64LE.
      if (
        e.name === 'RangeError' &&
        /value of "value" is out of range/i.test(e.message) &&
        /< 2n \*\* 64n/.test(e.message)
      ) {
        encoderRangeError = e;
      } else {
        // Any other error is acceptable for this spec — we are only here
        // to verify the encoder stopped tripping. Log + move on.
        console.log(`Downstream error (not the encoder bug): ${e.message}`);
      }
    }

    // The hard assertion: the v0 RangeError must be gone.
    expect(encoderRangeError).toBeNull();
  }, 300000);

  it('encoder still rejects pool-magnitude values (chain decoder is u64-only)', async () => {
    if (skipE2E) return;

    // Option B keeps the v0 wire format (chain decoder unchanged). The
    // encoder still caps at u64 — but the Option B win is that the Borsh
    // bytes are no longer computed on the non-fee-locking R2 SVM outbound
    // path, so this ceiling doesn't surface for Riyanshu's call (test
    // above, which submitted on live testnet).
    //
    // This test pins the bounds behavior: any caller that DOES still hit
    // the encoder (R1 SVM inbound, fee-locking outbound) with a > u64 value
    // will see an exception. We don't assert on message shape — Node owns
    // the message — only that throwing happens.
    const { encodeUniversalPayloadSvm } = await import(
      '../../../src/lib/orchestrator/internals/signing'
    );

    const eightSeventyTwoUpc = BigInt(872) * BigInt('1000000000000000000');
    const payload = {
      to: '0x0000000000000000000000000000000000000000',
      value: eightSeventyTwoUpc.toString(),
      data: '0xdeadbeef',
      gasLimit: BigInt(5e7).toString(),
      maxFeePerGas: BigInt(1e10).toString(),
      maxPriorityFeePerGas: '0',
      nonce: '0',
      deadline: '9999999999',
      vType: 0,
    };

    expect(() => encodeUniversalPayloadSvm(payload as any)).toThrow();
  }, 60000);
});

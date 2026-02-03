import { privateKeyToAccount } from 'viem/accounts';
import { PUSH_NETWORK, CHAIN } from '../src/lib/constants/enums';
import { createWalletClient, Hex, http } from 'viem';
import { PushChain } from '../src';
import { CHAIN_INFO } from '../src/lib/constants/chain';
import dotenv from 'dotenv';
import path from 'path';
import { ProgressEvent } from '../src/lib/progress-hook/progress-hook.types';
import { UniversalTxResponse } from '../src/lib/orchestrator/orchestrator.types';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

describe('trackTransaction E2E', () => {
  const pushNetwork = PUSH_NETWORK.TESTNET_DONUT;
  const originChain = CHAIN.PUSH_TESTNET_DONUT;
  const to = '0x35B84d6848D16415177c64D64504663b998A6ab4';

  // Shared state - send ONE transaction and reuse across tests
  let pushClient: PushChain;
  let sharedTxResponse: UniversalTxResponse;

  beforeAll(async () => {
    const privateKey = process.env['EVM_PRIVATE_KEY'] as Hex;
    if (!privateKey) {
      console.log('EVM_PRIVATE_KEY not set, skipping all tests');
      return;
    }

    const account = privateKeyToAccount(privateKey);
    const walletClient = createWalletClient({
      account,
      transport: http(CHAIN_INFO[originChain].defaultRPC[0]),
    });

    const universalSigner = await PushChain.utils.signer.toUniversalFromKeypair(
      walletClient,
      {
        chain: originChain,
        library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
      }
    );

    pushClient = await PushChain.initialize(universalSigner, {
      network: pushNetwork,
    });

    // Send ONE transaction to be reused by multiple tests
    console.log('\n=== [beforeAll] Sending shared transaction ===');
    sharedTxResponse = await pushClient.universal.sendTransaction({
      to,
      value: BigInt(1000),
    });
    console.log('Shared TX Hash:', sharedTxResponse.hash);

    // Wait for it to be confirmed
    await sharedTxResponse.wait();
    console.log('Shared TX confirmed!\n');
  }, 120000);

  it('should track a transaction and return receipt', async () => {
    if (!pushClient || !sharedTxResponse) {
      console.log('Setup failed, skipping test');
      return;
    }

    const trackProgressEvents: ProgressEvent[] = [];

    console.log('\n=== Tracking Transaction ===');
    const receipt = await pushClient.universal.trackTransaction(
      sharedTxResponse.hash,
      {
        waitForCompletion: true,
        progress: (event) => {
          console.log(`[TRACK] ${event.id}: ${event.message}`);
          trackProgressEvents.push(event);
        },
        advanced: {
          timeout: 30000,
        },
      }
    );

    console.log('Receipt Hash:', receipt.hash);
    console.log('Receipt Status:', receipt.status === 1 ? 'SUCCESS' : 'FAILED');
    console.log('Block Number:', receipt.blockNumber.toString());

    // Verify results
    expect(receipt.hash).toBe(sharedTxResponse.hash);
    expect(receipt.blockNumber).toBeGreaterThan(BigInt(0));
    expect(receipt.status).toBe(1);
    expect(trackProgressEvents.some(e => e.id === 'TRACK-TX-01')).toBe(true);
    expect(trackProgressEvents.some(e => e.id === 'TRACK-TX-99-01')).toBe(true);

    console.log('✓ All assertions passed');
  }, 60000);

  it('should throw error for invalid tx hash format', async () => {
    if (!pushClient) {
      console.log('Setup failed, skipping test');
      return;
    }

    console.log('\n=== Testing Invalid TX Hash ===');

    await expect(
      pushClient.universal.trackTransaction('0x123', {
        waitForCompletion: false,
      })
    ).rejects.toThrow();

    console.log('✓ Invalid hash throws error');
  }, 30000);

  it('should compare wait() vs trackTransaction results', async () => {
    if (!pushClient || !sharedTxResponse) {
      console.log('Setup failed, skipping test');
      return;
    }

    console.log('\n=== Comparing wait() vs trackTransaction ===');

    // Get receipt using wait() (already confirmed, so instant)
    const waitReceipt = await sharedTxResponse.wait();
    console.log('wait() receipt hash:', waitReceipt.hash);

    // Get receipt using trackTransaction
    const trackReceipt = await pushClient.universal.trackTransaction(
      sharedTxResponse.hash,
      { waitForCompletion: true }
    );
    console.log('trackTransaction receipt hash:', trackReceipt.hash);

    // Compare results
    expect(trackReceipt.hash).toBe(waitReceipt.hash);
    expect(trackReceipt.status).toBe(waitReceipt.status);
    expect(trackReceipt.blockNumber).toBe(waitReceipt.blockNumber);
    expect(trackReceipt.gasUsed).toBe(waitReceipt.gasUsed);

    console.log('✓ wait() and trackTransaction return identical results');
  }, 60000);

  it('should work without progress hook', async () => {
    if (!pushClient || !sharedTxResponse) {
      console.log('Setup failed, skipping test');
      return;
    }

    console.log('\n=== Testing without progress hook ===');

    // Track without progress hook - should not throw
    const receipt = await pushClient.universal.trackTransaction(
      sharedTxResponse.hash,
      {
        waitForCompletion: true,
        // No progress hook provided
      }
    );

    expect(receipt.hash).toBe(sharedTxResponse.hash);
    expect(receipt.status).toBe(1);

    console.log('✓ Works without progress hook');
  }, 60000);

  it('should track same transaction multiple times', async () => {
    if (!pushClient || !sharedTxResponse) {
      console.log('Setup failed, skipping test');
      return;
    }

    console.log('\n=== Testing multiple tracks of same TX ===');
    console.log('TX Hash:', sharedTxResponse.hash);

    // Track the same transaction 3 times (no new transaction needed!)
    const receipt1 = await pushClient.universal.trackTransaction(
      sharedTxResponse.hash,
      { waitForCompletion: true }
    );
    console.log('Track 1 - Hash:', receipt1.hash, 'Status:', receipt1.status);

    const receipt2 = await pushClient.universal.trackTransaction(
      sharedTxResponse.hash,
      { waitForCompletion: true }
    );
    console.log('Track 2 - Hash:', receipt2.hash, 'Status:', receipt2.status);

    const receipt3 = await pushClient.universal.trackTransaction(
      sharedTxResponse.hash,
      { waitForCompletion: false } // Non-blocking since already confirmed
    );
    console.log('Track 3 - Hash:', receipt3.hash, 'Status:', receipt3.status);

    // All should return same results
    expect(receipt1.hash).toBe(receipt2.hash);
    expect(receipt2.hash).toBe(receipt3.hash);
    expect(receipt1.status).toBe(receipt2.status);
    expect(receipt2.status).toBe(receipt3.status);
    expect(receipt1.blockNumber).toBe(receipt2.blockNumber);
    expect(receipt2.blockNumber).toBe(receipt3.blockNumber);

    console.log('✓ Multiple tracks return consistent results');
  }, 60000);

  it('should respect custom timeout setting', async () => {
    if (!pushClient) {
      console.log('Setup failed, skipping test');
      return;
    }

    console.log('\n=== Testing custom timeout ===');

    const nonExistentHash = '0x0000000000000000000000000000000000000000000000000000000000000001';
    const shortTimeout = 2000; // 2 seconds

    const start = Date.now();

    await expect(
      pushClient.universal.trackTransaction(nonExistentHash, {
        waitForCompletion: true,
        advanced: {
          timeout: shortTimeout,
          pollingIntervalMs: 500,
        },
      })
    ).rejects.toThrow(/Timeout/);

    const duration = Date.now() - start;

    expect(duration).toBeGreaterThanOrEqual(shortTimeout);
    expect(duration).toBeLessThan(shortTimeout + 2000);

    console.log(`✓ Timeout respected (took ${duration}ms for ${shortTimeout}ms timeout)`);
  }, 30000);
});

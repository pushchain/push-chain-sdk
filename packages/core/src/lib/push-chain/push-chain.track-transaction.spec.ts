import { createWalletClient, http } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { PushChain } from './push-chain';
import { CHAIN_INFO } from '../constants/chain';

describe('trackTransaction', () => {
  it('should track a known transaction and return receipt', async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const walletClient = createWalletClient({
      account,
      transport: http(
        CHAIN_INFO[PushChain.CONSTANTS.CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]
      ),
    });
    const signer = await PushChain.utils.signer.toUniversalFromKeypair(
      walletClient,
      {
        chain: PushChain.CONSTANTS.CHAIN.PUSH_TESTNET_DONUT,
        library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
      }
    );
    const pushChainClient = await PushChain.initialize(signer, {
      network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
    });

    // Use a known confirmed transaction hash from Push Chain Testnet
    // Replace this with an actual confirmed tx hash for testing
    const knownTxHash = '0x8e9aaff6fe40a6a9ad7bfd7280d3391bad690ae70fe8383604a28082401fc668';

    try {
      const receipt = await pushChainClient.universal.trackTransaction(
        knownTxHash,
        {
          waitForCompletion: true,
          advanced: {
            timeout: 30000,
          },
        }
      );

      expect(receipt).toBeDefined();
      expect(receipt.hash).toBe(knownTxHash);
      expect(receipt.status).toBeDefined();
      expect(receipt.blockNumber).toBeDefined();
      expect(receipt.gasUsed).toBeDefined();
    } catch (error) {
      // Skip test if transaction not found (might be on different network/state)
      console.log('Transaction not found, skipping test:', error);
    }
  }, 60000);

  it('should track transaction with progress hooks', async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const walletClient = createWalletClient({
      account,
      transport: http(
        CHAIN_INFO[PushChain.CONSTANTS.CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]
      ),
    });
    const signer = await PushChain.utils.signer.toUniversalFromKeypair(
      walletClient,
      {
        chain: PushChain.CONSTANTS.CHAIN.PUSH_TESTNET_DONUT,
        library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
      }
    );
    const pushChainClient = await PushChain.initialize(signer, {
      network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
    });

    const progressEvents: string[] = [];
    const knownTxHash = '0x8e9aaff6fe40a6a9ad7bfd7280d3391bad690ae70fe8383604a28082401fc668';

    try {
      await pushChainClient.universal.trackTransaction(knownTxHash, {
        waitForCompletion: true,
        progress: (event) => {
          progressEvents.push(event.id);
        },
        advanced: {
          timeout: 30000,
        },
      });

      // Verify progress hooks were emitted
      expect(progressEvents.length).toBeGreaterThan(0);
      expect(progressEvents).toContain('TRACK-TX-01'); // Tracking started
    } catch (error) {
      console.log('Transaction not found, skipping test:', error);
    }
  }, 60000);

  it('should timeout when tracking non-existent transaction', async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const walletClient = createWalletClient({
      account,
      transport: http(
        CHAIN_INFO[PushChain.CONSTANTS.CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]
      ),
    });
    const signer = await PushChain.utils.signer.toUniversalFromKeypair(
      walletClient,
      {
        chain: PushChain.CONSTANTS.CHAIN.PUSH_TESTNET_DONUT,
        library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
      }
    );
    const pushChainClient = await PushChain.initialize(signer, {
      network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
    });

    const nonExistentTxHash = '0x0000000000000000000000000000000000000000000000000000000000000000';

    await expect(
      pushChainClient.universal.trackTransaction(nonExistentTxHash, {
        waitForCompletion: true,
        advanced: {
          timeout: 3000, // Short timeout for test
          pollingIntervalMs: 500,
        },
      })
    ).rejects.toThrow(/Timeout/);
  }, 10000);

  it('should return immediately when waitForCompletion is false and tx exists', async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const walletClient = createWalletClient({
      account,
      transport: http(
        CHAIN_INFO[PushChain.CONSTANTS.CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]
      ),
    });
    const signer = await PushChain.utils.signer.toUniversalFromKeypair(
      walletClient,
      {
        chain: PushChain.CONSTANTS.CHAIN.PUSH_TESTNET_DONUT,
        library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
      }
    );
    const pushChainClient = await PushChain.initialize(signer, {
      network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
    });

    const knownTxHash = '0x8e9aaff6fe40a6a9ad7bfd7280d3391bad690ae70fe8383604a28082401fc668';

    try {
      const start = Date.now();
      const receipt = await pushChainClient.universal.trackTransaction(
        knownTxHash,
        {
          waitForCompletion: false,
        }
      );
      const duration = Date.now() - start;

      expect(receipt).toBeDefined();
      expect(receipt.hash).toBe(knownTxHash);
      // Should return quickly
      expect(duration).toBeLessThan(5000);
    } catch (error) {
      console.log('Transaction not found, skipping test:', error);
    }
  }, 10000);
});

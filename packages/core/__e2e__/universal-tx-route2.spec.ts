/**
 * Multi-Chain Universal Transaction Tests - Route 2 (UOA → CEA)
 *
 * Tests for outbound transactions from Push Chain to external chains via CEA.
 * Primary test chain: BNB Testnet (Chain ID: 97)
 */
import { PushChain } from '../src';
import { PUSH_NETWORK, CHAIN } from '../src/lib/constants/enums';
import { CHAIN_INFO } from '../src/lib/constants/chain';
import { MOVEABLE_TOKENS } from '../src/lib/constants/tokens';
import { createWalletClient, http, Hex, parseEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import dotenv from 'dotenv';
import path from 'path';
import { getCEAAddress, chainSupportsCEA } from '../src/lib/orchestrator/cea-utils';
import { TransactionRoute, detectRoute } from '../src/lib/orchestrator/route-detector';
import type { UniversalExecuteParams, ChainTarget } from '../src/lib/orchestrator/orchestrator.types';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

describe('Route 2: UOA → CEA (Outbound Transactions)', () => {
  let pushClient: Awaited<ReturnType<typeof PushChain.initialize>>;
  let ueaAddress: `0x${string}`;

  // Skip if no private key is set
  const privateKey = process.env['EVM_PRIVATE_KEY'] as Hex;
  const skipE2E = !privateKey;

  beforeAll(async () => {
    if (skipE2E) {
      console.log('Skipping E2E tests - EVM_PRIVATE_KEY not set');
      return;
    }

    const originChain = CHAIN.ETHEREUM_SEPOLIA;
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
      network: PUSH_NETWORK.TESTNET_DONUT,
      printTraces: true,
      progressHook: (val: any) => {
        console.log(`[${val.id}] ${val.title}`);
      },
    });

    ueaAddress = pushClient.universal.account;
    console.log(`UEA Address: ${ueaAddress}`);
  });

  describe('Route Detection', () => {
    it('should detect UOA_TO_PUSH for simple address target', () => {
      const params: UniversalExecuteParams = {
        to: '0x1234567890123456789012345678901234567890',
        value: parseEther('0.001'),
      };
      expect(detectRoute(params)).toBe(TransactionRoute.UOA_TO_PUSH);
    });

    it('should detect UOA_TO_CEA for ChainTarget', () => {
      const params: UniversalExecuteParams = {
        to: {
          address: '0x1234567890123456789012345678901234567890',
          chain: CHAIN.BNB_TESTNET,
        } as ChainTarget,
        value: parseEther('0.001'),
      };
      expect(detectRoute(params)).toBe(TransactionRoute.UOA_TO_CEA);
    });

    it('should detect CEA_TO_PUSH when from.chain is specified with Push target', () => {
      const params: UniversalExecuteParams = {
        from: { chain: CHAIN.BNB_TESTNET },
        to: {
          address: '0x1234567890123456789012345678901234567890',
          chain: CHAIN.PUSH_TESTNET_DONUT,
        } as ChainTarget,
        value: parseEther('0.001'),
      };
      expect(detectRoute(params)).toBe(TransactionRoute.CEA_TO_PUSH);
    });
  });

  describe('CEA Address Utilities', () => {
    it('should report BNB Testnet supports CEA', () => {
      expect(chainSupportsCEA(CHAIN.BNB_TESTNET)).toBe(true);
    });

    it('should report Ethereum Sepolia supports CEA', () => {
      expect(chainSupportsCEA(CHAIN.ETHEREUM_SEPOLIA)).toBe(true);
    });

    it('should report Solana Devnet does not support CEA', () => {
      expect(chainSupportsCEA(CHAIN.SOLANA_DEVNET)).toBe(false);
    });

    it('should compute CEA address for UEA on BNB Testnet', async () => {
      if (skipE2E) return;

      const result = await getCEAAddress(ueaAddress, CHAIN.BNB_TESTNET);
      console.log(`CEA on BNB Testnet: ${result.cea}, deployed: ${result.isDeployed}`);

      expect(result.cea).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(typeof result.isDeployed).toBe('boolean');
    });
  });

  describe('prepareTransaction API', () => {
    it('should prepare outbound transaction without executing', async () => {
      if (skipE2E) return;

      const targetAddress = '0x1234567890123456789012345678901234567890' as `0x${string}`;
      const params: UniversalExecuteParams = {
        to: {
          address: targetAddress,
          chain: CHAIN.BNB_TESTNET,
        },
        value: parseEther('0.0001'),
      };

      const prepared = await pushClient.universal.prepareTransaction(params);

      console.log(`Prepared tx route: ${prepared.route}`);
      console.log(`Estimated gas: ${prepared.estimatedGas}`);
      console.log(`Nonce: ${prepared.nonce}`);

      expect(prepared.route).toBe('UOA_TO_CEA');
      expect(prepared.payload).toBeDefined();
      expect(typeof prepared.thenOn).toBe('function');
      expect(typeof prepared.send).toBe('function');
    });
  });

  describe('executeTransactions Chaining API', () => {
    it('should create chained builder', () => {
      if (skipE2E) return;

      const firstTx: UniversalExecuteParams = {
        to: '0x1234567890123456789012345678901234567890',
        value: parseEther('0.001'),
      };

      const builder = pushClient.universal.executeTransactions(firstTx);

      expect(typeof builder.thenOn).toBe('function');
      expect(typeof builder.send).toBe('function');

      // Test chaining
      const chainedBuilder = builder.thenOn({
        to: {
          address: '0x1234567890123456789012345678901234567890',
          chain: CHAIN.BNB_TESTNET,
        },
        value: parseEther('0.0001'),
      });

      expect(typeof chainedBuilder.thenOn).toBe('function');
      expect(typeof chainedBuilder.send).toBe('function');
    });
  });

  // Note: The following test actually executes a transaction and requires:
  // 1. EVM_PRIVATE_KEY to be set
  // 2. The UEA to have pETH balance on Push Chain (already funded)
  // 3. Sufficient gas for the outbound transaction
  describe('Route 2 E2E: Outbound to BSC Testnet', () => {
    it('should execute outbound transfer from UOA to CEA on BSC Testnet', async () => {
      if (skipE2E) return;

      const targetAddress = '0x1234567890123456789012345678901234567890' as `0x${string}`;

      // The UOA already has pBNB balance on Push Chain
      // We can directly test the outbound flow without bridging first

      // Execute outbound transfer to BSC Testnet
      const tx = await pushClient.universal.sendTransaction({
        to: {
          address: targetAddress,
          chain: CHAIN.BNB_TESTNET,
        },
        value: parseEther('0.00015'),
        gasLimit: BigInt(2000000),
      });

      console.log(`[TEST] ${new Date().toISOString()} Push Chain TX Hash: ${tx.hash}`);

      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(tx.chain).toBe(CHAIN.BNB_TESTNET);
    }, 180000);

    it('should execute outbound and wait for complete sync using waitForOutboundTx', async () => {
      if (skipE2E) return;

      const targetAddress = '0x1234567890123456789012345678901234567890' as `0x${string}`;

      console.log(`\n=== TEST: waitForOutboundTx ===`);
      console.log(`[TEST] ${new Date().toISOString()} Sending outbound tx...`);

      // Execute outbound transfer to BSC Testnet
      const tx = await pushClient.universal.sendTransaction({
        to: {
          address: targetAddress,
          chain: CHAIN.BNB_TESTNET,
        },
        value: parseEther('0.00015'),
        gasLimit: BigInt(2000000),
      });

      console.log(`[TEST] ${new Date().toISOString()} Push Chain TX Hash: ${tx.hash}`);
      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

      // Wait for the outbound transaction to complete on BSC Testnet
      // 60s initial wait (relay needs time), 10s poll, 5min timeout
      const progressEvents: string[] = [];
      console.log(`[TEST] ${new Date().toISOString()} Starting waitForOutboundTx (60s initial, 10s poll, 300s timeout)`);
      const outboundDetails = await pushClient.universal.waitForOutboundTx(tx.hash, {
        initialWaitMs: 60000,
        pollingIntervalMs: 10000,
        timeout: 300000,
        progressHook: (event) => {
          console.log(`[TEST:progressHook] ${new Date().toISOString()} Status: ${event.status}, Elapsed: ${event.elapsed}ms`);
          progressEvents.push(event.status);
        },
      });

      console.log(`[TEST] ${new Date().toISOString()} Outbound TX completed:`);
      console.log(`  External TX Hash: ${outboundDetails.externalTxHash}`);
      console.log(`  Destination Chain: ${outboundDetails.destinationChain}`);
      console.log(`  Explorer URL: ${outboundDetails.explorerUrl}`);
      console.log(`  Recipient: ${outboundDetails.recipient}`);
      console.log(`  Amount: ${outboundDetails.amount}`);

      // Verify the outbound details
      expect(outboundDetails.externalTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(outboundDetails.destinationChain).toBe(CHAIN.BNB_TESTNET);
      expect(outboundDetails.explorerUrl).toContain(outboundDetails.externalTxHash);
      expect(progressEvents).toContain('waiting');
      expect(progressEvents).toContain('found');
    }, 600000); // 10 min timeout for full E2E with relay

    it('should execute outbound and sync using v2 API syncOutboundTransaction', async () => {
      if (skipE2E) return;

      const targetAddress = '0x1234567890123456789012345678901234567890' as `0x${string}`;

      console.log(`\n=== TEST: syncOutboundTransaction v2 ===`);
      console.log(`[TEST] ${new Date().toISOString()} Sending outbound tx...`);

      // Execute outbound transfer to BSC Testnet
      const tx = await pushClient.universal.sendTransaction({
        to: {
          address: targetAddress,
          chain: CHAIN.BNB_TESTNET,
        },
        value: parseEther('0.00015'),
        gasLimit: BigInt(2000000),
      });

      console.log(`[TEST] ${new Date().toISOString()} Push Chain TX Hash: ${tx.hash}`);
      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

      // Quick check: call getOutboundTxDetails immediately to see what state the tx is in
      console.log(`[TEST] ${new Date().toISOString()} Immediate getOutboundTxDetails check (expecting null)...`);
      const immediateCheck = await pushClient.universal.getOutboundTxDetails(tx.hash);
      console.log(`[TEST] ${new Date().toISOString()} Immediate check result: ${JSON.stringify(immediateCheck)}`);

      // Wait 5s then try again
      console.log(`[TEST] ${new Date().toISOString()} Waiting 5s before second check...`);
      await new Promise(resolve => setTimeout(resolve, 5000));

      console.log(`[TEST] ${new Date().toISOString()} Second getOutboundTxDetails check...`);
      let outboundDetails = await pushClient.universal.getOutboundTxDetails(tx.hash);
      console.log(`[TEST] ${new Date().toISOString()} Second check result: ${JSON.stringify(outboundDetails)}`);

      // If not ready yet, wait for it using waitForOutboundTx with reduced timeouts
      if (!outboundDetails) {
        console.log(`[TEST] ${new Date().toISOString()} Outbound not ready yet, starting waitForOutboundTx (60s initial, 10s poll, 300s timeout)...`);
        const progressEvents: string[] = [];
        outboundDetails = await pushClient.universal.waitForOutboundTx(tx.hash, {
          initialWaitMs: 60000,
          pollingIntervalMs: 10000,
          timeout: 300000,
          progressHook: (event) => {
            console.log(`[TEST:progressHook] ${new Date().toISOString()} Status: ${event.status}, Elapsed: ${event.elapsed}ms`);
            progressEvents.push(event.status);
          },
        });

        // Verify progress hook was called
        expect(progressEvents.length).toBeGreaterThan(0);
      }

      console.log(`[TEST] ${new Date().toISOString()} Outbound TX sync completed:`);
      console.log(`  External TX Hash: ${outboundDetails.externalTxHash}`);
      console.log(`  Destination Chain: ${outboundDetails.destinationChain}`);
      console.log(`  Explorer URL: ${outboundDetails.explorerUrl}`);

      // Verify the results
      expect(outboundDetails.externalTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(outboundDetails.destinationChain).toBe(CHAIN.BNB_TESTNET);
    }, 600000); // 10 min timeout for full E2E with relay
  });
});

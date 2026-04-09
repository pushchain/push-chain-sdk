/* eslint-disable @typescript-eslint/no-non-null-assertion */
/**
 * CEA Auto-Deployment Diagnostic E2E
 *
 * Validates that:
 * 1. CEA address is deterministic (computable before deployment via CREATE2)
 * 2. Route 2 (UOA_TO_CEA) auto-deploys CEA on the external chain via relay
 * 3. Route 3 (CEA_TO_PUSH) fails early at prepareTransaction when CEA is undeployed
 * 4. Route 3 works after CEA has been deployed via Route 2
 *
 * Uses EVM_PRIVATE_KEY env var (Sepolia signer with deployed UEA and funds).
 */

import '@e2e/shared/setup';
import { Hex, createPublicClient, http, encodeFunctionData } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { PushChain } from '../../../src';
import { CHAIN, PUSH_NETWORK } from '../../../src/lib/constants/enums';
import { CHAIN_INFO } from '../../../src/lib/constants/chain';
import { getCEAAddress } from '../../../src/lib/orchestrator/cea-utils';
import { TransactionRoute, detectRoute } from '../../../src/lib/orchestrator/route-detector';
import type { UniversalExecuteParams } from '../../../src/lib/orchestrator/orchestrator.types';
import { createEvmPushClient } from '@e2e/shared/evm-client';
import { verifyExternalTransaction } from '@e2e/shared/external-tx-verifier';
import { getActiveFixtures, type ChainTestFixture } from '@e2e/shared/chain-fixtures';
import { COUNTER_ABI, TEST_TARGET } from '@e2e/shared/outbound-helpers';

const fixtures = getActiveFixtures();

describe('CEA Auto-Deployment Diagnostic', () => {
  // Main wallet — has deployed UEA + funds (used for Route 2 auto-deploy test)
  let mainClient: Awaited<ReturnType<typeof PushChain.initialize>>;
  let mainUeaAddress: `0x${string}`;

  const evmKey = process.env['EVM_PRIVATE_KEY'] as Hex;
  const skipE2E = !evmKey;

  beforeAll(async () => {
    if (skipE2E) {
      console.log('Skipping E2E tests - EVM_PRIVATE_KEY not set');
      return;
    }

    const setup = await createEvmPushClient({
      chain: CHAIN.ETHEREUM_SEPOLIA,
      privateKey: evmKey,
      printTraces: true,
      progressHook: (val) => {
        console.log(`[${val.id}] ${val.title}`);
      },
    });
    mainClient = setup.pushClient;
    mainUeaAddress = mainClient.universal.account as `0x${string}`;
    console.log(`Main UEA Address: ${mainUeaAddress}`);
  }, 60000);

  // ==========================================================================
  // 1. CEA Address is Deterministic (CREATE2)
  // ==========================================================================
  describe.each(fixtures)(
    '1. CEA Address Determinism [$label]',
    (fixture: ChainTestFixture) => {
      it('should compute CEA address even when not deployed', async () => {
        if (skipE2E) return;

        // Generate a brand new address that has never interacted with any chain
        const freshKey = generatePrivateKey();
        const freshAccount = privateKeyToAccount(freshKey);
        const freshAddress = freshAccount.address;

        console.log(`\n=== CEA Determinism Test [${fixture.label}] ===`);
        console.log(`Fresh address (never used): ${freshAddress}`);

        // getCEAAddress should return a valid address even when CEA is not deployed
        const result = await getCEAAddress(freshAddress, fixture.chain);

        console.log(`CEA address: ${result.cea}`);
        console.log(`Is deployed: ${result.isDeployed}`);

        // CEA address should be a valid non-zero address
        expect(result.cea).toMatch(/^0x[a-fA-F0-9]{40}$/);
        expect(result.cea).not.toBe(
          '0x0000000000000000000000000000000000000000'
        );

        // For a fresh address, CEA should NOT be deployed
        expect(result.isDeployed).toBe(false);

        // Calling again should return the same address (deterministic)
        const result2 = await getCEAAddress(freshAddress, fixture.chain);
        expect(result2.cea.toLowerCase()).toBe(result.cea.toLowerCase());
      }, 30000);
    }
  );

  // ==========================================================================
  // 2. Route 2 Auto-Deploys CEA (main wallet — already has UEA + funds)
  // ==========================================================================
  describe.each(fixtures)(
    '2. Route 2 CEA Auto-Deploy [$label]',
    (fixture: ChainTestFixture) => {
      it('should verify CEA deployment status for main wallet', async () => {
        if (skipE2E) return;

        console.log(
          `\n=== Route 2 CEA Status Check [${fixture.label}] ===`
        );

        const ceaResult = await getCEAAddress(
          mainUeaAddress,
          fixture.chain
        );

        console.log(`UEA: ${mainUeaAddress}`);
        console.log(`CEA on ${fixture.label}: ${ceaResult.cea}`);
        console.log(`CEA deployed: ${ceaResult.isDeployed}`);

        // The main wallet should already have CEA deployed from prior Route 2 txs
        // If not deployed, this test documents the current state
        if (ceaResult.isDeployed) {
          console.log(
            'CEA already deployed — prior Route 2 tx deployed it via relay'
          );
        } else {
          console.log(
            'CEA NOT deployed — will be auto-deployed on next Route 2 tx'
          );
        }

        // Either way, address should be valid
        expect(ceaResult.cea).toMatch(/^0x[a-fA-F0-9]{40}$/);
      }, 30000);

      it('should send Route 2 outbound and verify CEA exists after relay', async () => {
        if (skipE2E) return;

        console.log(
          `\n=== Route 2 Outbound + CEA Deploy [${fixture.label}] ===`
        );

        // Check CEA status BEFORE
        const before = await getCEAAddress(
          mainUeaAddress,
          fixture.chain
        );
        console.log(
          `CEA before: ${before.cea}, deployed: ${before.isDeployed}`
        );

        // Send a payload-only Route 2 tx (counter increment)
        const incrementData = encodeFunctionData({
          abi: COUNTER_ABI,
          functionName: 'increment',
        });

        const params: UniversalExecuteParams = {
          to: {
            address: fixture.contracts.counter,
            chain: fixture.chain,
          },
          data: incrementData,
        };

        expect(detectRoute(params)).toBe(TransactionRoute.UOA_TO_CEA);

        const tx = await mainClient.universal.sendTransaction(params);
        console.log(`Route 2 TX hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

        // Wait for relay to execute on external chain (this is where CEA gets deployed)
        console.log('Waiting for relay...');
        const receipt = await tx.wait();
        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX: ${receipt.externalTxHash}`);

        expect(receipt.status).toBe(1);
        expect(receipt.externalTxHash).toBeDefined();

        // Verify external tx
        await verifyExternalTransaction(
          receipt.externalTxHash!,
          receipt.externalChain!
        );

        // Check CEA status AFTER — should now be deployed
        const after = await getCEAAddress(
          mainUeaAddress,
          fixture.chain
        );
        console.log(
          `CEA after: ${after.cea}, deployed: ${after.isDeployed}`
        );

        // CEA should be deployed after relay executed the outbound tx
        expect(after.isDeployed).toBe(true);
        // Address should be the same (deterministic)
        expect(after.cea.toLowerCase()).toBe(
          before.cea.toLowerCase()
        );

        // Double-check: getCode on external chain
        const extPublicClient = createPublicClient({
          transport: http(CHAIN_INFO[fixture.chain].defaultRPC[0]),
        });
        const code = await extPublicClient.getCode({
          address: after.cea,
        });
        console.log(
          `CEA on-chain code length: ${code ? (code.length - 2) / 2 : 0} bytes`
        );
        expect(code).toBeDefined();
        expect(code).not.toBe('0x');
      }, 360000);
    }
  );

  // ==========================================================================
  // 3. Route 3 prepareTransaction — CEA undeployed (on-chain auto-deploys)
  // ==========================================================================
  describe('3. Route 3 prepareTransaction — CEA undeployed', () => {
    it('should succeed at prepareTransaction even when CEA is not deployed (on-chain auto-deploys)', async () => {
      if (skipE2E) return;

      console.log(
        '\n=== Route 3 prepareTransaction — undeployed CEA (should succeed) ==='
      );

      // Create a fresh client from a never-used key (CEA won't exist on any chain)
      const freshKey = generatePrivateKey();
      const freshSetup = await createEvmPushClient({
        chain: CHAIN.ETHEREUM_SEPOLIA,
        privateKey: freshKey,
        printTraces: true,
      });
      const freshClient = freshSetup.pushClient;
      const freshUea = freshClient.universal
        .account as `0x${string}`;
      console.log(`Fresh UEA: ${freshUea}`);

      // Verify CEA is NOT deployed on BNB Testnet
      const ceaResult = await getCEAAddress(
        freshUea,
        CHAIN.BNB_TESTNET
      );
      console.log(
        `CEA on BNB: ${ceaResult.cea}, deployed: ${ceaResult.isDeployed}`
      );
      expect(ceaResult.isDeployed).toBe(false);

      // Route 3 params: from BNB CEA back to Push Chain
      const route3Params: UniversalExecuteParams = {
        from: { chain: CHAIN.BNB_TESTNET },
        to: freshUea,
        value: BigInt(1),
      };

      expect(detectRoute(route3Params)).toBe(
        TransactionRoute.CEA_TO_PUSH
      );

      // prepareTransaction should succeed — SDK no longer blocks Route 3 for undeployed CEA.
      // On-chain, Vault.finalizeUniversalTx will auto-deploy CEA via CEAFactory.deployCEA().
      const prepared =
        await freshClient.universal.prepareTransaction(route3Params);

      console.log(`Route: ${prepared.route}`);
      console.log(`Nonce: ${prepared.nonce.toString()}`);
      console.log(
        `Estimated gas: ${prepared.estimatedGas.toString()}`
      );
      console.log(
        `Payload (first 66): ${prepared.payload.slice(0, 66)}...`
      );

      expect(prepared.route).toBe('CEA_TO_PUSH');
      expect(prepared.payload).toBeDefined();
      expect(prepared.payload.length).toBeGreaterThan(2);

      console.log(
        'prepareTransaction succeeded — on-chain will auto-deploy CEA when tx is executed'
      );
    }, 60000);
  });

  // ==========================================================================
  // 4. Route 3 Works After CEA Deployed (main wallet)
  // ==========================================================================
  describe.each(fixtures)(
    '4. Route 3 prepareTransaction — CEA deployed [$label]',
    (fixture: ChainTestFixture) => {
      it('should succeed at prepareTransaction when CEA exists', async () => {
        if (skipE2E) return;

        console.log(
          `\n=== Route 3 prepareTransaction — deployed CEA [${fixture.label}] ===`
        );

        // Main wallet should have CEA deployed (from section 2 test above)
        const ceaResult = await getCEAAddress(
          mainUeaAddress,
          fixture.chain
        );
        console.log(
          `CEA: ${ceaResult.cea}, deployed: ${ceaResult.isDeployed}`
        );

        if (!ceaResult.isDeployed) {
          console.log(
            'Skipping — CEA not deployed (run section 2 test first)'
          );
          return;
        }

        // Route 3: from external chain CEA back to Push Chain
        const route3Params: UniversalExecuteParams = {
          from: { chain: fixture.chain },
          to: mainUeaAddress,
          value: BigInt(1),
        };

        expect(detectRoute(route3Params)).toBe(
          TransactionRoute.CEA_TO_PUSH
        );

        // prepareTransaction should succeed now
        const prepared =
          await mainClient.universal.prepareTransaction(route3Params);

        console.log(`Route: ${prepared.route}`);
        console.log(`Nonce: ${prepared.nonce.toString()}`);
        console.log(
          `Estimated gas: ${prepared.estimatedGas.toString()}`
        );
        console.log(
          `Payload (first 66): ${prepared.payload.slice(0, 66)}...`
        );

        expect(prepared.route).toBe('CEA_TO_PUSH');
        expect(prepared.payload).toBeDefined();
        expect(prepared.payload.length).toBeGreaterThan(2);
      }, 60000);
    }
  );
});

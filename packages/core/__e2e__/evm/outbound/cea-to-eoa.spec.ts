/* eslint-disable @typescript-eslint/no-non-null-assertion */
import '@e2e/shared/setup';
/**
 * CEA -> EOA: Inbound to Push Chain Native Account (Route 3)
 *
 * Tests for inbound transactions from external chains back to Push Chain via CEA,
 * targeting an EOA (native Push Chain account) signer (PUSH_PRIVATE_KEY).
 * Covers: ERC-20 bridge back, native bridge back.
 *
 * Parameterised across all active EVM chains via chain-fixtures.
 *
 * Coverage: Native Bridge Back, ERC-20 Bridge Back
 */
import { PushChain } from '../../../src';
import { CHAIN } from '../../../src/lib/constants/enums';
import { Hex, parseEther } from 'viem';
import { getCEAAddress } from '../../../src/lib/orchestrator/cea-utils';
import { TransactionRoute, detectRoute } from '../../../src/lib/orchestrator/route-detector';
import type { UniversalExecuteParams } from '../../../src/lib/orchestrator/orchestrator.types';
import type { MoveableToken } from '../../../src/lib/constants/tokens';
import { verifyExternalTransaction } from '@e2e/shared/external-tx-verifier';
import { getToken } from '@e2e/shared/constants';
import { getActiveFixtures } from '@e2e/shared/chain-fixtures';
import { createEvmPushClient } from '@e2e/shared/evm-client';
import { ensureCeaErc20Balance, ensureCeaNativeBalance } from '@e2e/shared/outbound-helpers';

const fixtures = getActiveFixtures();

describe('CEA -> EOA: Inbound to Push Chain Native Account (Route 3)', () => {
  let pushClient: Awaited<ReturnType<typeof PushChain.initialize>>;
  let eoaAddress: `0x${string}`;

  // Uses PUSH_PRIVATE_KEY — a native Push Chain account (not derived from external chain)
  const privateKey = process.env['PUSH_PRIVATE_KEY'] as Hex;
  const skipE2E = !privateKey;

  beforeAll(async () => {
    if (skipE2E) {
      console.log('Skipping E2E tests - PUSH_PRIVATE_KEY not set');
      return;
    }

    // Key difference: origin is PUSH_TESTNET_DONUT (native Push Chain EOA)
    const setup = await createEvmPushClient({
      chain: CHAIN.PUSH_TESTNET_DONUT,
      privateKey,
      printTraces: true,
      progressHook: (val) => {
        console.log(`[${val.id}] ${val.title}`);
      },
    });
    pushClient = setup.pushClient;

    eoaAddress = pushClient.universal.account;
    console.log(`Push EOA Address: ${eoaAddress}`);
  }, 60000);

  // ============================================================================
  // Core Scenarios — parameterised across EVM chains
  // ============================================================================
  describe.each(fixtures)('Core Scenarios [$label]', (fixture) => {
    let ceaAddress: `0x${string}`;
    let usdtToken: MoveableToken | undefined;

    beforeAll(async () => {
      if (skipE2E) return;

      const ceaResult = await getCEAAddress(eoaAddress, fixture.chain);
      ceaAddress = ceaResult.cea;
      console.log(`CEA Address on ${fixture.label}: ${ceaAddress}, deployed: ${ceaResult.isDeployed}`);

      try {
        usdtToken = getToken(fixture.chain, 'USDT');
        console.log(`USDT Token (${fixture.label}): ${usdtToken.address} (${usdtToken.decimals} decimals)`);
      } catch {
        console.log(`USDT token not found for ${fixture.label}`);
      }
    }, 60000);

    // ============================================================================
    // 1. Funds — ERC-20 bridge back
    // ============================================================================
    describe('1. Funds', () => {
      beforeAll(async () => {
        if (skipE2E || !usdtToken) return;
        await ensureCeaErc20Balance({
          pushClient,
          ceaAddress,
          token: usdtToken,
          requiredAmount: BigInt(20000),
          targetChain: fixture.chain,
        });
      }, 600000);

      it('should bridge ERC-20 USDT back to Push Chain from EOA CEA', async () => {
        if (skipE2E) return;
        if (!usdtToken) {
          console.log('Skipping - USDT token not found');
          return;
        }

        console.log(`\n=== Test: EOA ERC-20 USDT Inbound (CEA -> Push, Route 3) [${fixture.label}] ===`);

        const params: UniversalExecuteParams = {
          from: { chain: fixture.chain },
          to: eoaAddress,
          funds: {
            amount: BigInt(10000),
            token: usdtToken,
          },
        };

        expect(detectRoute(params)).toBe(TransactionRoute.CEA_TO_PUSH);

        const tx = await pushClient.universal.sendTransaction(params);

        console.log(`Push Chain TX Hash: ${tx.hash}`);
        console.log(`Source Chain: ${tx.chain}`);

        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(tx.chain).toBe(fixture.chain);

        // Wait for outbound relay
        console.log('Calling tx.wait() - polling for external chain tx hash...');
        const receipt = await tx.wait();
        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);
        console.log(`External Chain: ${receipt.externalChain}`);
        console.log(`External Explorer: ${receipt.externalExplorerUrl}`);

        expect(receipt.status).toBe(1);
        expect(receipt.externalTxHash).toBeDefined();
        expect(receipt.externalTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(receipt.externalChain).toBe(fixture.chain);

        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);
      }, 600000);
    });

    // ============================================================================
    // 2. Native Funds — native bridge back
    // ============================================================================
    describe('2. Native Funds', () => {
      beforeAll(async () => {
        if (skipE2E) return;
        await ensureCeaNativeBalance({
          pushClient,
          ceaAddress,
          requiredAmount: parseEther('0.0002'),
          targetChain: fixture.chain,
        });
      }, 600000);

      it('should bridge native token back to Push Chain from EOA CEA', async () => {
        if (skipE2E) return;

        console.log(`\n=== Test: EOA Native Inbound (CEA -> Push, Route 3) [${fixture.label}] ===`);

        const params: UniversalExecuteParams = {
          from: { chain: fixture.chain },
          to: eoaAddress,
          value: parseEther('0.00005'),
        };

        expect(detectRoute(params)).toBe(TransactionRoute.CEA_TO_PUSH);

        const tx = await pushClient.universal.sendTransaction(params);

        console.log(`Push Chain TX Hash: ${tx.hash}`);
        console.log(`Source Chain: ${tx.chain}`);

        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(tx.chain).toBe(fixture.chain);

        // Wait for outbound relay
        console.log('Calling tx.wait() - polling for external chain tx hash...');
        const receipt = await tx.wait();
        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);
        console.log(`External Chain: ${receipt.externalChain}`);
        console.log(`External Explorer: ${receipt.externalExplorerUrl}`);

        expect(receipt.status).toBe(1);
        expect(receipt.externalTxHash).toBeDefined();
        expect(receipt.externalTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(receipt.externalChain).toBe(fixture.chain);

        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);
      }, 600000);
    });

  });
});

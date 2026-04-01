/* eslint-disable @typescript-eslint/no-non-null-assertion */
import '@e2e/shared/setup';
/**
 * CEA → UEA: Inbound Transactions (Route 3)
 *
 * Tests for inbound transactions from external chains back to Push Chain via CEA,
 * targeting a UEA (Universal External Account) signer (EVM_PRIVATE_KEY).
 * Covers: Route Detection, CEA Prerequisites, Transaction Preparation, FUNDS only,
 * PAYLOAD only, FUNDS + PAYLOAD, E2E Sync, Error Handling, Progress Hooks
 *
 * UTX Gap Coverage (S9-S12):
 * UTX-02 Value to Others, UTX-04 Funds to Others, UTX-16 Native Funds to Others,
 * UTX-13 Value+Funds+Data to Contract.
 *
 * Parameterised across all active EVM chains via chain-fixtures.
 *
 * Prerequisites:
 * - CEA must be deployed on the external chain
 * - The burn/deposit mechanism carries value through the relay (no pre-funding needed)
 */
import { PushChain } from '../../../src';
import { PUSH_NETWORK, CHAIN } from '../../../src/lib/constants/enums';
import { CHAIN_INFO, UNIVERSAL_GATEWAY_ADDRESSES } from '../../../src/lib/constants/chain';
import { createWalletClient, http, Hex, parseEther, formatEther, createPublicClient, encodeFunctionData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { getCEAAddress, chainSupportsCEA } from '../../../src/lib/orchestrator/cea-utils';
import { TransactionRoute, detectRoute } from '../../../src/lib/orchestrator/route-detector';
import type { UniversalExecuteParams, ChainTarget } from '../../../src/lib/orchestrator/orchestrator.types';
import type { ProgressEvent } from '../../../src/lib/progress-hook/progress-hook.types';
import { ERC20_EVM } from '../../../src/lib/constants/abi/erc20.evm';
import { type MoveableToken } from '../../../src/lib/constants/tokens';
import { COUNTER_ABI_PAYABLE } from '../../../src/lib/push-chain/helpers/abis';
import { COUNTER_ADDRESS_PAYABLE } from '../../../src/lib/push-chain/helpers/addresses';
import { verifyExternalTransaction } from '@e2e/shared/external-tx-verifier';
import { getToken } from '@e2e/shared/constants';
import { getActiveFixtures, type ChainTestFixture } from '@e2e/shared/chain-fixtures';
import { createEvmPushClient } from '@e2e/shared/evm-client';
import { TEST_TARGET, NATIVE_ADDRESS, COUNTER_ABI, ensureCeaErc20Balance, ensureCeaNativeBalance } from '@e2e/shared/outbound-helpers';

// PRC-20 token on Push Chain (pUSDT) — used for multicall approve tests
// that execute ON Push Chain (this is NOT an ERC-20 on external chains)
const PUSH_CHAIN_PUSDT = '0x2f98B4235FD2BA0173a2B056D722879360B12E7b' as `0x${string}`;

const fixtures = getActiveFixtures();

describe('CEA → UEA: Inbound Transactions (Route 3)', () => {
  let pushClient: Awaited<ReturnType<typeof PushChain.initialize>>;
  let ueaAddress: `0x${string}`;
  let pushPublicClient: ReturnType<typeof createPublicClient>;

  const privateKey = process.env['EVM_PRIVATE_KEY'] as Hex;
  const skipE2E = !privateKey;

  beforeAll(async () => {
    if (skipE2E) {
      console.log('Skipping E2E tests - EVM_PRIVATE_KEY not set');
      return;
    }

    const setup = await createEvmPushClient({
      chain: CHAIN.ETHEREUM_SEPOLIA,
      privateKey,
      printTraces: true,
      progressHook: (val: ProgressEvent) => {
        console.log(`[${val.id}] ${val.title}`);
      },
    });
    pushClient = setup.pushClient;

    ueaAddress = pushClient.universal.account;
    console.log(`UEA Address: ${ueaAddress}`);

    pushPublicClient = createPublicClient({
      transport: http(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]),
    });
  }, 60000);

  // ============================================================================
  // Core Scenarios — parameterised across EVM chains
  // ============================================================================
  describe.each(fixtures)('Core Scenarios [$label]', (fixture: ChainTestFixture) => {
    let fixtureCeaAddress: `0x${string}`;
    let fixtureUsdtToken: MoveableToken | undefined;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    let publicClient: ReturnType<typeof createPublicClient>;

    beforeAll(async () => {
      if (skipE2E) return;
      const ceaResult = await getCEAAddress(ueaAddress, fixture.chain);
      fixtureCeaAddress = ceaResult.cea;
      console.log(`CEA Address on ${fixture.label}: ${fixtureCeaAddress}, deployed: ${ceaResult.isDeployed}`);
      try { fixtureUsdtToken = getToken(fixture.chain, 'USDT'); } catch { /* token not available */ }
      if (fixtureUsdtToken) {
        console.log(`USDT Token (${fixture.label}): ${fixtureUsdtToken.address} (${fixtureUsdtToken.decimals} decimals)`);
      }
      publicClient = createPublicClient({ transport: http(CHAIN_INFO[fixture.chain].defaultRPC[0]) });
    }, 60000);

    // ==========================================================================
    // 1. Funds
    // ==========================================================================
    describe('1. Funds', () => {
      beforeAll(async () => {
        if (skipE2E || !fixtureUsdtToken) return;
        await ensureCeaErc20Balance({
          pushClient,
          ceaAddress: fixtureCeaAddress,
          token: fixtureUsdtToken,
          requiredAmount: BigInt(20000), // 2 tests x 10000 (0.01 USDT each)
          targetChain: fixture.chain,
        });
      }, 600000);

      it('should bridge ERC20 USDT back from CEA to Push Chain', async () => {
        if (skipE2E) return;
        if (!fixtureUsdtToken) {
          console.log(`Skipping [${fixture.label}] - USDT token not found in MOVEABLE_TOKENS`);
          return;
        }

        console.log(`\n=== Test: ERC20 Self-Call — Bridge USDT Back [${fixture.label}] ===`);
        console.log('Burns ERC20 on external chain, mints on Push Chain. SDK auto-adds approve step.');

        const bridgeAmount = BigInt(10000); // 0.01 USDT (6 decimals)

        const params: UniversalExecuteParams = {
          from: { chain: fixture.chain },
          to: ueaAddress, // Self — bridge back to own UEA
          funds: {
            amount: bridgeAmount,
            token: fixtureUsdtToken,
          },
        };

        expect(detectRoute(params)).toBe(TransactionRoute.CEA_TO_PUSH);

        const tx = await pushClient.universal.sendTransaction(params);

        console.log(`Push Chain TX Hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(tx.chain).toBe(fixture.chain);

        // Wait for outbound relay
        console.log('Calling tx.wait() - polling for external chain tx hash...');
        const receipt = await tx.wait();
        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);
        console.log(`External Explorer: ${receipt.externalExplorerUrl}`);

        expect(receipt.status).toBe(1);
        expect(receipt.externalTxHash).toBeDefined();
        expect(receipt.externalTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(receipt.externalChain).toBe(fixture.chain);

        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);
      }, 600000);
    });

    // ==========================================================================
    // 2. Payload (Data)
    // ==========================================================================
    describe('2. Payload (Data)', () => {
      it('should increment Push Chain counter via Route 3 payload', async () => {
        if (skipE2E) return;

        console.log(`\n=== Test: Payload-Only Inbound — Counter Increment [${fixture.label}] ===`);

        // Read Push Chain counter BEFORE
        const counterBefore = await pushPublicClient.readContract({
          address: COUNTER_ADDRESS_PAYABLE,
          abi: COUNTER_ABI_PAYABLE,
          functionName: 'countPC',
        }) as bigint;
        console.log(`Push Chain Counter BEFORE: ${counterBefore}`);

        const pushPayload = encodeFunctionData({
          abi: COUNTER_ABI,
          functionName: 'increment',
        });

        const params: UniversalExecuteParams = {
          from: { chain: fixture.chain },
          to: COUNTER_ADDRESS_PAYABLE,
          data: pushPayload,
        };

        expect(detectRoute(params)).toBe(TransactionRoute.CEA_TO_PUSH);

        const tx = await pushClient.universal.sendTransaction(params);

        console.log(`Push Chain TX Hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

        // Wait for outbound relay and verify external chain details
        console.log('Calling tx.wait() - polling for outbound tx hash...');
        const receipt = await tx.wait();
        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);
        console.log(`External Explorer: ${receipt.externalExplorerUrl}`);

        expect(receipt.status).toBe(1);
        expect(receipt.externalTxHash).toBeDefined();
        expect(receipt.externalTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(receipt.externalChain).toBe(fixture.chain);

        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);

        // CEA-to-Push requires round-trip: Push → External → Push (inbound)
        // The return inbound relay takes significant time, poll until counter increments
        const maxInboundWait = 180000;
        const pollInterval = 10000;
        const pollStart = Date.now();
        let counterAfter = counterBefore;
        while (Date.now() - pollStart < maxInboundWait) {
          await new Promise((r) => setTimeout(r, pollInterval));
          counterAfter = await pushPublicClient.readContract({
            address: COUNTER_ADDRESS_PAYABLE,
            abi: COUNTER_ABI_PAYABLE,
            functionName: 'countPC',
          }) as bigint;
          const elapsed = Math.round((Date.now() - pollStart) / 1000);
          console.log(`Polling counter: ${counterAfter} (elapsed: ${elapsed}s)`);
          if (counterAfter > counterBefore) break;
        }
        console.log(`Push Chain Counter AFTER: ${counterAfter}`);
        expect(counterAfter).toBeGreaterThan(counterBefore);
      }, 600000);
    });

    // ==========================================================================
    // 3. Multicall
    // ==========================================================================
    describe('3. Multicall', () => {
      it('should execute multicall on Push Chain: increment counter + approve (no funds)', async () => {
        if (skipE2E) return;

        console.log(`\n=== Test: UEA Multicall Only (Route 3) — Counter Increment + Approve [${fixture.label}] ===`);

        // Read Push Chain counter BEFORE
        const counterBefore = await pushPublicClient.readContract({
          address: COUNTER_ADDRESS_PAYABLE,
          abi: COUNTER_ABI_PAYABLE,
          functionName: 'countPC',
        }) as bigint;
        console.log(`Push Chain Counter BEFORE: ${counterBefore}`);

        const incrementPayload = encodeFunctionData({
          abi: COUNTER_ABI,
          functionName: 'increment',
        });

        const approvePayload = encodeFunctionData({
          abi: ERC20_EVM,
          functionName: 'approve',
          args: [TEST_TARGET, BigInt(1000000)],
        });

        const params: UniversalExecuteParams = {
          from: { chain: fixture.chain },
          to: NATIVE_ADDRESS as `0x${string}`,
          data: [
            { to: COUNTER_ADDRESS_PAYABLE, value: BigInt(0), data: incrementPayload },
            { to: PUSH_CHAIN_PUSDT, value: BigInt(0), data: approvePayload },
          ],
        };

        expect(detectRoute(params)).toBe(TransactionRoute.CEA_TO_PUSH);

        const tx = await pushClient.universal.sendTransaction(params);

        console.log(`Push Chain TX Hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(tx.chain).toBe(fixture.chain);

        // Wait for outbound relay
        console.log('Calling tx.wait() - polling for external chain tx hash...');
        const receipt = await tx.wait();
        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);
        console.log(`External Explorer: ${receipt.externalExplorerUrl}`);

        expect(receipt.status).toBe(1);
        expect(receipt.externalTxHash).toBeDefined();
        expect(receipt.externalTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(receipt.externalChain).toBe(fixture.chain);

        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);

        // CEA-to-Push multicall requires round-trip: Push → External → Push (inbound)
        // The return inbound relay takes significant time, poll until counter increments
        const maxInboundWait = 180000; // 3 minutes for return inbound
        const pollInterval = 10000;
        const pollStart = Date.now();
        let counterAfter = counterBefore;
        while (Date.now() - pollStart < maxInboundWait) {
          await new Promise((r) => setTimeout(r, pollInterval));
          counterAfter = await pushPublicClient.readContract({
            address: COUNTER_ADDRESS_PAYABLE,
            abi: COUNTER_ABI_PAYABLE,
            functionName: 'countPC',
          }) as bigint;
          const elapsed = Math.round((Date.now() - pollStart) / 1000);
          console.log(`Polling counter: ${counterAfter} (elapsed: ${elapsed}s)`);
          if (counterAfter > counterBefore) break;
        }
        console.log(`Push Chain Counter AFTER: ${counterAfter}`);
        expect(counterAfter).toBeGreaterThan(counterBefore);
      }, 600000);
    });

    // ==========================================================================
    // 4. Funds + Payload
    // ==========================================================================
    describe('4. Funds + Payload', () => {
      beforeAll(async () => {
        if (skipE2E || !fixtureUsdtToken) return;
        await ensureCeaErc20Balance({
          pushClient,
          ceaAddress: fixtureCeaAddress,
          token: fixtureUsdtToken,
          requiredAmount: BigInt(20000), // 2 tests x 10000 (0.01 USDT each)
          targetChain: fixture.chain,
        });
      }, 600000);

      it('should bridge ERC20 USDT and increment Push Chain counter', async () => {
        if (skipE2E) return;
        if (!fixtureUsdtToken) {
          console.log(`Skipping [${fixture.label}] - USDT token not found`);
          return;
        }

        console.log(`\n=== Test: ERC20 Self-Call + Counter Increment [${fixture.label}] ===`);
        console.log('Burns ERC20 on external chain + increments counter on Push Chain.');

        const bridgeAmount = BigInt(10000); // 0.01 USDT

        // Read Push Chain counter BEFORE
        const counterBefore = await pushPublicClient.readContract({
          address: COUNTER_ADDRESS_PAYABLE,
          abi: COUNTER_ABI_PAYABLE,
          functionName: 'countPC',
        }) as bigint;
        console.log(`Push Chain Counter BEFORE: ${counterBefore}`);

        const pushPayload = encodeFunctionData({
          abi: COUNTER_ABI,
          functionName: 'increment',
        });

        const params: UniversalExecuteParams = {
          from: { chain: fixture.chain },
          to: COUNTER_ADDRESS_PAYABLE,
          funds: {
            amount: bridgeAmount,
            token: fixtureUsdtToken,
          },
          data: pushPayload,
        };

        expect(detectRoute(params)).toBe(TransactionRoute.CEA_TO_PUSH);

        const tx = await pushClient.universal.sendTransaction(params);

        console.log(`Push Chain TX Hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(tx.chain).toBe(fixture.chain);

        // Wait for outbound relay
        console.log('Calling tx.wait() - polling for external chain tx hash...');
        const receipt = await tx.wait();
        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);
        console.log(`External Explorer: ${receipt.externalExplorerUrl}`);

        expect(receipt.status).toBe(1);
        expect(receipt.externalTxHash).toBeDefined();
        expect(receipt.externalTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(receipt.externalChain).toBe(fixture.chain);

        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);

        // CEA-to-Push requires round-trip: Push → External → Push (inbound)
        const maxInboundWait = 180000;
        const pollInterval = 10000;
        const pollStart = Date.now();
        let counterAfter = counterBefore;
        while (Date.now() - pollStart < maxInboundWait) {
          await new Promise((r) => setTimeout(r, pollInterval));
          counterAfter = await pushPublicClient.readContract({
            address: COUNTER_ADDRESS_PAYABLE,
            abi: COUNTER_ABI_PAYABLE,
            functionName: 'countPC',
          }) as bigint;
          const elapsed = Math.round((Date.now() - pollStart) / 1000);
          console.log(`Polling counter: ${counterAfter} (elapsed: ${elapsed}s)`);
          if (counterAfter > counterBefore) break;
        }
        console.log(`Push Chain Counter AFTER: ${counterAfter}`);
        expect(counterAfter).toBeGreaterThan(counterBefore);
      }, 600000);
    });

    // ==========================================================================
    // 5. Funds + Multicall
    // ==========================================================================
    describe('5. Funds + Multicall', () => {
      beforeAll(async () => {
        if (skipE2E || !fixtureUsdtToken) return;
        await ensureCeaErc20Balance({
          pushClient,
          ceaAddress: fixtureCeaAddress,
          token: fixtureUsdtToken,
          requiredAmount: BigInt(20000),
          targetChain: fixture.chain,
        });
      }, 600000);

      it('should bridge ERC-20 funds and execute multicall on Push Chain', async () => {
        if (skipE2E) return;
        if (!fixtureUsdtToken) {
          console.log(`Skipping [${fixture.label}] - USDT token not found`);
          return;
        }

        console.log(`\n=== Test: UEA Funds + Multicall (Route 3) — ERC-20 + Counter + Approve [${fixture.label}] ===`);

        // Read Push Chain counter BEFORE
        const counterBefore = await pushPublicClient.readContract({
          address: COUNTER_ADDRESS_PAYABLE,
          abi: COUNTER_ABI_PAYABLE,
          functionName: 'countPC',
        }) as bigint;
        console.log(`Push Chain Counter BEFORE: ${counterBefore}`);

        const incrementPayload = encodeFunctionData({
          abi: COUNTER_ABI,
          functionName: 'increment',
        });

        const approvePayload = encodeFunctionData({
          abi: ERC20_EVM,
          functionName: 'approve',
          args: [TEST_TARGET, BigInt(1000000)],
        });

        const params: UniversalExecuteParams = {
          from: { chain: fixture.chain },
          to: NATIVE_ADDRESS as `0x${string}`,
          funds: {
            amount: BigInt(10000),
            token: fixtureUsdtToken,
          },
          data: [
            { to: COUNTER_ADDRESS_PAYABLE, value: BigInt(0), data: incrementPayload },
            { to: PUSH_CHAIN_PUSDT, value: BigInt(0), data: approvePayload },
          ],
        };

        expect(detectRoute(params)).toBe(TransactionRoute.CEA_TO_PUSH);

        const tx = await pushClient.universal.sendTransaction(params);

        console.log(`Push Chain TX Hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(tx.chain).toBe(fixture.chain);

        // Wait for outbound relay
        console.log('Calling tx.wait() - polling for external chain tx hash...');
        const receipt = await tx.wait();
        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);
        console.log(`External Explorer: ${receipt.externalExplorerUrl}`);

        // Push Chain tx must succeed
        expect(receipt.status).toBe(1);

        // ERC-20 + multicall outbound may take longer than the default 180s relay poll.
        // Verify external chain details when available; log warning if relay is still processing.
        if (receipt.externalTxHash) {
          expect(receipt.externalTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
          expect(receipt.externalChain).toBe(fixture.chain);
          await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);
        } else {
          console.warn(
            '[Test 14] External TX hash not available — relay may still be processing the ERC-20 + multicall outbound. ' +
            'Push Chain tx succeeded. Retry or check explorer manually.'
          );
        }

        // CEA-to-Push requires round-trip: Push → External → Push (inbound)
        const maxInboundWait = 180000;
        const pollInterval = 10000;
        const pollStart = Date.now();
        let counterAfter = counterBefore;
        while (Date.now() - pollStart < maxInboundWait) {
          await new Promise((r) => setTimeout(r, pollInterval));
          counterAfter = await pushPublicClient.readContract({
            address: COUNTER_ADDRESS_PAYABLE,
            abi: COUNTER_ABI_PAYABLE,
            functionName: 'countPC',
          }) as bigint;
          const elapsed = Math.round((Date.now() - pollStart) / 1000);
          console.log(`Polling counter: ${counterAfter} (elapsed: ${elapsed}s)`);
          if (counterAfter > counterBefore) break;
        }
        console.log(`Push Chain Counter AFTER: ${counterAfter}`);
        expect(counterAfter).toBeGreaterThan(counterBefore);
      }, 600000);
    });

    // ==========================================================================
    // 6. Native Funds
    // ==========================================================================
    describe('6. Native Funds', () => {
      beforeAll(async () => {
        if (skipE2E) return;
        await ensureCeaNativeBalance({
          pushClient,
          ceaAddress: fixtureCeaAddress,
          requiredAmount: parseEther('0.0002'), // buffer for native transfer tests
          targetChain: fixture.chain,
        });
      }, 600000);

      it('should transfer native token from CEA to Push Chain', async () => {
        if (skipE2E) return;

        console.log(`\n=== Test: Native Inbound (CEA → Push) [${fixture.label}] ===`);

        const params: UniversalExecuteParams = {
          from: { chain: fixture.chain },
          to: ueaAddress,
          value: parseEther('0.00005'),
        };

        expect(detectRoute(params)).toBe(TransactionRoute.CEA_TO_PUSH);

        const tx = await pushClient.universal.sendTransaction(params);

        console.log(`Push Chain TX Hash: ${tx.hash}`);
        console.log(`Source Chain: ${tx.chain}`);

        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(tx.chain).toBe(fixture.chain);

        // Wait for outbound relay and verify external chain details
        console.log('Calling tx.wait() - polling for outbound tx hash...');
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

    // ==========================================================================
    // 7. Native Funds + Payload
    // ==========================================================================
    describe('7. Native Funds + Payload', () => {
      it('should transfer native token and increment Push Chain counter', async () => {
        if (skipE2E) return;

        console.log(`\n=== Test: FUNDS + PAYLOAD Inbound — Counter Increment [${fixture.label}] ===`);

        // Read Push Chain counter BEFORE
        const counterBefore = await pushPublicClient.readContract({
          address: COUNTER_ADDRESS_PAYABLE,
          abi: COUNTER_ABI_PAYABLE,
          functionName: 'countPC',
        }) as bigint;
        console.log(`Push Chain Counter BEFORE: ${counterBefore}`);

        const pushPayload = encodeFunctionData({
          abi: COUNTER_ABI,
          functionName: 'increment',
        });

        const params: UniversalExecuteParams = {
          from: { chain: fixture.chain },
          to: COUNTER_ADDRESS_PAYABLE,
          value: parseEther('0.00005'),
          data: pushPayload,
        };

        expect(detectRoute(params)).toBe(TransactionRoute.CEA_TO_PUSH);

        const tx = await pushClient.universal.sendTransaction(params);

        console.log(`Push Chain TX Hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(tx.chain).toBe(fixture.chain);

        // Wait for outbound relay and verify external chain details
        console.log('Calling tx.wait() - polling for outbound tx hash...');
        const receipt = await tx.wait();
        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);
        console.log(`External Explorer: ${receipt.externalExplorerUrl}`);

        expect(receipt.status).toBe(1);
        expect(receipt.externalTxHash).toBeDefined();
        expect(receipt.externalTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(receipt.externalChain).toBe(fixture.chain);

        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);

        // CEA-to-Push requires round-trip: Push → External → Push (inbound)
        const maxInboundWait = 180000;
        const pollInterval = 10000;
        const pollStart = Date.now();
        let counterAfter = counterBefore;
        while (Date.now() - pollStart < maxInboundWait) {
          await new Promise((r) => setTimeout(r, pollInterval));
          counterAfter = await pushPublicClient.readContract({
            address: COUNTER_ADDRESS_PAYABLE,
            abi: COUNTER_ABI_PAYABLE,
            functionName: 'countPC',
          }) as bigint;
          const elapsed = Math.round((Date.now() - pollStart) / 1000);
          console.log(`Polling counter: ${counterAfter} (elapsed: ${elapsed}s)`);
          if (counterAfter > counterBefore) break;
        }
        console.log(`Push Chain Counter AFTER: ${counterAfter}`);
        expect(counterAfter).toBeGreaterThan(counterBefore);
      }, 600000);
    });

    // ==========================================================================
    // 8. Native Funds + Multicall
    // ==========================================================================
    describe('8. Native Funds + Multicall', () => {
      beforeAll(async () => {
        if (skipE2E) return;
        await ensureCeaNativeBalance({
          pushClient,
          ceaAddress: fixtureCeaAddress,
          requiredAmount: parseEther('0.0002'),
          targetChain: fixture.chain,
        });
      }, 600000);

      it('should bridge native token and execute multicall on Push Chain', async () => {
        if (skipE2E) return;

        console.log(`\n=== Test: UEA Native Funds + Multicall (Route 3) — Native + Counter + Approve [${fixture.label}] ===`);

        // Read Push Chain counter BEFORE
        const counterBefore = await pushPublicClient.readContract({
          address: COUNTER_ADDRESS_PAYABLE,
          abi: COUNTER_ABI_PAYABLE,
          functionName: 'countPC',
        }) as bigint;
        console.log(`Push Chain Counter BEFORE: ${counterBefore}`);

        const incrementPayload = encodeFunctionData({
          abi: COUNTER_ABI,
          functionName: 'increment',
        });

        const approvePayload = encodeFunctionData({
          abi: ERC20_EVM,
          functionName: 'approve',
          args: [TEST_TARGET, BigInt(1000000)],
        });

        const params: UniversalExecuteParams = {
          from: { chain: fixture.chain },
          to: NATIVE_ADDRESS as `0x${string}`,
          value: parseEther('0.00005'),
          data: [
            { to: COUNTER_ADDRESS_PAYABLE, value: BigInt(0), data: incrementPayload },
            { to: PUSH_CHAIN_PUSDT, value: BigInt(0), data: approvePayload },
          ],
        };

        expect(detectRoute(params)).toBe(TransactionRoute.CEA_TO_PUSH);

        const tx = await pushClient.universal.sendTransaction(params);

        console.log(`Push Chain TX Hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(tx.chain).toBe(fixture.chain);

        // Wait for outbound relay
        console.log('Calling tx.wait() - polling for external chain tx hash...');
        const receipt = await tx.wait();
        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);
        console.log(`External Explorer: ${receipt.externalExplorerUrl}`);

        expect(receipt.status).toBe(1);
        expect(receipt.externalTxHash).toBeDefined();
        expect(receipt.externalTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(receipt.externalChain).toBe(fixture.chain);

        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);

        // CEA-to-Push requires round-trip: Push → External → Push (inbound)
        const maxInboundWait = 180000;
        const pollInterval = 10000;
        const pollStart = Date.now();
        let counterAfter = counterBefore;
        while (Date.now() - pollStart < maxInboundWait) {
          await new Promise((r) => setTimeout(r, pollInterval));
          counterAfter = await pushPublicClient.readContract({
            address: COUNTER_ADDRESS_PAYABLE,
            abi: COUNTER_ABI_PAYABLE,
            functionName: 'countPC',
          }) as bigint;
          const elapsed = Math.round((Date.now() - pollStart) / 1000);
          console.log(`Polling counter: ${counterAfter} (elapsed: ${elapsed}s)`);
          if (counterAfter > counterBefore) break;
        }
        console.log(`Push Chain Counter AFTER: ${counterAfter}`);
        expect(counterAfter).toBeGreaterThan(counterBefore);
      }, 600000);
    });

    // ==========================================================================
    // 9. Value to Others (UTX-02)
    // ==========================================================================
    describe('9. Value to Others (UTX-02)', () => {
      beforeAll(async () => {
        if (skipE2E) return;
        await ensureCeaNativeBalance({
          pushClient,
          ceaAddress: fixtureCeaAddress,
          requiredAmount: parseEther('0.0002'),
          targetChain: fixture.chain,
        });
      }, 600000);

      it('should transfer native value from CEA to different address', async () => {
        if (skipE2E) return;

        console.log(`\n=== Test: Value to Others via Route 3 [${fixture.label}] ===`);

        const params: UniversalExecuteParams = {
          from: { chain: fixture.chain },
          to: '0x742d35Cc6634c0532925A3b844BC9e7595F5bE21' as `0x${string}`,
          value: parseEther('0.00005'),
        };

        expect(detectRoute(params)).toBe(TransactionRoute.CEA_TO_PUSH);

        const tx = await pushClient.universal.sendTransaction(params);

        console.log(`Push Chain TX Hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(tx.chain).toBe(fixture.chain);

        const receipt = await tx.wait();
        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);
        expect(receipt.status).toBe(1);

        if (receipt.externalTxHash) {
          expect(receipt.externalTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
          await verifyExternalTransaction(receipt.externalTxHash, receipt.externalChain!);
        }
      }, 600000);
    });

    // ==========================================================================
    // 10. Funds to Others (UTX-04)
    // ==========================================================================
    describe('10. Funds to Others (UTX-04)', () => {
      beforeAll(async () => {
        if (skipE2E || !fixtureUsdtToken) return;
        await ensureCeaErc20Balance({
          pushClient,
          ceaAddress: fixtureCeaAddress,
          token: fixtureUsdtToken,
          requiredAmount: BigInt(10000),
          targetChain: fixture.chain,
        });
      }, 600000);

      it('should bridge ERC20 USDT from CEA to different address', async () => {
        if (skipE2E) return;
        if (!fixtureUsdtToken) {
          console.log(`Skipping [${fixture.label}] - USDT token not found`);
          return;
        }

        console.log(`\n=== Test: Funds to Others via Route 3 [${fixture.label}] ===`);

        const bridgeAmount = BigInt(10000); // 0.01 USDT

        const params: UniversalExecuteParams = {
          from: { chain: fixture.chain },
          to: '0x742d35Cc6634c0532925A3b844BC9e7595F5bE21' as `0x${string}`,
          funds: {
            amount: bridgeAmount,
            token: fixtureUsdtToken,
          },
        };

        expect(detectRoute(params)).toBe(TransactionRoute.CEA_TO_PUSH);

        const tx = await pushClient.universal.sendTransaction(params);

        console.log(`Push Chain TX Hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(tx.chain).toBe(fixture.chain);

        const receipt = await tx.wait();
        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);
        expect(receipt.status).toBe(1);

        if (receipt.externalTxHash) {
          expect(receipt.externalTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
          await verifyExternalTransaction(receipt.externalTxHash, receipt.externalChain!);
        }
      }, 600000);
    });

    // ==========================================================================
    // 11. Native Funds to Others (UTX-16)
    // ==========================================================================
    describe('11. Native Funds to Others (UTX-16)', () => {
      beforeAll(async () => {
        if (skipE2E) return;
        await ensureCeaNativeBalance({
          pushClient,
          ceaAddress: fixtureCeaAddress,
          requiredAmount: parseEther('0.0002'),
          targetChain: fixture.chain,
        });
      }, 600000);

      it('should transfer native token from CEA to different address', async () => {
        if (skipE2E) return;

        console.log(`\n=== Test: Native Funds to Others via Route 3 [${fixture.label}] ===`);

        const params: UniversalExecuteParams = {
          from: { chain: fixture.chain },
          to: '0x742d35Cc6634c0532925A3b844BC9e7595F5bE21' as `0x${string}`,
          value: parseEther('0.00005'),
        };

        expect(detectRoute(params)).toBe(TransactionRoute.CEA_TO_PUSH);

        const tx = await pushClient.universal.sendTransaction(params);

        console.log(`Push Chain TX Hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

        const receipt = await tx.wait();
        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);
        expect(receipt.status).toBe(1);

        if (receipt.externalTxHash) {
          expect(receipt.externalTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
          await verifyExternalTransaction(receipt.externalTxHash, receipt.externalChain!);
        }
      }, 600000);
    });

    // ==========================================================================
    // 12. Value + Funds + Data to Contract (UTX-13)
    // ==========================================================================
    describe('12. Value + Funds + Data to Contract (UTX-13)', () => {
      beforeAll(async () => {
        if (skipE2E || !fixtureUsdtToken) return;
        await ensureCeaErc20Balance({
          pushClient,
          ceaAddress: fixtureCeaAddress,
          token: fixtureUsdtToken,
          requiredAmount: BigInt(10000),
          targetChain: fixture.chain,
        });
        await ensureCeaNativeBalance({
          pushClient,
          ceaAddress: fixtureCeaAddress,
          requiredAmount: parseEther('0.0002'),
          targetChain: fixture.chain,
        });
      }, 600000);

      it('should send value + funds + data to counter contract via Route 3', async () => {
        if (skipE2E) return;
        if (!fixtureUsdtToken) {
          console.log(`Skipping [${fixture.label}] - USDT token not found`);
          return;
        }

        console.log(`\n=== Test: V+F+D to Contract via Route 3 [${fixture.label}] ===`);

        const pushPayload = encodeFunctionData({
          abi: COUNTER_ABI,
          functionName: 'increment',
        });

        const counterBefore = await pushPublicClient.readContract({
          address: COUNTER_ADDRESS_PAYABLE,
          abi: COUNTER_ABI_PAYABLE,
          functionName: 'countPC',
        }) as bigint;
        console.log(`Counter BEFORE: ${counterBefore}`);

        const params: UniversalExecuteParams = {
          from: { chain: fixture.chain },
          to: COUNTER_ADDRESS_PAYABLE,
          value: parseEther('0.00001'),
          funds: {
            amount: BigInt(10000), // 0.01 USDT
            token: fixtureUsdtToken,
          },
          data: pushPayload,
        };

        expect(detectRoute(params)).toBe(TransactionRoute.CEA_TO_PUSH);

        const tx = await pushClient.universal.sendTransaction(params);

        console.log(`Push Chain TX Hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

        const receipt = await tx.wait();
        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);
        expect(receipt.status).toBe(1);

        if (receipt.externalTxHash) {
          expect(receipt.externalTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
          await verifyExternalTransaction(receipt.externalTxHash, receipt.externalChain!);
        }

        // Poll for counter increment (round-trip relay — V+F+D is slower)
        const maxInboundWait = 300000;
        const pollInterval = 10000;
        const pollStart = Date.now();
        let counterAfter = counterBefore;
        while (Date.now() - pollStart < maxInboundWait) {
          await new Promise((r) => setTimeout(r, pollInterval));
          counterAfter = await pushPublicClient.readContract({
            address: COUNTER_ADDRESS_PAYABLE,
            abi: COUNTER_ABI_PAYABLE,
            functionName: 'countPC',
          }) as bigint;
          const elapsed = Math.round((Date.now() - pollStart) / 1000);
          console.log(`Polling counter: ${counterAfter} (elapsed: ${elapsed}s)`);
          if (counterAfter > counterBefore) break;
        }
        console.log(`Counter AFTER: ${counterAfter}`);
        if (counterAfter <= counterBefore) {
          console.warn('Counter did not increment within timeout — relay may be slow');
        }
        expect(counterAfter).toBeGreaterThan(counterBefore);
      }, 600000);
    });

    // ==========================================================================
    // 13. Value + Funds to Self (UTX-09)
    // ==========================================================================
    describe('13. Value + Funds to Self (UTX-09)', () => {
      beforeAll(async () => {
        if (skipE2E || !fixtureUsdtToken) return;
        await ensureCeaErc20Balance({
          pushClient,
          ceaAddress: fixtureCeaAddress,
          token: fixtureUsdtToken,
          requiredAmount: BigInt(10000),
          targetChain: fixture.chain,
        });
        await ensureCeaNativeBalance({
          pushClient,
          ceaAddress: fixtureCeaAddress,
          requiredAmount: parseEther('0.0002'),
          targetChain: fixture.chain,
        });
      }, 600000);

      it('should bridge value + ERC20 funds to self via Route 3', async () => {
        if (skipE2E) return;
        if (!fixtureUsdtToken) {
          console.log(`Skipping [${fixture.label}] - USDT token not found`);
          return;
        }

        console.log(`\n=== Test: Value + Funds to Self via Route 3 [${fixture.label}] ===`);

        const params: UniversalExecuteParams = {
          from: { chain: fixture.chain },
          to: ueaAddress,
          value: parseEther('0.00005'),
          funds: {
            amount: BigInt(10000), // 0.01 USDT
            token: fixtureUsdtToken,
          },
        };

        expect(detectRoute(params)).toBe(TransactionRoute.CEA_TO_PUSH);

        const tx = await pushClient.universal.sendTransaction(params);

        console.log(`Push Chain TX Hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(tx.chain).toBe(fixture.chain);

        const receipt = await tx.wait();
        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);
        expect(receipt.status).toBe(1);

        if (receipt.externalTxHash) {
          expect(receipt.externalTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
          await verifyExternalTransaction(receipt.externalTxHash, receipt.externalChain!);
        }
      }, 600000);
    });

    // ==========================================================================
    // 14. Value + Funds to Others (UTX-10)
    // ==========================================================================
    describe('14. Value + Funds to Others (UTX-10)', () => {
      beforeAll(async () => {
        if (skipE2E || !fixtureUsdtToken) return;
        await ensureCeaErc20Balance({
          pushClient,
          ceaAddress: fixtureCeaAddress,
          token: fixtureUsdtToken,
          requiredAmount: BigInt(10000),
          targetChain: fixture.chain,
        });
        await ensureCeaNativeBalance({
          pushClient,
          ceaAddress: fixtureCeaAddress,
          requiredAmount: parseEther('0.0002'),
          targetChain: fixture.chain,
        });
      }, 600000);

      it('should bridge value + ERC20 funds to different address via Route 3', async () => {
        if (skipE2E) return;
        if (!fixtureUsdtToken) {
          console.log(`Skipping [${fixture.label}] - USDT token not found`);
          return;
        }

        console.log(`\n=== Test: Value + Funds to Others via Route 3 [${fixture.label}] ===`);

        const params: UniversalExecuteParams = {
          from: { chain: fixture.chain },
          to: '0x742d35Cc6634c0532925A3b844BC9e7595F5bE21' as `0x${string}`,
          value: parseEther('0.00005'),
          funds: {
            amount: BigInt(10000), // 0.01 USDT
            token: fixtureUsdtToken,
          },
        };

        expect(detectRoute(params)).toBe(TransactionRoute.CEA_TO_PUSH);

        const tx = await pushClient.universal.sendTransaction(params);

        console.log(`Push Chain TX Hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(tx.chain).toBe(fixture.chain);

        const receipt = await tx.wait();
        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);
        expect(receipt.status).toBe(1);

        if (receipt.externalTxHash) {
          expect(receipt.externalTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
          await verifyExternalTransaction(receipt.externalTxHash, receipt.externalChain!);
        }
      }, 600000);
    });

    // ==========================================================================
    // 15. Value + Native Funds (UTX-19)
    // ==========================================================================
    describe('15. Value + Native Funds (UTX-19)', () => {
      beforeAll(async () => {
        if (skipE2E) return;
        await ensureCeaNativeBalance({
          pushClient,
          ceaAddress: fixtureCeaAddress,
          requiredAmount: parseEther('0.0004'),
          targetChain: fixture.chain,
        });
      }, 600000);

      it('should bridge value + native funds to self via Route 3', async () => {
        if (skipE2E) return;

        console.log(`\n=== Test: Value + Native Funds via Route 3 [${fixture.label}] ===`);

        const params: UniversalExecuteParams = {
          from: { chain: fixture.chain },
          to: ueaAddress,
          value: parseEther('0.0001'),
        };

        expect(detectRoute(params)).toBe(TransactionRoute.CEA_TO_PUSH);

        const tx = await pushClient.universal.sendTransaction(params);

        console.log(`Push Chain TX Hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(tx.chain).toBe(fixture.chain);

        const receipt = await tx.wait();
        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);
        expect(receipt.status).toBe(1);

        if (receipt.externalTxHash) {
          expect(receipt.externalTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
          await verifyExternalTransaction(receipt.externalTxHash, receipt.externalChain!);
        }
      }, 600000);
    });

  });

  // ============================================================================
  // Additional Tests
  // ============================================================================
  describe.each(fixtures)('Additional Tests [$label]', (fixture: ChainTestFixture) => {
    let fixtureCeaAddress: `0x${string}`;
    let fixtureUsdtToken: MoveableToken | undefined;
    let fixturePublicClient: ReturnType<typeof createPublicClient>;

    beforeAll(async () => {
      if (skipE2E) return;
      const ceaResult = await getCEAAddress(ueaAddress, fixture.chain);
      fixtureCeaAddress = ceaResult.cea;
      console.log(`CEA Address on ${fixture.label}: ${fixtureCeaAddress}, deployed: ${ceaResult.isDeployed}`);
      try { fixtureUsdtToken = getToken(fixture.chain, 'USDT'); } catch { /* token not available */ }
      if (fixtureUsdtToken) {
        console.log(`USDT Token (${fixture.label}): ${fixtureUsdtToken.address} (${fixtureUsdtToken.decimals} decimals)`);
      }
      fixturePublicClient = createPublicClient({
        transport: http(CHAIN_INFO[fixture.chain].defaultRPC[0]),
      });
    }, 60000);

    // ==========================================================================
    // Route Detection
    // ==========================================================================
    describe('Route Detection', () => {
      it('should detect CEA_TO_PUSH when from.chain is external and to is string', () => {
        const params: UniversalExecuteParams = {
          from: { chain: fixture.chain },
          to: '0x1234567890123456789012345678901234567890',
          value: parseEther('0.001'),
        };
        expect(detectRoute(params)).toBe(TransactionRoute.CEA_TO_PUSH);
      });

      it('should detect CEA_TO_PUSH when from.chain is external and to.chain is Push', () => {
        const params: UniversalExecuteParams = {
          from: { chain: fixture.chain },
          to: {
            address: '0x1234567890123456789012345678901234567890',
            chain: CHAIN.PUSH_TESTNET_DONUT,
          } as ChainTarget,
          value: parseEther('0.001'),
        };
        expect(detectRoute(params)).toBe(TransactionRoute.CEA_TO_PUSH);
      });

      it('should detect UOA_TO_PUSH when from.chain is not specified', () => {
        const params: UniversalExecuteParams = {
          to: '0x1234567890123456789012345678901234567890',
          value: parseEther('0.001'),
        };
        expect(detectRoute(params)).toBe(TransactionRoute.UOA_TO_PUSH);
      });

      it('should detect CEA_TO_CEA when from.chain and to.chain are both external', () => {
        const params: UniversalExecuteParams = {
          from: { chain: fixture.chain },
          to: {
            address: '0x1234567890123456789012345678901234567890',
            chain: CHAIN.ETHEREUM_SEPOLIA,
          } as ChainTarget,
          value: parseEther('0.001'),
        };
        expect(detectRoute(params)).toBe(TransactionRoute.CEA_TO_CEA);
      });
    });

    // ==========================================================================
    // CEA Prerequisites
    // ==========================================================================
    describe('CEA Prerequisites', () => {
      it('should report chain supports CEA', () => {
        expect(chainSupportsCEA(fixture.chain)).toBe(true);
      });

      it('should compute deterministic CEA address', async () => {
        if (skipE2E) return;

        const result1 = await getCEAAddress(ueaAddress, fixture.chain);
        const result2 = await getCEAAddress(ueaAddress, fixture.chain);

        expect(result1.cea).toMatch(/^0x[a-fA-F0-9]{40}$/);
        expect(result2.cea).toBe(result1.cea);
      });

      it('should have UniversalGateway configured', () => {
        const gateway = UNIVERSAL_GATEWAY_ADDRESSES[fixture.chain];
        expect(gateway).toBeDefined();
        expect(gateway).toMatch(/^0x[a-fA-F0-9]{40}$/);
        console.log(`UniversalGateway on ${fixture.label}: ${gateway}`);
      });

      it('should check CEA native balance', async () => {
        if (skipE2E) return;

        const balance = await fixturePublicClient.getBalance({ address: fixtureCeaAddress });
        console.log(`CEA native balance on ${fixture.label}: ${formatEther(balance)}`);

        if (balance === BigInt(0)) {
          console.warn('WARNING: CEA has no native balance on external chain.');
          console.warn(`CEA address: ${fixtureCeaAddress}`);
        }
      });
    });

    // ==========================================================================
    // Transaction Preparation
    // ==========================================================================
    describe('Transaction Preparation', () => {
      it('should prepare Route 3 transaction without executing', async () => {
        if (skipE2E) return;

        const params: UniversalExecuteParams = {
          from: { chain: fixture.chain },
          to: ueaAddress,
          value: parseEther('0.00005'),
        };

        const prepared = await pushClient.universal.prepareTransaction(params);

        console.log(`Prepared tx route: ${prepared.route}`);
        console.log(`Estimated gas: ${prepared.estimatedGas}`);
        console.log(`Nonce: ${prepared.nonce}`);

        expect(prepared.route).toBe('CEA_TO_PUSH');
        expect(prepared.payload).toBeDefined();
        expect(typeof prepared.thenOn).toBe('function');
        expect(typeof prepared.send).toBe('function');
      });

      it('should create chained builder from prepared Route 3 transaction', async () => {
        if (skipE2E) return;

        const firstPrepared = await pushClient.universal.prepareTransaction({
          from: { chain: fixture.chain },
          to: ueaAddress,
          value: parseEther('0.00005'),
        });

        const builder = pushClient.universal.executeTransactions(firstPrepared);

        expect(typeof builder.thenOn).toBe('function');
        expect(typeof builder.send).toBe('function');

        // Chain with a Route 2 outbound
        const secondPrepared = await pushClient.universal.prepareTransaction({
          to: {
            address: TEST_TARGET,
            chain: fixture.chain,
          },
          value: parseEther('0.0001'),
        });

        const chainedBuilder = builder.thenOn(secondPrepared);

        expect(typeof chainedBuilder.thenOn).toBe('function');
        expect(typeof chainedBuilder.send).toBe('function');
      }, 60000);
    });

    // ==========================================================================
    // Edge Cases
    // ==========================================================================
    describe('Edge Cases', () => {
      it('should handle small amount inbound transfer', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: Small Amount Inbound ===');

        const params: UniversalExecuteParams = {
          from: { chain: fixture.chain },
          to: ueaAddress,
          value: BigInt(1000), // Small amount
        };

        expect(detectRoute(params)).toBe(TransactionRoute.CEA_TO_PUSH);

        const tx = await pushClient.universal.sendTransaction(params);

        console.log(`Push Chain TX Hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

        // Wait for outbound relay and verify external chain details
        console.log('Calling tx.wait() - polling for outbound tx hash...');
        const receipt = await tx.wait();
        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);
        console.log(`External Explorer: ${receipt.externalExplorerUrl}`);

        expect(receipt.status).toBe(1);
        expect(receipt.externalTxHash).toBeDefined();
        expect(receipt.externalTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(receipt.externalChain).toBe(fixture.chain);

        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);
      }, 600000);
    });

    // ==========================================================================
    // E2E Sync
    // ==========================================================================
    describe('E2E Sync', () => {
      it('should execute Route 3 inbound and verify receipt via .wait()', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: E2E Inbound with .wait() ===');

        const tx = await pushClient.universal.sendTransaction({
          from: { chain: fixture.chain },
          to: ueaAddress,
          value: parseEther('0.00005'),
        });

        console.log(`Push Chain TX Hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

        // .wait() polls for external chain details
        console.log('Calling tx.wait() - polling for external chain details...');
        const receipt = await tx.wait();

        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);
        console.log(`External Chain: ${receipt.externalChain}`);
        console.log(`External Explorer: ${receipt.externalExplorerUrl}`);

        expect(receipt.hash).toBe(tx.hash);
        expect(receipt.status).toBe(1);
        expect(receipt.externalTxHash).toBeDefined();
        expect(receipt.externalTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(receipt.externalChain).toBe(fixture.chain);
        expect(receipt.externalExplorerUrl).toContain(receipt.externalTxHash);

        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);
      }, 600000);
    });

    // ==========================================================================
    // Error Handling
    // ==========================================================================
    describe('Error Handling', () => {
      it('should fail gracefully if CEA is not deployed on target chain', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: CEA Not Deployed Error ===');

        const params: UniversalExecuteParams = {
          from: { chain: CHAIN.ARBITRUM_SEPOLIA },
          to: ueaAddress,
          value: parseEther('0.001'),
        };

        try {
          const { isDeployed } = await getCEAAddress(ueaAddress, CHAIN.ARBITRUM_SEPOLIA);

          if (!isDeployed) {
            await expect(
              pushClient.universal.sendTransaction(params)
            ).rejects.toThrow(/CEA not deployed/);
          } else {
            console.log('  - skipping this test case');
          }
        } catch (err: any) {
          // If getCEAAddress throws (CEAFactory not available), that's also a valid outcome
          console.log(`getCEAAddress threw: ${err.message}`);
          await expect(
            pushClient.universal.sendTransaction(params)
          ).rejects.toThrow();
        }
      }, 60000);

      it('should treat missing from.chain as Route 1 (UOA_TO_PUSH)', () => {
        const params: UniversalExecuteParams = {
          to: ueaAddress || '0x1234567890123456789012345678901234567890',
          value: parseEther('0.001'),
        };

        expect(detectRoute(params)).toBe(TransactionRoute.UOA_TO_PUSH);
      });
    });

    // ==========================================================================
    // Progress Hooks
    // ==========================================================================
    describe('Progress Hooks', () => {
      it('should emit correct hooks for Route 3 FUNDS flow', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: Progress Hooks (Route 3 FUNDS) ===');

        const events: ProgressEvent[] = [];

        const account = privateKeyToAccount(privateKey);
        const walletClient = createWalletClient({
          account,
          transport: http(CHAIN_INFO[CHAIN.ETHEREUM_SEPOLIA].defaultRPC[0]),
        });

        const universalSigner = await PushChain.utils.signer.toUniversalFromKeypair(
          walletClient,
          {
            chain: CHAIN.ETHEREUM_SEPOLIA,
            library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
          }
        );

        const clientWithHook = await PushChain.initialize(universalSigner, {
          network: PUSH_NETWORK.TESTNET_DONUT,
          progressHook: (event: ProgressEvent) => {
            events.push(event);
            console.log(`[HOOK] ${event.id}: ${event.title}`);
          },
        });

        const tx = await clientWithHook.universal.sendTransaction({
          from: { chain: fixture.chain },
          to: clientWithHook.universal.account,
          value: parseEther('0.00005'),
        });

        // Verify we got progress events
        expect(events.length).toBeGreaterThan(0);

        // Verify key events were emitted
        expect(events.some(e => e.id === 'SEND-TX-01')).toBe(true);
        expect(events.some(e => e.id.startsWith('SEND-TX-99'))).toBe(true);
      }, 600000);
    });

    // ==========================================================================
    // Hybrid Flows
    // ==========================================================================
    describe('Hybrid Flows', () => {
      /*beforeAll(async () => {
        if (skipE2E) return;
        // Fund native token for flows 4.3, 4.7
        await ensureCeaNativeBalance({
          pushClient,
          ceaAddress: fixtureCeaAddress,
          requiredAmount: parseEther('0.0002'), // buffer for 2 native tests
          targetChain: fixture.chain,
        });
        // Fund ERC20 USDT for flows 4.4, 4.8
        if (fixtureUsdtToken) {
          await ensureCeaErc20Balance({
            pushClient,
            ceaAddress: fixtureCeaAddress,
            token: fixtureUsdtToken,
            requiredAmount: BigInt(20000), // 2 tests x 10000
            targetChain: fixture.chain,
          });
        }
      }, 600000);*/

      it('should bridge native with hybrid amount — burn + CEA balance', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: Native Hybrid Self-Call ===');
        console.log('CEA has pre-existing native balance. Burns additional PRC20.');
        console.log('SDK auto-detects CEA balance and bridges burn + pre-existing.');

        // Burns 0.00005 native worth of PRC20. If CEA has pre-existing native balance,
        // SDK will auto-include it in the bridge amount.
        const params: UniversalExecuteParams = {
          from: { chain: fixture.chain },
          to: ueaAddress,
          value: parseEther('0.00005'),
        };

        expect(detectRoute(params)).toBe(TransactionRoute.CEA_TO_PUSH);

        const tx = await pushClient.universal.sendTransaction(params);

        console.log(`Push Chain TX Hash: ${tx.hash}`);
        console.log(`Source Chain: ${tx.chain}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(tx.chain).toBe(fixture.chain);

        console.log('Calling tx.wait() - polling for external chain tx hash...');
        const receipt = await tx.wait();
        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);
        console.log(`External Explorer: ${receipt.externalExplorerUrl}`);

        expect(receipt.status).toBe(1);
        expect(receipt.externalTxHash).toBeDefined();
        expect(receipt.externalTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(receipt.externalChain).toBe(fixture.chain);

        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);
      }, 600000);

      it('should bridge ERC20 with hybrid amount — burn + CEA balance', async () => {
        if (skipE2E) return;
        if (!fixtureUsdtToken) {
          console.log('Skipping - USDT token not found');
          return;
        }

        console.log('\n=== Test: ERC20 Hybrid Self-Call ===');
        console.log('CEA has pre-existing USDT. Burns additional PRC20-USDT.');
        console.log('SDK auto-detects CEA balance and bridges burn + pre-existing.');

        const burnAmount = BigInt(10000); // 0.01 USDT

        const params: UniversalExecuteParams = {
          from: { chain: fixture.chain },
          to: ueaAddress,
          funds: {
            amount: burnAmount,
            token: fixtureUsdtToken!,
          },
        };

        expect(detectRoute(params)).toBe(TransactionRoute.CEA_TO_PUSH);

        const tx = await pushClient.universal.sendTransaction(params);

        console.log(`Push Chain TX Hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(tx.chain).toBe(fixture.chain);

        console.log('Calling tx.wait() - polling for external chain tx hash...');
        const receipt = await tx.wait();
        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);
        console.log(`External Explorer: ${receipt.externalExplorerUrl}`);

        expect(receipt.status).toBe(1);
        expect(receipt.externalTxHash).toBeDefined();
        expect(receipt.externalTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(receipt.externalChain).toBe(fixture.chain);

        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);
      }, 600000);

      it('should bridge native hybrid + Push Chain payload', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: Native Hybrid + Payload ===');
        console.log('CEA has pre-existing native balance. Burns PRC20 + executes payload on Push Chain.');

        const pushPayload = encodeFunctionData({
          abi: ERC20_EVM,
          functionName: 'approve',
          args: [TEST_TARGET, BigInt(500000)],
        });

        const params: UniversalExecuteParams = {
          from: { chain: fixture.chain },
          to: TEST_TARGET,
          value: parseEther('0.00005'),
          data: pushPayload,
        };

        expect(detectRoute(params)).toBe(TransactionRoute.CEA_TO_PUSH);

        const tx = await pushClient.universal.sendTransaction(params);

        console.log(`Push Chain TX Hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(tx.chain).toBe(fixture.chain);

        console.log('Calling tx.wait() - polling for external chain tx hash...');
        const receipt = await tx.wait();
        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);
        console.log(`External Explorer: ${receipt.externalExplorerUrl}`);

        expect(receipt.status).toBe(1);
        expect(receipt.externalTxHash).toBeDefined();
        expect(receipt.externalTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(receipt.externalChain).toBe(fixture.chain);

        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);
      }, 600000);

      it('should bridge ERC20 hybrid + Push Chain payload', async () => {
        if (skipE2E) return;
        if (!fixtureUsdtToken) {
          console.log('Skipping - USDT token not found');
          return;
        }

        console.log('\n=== Test: ERC20 Hybrid + Payload ===');
        console.log('CEA has pre-existing USDT. Burns PRC20-USDT + executes payload on Push Chain.');

        const burnAmount = BigInt(10000); // 0.01 USDT

        const pushPayload = encodeFunctionData({
          abi: ERC20_EVM,
          functionName: 'approve',
          args: [TEST_TARGET, BigInt(1000000)],
        });

        const params: UniversalExecuteParams = {
          from: { chain: fixture.chain },
          to: TEST_TARGET,
          funds: {
            amount: burnAmount,
            token: fixtureUsdtToken!,
          },
          data: pushPayload,
        };

        expect(detectRoute(params)).toBe(TransactionRoute.CEA_TO_PUSH);

        const tx = await pushClient.universal.sendTransaction(params);

        console.log(`Push Chain TX Hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(tx.chain).toBe(fixture.chain);

        console.log('Calling tx.wait() - polling for external chain tx hash...');
        const receipt = await tx.wait();
        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);
        console.log(`External Explorer: ${receipt.externalExplorerUrl}`);

        expect(receipt.status).toBe(1);
        expect(receipt.externalTxHash).toBeDefined();
        expect(receipt.externalTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(receipt.externalChain).toBe(fixture.chain);

        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);
      }, 600000);
    });

    // ==========================================================================
    // Cascade Tests
    // ==========================================================================
    describe('Cascade Tests', () => {
      it('should increment counter then bridge native back (payload + funds bridge)', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: Cascade — Counter Increment + Bridge Back ===');

        const incrementPayload = encodeFunctionData({ abi: COUNTER_ABI, functionName: 'increment' });

        // Read counter BEFORE
        const counterBefore = await fixturePublicClient.readContract({
          address: fixture.contracts.counter,
          abi: COUNTER_ABI,
          functionName: 'count',
        }) as bigint;
        console.log(`Counter BEFORE: ${counterBefore}`);

        // Hop 1 (Route 2): Payload-only increment on external chain
        const tx1 = await pushClient.universal.prepareTransaction({
          to: {
            address: fixture.contracts.counter,
            chain: fixture.chain,
          },
          data: incrementPayload,
        });

        // Hop 2 (Route 3): Bridge native token back to Push
        const tx2 = await pushClient.universal.prepareTransaction({
          from: { chain: fixture.chain },
          to: ueaAddress,
          value: parseEther('0.00005'),
        });

        const result = await pushClient.universal
          .executeTransactions(tx1)
          .thenOn(tx2)
          .send();

        console.log(`Initial TX Hash: ${result.initialTxHash}`);
        console.log(`Hop count: ${result.hopCount}`);

        expect(result.initialTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(result.hopCount).toBeGreaterThanOrEqual(2);

        // Wait for all hops to complete
        const completion = await result.waitForAll({
          timeout: 900000,
          progressHook: (event) => {
            console.log(`[waitForAll] hop ${event.hopIndex} status: ${event.status}`);
          },
        });

        expect(completion.success).toBe(true);

        // Wait for RPC propagation
        await new Promise((r) => setTimeout(r, 5000));

        // Read counter AFTER
        const counterAfter = await fixturePublicClient.readContract({
          address: fixture.contracts.counter,
          abi: COUNTER_ABI,
          functionName: 'count',
        }) as bigint;
        console.log(`Counter AFTER: ${counterAfter}`);

        expect(counterAfter).toBeGreaterThan(counterBefore);
      }, 900000);

      it('should transfer native + increment counter then bridge back (native funds + payload cascade)', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: Cascade — Native Funds + Counter + Bridge Back ===');

        const incrementPayload = encodeFunctionData({ abi: COUNTER_ABI, functionName: 'increment' });

        // Read counter BEFORE
        const counterBefore = await fixturePublicClient.readContract({
          address: fixture.contracts.counter,
          abi: COUNTER_ABI,
          functionName: 'count',
        }) as bigint;
        console.log(`Counter BEFORE: ${counterBefore}`);

        // Hop 1 (Route 2): Native funds + counter increment
        const tx1 = await pushClient.universal.prepareTransaction({
          to: {
            address: NATIVE_ADDRESS as `0x${string}`,
            chain: fixture.chain,
          },
          value: parseEther('0.0001'),
          data: [
            { to: TEST_TARGET, value: parseEther('0.0001'), data: '0x' as `0x${string}` },
            { to: fixture.contracts.counter, value: BigInt(0), data: incrementPayload },
          ],
        });

        // Hop 2 (Route 3): Bridge back
        const tx2 = await pushClient.universal.prepareTransaction({
          from: { chain: fixture.chain },
          to: ueaAddress,
          value: parseEther('0.00005'),
        });

        const result = await pushClient.universal
          .executeTransactions(tx1)
          .thenOn(tx2)
          .send();

        console.log(`Initial TX Hash: ${result.initialTxHash}`);
        console.log(`Hop count: ${result.hopCount}`);

        expect(result.initialTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(result.hopCount).toBeGreaterThanOrEqual(2);

        const completion = await result.waitForAll({
          timeout: 900000,
          progressHook: (event) => {
            console.log(`[waitForAll] hop ${event.hopIndex} status: ${event.status}`);
          },
        });

        expect(completion.success).toBe(true);

        // Wait for RPC propagation
        await new Promise((r) => setTimeout(r, 5000));

        // Read counter AFTER
        const counterAfter = await fixturePublicClient.readContract({
          address: fixture.contracts.counter,
          abi: COUNTER_ABI,
          functionName: 'count',
        }) as bigint;
        console.log(`Counter AFTER: ${counterAfter}`);

        expect(counterAfter).toBeGreaterThan(counterBefore);
      }, 900000);

      it('should transfer native + double increment counter then bridge back (native funds + multicall cascade)', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: Cascade — Native Funds + Multicall (Double Increment) + Bridge Back ===');

        const incrementPayload = encodeFunctionData({ abi: COUNTER_ABI, functionName: 'increment' });

        // Read counter BEFORE
        const counterBefore = await fixturePublicClient.readContract({
          address: fixture.contracts.counter,
          abi: COUNTER_ABI,
          functionName: 'count',
        }) as bigint;
        console.log(`Counter BEFORE: ${counterBefore}`);

        // Hop 1 (Route 2): Native funds + multicall (double increment)
        const tx1 = await pushClient.universal.prepareTransaction({
          to: {
            address: NATIVE_ADDRESS as `0x${string}`,
            chain: fixture.chain,
          },
          value: parseEther('0.0001'),
          data: [
            { to: TEST_TARGET, value: parseEther('0.0001'), data: '0x' as `0x${string}` },
            { to: fixture.contracts.counter, value: BigInt(0), data: incrementPayload },
            { to: fixture.contracts.counter, value: BigInt(0), data: incrementPayload },
          ],
        });

        // Hop 2 (Route 3): Bridge back
        const tx2 = await pushClient.universal.prepareTransaction({
          from: { chain: fixture.chain },
          to: ueaAddress,
          value: parseEther('0.00005'),
        });

        const result = await pushClient.universal
          .executeTransactions(tx1)
          .thenOn(tx2)
          .send();

        console.log(`Initial TX Hash: ${result.initialTxHash}`);
        console.log(`Hop count: ${result.hopCount}`);

        expect(result.initialTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(result.hopCount).toBeGreaterThanOrEqual(2);

        const completion = await result.waitForAll({
          timeout: 900000,
          progressHook: (event) => {
            console.log(`[waitForAll] hop ${event.hopIndex} status: ${event.status}`);
          },
        });

        expect(completion.success).toBe(true);

        // Wait for RPC propagation
        await new Promise((r) => setTimeout(r, 5000));

        // Read counter AFTER
        const counterAfter = await fixturePublicClient.readContract({
          address: fixture.contracts.counter,
          abi: COUNTER_ABI,
          functionName: 'count',
        }) as bigint;
        console.log(`Counter AFTER: ${counterAfter}`);

        expect(counterAfter).toBeGreaterThanOrEqual(counterBefore + BigInt(2));
      }, 900000);

      it('should transfer USDT + increment counter then bridge back (ERC20 funds + payload cascade)', async () => {
        if (skipE2E) return;
        if (!fixtureUsdtToken) {
          console.log('Skipping - USDT token not found');
          return;
        }

        console.log('\n=== Test: Cascade — ERC20 Funds + Counter + Bridge Back ===');

        const incrementPayload = encodeFunctionData({ abi: COUNTER_ABI, functionName: 'increment' });
        const erc20TransferPayload = encodeFunctionData({
          abi: ERC20_EVM,
          functionName: 'transfer',
          args: [TEST_TARGET, BigInt(10000)],
        });

        // Read counter BEFORE
        const counterBefore = await fixturePublicClient.readContract({
          address: fixture.contracts.counter,
          abi: COUNTER_ABI,
          functionName: 'count',
        }) as bigint;
        console.log(`Counter BEFORE: ${counterBefore}`);

        // Hop 1 (Route 2): ERC20 funds + counter increment
        const tx1 = await pushClient.universal.prepareTransaction({
          to: {
            address: NATIVE_ADDRESS as `0x${string}`,
            chain: fixture.chain,
          },
          funds: {
            amount: BigInt(10000),
            token: fixtureUsdtToken!,
          },
          data: [
            { to: fixtureUsdtToken!.address as `0x${string}`, value: BigInt(0), data: erc20TransferPayload },
            { to: fixture.contracts.counter, value: BigInt(0), data: incrementPayload },
          ],
        });

        // Hop 2 (Route 3): Bridge native token back to Push
        const tx2 = await pushClient.universal.prepareTransaction({
          from: { chain: fixture.chain },
          to: ueaAddress,
          value: parseEther('0.00005'),
        });

        const result = await pushClient.universal
          .executeTransactions(tx1)
          .thenOn(tx2)
          .send();

        console.log(`Initial TX Hash: ${result.initialTxHash}`);
        console.log(`Hop count: ${result.hopCount}`);

        expect(result.initialTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(result.hopCount).toBeGreaterThanOrEqual(2);

        const completion = await result.waitForAll({
          timeout: 900000,
          progressHook: (event) => {
            console.log(`[waitForAll] hop ${event.hopIndex} status: ${event.status}`);
          },
        });

        expect(completion.success).toBe(true);

        // Wait for RPC propagation
        await new Promise((r) => setTimeout(r, 5000));

        // Read counter AFTER
        const counterAfter = await fixturePublicClient.readContract({
          address: fixture.contracts.counter,
          abi: COUNTER_ABI,
          functionName: 'count',
        }) as bigint;
        console.log(`Counter AFTER: ${counterAfter}`);

        expect(counterAfter).toBeGreaterThan(counterBefore);
      }, 900000);

      it('should transfer USDT + double increment counter then bridge back (ERC20 funds + multicall cascade)', async () => {
        if (skipE2E) return;
        if (!fixtureUsdtToken) {
          console.log('Skipping - USDT token not found');
          return;
        }

        console.log('\n=== Test: Cascade — ERC20 Funds + Multicall (Double Increment) + Bridge Back ===');

        const incrementPayload = encodeFunctionData({ abi: COUNTER_ABI, functionName: 'increment' });
        const erc20TransferPayload = encodeFunctionData({
          abi: ERC20_EVM,
          functionName: 'transfer',
          args: [TEST_TARGET, BigInt(10000)],
        });

        // Read counter BEFORE
        const counterBefore = await fixturePublicClient.readContract({
          address: fixture.contracts.counter,
          abi: COUNTER_ABI,
          functionName: 'count',
        }) as bigint;
        console.log(`Counter BEFORE: ${counterBefore}`);

        // Hop 1 (Route 2): ERC20 funds + multicall (double increment)
        const tx1 = await pushClient.universal.prepareTransaction({
          to: {
            address: NATIVE_ADDRESS as `0x${string}`,
            chain: fixture.chain,
          },
          funds: {
            amount: BigInt(10000),
            token: fixtureUsdtToken!,
          },
          data: [
            { to: fixtureUsdtToken!.address as `0x${string}`, value: BigInt(0), data: erc20TransferPayload },
            { to: fixture.contracts.counter, value: BigInt(0), data: incrementPayload },
            { to: fixture.contracts.counter, value: BigInt(0), data: incrementPayload },
          ],
        });

        // Hop 2 (Route 3): Bridge back
        const tx2 = await pushClient.universal.prepareTransaction({
          from: { chain: fixture.chain },
          to: ueaAddress,
          value: parseEther('0.00005'),
        });

        const result = await pushClient.universal
          .executeTransactions(tx1)
          .thenOn(tx2)
          .send();

        console.log(`Initial TX Hash: ${result.initialTxHash}`);
        console.log(`Hop count: ${result.hopCount}`);

        expect(result.initialTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(result.hopCount).toBeGreaterThanOrEqual(2);

        const completion = await result.waitForAll({
          timeout: 900000,
          progressHook: (event) => {
            console.log(`[waitForAll] hop ${event.hopIndex} status: ${event.status}`);
          },
        });

        expect(completion.success).toBe(true);

        // Wait for RPC propagation
        await new Promise((r) => setTimeout(r, 5000));

        // Read counter AFTER
        const counterAfter = await fixturePublicClient.readContract({
          address: fixture.contracts.counter,
          abi: COUNTER_ABI,
          functionName: 'count',
        }) as bigint;
        console.log(`Counter AFTER: ${counterAfter}`);

        expect(counterAfter).toBeGreaterThanOrEqual(counterBefore + BigInt(2));
      }, 900000);
    });

  });
});

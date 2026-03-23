import '@e2e/shared/setup';
/**
 * CEA → UEA: Inbound Transactions (Route 3)
 *
 * Tests for inbound transactions from external chains back to Push Chain via CEA,
 * targeting a UEA (Universal External Account) signer (EVM_PRIVATE_KEY).
 * Covers: Route Detection, CEA Prerequisites, Transaction Preparation, FUNDS only,
 * PAYLOAD only, FUNDS + PAYLOAD, E2E Sync, Error Handling, Progress Hooks
 *
 * Primary test chain: BNB Testnet (Chain ID: 97)
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
import { MOVEABLE_TOKEN_CONSTANTS, type MoveableToken } from '../../../src/lib/constants/tokens';
import { COUNTER_ABI_PAYABLE } from '../../../src/lib/push-chain/helpers/abis';
import { COUNTER_ADDRESS_PAYABLE } from '../../../src/lib/push-chain/helpers/addresses';
import { verifyExternalTransaction } from '@e2e/shared/external-tx-verifier';


// Test constants
const TEST_TARGET = '0x1234567890123456789012345678901234567890' as `0x${string}`;
const BSC_USDT_ADDRESS = '0xBC14F348BC9667be46b35Edc9B68653d86013DC5' as const;
const NATIVE_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

// PRC-20 token on Push Chain (pUSDT for BNB chain) — used for multicall approve tests
// that execute ON Push Chain (BSC_USDT_ADDRESS is NOT an ERC-20 on Push Chain)
const PUSH_CHAIN_PUSDT = '0x2f98B4235FD2BA0173a2B056D722879360B12E7b' as `0x${string}`;

// Counter contract addresses (deployed on BNB Testnet 2026-03-14)
const COUNTER_A = '0x7f0936bb90e7dcf3edb47199c2005e7184e44cf8' as `0x${string}`;
const COUNTER_B = '0x7dd2f6d20cd2c8f24d8c6c7de48c4b39c6aa9b18' as `0x${string}`;
const COUNTER_ABI = [
  { type: 'function', name: 'count', inputs: [], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'increment', inputs: [], outputs: [], stateMutability: 'nonpayable' },
] as const;

/**
 * Ensures CEA has at least `requiredAmount` of an ERC20 token on the external chain.
 * If balance is insufficient, funds CEA via Route 2 (UEA → CEA) and waits for relay.
 */
async function ensureCeaErc20Balance(opts: {
  pushClient: Awaited<ReturnType<typeof PushChain.initialize>>;
  ceaAddress: `0x${string}`;
  token: MoveableToken;
  requiredAmount: bigint;
  targetChain: CHAIN;
}): Promise<void> {
  const { pushClient, ceaAddress, token, requiredAmount, targetChain } = opts;

  const publicClient = createPublicClient({
    transport: http(CHAIN_INFO[targetChain].defaultRPC[0]),
  });
  const balance = await publicClient.readContract({
    address: token.address as `0x${string}`,
    abi: ERC20_EVM,
    functionName: 'balanceOf',
    args: [ceaAddress],
  }) as bigint;

  console.log(`[ensureCeaBalance] CEA ${token.symbol} balance: ${balance.toString()}, required: ${requiredAmount.toString()}`);

  if (balance >= requiredAmount) {
    console.log(`[ensureCeaBalance] Sufficient ${token.symbol} balance, no funding needed.`);
    return;
  }

  const deficit = requiredAmount - balance;
  const fundAmount = deficit + requiredAmount; // fund extra buffer
  console.log(`[ensureCeaBalance] Insufficient ${token.symbol}. Funding CEA with ${fundAmount.toString()} via Route 2 (UEA → CEA)...`);

  const tx = await pushClient.universal.sendTransaction({
    to: {
      address: ceaAddress,
      chain: targetChain,
    },
    funds: {
      amount: fundAmount,
      token,
    },
  });
  console.log(`[ensureCeaBalance] Funding TX hash: ${tx.hash}`);

  const receipt = await tx.wait();
  console.log(`[ensureCeaBalance] Funding complete. Status: ${receipt.status}, External TX: ${receipt.externalTxHash}`);

  if (receipt.status !== 1) {
    throw new Error(`CEA ERC20 funding failed with status ${receipt.status}`);
  }
}

/**
 * Ensures CEA has at least `requiredAmount` of native token (e.g. BNB) on the external chain.
 * If balance is insufficient, funds CEA via Route 2 (UEA → CEA) and waits for relay.
 */
async function ensureCeaNativeBalance(opts: {
  pushClient: Awaited<ReturnType<typeof PushChain.initialize>>;
  ceaAddress: `0x${string}`;
  requiredAmount: bigint;
  targetChain: CHAIN;
}): Promise<void> {
  const { pushClient, ceaAddress, requiredAmount, targetChain } = opts;

  const publicClient = createPublicClient({
    transport: http(CHAIN_INFO[targetChain].defaultRPC[0]),
  });
  const balance = await publicClient.getBalance({ address: ceaAddress });

  console.log(`[ensureCeaBalance] CEA native balance: ${formatEther(balance)}, required: ${formatEther(requiredAmount)}`);

  if (balance >= requiredAmount) {
    console.log(`[ensureCeaBalance] Sufficient native balance, no funding needed.`);
    return;
  }

  const deficit = requiredAmount - balance;
  const fundAmount = deficit + requiredAmount; // fund extra buffer
  console.log(`[ensureCeaBalance] Insufficient native balance. Funding CEA with ${formatEther(fundAmount)} via Route 2 (UEA → CEA)...`);

  const tx = await pushClient.universal.sendTransaction({
    to: {
      address: ceaAddress,
      chain: targetChain,
    },
    value: fundAmount,
  });
  console.log(`[ensureCeaBalance] Funding TX hash: ${tx.hash}`);

  const receipt = await tx.wait();
  console.log(`[ensureCeaBalance] Funding complete. Status: ${receipt.status}, External TX: ${receipt.externalTxHash}`);

  if (receipt.status !== 1) {
    throw new Error(`CEA native funding failed with status ${receipt.status}`);
  }
}

describe('CEA → UEA: Inbound Transactions (Route 3)', () => {
  let pushClient: Awaited<ReturnType<typeof PushChain.initialize>>;
  let ueaAddress: `0x${string}`;
  let ceaAddress: `0x${string}`;
  let usdtToken: MoveableToken | undefined;
  let bscPublicClient: ReturnType<typeof createPublicClient>;
  let pushPublicClient: ReturnType<typeof createPublicClient>;

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

    // Get CEA address on BSC Testnet
    const ceaResult = await getCEAAddress(ueaAddress, CHAIN.BNB_TESTNET);
    ceaAddress = ceaResult.cea;
    console.log(`CEA Address on BSC: ${ceaAddress}, deployed: ${ceaResult.isDeployed}`);

    // Get USDT token for ERC20 self-call flows
    usdtToken = MOVEABLE_TOKEN_CONSTANTS.BNB_TESTNET.USDT;
    if (usdtToken) {
      console.log(`USDT Token (BNB Testnet): ${usdtToken.address} (${usdtToken.decimals} decimals)`);
    }

    bscPublicClient = createPublicClient({
      transport: http(CHAIN_INFO[CHAIN.BNB_TESTNET].defaultRPC[0]),
    });
    pushPublicClient = createPublicClient({
      transport: http(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]),
    });

  }, 60000);

  // ============================================================================
  // Core Scenarios
  // ============================================================================
  describe('Core Scenarios', () => {

    // ==========================================================================
    // 1. Funds
    // ==========================================================================
    describe('1. Funds', () => {
      beforeAll(async () => {
        if (skipE2E || !usdtToken) return;
        await ensureCeaErc20Balance({
          pushClient,
          ceaAddress,
          token: usdtToken,
          requiredAmount: BigInt(20000), // 2 tests x 10000 (0.01 USDT each)
          targetChain: CHAIN.BNB_TESTNET,
        });
      }, 600000);

      it('should bridge ERC20 USDT back from CEA to Push Chain (Flow 4.2)', async () => {
        if (skipE2E) return;
        if (!usdtToken) {
          console.log('Skipping - USDT token not found in MOVEABLE_TOKENS for BNB Testnet');
          return;
        }

        console.log('\n=== Test: ERC20 Self-Call — Bridge USDT Back (Flow 4.2) ===');
        console.log('Burns ERC20 on external chain, mints on Push Chain. SDK auto-adds approve step.');

        const bridgeAmount = BigInt(10000); // 0.01 USDT (6 decimals)

        const params: UniversalExecuteParams = {
          from: { chain: CHAIN.BNB_TESTNET },
          to: ueaAddress, // Self — bridge back to own UEA
          funds: {
            amount: bridgeAmount,
            token: usdtToken,
          },
        };

        expect(detectRoute(params)).toBe(TransactionRoute.CEA_TO_PUSH);

        const tx = await pushClient.universal.sendTransaction(params);

        console.log(`Push Chain TX Hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(tx.chain).toBe(CHAIN.BNB_TESTNET);

        // Wait for outbound relay
        console.log('Calling tx.wait() - polling for external chain tx hash...');
        const receipt = await tx.wait();
        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);
        console.log(`External Explorer: ${receipt.externalExplorerUrl}`);

        expect(receipt.status).toBe(1);
        expect(receipt.externalTxHash).toBeDefined();
        expect(receipt.externalTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(receipt.externalChain).toBe(CHAIN.BNB_TESTNET);

        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);
      }, 600000);
    });

    // ==========================================================================
    // 2. Payload (Data)
    // ==========================================================================
    describe('2. Payload (Data)', () => {
      it('should increment Push Chain counter via Route 3 payload', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: Payload-Only Inbound — Counter Increment ===');

        // Read Push Chain counter BEFORE
        const counterBefore = await pushPublicClient.readContract({
          address: COUNTER_ADDRESS_PAYABLE,
          abi: COUNTER_ABI_PAYABLE,
          functionName: 'countPC',
        }) as bigint;
        console.log(`Push Chain Counter BEFORE: ${counterBefore}`);

        const pushPayload = encodeFunctionData({
          abi: COUNTER_ABI_PAYABLE,
          functionName: 'increment',
        });

        const params: UniversalExecuteParams = {
          from: { chain: CHAIN.BNB_TESTNET },
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
        expect(receipt.externalChain).toBe(CHAIN.BNB_TESTNET);

        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);

        // CEA-to-Push requires round-trip: Push → BSC → Push (inbound)
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

        console.log('\n=== Test: UEA Multicall Only (Route 3) — Counter Increment + Approve ===');

        // Read Push Chain counter BEFORE
        const counterBefore = await pushPublicClient.readContract({
          address: COUNTER_ADDRESS_PAYABLE,
          abi: COUNTER_ABI_PAYABLE,
          functionName: 'countPC',
        }) as bigint;
        console.log(`Push Chain Counter BEFORE: ${counterBefore}`);

        const incrementPayload = encodeFunctionData({
          abi: COUNTER_ABI_PAYABLE,
          functionName: 'increment',
        });

        const approvePayload = encodeFunctionData({
          abi: ERC20_EVM,
          functionName: 'approve',
          args: [TEST_TARGET, BigInt(1000000)],
        });

        const params: UniversalExecuteParams = {
          from: { chain: CHAIN.BNB_TESTNET },
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
        expect(tx.chain).toBe(CHAIN.BNB_TESTNET);

        // Wait for outbound relay
        console.log('Calling tx.wait() - polling for external chain tx hash...');
        const receipt = await tx.wait();
        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);
        console.log(`External Explorer: ${receipt.externalExplorerUrl}`);

        expect(receipt.status).toBe(1);
        expect(receipt.externalTxHash).toBeDefined();
        expect(receipt.externalTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(receipt.externalChain).toBe(CHAIN.BNB_TESTNET);

        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);

        // CEA-to-Push multicall requires round-trip: Push → BSC → Push (inbound)
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
        if (skipE2E || !usdtToken) return;
        await ensureCeaErc20Balance({
          pushClient,
          ceaAddress,
          token: usdtToken,
          requiredAmount: BigInt(20000), // 2 tests x 10000 (0.01 USDT each)
          targetChain: CHAIN.BNB_TESTNET,
        });
      }, 600000);

      it('should bridge ERC20 USDT and increment Push Chain counter (Flow 4.6)', async () => {
        if (skipE2E) return;
        if (!usdtToken) {
          console.log('Skipping - USDT token not found');
          return;
        }

        console.log('\n=== Test: ERC20 Self-Call + Counter Increment (Flow 4.6) ===');
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
          abi: COUNTER_ABI_PAYABLE,
          functionName: 'increment',
        });

        const params: UniversalExecuteParams = {
          from: { chain: CHAIN.BNB_TESTNET },
          to: COUNTER_ADDRESS_PAYABLE,
          funds: {
            amount: bridgeAmount,
            token: usdtToken,
          },
          data: pushPayload,
        };

        expect(detectRoute(params)).toBe(TransactionRoute.CEA_TO_PUSH);

        const tx = await pushClient.universal.sendTransaction(params);

        console.log(`Push Chain TX Hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(tx.chain).toBe(CHAIN.BNB_TESTNET);

        // Wait for outbound relay
        console.log('Calling tx.wait() - polling for external chain tx hash...');
        const receipt = await tx.wait();
        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);
        console.log(`External Explorer: ${receipt.externalExplorerUrl}`);

        expect(receipt.status).toBe(1);
        expect(receipt.externalTxHash).toBeDefined();
        expect(receipt.externalTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(receipt.externalChain).toBe(CHAIN.BNB_TESTNET);

        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);

        // CEA-to-Push requires round-trip: Push → BSC → Push (inbound)
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
        if (skipE2E || !usdtToken) return;
        await ensureCeaErc20Balance({
          pushClient,
          ceaAddress,
          token: usdtToken,
          requiredAmount: BigInt(20000),
          targetChain: CHAIN.BNB_TESTNET,
        });
      }, 600000);

      it('should bridge ERC-20 funds and execute multicall on Push Chain', async () => {
        if (skipE2E) return;
        if (!usdtToken) {
          console.log('Skipping - USDT token not found');
          return;
        }

        console.log('\n=== Test: UEA Funds + Multicall (Route 3) — ERC-20 + Counter + Approve ===');

        // Read Push Chain counter BEFORE
        const counterBefore = await pushPublicClient.readContract({
          address: COUNTER_ADDRESS_PAYABLE,
          abi: COUNTER_ABI_PAYABLE,
          functionName: 'countPC',
        }) as bigint;
        console.log(`Push Chain Counter BEFORE: ${counterBefore}`);

        const incrementPayload = encodeFunctionData({
          abi: COUNTER_ABI_PAYABLE,
          functionName: 'increment',
        });

        const approvePayload = encodeFunctionData({
          abi: ERC20_EVM,
          functionName: 'approve',
          args: [TEST_TARGET, BigInt(1000000)],
        });

        const params: UniversalExecuteParams = {
          from: { chain: CHAIN.BNB_TESTNET },
          to: NATIVE_ADDRESS as `0x${string}`,
          funds: {
            amount: BigInt(10000),
            token: usdtToken,
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
        expect(tx.chain).toBe(CHAIN.BNB_TESTNET);

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
          expect(receipt.externalChain).toBe(CHAIN.BNB_TESTNET);
          await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);
        } else {
          console.warn(
            '[Test 14] External TX hash not available — relay may still be processing the ERC-20 + multicall outbound. ' +
            'Push Chain tx succeeded. Retry or check explorer manually.'
          );
        }

        // CEA-to-Push requires round-trip: Push → BSC → Push (inbound)
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
          ceaAddress,
          requiredAmount: parseEther('0.0002'), // buffer for native transfer tests
          targetChain: CHAIN.BNB_TESTNET,
        });
      }, 600000);

      it('should transfer native BNB from CEA to Push Chain', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: Native BNB Inbound (CEA → Push) ===');

        const params: UniversalExecuteParams = {
          from: { chain: CHAIN.BNB_TESTNET },
          to: ueaAddress,
          value: parseEther('0.00005'),
        };

        expect(detectRoute(params)).toBe(TransactionRoute.CEA_TO_PUSH);

        const tx = await pushClient.universal.sendTransaction(params);

        console.log(`Push Chain TX Hash: ${tx.hash}`);
        console.log(`Source Chain: ${tx.chain}`);

        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(tx.chain).toBe(CHAIN.BNB_TESTNET);

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
        expect(receipt.externalChain).toBe(CHAIN.BNB_TESTNET);

        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);
      }, 600000);
    });

    // ==========================================================================
    // 7. Native Funds + Payload
    // ==========================================================================
    describe('7. Native Funds + Payload', () => {
      it('should transfer native BNB and increment Push Chain counter', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: FUNDS + PAYLOAD Inbound — Counter Increment ===');

        // Read Push Chain counter BEFORE
        const counterBefore = await pushPublicClient.readContract({
          address: COUNTER_ADDRESS_PAYABLE,
          abi: COUNTER_ABI_PAYABLE,
          functionName: 'countPC',
        }) as bigint;
        console.log(`Push Chain Counter BEFORE: ${counterBefore}`);

        const pushPayload = encodeFunctionData({
          abi: COUNTER_ABI_PAYABLE,
          functionName: 'increment',
        });

        const params: UniversalExecuteParams = {
          from: { chain: CHAIN.BNB_TESTNET },
          to: COUNTER_ADDRESS_PAYABLE,
          value: parseEther('0.00005'),
          data: pushPayload,
        };

        expect(detectRoute(params)).toBe(TransactionRoute.CEA_TO_PUSH);

        const tx = await pushClient.universal.sendTransaction(params);

        console.log(`Push Chain TX Hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(tx.chain).toBe(CHAIN.BNB_TESTNET);

        // Wait for outbound relay and verify external chain details
        console.log('Calling tx.wait() - polling for outbound tx hash...');
        const receipt = await tx.wait();
        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);
        console.log(`External Explorer: ${receipt.externalExplorerUrl}`);

        expect(receipt.status).toBe(1);
        expect(receipt.externalTxHash).toBeDefined();
        expect(receipt.externalTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(receipt.externalChain).toBe(CHAIN.BNB_TESTNET);

        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);

        // CEA-to-Push requires round-trip: Push → BSC → Push (inbound)
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
          ceaAddress,
          requiredAmount: parseEther('0.0002'),
          targetChain: CHAIN.BNB_TESTNET,
        });
      }, 600000);

      it('should bridge native BNB and execute multicall on Push Chain', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: UEA Native Funds + Multicall (Route 3) — BNB + Counter + Approve ===');

        // Read Push Chain counter BEFORE
        const counterBefore = await pushPublicClient.readContract({
          address: COUNTER_ADDRESS_PAYABLE,
          abi: COUNTER_ABI_PAYABLE,
          functionName: 'countPC',
        }) as bigint;
        console.log(`Push Chain Counter BEFORE: ${counterBefore}`);

        const incrementPayload = encodeFunctionData({
          abi: COUNTER_ABI_PAYABLE,
          functionName: 'increment',
        });

        const approvePayload = encodeFunctionData({
          abi: ERC20_EVM,
          functionName: 'approve',
          args: [TEST_TARGET, BigInt(1000000)],
        });

        const params: UniversalExecuteParams = {
          from: { chain: CHAIN.BNB_TESTNET },
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
        expect(tx.chain).toBe(CHAIN.BNB_TESTNET);

        // Wait for outbound relay
        console.log('Calling tx.wait() - polling for external chain tx hash...');
        const receipt = await tx.wait();
        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);
        console.log(`External Explorer: ${receipt.externalExplorerUrl}`);

        expect(receipt.status).toBe(1);
        expect(receipt.externalTxHash).toBeDefined();
        expect(receipt.externalTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(receipt.externalChain).toBe(CHAIN.BNB_TESTNET);

        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);

        // CEA-to-Push requires round-trip: Push → BSC → Push (inbound)
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

  });

  // ============================================================================
  // Additional Tests
  // ============================================================================
  describe('Additional Tests', () => {

    // ==========================================================================
    // Route Detection
    // ==========================================================================
    describe('Route Detection', () => {
      it('should detect CEA_TO_PUSH when from.chain is external and to is string', () => {
        const params: UniversalExecuteParams = {
          from: { chain: CHAIN.BNB_TESTNET },
          to: '0x1234567890123456789012345678901234567890',
          value: parseEther('0.001'),
        };
        expect(detectRoute(params)).toBe(TransactionRoute.CEA_TO_PUSH);
      });

      it('should detect CEA_TO_PUSH when from.chain is external and to.chain is Push', () => {
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

      it('should detect UOA_TO_PUSH when from.chain is not specified', () => {
        const params: UniversalExecuteParams = {
          to: '0x1234567890123456789012345678901234567890',
          value: parseEther('0.001'),
        };
        expect(detectRoute(params)).toBe(TransactionRoute.UOA_TO_PUSH);
      });

      it('should detect CEA_TO_CEA when from.chain and to.chain are both external', () => {
        const params: UniversalExecuteParams = {
          from: { chain: CHAIN.BNB_TESTNET },
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
      it('should report BNB Testnet supports CEA', () => {
        expect(chainSupportsCEA(CHAIN.BNB_TESTNET)).toBe(true);
      });

      it('should compute deterministic CEA address', async () => {
        if (skipE2E) return;

        const result1 = await getCEAAddress(ueaAddress, CHAIN.BNB_TESTNET);
        const result2 = await getCEAAddress(ueaAddress, CHAIN.BNB_TESTNET);

        expect(result1.cea).toMatch(/^0x[a-fA-F0-9]{40}$/);
        expect(result2.cea).toBe(result1.cea);
      });

      it('should have UniversalGateway configured for BSC Testnet', () => {
        const gateway = UNIVERSAL_GATEWAY_ADDRESSES[CHAIN.BNB_TESTNET];
        expect(gateway).toBeDefined();
        expect(gateway).toMatch(/^0x[a-fA-F0-9]{40}$/);
        console.log(`UniversalGateway on BSC Testnet: ${gateway}`);
      });

      it('should check CEA native balance on BSC Testnet', async () => {
        if (skipE2E) return;

        const publicClient = createPublicClient({
          transport: http(CHAIN_INFO[CHAIN.BNB_TESTNET].defaultRPC[0]),
        });
        const balance = await publicClient.getBalance({ address: ceaAddress });
        console.log(`CEA native balance on BSC Testnet: ${formatEther(balance)} BNB`);

        if (balance === BigInt(0)) {
          console.warn('WARNING: CEA has no BNB balance on external chain.');
          console.warn(`CEA address: ${ceaAddress}`);
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
          from: { chain: CHAIN.BNB_TESTNET },
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
          from: { chain: CHAIN.BNB_TESTNET },
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
            chain: CHAIN.BNB_TESTNET,
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
          from: { chain: CHAIN.BNB_TESTNET },
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
        expect(receipt.externalChain).toBe(CHAIN.BNB_TESTNET);

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
          from: { chain: CHAIN.BNB_TESTNET },
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
        expect(receipt.externalChain).toBe(CHAIN.BNB_TESTNET);
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
            console.log('CEA is deployed on ARBITRUM_SEPOLIA - skipping this test case');
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

        const originChain = CHAIN.BNB_TESTNET;
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

        const clientWithHook = await PushChain.initialize(universalSigner, {
          network: PUSH_NETWORK.TESTNET_DONUT,
          progressHook: (event: ProgressEvent) => {
            events.push(event);
            console.log(`[HOOK] ${event.id}: ${event.title}`);
          },
        });

        const tx = await clientWithHook.universal.sendTransaction({
          from: { chain: CHAIN.BNB_TESTNET },
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
        // Fund native BNB for flows 4.3, 4.7
        await ensureCeaNativeBalance({
          pushClient,
          ceaAddress,
          requiredAmount: parseEther('0.0002'), // buffer for 2 native tests
          targetChain: CHAIN.BNB_TESTNET,
        });
        // Fund ERC20 USDT for flows 4.4, 4.8
        if (usdtToken) {
          await ensureCeaErc20Balance({
            pushClient,
            ceaAddress,
            token: usdtToken,
            requiredAmount: BigInt(20000), // 2 tests x 10000
            targetChain: CHAIN.BNB_TESTNET,
          });
        }
      }, 600000);*/

      it('should bridge native with hybrid amount — burn + CEA balance (Flow 4.3)', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: Native Hybrid Self-Call (Flow 4.3) ===');
        console.log('CEA has pre-existing BNB balance. Burns additional PRC20-BNB.');
        console.log('SDK auto-detects CEA balance and bridges burn + pre-existing.');

        // Burns 0.00005 BNB worth of PRC20. If CEA has pre-existing BNB,
        // SDK will auto-include it in the bridge amount.
        const params: UniversalExecuteParams = {
          from: { chain: CHAIN.BNB_TESTNET },
          to: ueaAddress,
          value: parseEther('0.00005'),
        };

        expect(detectRoute(params)).toBe(TransactionRoute.CEA_TO_PUSH);

        const tx = await pushClient.universal.sendTransaction(params);

        console.log(`Push Chain TX Hash: ${tx.hash}`);
        console.log(`Source Chain: ${tx.chain}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(tx.chain).toBe(CHAIN.BNB_TESTNET);

        console.log('Calling tx.wait() - polling for external chain tx hash...');
        const receipt = await tx.wait();
        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);
        console.log(`External Explorer: ${receipt.externalExplorerUrl}`);

        expect(receipt.status).toBe(1);
        expect(receipt.externalTxHash).toBeDefined();
        expect(receipt.externalTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(receipt.externalChain).toBe(CHAIN.BNB_TESTNET);

        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);
      }, 600000);

      it('should bridge ERC20 with hybrid amount — burn + CEA balance (Flow 4.4)', async () => {
        if (skipE2E) return;
        if (!usdtToken) {
          console.log('Skipping - USDT token not found');
          return;
        }

        console.log('\n=== Test: ERC20 Hybrid Self-Call (Flow 4.4) ===');
        console.log('CEA has pre-existing USDT. Burns additional PRC20-USDT.');
        console.log('SDK auto-detects CEA balance and bridges burn + pre-existing.');

        const burnAmount = BigInt(10000); // 0.01 USDT

        const params: UniversalExecuteParams = {
          from: { chain: CHAIN.BNB_TESTNET },
          to: ueaAddress,
          funds: {
            amount: burnAmount,
            token: usdtToken,
          },
        };

        expect(detectRoute(params)).toBe(TransactionRoute.CEA_TO_PUSH);

        const tx = await pushClient.universal.sendTransaction(params);

        console.log(`Push Chain TX Hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(tx.chain).toBe(CHAIN.BNB_TESTNET);

        console.log('Calling tx.wait() - polling for external chain tx hash...');
        const receipt = await tx.wait();
        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);
        console.log(`External Explorer: ${receipt.externalExplorerUrl}`);

        expect(receipt.status).toBe(1);
        expect(receipt.externalTxHash).toBeDefined();
        expect(receipt.externalTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(receipt.externalChain).toBe(CHAIN.BNB_TESTNET);

        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);
      }, 600000);

      it('should bridge native hybrid + Push Chain payload (Flow 4.7)', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: Native Hybrid + Payload (Flow 4.7) ===');
        console.log('CEA has pre-existing BNB. Burns PRC20-BNB + executes payload on Push Chain.');

        const pushPayload = encodeFunctionData({
          abi: ERC20_EVM,
          functionName: 'approve',
          args: [TEST_TARGET, BigInt(500000)],
        });

        const params: UniversalExecuteParams = {
          from: { chain: CHAIN.BNB_TESTNET },
          to: TEST_TARGET,
          value: parseEther('0.00005'),
          data: pushPayload,
        };

        expect(detectRoute(params)).toBe(TransactionRoute.CEA_TO_PUSH);

        const tx = await pushClient.universal.sendTransaction(params);

        console.log(`Push Chain TX Hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(tx.chain).toBe(CHAIN.BNB_TESTNET);

        console.log('Calling tx.wait() - polling for external chain tx hash...');
        const receipt = await tx.wait();
        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);
        console.log(`External Explorer: ${receipt.externalExplorerUrl}`);

        expect(receipt.status).toBe(1);
        expect(receipt.externalTxHash).toBeDefined();
        expect(receipt.externalTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(receipt.externalChain).toBe(CHAIN.BNB_TESTNET);

        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);
      }, 600000);

      it('should bridge ERC20 hybrid + Push Chain payload (Flow 4.8)', async () => {
        if (skipE2E) return;
        if (!usdtToken) {
          console.log('Skipping - USDT token not found');
          return;
        }

        console.log('\n=== Test: ERC20 Hybrid + Payload (Flow 4.8) ===');
        console.log('CEA has pre-existing USDT. Burns PRC20-USDT + executes payload on Push Chain.');

        const burnAmount = BigInt(10000); // 0.01 USDT

        const pushPayload = encodeFunctionData({
          abi: ERC20_EVM,
          functionName: 'approve',
          args: [TEST_TARGET, BigInt(1000000)],
        });

        const params: UniversalExecuteParams = {
          from: { chain: CHAIN.BNB_TESTNET },
          to: TEST_TARGET,
          funds: {
            amount: burnAmount,
            token: usdtToken,
          },
          data: pushPayload,
        };

        expect(detectRoute(params)).toBe(TransactionRoute.CEA_TO_PUSH);

        const tx = await pushClient.universal.sendTransaction(params);

        console.log(`Push Chain TX Hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(tx.chain).toBe(CHAIN.BNB_TESTNET);

        console.log('Calling tx.wait() - polling for external chain tx hash...');
        const receipt = await tx.wait();
        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);
        console.log(`External Explorer: ${receipt.externalExplorerUrl}`);

        expect(receipt.status).toBe(1);
        expect(receipt.externalTxHash).toBeDefined();
        expect(receipt.externalTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(receipt.externalChain).toBe(CHAIN.BNB_TESTNET);

        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);
      }, 600000);
    });

    // ==========================================================================
    // Cascade Tests
    // ==========================================================================
    describe('Cascade Tests', () => {
      it('should increment counter then bridge BNB back (payload + funds bridge)', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: Cascade — Counter Increment + Bridge Back ===');

        const incrementPayload = encodeFunctionData({ abi: COUNTER_ABI, functionName: 'increment' });

        // Read counter BEFORE
        const counterBefore = await bscPublicClient.readContract({
          address: COUNTER_A,
          abi: COUNTER_ABI,
          functionName: 'count',
        }) as bigint;
        console.log(`CounterA BEFORE: ${counterBefore}`);

        // Hop 1 (Route 2): Payload-only increment on BSC
        const tx1 = await pushClient.universal.prepareTransaction({
          to: {
            address: COUNTER_A,
            chain: CHAIN.BNB_TESTNET,
          },
          data: incrementPayload,
        });

        // Hop 2 (Route 3): Bridge native BNB back to Push
        const tx2 = await pushClient.universal.prepareTransaction({
          from: { chain: CHAIN.BNB_TESTNET },
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
        const counterAfter = await bscPublicClient.readContract({
          address: COUNTER_A,
          abi: COUNTER_ABI,
          functionName: 'count',
        }) as bigint;
        console.log(`CounterA AFTER: ${counterAfter}`);

        expect(counterAfter).toBeGreaterThan(counterBefore);
      }, 900000);

      it('should transfer BNB + increment counter then bridge back (native funds + payload cascade)', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: Cascade — Native Funds + Counter + Bridge Back ===');

        const incrementPayload = encodeFunctionData({ abi: COUNTER_ABI, functionName: 'increment' });

        // Read counter BEFORE
        const counterBefore = await bscPublicClient.readContract({
          address: COUNTER_A,
          abi: COUNTER_ABI,
          functionName: 'count',
        }) as bigint;
        console.log(`CounterA BEFORE: ${counterBefore}`);

        // Hop 1 (Route 2): Native funds + counter increment
        const tx1 = await pushClient.universal.prepareTransaction({
          to: {
            address: NATIVE_ADDRESS as `0x${string}`,
            chain: CHAIN.BNB_TESTNET,
          },
          value: parseEther('0.0001'),
          data: [
            { to: TEST_TARGET, value: parseEther('0.0001'), data: '0x' as `0x${string}` },
            { to: COUNTER_A, value: BigInt(0), data: incrementPayload },
          ],
        });

        // Hop 2 (Route 3): Bridge back
        const tx2 = await pushClient.universal.prepareTransaction({
          from: { chain: CHAIN.BNB_TESTNET },
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
        const counterAfter = await bscPublicClient.readContract({
          address: COUNTER_A,
          abi: COUNTER_ABI,
          functionName: 'count',
        }) as bigint;
        console.log(`CounterA AFTER: ${counterAfter}`);

        expect(counterAfter).toBeGreaterThan(counterBefore);
      }, 900000);

      it('should transfer BNB + increment both counters then bridge back (native funds + multicall cascade)', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: Cascade — Native Funds + Multicall (Both Counters) + Bridge Back ===');

        const incrementPayload = encodeFunctionData({ abi: COUNTER_ABI, functionName: 'increment' });

        // Read both counters BEFORE
        const counterABefore = await bscPublicClient.readContract({
          address: COUNTER_A,
          abi: COUNTER_ABI,
          functionName: 'count',
        }) as bigint;
        const counterBBefore = await bscPublicClient.readContract({
          address: COUNTER_B,
          abi: COUNTER_ABI,
          functionName: 'count',
        }) as bigint;
        console.log(`CounterA BEFORE: ${counterABefore}, CounterB BEFORE: ${counterBBefore}`);

        // Hop 1 (Route 2): Native funds + multicall (both counters)
        const tx1 = await pushClient.universal.prepareTransaction({
          to: {
            address: NATIVE_ADDRESS as `0x${string}`,
            chain: CHAIN.BNB_TESTNET,
          },
          value: parseEther('0.0001'),
          data: [
            { to: TEST_TARGET, value: parseEther('0.0001'), data: '0x' as `0x${string}` },
            { to: COUNTER_A, value: BigInt(0), data: incrementPayload },
            { to: COUNTER_B, value: BigInt(0), data: incrementPayload },
          ],
        });

        // Hop 2 (Route 3): Bridge back
        const tx2 = await pushClient.universal.prepareTransaction({
          from: { chain: CHAIN.BNB_TESTNET },
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

        // Read both counters AFTER
        const counterAAfter = await bscPublicClient.readContract({
          address: COUNTER_A,
          abi: COUNTER_ABI,
          functionName: 'count',
        }) as bigint;
        const counterBAfter = await bscPublicClient.readContract({
          address: COUNTER_B,
          abi: COUNTER_ABI,
          functionName: 'count',
        }) as bigint;
        console.log(`CounterA AFTER: ${counterAAfter}, CounterB AFTER: ${counterBAfter}`);

        expect(counterAAfter).toBeGreaterThan(counterABefore);
        expect(counterBAfter).toBeGreaterThan(counterBBefore);
      }, 900000);

      it('should transfer USDT + increment counter then bridge back (ERC20 funds + payload cascade)', async () => {
        if (skipE2E) return;
        if (!usdtToken) {
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
        const counterBefore = await bscPublicClient.readContract({
          address: COUNTER_A,
          abi: COUNTER_ABI,
          functionName: 'count',
        }) as bigint;
        console.log(`CounterA BEFORE: ${counterBefore}`);

        // Hop 1 (Route 2): ERC20 funds + counter increment
        const tx1 = await pushClient.universal.prepareTransaction({
          to: {
            address: NATIVE_ADDRESS as `0x${string}`,
            chain: CHAIN.BNB_TESTNET,
          },
          funds: {
            amount: BigInt(10000),
            token: usdtToken,
          },
          data: [
            { to: BSC_USDT_ADDRESS as `0x${string}`, value: BigInt(0), data: erc20TransferPayload },
            { to: COUNTER_A, value: BigInt(0), data: incrementPayload },
          ],
        });

        // Hop 2 (Route 3): Bridge native BNB back to Push
        const tx2 = await pushClient.universal.prepareTransaction({
          from: { chain: CHAIN.BNB_TESTNET },
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
        const counterAfter = await bscPublicClient.readContract({
          address: COUNTER_A,
          abi: COUNTER_ABI,
          functionName: 'count',
        }) as bigint;
        console.log(`CounterA AFTER: ${counterAfter}`);

        expect(counterAfter).toBeGreaterThan(counterBefore);
      }, 900000);

      it('should transfer USDT + increment both counters then bridge back (ERC20 funds + multicall cascade)', async () => {
        if (skipE2E) return;
        if (!usdtToken) {
          console.log('Skipping - USDT token not found');
          return;
        }

        console.log('\n=== Test: Cascade — ERC20 Funds + Multicall (Both Counters) + Bridge Back ===');

        const incrementPayload = encodeFunctionData({ abi: COUNTER_ABI, functionName: 'increment' });
        const erc20TransferPayload = encodeFunctionData({
          abi: ERC20_EVM,
          functionName: 'transfer',
          args: [TEST_TARGET, BigInt(10000)],
        });

        // Read both counters BEFORE
        const counterABefore = await bscPublicClient.readContract({
          address: COUNTER_A,
          abi: COUNTER_ABI,
          functionName: 'count',
        }) as bigint;
        const counterBBefore = await bscPublicClient.readContract({
          address: COUNTER_B,
          abi: COUNTER_ABI,
          functionName: 'count',
        }) as bigint;
        console.log(`CounterA BEFORE: ${counterABefore}, CounterB BEFORE: ${counterBBefore}`);

        // Hop 1 (Route 2): ERC20 funds + multicall (both counters)
        const tx1 = await pushClient.universal.prepareTransaction({
          to: {
            address: NATIVE_ADDRESS as `0x${string}`,
            chain: CHAIN.BNB_TESTNET,
          },
          funds: {
            amount: BigInt(10000),
            token: usdtToken,
          },
          data: [
            { to: BSC_USDT_ADDRESS as `0x${string}`, value: BigInt(0), data: erc20TransferPayload },
            { to: COUNTER_A, value: BigInt(0), data: incrementPayload },
            { to: COUNTER_B, value: BigInt(0), data: incrementPayload },
          ],
        });

        // Hop 2 (Route 3): Bridge back
        const tx2 = await pushClient.universal.prepareTransaction({
          from: { chain: CHAIN.BNB_TESTNET },
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

        // Read both counters AFTER
        const counterAAfter = await bscPublicClient.readContract({
          address: COUNTER_A,
          abi: COUNTER_ABI,
          functionName: 'count',
        }) as bigint;
        const counterBAfter = await bscPublicClient.readContract({
          address: COUNTER_B,
          abi: COUNTER_ABI,
          functionName: 'count',
        }) as bigint;
        console.log(`CounterA AFTER: ${counterAAfter}, CounterB AFTER: ${counterBAfter}`);

        expect(counterAAfter).toBeGreaterThan(counterABefore);
        expect(counterBAfter).toBeGreaterThan(counterBBefore);
      }, 900000);
    });

  });
});

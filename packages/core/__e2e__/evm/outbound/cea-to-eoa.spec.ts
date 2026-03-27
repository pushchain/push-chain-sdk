import '@e2e/shared/setup';
/**
 * CEA → EOA: Inbound to Push Chain Native Account (Route 3)
 *
 * Tests for inbound transactions from external chains back to Push Chain via CEA,
 * targeting an EOA (native Push Chain account) signer (PUSH_PRIVATE_KEY).
 * Covers: ERC-20 bridge back, native bridge back.
 *
 * Primary test chain: BNB Testnet (Chain ID: 97)
 *
 * Coverage: R3-F (Native Bridge Back), R3-F-ERC20 (ERC-20 Bridge Back)
 */
import { PushChain } from '../../../src';
import { PUSH_NETWORK, CHAIN } from '../../../src/lib/constants/enums';
import { CHAIN_INFO } from '../../../src/lib/constants/chain';
import { createWalletClient, http, Hex, parseEther, formatEther, createPublicClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { getCEAAddress } from '../../../src/lib/orchestrator/cea-utils';
import { TransactionRoute, detectRoute } from '../../../src/lib/orchestrator/route-detector';
import type { UniversalExecuteParams } from '../../../src/lib/orchestrator/orchestrator.types';
import { ERC20_EVM } from '../../../src/lib/constants/abi/erc20.evm';
import { MOVEABLE_TOKEN_CONSTANTS, type MoveableToken } from '../../../src/lib/constants/tokens';
import { verifyExternalTransaction } from '@e2e/shared/external-tx-verifier';

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

describe('CEA → EOA: Inbound to Push Chain Native Account (Route 3)', () => {
  let pushClient: Awaited<ReturnType<typeof PushChain.initialize>>;
  let eoaAddress: `0x${string}`;
  let ceaAddress: `0x${string}`;
  let usdtToken: MoveableToken | undefined;

  // Uses PUSH_PRIVATE_KEY — a native Push Chain account (not derived from external chain)
  const privateKey = process.env['PUSH_PRIVATE_KEY'] as Hex;
  const skipE2E = !privateKey;

  beforeAll(async () => {
    if (skipE2E) {
      console.log('Skipping E2E tests - PUSH_PRIVATE_KEY not set');
      return;
    }

    // Key difference: origin is PUSH_TESTNET_DONUT (native Push Chain EOA)
    const originChain = CHAIN.PUSH_TESTNET_DONUT;
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

    eoaAddress = pushClient.universal.account;
    console.log(`Push EOA Address: ${eoaAddress}`);

    // Get CEA address for BSC Testnet — CEA Factory works for native Push EOA too
    const ceaResult = await getCEAAddress(eoaAddress, CHAIN.BNB_TESTNET);
    ceaAddress = ceaResult.cea;
    console.log(`CEA Address on BSC: ${ceaAddress}, deployed: ${ceaResult.isDeployed}`);

    // Get USDT token for ERC20 flows
    usdtToken = MOVEABLE_TOKEN_CONSTANTS.BNB_TESTNET.USDT;
    if (usdtToken) {
      console.log(`USDT Token (BNB Testnet): ${usdtToken.address} (${usdtToken.decimals} decimals)`);
    }
  }, 60000);

  // ============================================================================
  // Core Scenarios
  // ============================================================================
  describe('Core Scenarios', () => {

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
          targetChain: CHAIN.BNB_TESTNET,
        });
      }, 600000);

      it('should bridge ERC-20 USDT back to Push Chain from EOA CEA', async () => {
        if (skipE2E) return;
        if (!usdtToken) {
          console.log('Skipping - USDT token not found');
          return;
        }

        console.log('\n=== Test: EOA ERC-20 USDT Inbound (CEA → Push, Route 3) ===');

        const params: UniversalExecuteParams = {
          from: { chain: CHAIN.BNB_TESTNET },
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
        expect(tx.chain).toBe(CHAIN.BNB_TESTNET);

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
        expect(receipt.externalChain).toBe(CHAIN.BNB_TESTNET);

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
          targetChain: CHAIN.BNB_TESTNET,
        });
      }, 600000);

      it('should bridge native BNB back to Push Chain from EOA CEA', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: EOA Native BNB Inbound (CEA → Push, Route 3) ===');

        const params: UniversalExecuteParams = {
          from: { chain: CHAIN.BNB_TESTNET },
          to: eoaAddress,
          value: parseEther('0.00005'),
        };

        expect(detectRoute(params)).toBe(TransactionRoute.CEA_TO_PUSH);

        const tx = await pushClient.universal.sendTransaction(params);

        console.log(`Push Chain TX Hash: ${tx.hash}`);
        console.log(`Source Chain: ${tx.chain}`);

        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(tx.chain).toBe(CHAIN.BNB_TESTNET);

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
        expect(receipt.externalChain).toBe(CHAIN.BNB_TESTNET);

        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);
      }, 600000);
    });

  });
});

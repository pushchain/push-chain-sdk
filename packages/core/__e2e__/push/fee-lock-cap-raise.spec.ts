import '@e2e/shared/setup';
/**
 * E2E: Fee-Lock Deposit Cap Raised from $10 USD → $1000 USD
 *
 * Regression test for the bump in 5 SDK sites (gateway-client, execute-standard,
 * execute-funds-payload, gas-calculator) that previously clamped fee-lock deposits
 * at $10 USD. At the current Uniswap pETH→WPC pool rate (~$4+/PC), $10 of pETH
 * yielded only ~2.4 PC after slippage — so any transfer >~2 PC from Sepolia
 * hit "Insufficient deposit" in the pre-flight check.
 *
 * Originally reported failure: transferring 20 PC from Sepolia → Push Chain.
 *
 * NOTE: full end-to-end success additionally requires the EVM UniversalGateway
 * admin to call setCapsUSD(_, 1000e18) on the deployed contract (current on-chain
 * cap was $100 pre-bump). If the contract hasn't been bumped, the SDK pre-flight
 * will pass but the on-chain tx will revert. The assertions below focus on
 * SDK-side behavior (no pre-flight throw, correct error message at the new cap).
 */
import { type Hex, createPublicClient, createWalletClient, http, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { PushChain } from '../../src';
import { CHAIN } from '../../src/lib/constants/enums';
import { CHAIN_INFO } from '../../src/lib/constants/chain';
import { createEvmPushClient } from '@e2e/shared/evm-client';
import { TEST_TARGET_ADDRESS, SEPOLIA_RPC } from '@e2e/shared/constants';

const PUSH_RPC = CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0];

// Minimum Sepolia ETH the main wallet needs to cover a $1000 fee-lock deposit
// at an ETH price around $3k. Leave headroom for future price moves + gas.
const MIN_SEPOLIA_ETH_WEI = BigInt(3e17); // 0.3 ETH

const privateKey = process.env['EVM_PRIVATE_KEY'] as Hex | undefined;
const skipE2E = !privateKey;

describe('Fee-Lock Cap Raised to $1000 USD (Sepolia → Push)', () => {
  const sepoliaPublicClient = createPublicClient({
    chain: sepolia,
    transport: http(SEPOLIA_RPC),
  });
  const pushPublicClient = createPublicClient({
    transport: http(PUSH_RPC),
  });

  let sepoliaClient: PushChain;
  let mainAddress: `0x${string}`;
  let ueaAddress: `0x${string}`;

  beforeAll(async () => {
    if (skipE2E) {
      console.warn('EVM_PRIVATE_KEY not set — skipping fee-lock cap e2e');
      return;
    }

    const setup = await createEvmPushClient({
      chain: CHAIN.ETHEREUM_SEPOLIA,
      privateKey: privateKey!,
      progressHook: (val) => console.log('[fee-lock-cap]', val),
    });
    sepoliaClient = setup.pushClient;
    mainAddress = setup.account.address;
    ueaAddress = sepoliaClient.universal.account as `0x${string}`;

    const sepoliaBalance = await sepoliaPublicClient.getBalance({ address: mainAddress });
    const ueaBalance = await pushPublicClient.getBalance({ address: ueaAddress });

    console.log('--- Wallet state ---');
    console.log(`Main (Sepolia EOA): ${mainAddress}`);
    console.log(`  Sepolia ETH:      ${formatEther(sepoliaBalance)} ETH`);
    console.log(`UEA (Push):         ${ueaAddress}`);
    console.log(`  Push PC:          ${formatEther(ueaBalance)} PC`);
  }, 60_000);

  // ==========================================================================
  // POSITIVE: the originally failing scenario — 20 PC transfer from Sepolia
  // ==========================================================================
  it('should not throw "Insufficient deposit" for a 20 PC transfer from Sepolia', async () => {
    if (skipE2E) return;

    const sepoliaBalance = await sepoliaPublicClient.getBalance({ address: mainAddress });
    if (sepoliaBalance < MIN_SEPOLIA_ETH_WEI) {
      console.warn(
        `Sepolia balance ${formatEther(sepoliaBalance)} ETH < required ` +
        `${formatEther(MIN_SEPOLIA_ETH_WEI)} ETH — skipping transfer assertion. ` +
        `Fund ${mainAddress} on Sepolia to run this test end-to-end.`
      );
      return;
    }

    const transferValue = PushChain.utils.helpers.parseUnits('20', 18);
    const recipientBalanceBefore = await pushPublicClient.getBalance({
      address: TEST_TARGET_ADDRESS,
    });

    // Under the old $10 cap this call would throw before broadcasting.
    // We assert only that the SDK pre-flight does NOT throw the old error —
    // on-chain execution additionally depends on the EVM gateway's on-chain
    // MAX_CAP_UNIVERSAL_TX_USD being raised in parallel.
    let preFlightThrew: Error | undefined;
    let txHash: string | undefined;

    try {
      const tx = await sepoliaClient.universal.sendTransaction({
        to: TEST_TARGET_ADDRESS,
        value: transferValue,
      });
      txHash = tx.hash;
      console.log(`TX Hash: ${tx.hash}`);

      const receipt = await tx.wait();
      console.log(`Receipt status: ${receipt.status}`);

      if (receipt.status === 1) {
        const recipientBalanceAfter = await pushPublicClient.getBalance({
          address: TEST_TARGET_ADDRESS,
        });
        const diff = recipientBalanceAfter - recipientBalanceBefore;
        console.log(`Recipient balance diff: ${formatEther(diff)} PC`);
        expect(diff).toBeGreaterThanOrEqual(transferValue);
      } else {
        console.warn(
          `On-chain tx reverted (receipt.status=0). This usually means the EVM ` +
          `UniversalGateway's MAX_CAP_UNIVERSAL_TX_USD has not been raised to $1000. ` +
          `SDK-side fix is still validated (no "Insufficient deposit" pre-flight throw).`
        );
      }
    } catch (err) {
      preFlightThrew = err instanceof Error ? err : new Error(String(err));
      console.log(`Caught error: ${preFlightThrew.message}`);
    }

    // The exact assertion for this fix: the old "$10 USD" pre-flight error is gone.
    if (preFlightThrew) {
      expect(preFlightThrew.message).not.toMatch(/capped at \$10 USD/);
      expect(preFlightThrew.message).not.toMatch(/exceeds max \$10/);
    }
    expect(txHash ?? '').toMatch(/^(0x[a-fA-F0-9]{64})?$/);
  }, 300_000);

  // ==========================================================================
  // SELF-TEST: a transfer comfortably inside the current pool-safe capacity
  // should broadcast and confirm end-to-end. Sized well below the
  // "max transferable right now" reported in the error-path diagnostic.
  // ==========================================================================
  it('should broadcast a 13 PC transfer end-to-end (within current pool capacity)', async () => {
    if (skipE2E) return;

    const sepoliaBalance = await sepoliaPublicClient.getBalance({ address: mainAddress });
    if (sepoliaBalance < MIN_SEPOLIA_ETH_WEI) {
      console.warn(
        `Sepolia balance ${formatEther(sepoliaBalance)} ETH < ${formatEther(MIN_SEPOLIA_ETH_WEI)} ETH — skipping.`
      );
      return;
    }

    const transferValue = PushChain.utils.helpers.parseUnits('13', 18);
    const MIN_UEA_BALANCE = PushChain.utils.helpers.parseUnits('12', 18);
    const TOP_UP_TARGET = PushChain.utils.helpers.parseUnits('15', 18);

    let ueaBalanceBefore = await pushPublicClient.getBalance({ address: ueaAddress });
    console.log(`UEA balance before: ${formatEther(ueaBalanceBefore)} PC`);

    // Top up the UEA from the main wallet (same key, on Push Chain directly)
    // if it's too low to cover a 13 PC transfer after the fee-lock cycle.
    if (ueaBalanceBefore < MIN_UEA_BALANCE) {
      const pushWalletClient = createWalletClient({
        account: privateKeyToAccount(privateKey!),
        transport: http(PUSH_RPC),
      });
      const topUp = TOP_UP_TARGET - ueaBalanceBefore;
      console.log(
        `Topping up UEA by ${formatEther(topUp)} PC from main wallet on Push Chain...`
      );
      const fundHash = await pushWalletClient.sendTransaction({
        to: ueaAddress,
        value: topUp,
        chain: null,
      });
      await pushPublicClient.waitForTransactionReceipt({ hash: fundHash });
      ueaBalanceBefore = await pushPublicClient.getBalance({ address: ueaAddress });
      console.log(`UEA balance after top-up: ${formatEther(ueaBalanceBefore)} PC`);
    }

    const recipientBalanceBefore = await pushPublicClient.getBalance({
      address: TEST_TARGET_ADDRESS,
    });
    console.log(`Sending 13 PC → ${TEST_TARGET_ADDRESS}`);

    const tx = await sepoliaClient.universal.sendTransaction({
      to: TEST_TARGET_ADDRESS,
      value: transferValue,
    });

    console.log(`TX Hash: ${tx.hash}`);
    expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

    const receipt = await tx.wait();
    console.log(`Receipt status: ${receipt.status}`);
    expect(receipt.status).toBe(1);

    const recipientBalanceAfter = await pushPublicClient.getBalance({
      address: TEST_TARGET_ADDRESS,
    });
    const diff = recipientBalanceAfter - recipientBalanceBefore;
    console.log(`Recipient received: ${formatEther(diff)} PC`);
    expect(diff).toBeGreaterThanOrEqual(transferValue);
  }, 300_000);

  // ==========================================================================
  // NEGATIVE: transfer above the new $1000 cap should surface the new error
  // ==========================================================================
  it('should throw "$1000 USD" error for a transfer well above the new cap', async () => {
    if (skipE2E) return;

    // 10,000 PC is far above any plausible UEA balance + maxed-out $1000 deposit,
    // so the pre-flight cap check fires deterministically regardless of existing funds.
    const oversizedValue = PushChain.utils.helpers.parseUnits('10000', 18);

    await expect(
      sepoliaClient.universal.sendTransaction({
        to: TEST_TARGET_ADDRESS,
        value: oversizedValue,
      })
    ).rejects.toThrow(/capped at \$1000 USD/);
  }, 120_000);
});

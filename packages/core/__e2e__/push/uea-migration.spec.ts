import '@e2e/shared/setup';
import type { ProgressEvent } from '../../src/lib/progress-hook/progress-hook.types';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import {
  createPublicClient,
  createWalletClient,
  Hex,
  http,
  parseEther,
} from 'viem';
import { sepolia } from 'viem/chains';
import { PushChain } from '../../src';
import { CHAIN, PUSH_NETWORK } from '../../src/lib/constants/enums';
import { CHAIN_INFO } from '../../src/lib/constants/chain';
import { parseUEAVersion } from '../../src/lib/orchestrator/orchestrator.types';
import { createEvmPushClient } from '@e2e/shared/evm-client';

/**
 * E2E test for UEA Migration / Upgrade flow.
 *
 * Prerequisites:
 * - EVM_PRIVATE_KEY set in .env (account with an old UEA deployed on testnet donut)
 * - UEAFactory deployed at 0x93a31A8DDdCA2686243f1a701AbF82aBA90Fe2eF
 * - UEAMigration contract set on factory
 * - New UEA_EVM/UEA_SVM implementations registered
 */
describe('UEA Migration', () => {
  const originChain = CHAIN.ETHEREUM_SEPOLIA;
  let pushClient: PushChain;
  let mainWalletClient: ReturnType<typeof createWalletClient>;

  beforeAll(async () => {
    const privateKey = process.env['EVM_PRIVATE_KEY'] as Hex;
    if (!privateKey) throw new Error('EVM_PRIVATE_KEY not set');

    const setup = await createEvmPushClient({
      chain: originChain,
      privateKey,
      progressHook: (event) => {
        console.log(`[${event.id}] ${event.title}: ${event.message}`);
      },
    });
    pushClient = setup.pushClient;
    mainWalletClient = setup.walletClient;
  }, 60_000);

  it('should have accountStatus populated after initialize', async () => {
    // Wait for the background fetch to complete
    await pushClient.accountStatusReady;

    const status = pushClient.accountStatus;
    console.log('Account Status after init:', JSON.stringify(status, null, 2));

    expect(status.mode).toBe('signer');
    expect(status.uea.loaded).toBe(true);
    expect(typeof status.uea.deployed).toBe('boolean');
    expect(typeof status.uea.version).toBe('string');
    expect(typeof status.uea.minRequiredVersion).toBe('string');
    expect(typeof status.uea.requiresUpgrade).toBe('boolean');
  }, 60_000);

  it('should fetch account status with getAccountStatus()', async () => {
    const status = await pushClient.getAccountStatus({ forceRefresh: true });
    console.log(
      'Account Status (fetched):',
      JSON.stringify(status, null, 2)
    );

    expect(status.uea.loaded).toBe(true);
    expect(status.mode).toBe('signer');

    if (status.uea.deployed) {
      expect(status.uea.version).not.toBe('');
      console.log(`UEA deployed. Version: ${status.uea.version}`);
      console.log(`Min required: ${status.uea.minRequiredVersion}`);
      console.log(`Requires upgrade: ${status.uea.requiresUpgrade}`);

      if (status.uea.minRequiredVersion) {
        const current = parseUEAVersion(status.uea.version);
        const required = parseUEAVersion(status.uea.minRequiredVersion);
        expect(status.uea.requiresUpgrade).toBe(current < required);
      }
    } else {
      console.log('UEA not deployed yet for this account');
      expect(status.uea.version).toBe('');
      expect(status.uea.requiresUpgrade).toBe(false);
    }
  }, 30_000);

  it('should upgrade account if upgrade is required', async () => {
    const status = await pushClient.getAccountStatus({ forceRefresh: true });

    if (!status.uea.deployed) {
      console.log('SKIP: UEA not deployed — cannot test migration');
      return;
    }

    if (!status.uea.requiresUpgrade) {
      console.log(
        `SKIP: No upgrade required (version ${status.uea.version} >= ${status.uea.minRequiredVersion})`
      );
      return;
    }

    console.log(
      `Upgrading UEA from ${status.uea.version} to ${status.uea.minRequiredVersion}...`
    );

    const events: ProgressEvent[] = [];
    await pushClient.upgradeAccount({
      progressHook: (event) => {
        events.push(event);
        console.log(`[${event.id}] ${event.title}: ${event.message}`);
      },
    });

    // Verify progress hooks fired
    const eventIds = events.map((e) => e.id);
    expect(eventIds).toContain('UEA-MIG-01'); // Checking
    expect(eventIds).toContain('UEA-MIG-02'); // Awaiting signature
    expect(eventIds).toContain('UEA-MIG-03'); // Broadcasting
    expect(eventIds).toContain('UEA-MIG-9901'); // Success

    // Verify account status updated
    const updated = pushClient.accountStatus;
    console.log(
      'Account Status after upgrade:',
      JSON.stringify(updated, null, 2)
    );
    expect(updated.uea.requiresUpgrade).toBe(false);
  }, 120_000);

  it('should deploy UEA via fresh wallet tx and require no migration', async () => {
    // 1. Generate a brand new wallet
    const freshPrivateKey = generatePrivateKey();
    const freshAccount = privateKeyToAccount(freshPrivateKey);
    console.log(`Fresh wallet address: ${freshAccount.address}`);

    // 2. Fund fresh wallet with ETH on Sepolia (needed for fee-locking)
    const publicClient = createPublicClient({
      chain: sepolia,
      transport: http(CHAIN_INFO[originChain].defaultRPC[0]),
    });

    const fundTxHash = await mainWalletClient.sendTransaction({
      to: freshAccount.address,
      value: parseEther('0.005'),
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      account: mainWalletClient.account!,
      chain: sepolia,
    });
    await publicClient.waitForTransactionReceipt({ hash: fundTxHash });
    console.log(`Funded fresh wallet with 0.005 ETH: ${fundTxHash}`);

    // 3. Initialize PushChain with fresh wallet
    const freshWalletClient = createWalletClient({
      account: freshAccount,
      chain: sepolia,
      transport: http(CHAIN_INFO[originChain].defaultRPC[0]),
    });

    const freshSigner =
      await PushChain.utils.signer.toUniversalFromKeypair(freshWalletClient, {
        chain: originChain,
        library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
      });

    const freshClient = await PushChain.initialize(freshSigner, {
      network: PUSH_NETWORK.TESTNET_DONUT,
      progressHook: (event) => {
        console.log(`[fresh] [${event.id}] ${event.title}: ${event.message}`);
      },
    });

    // 4. Verify UEA is NOT deployed yet
    const statusBefore = await freshClient.getAccountStatus({
      forceRefresh: true,
    });
    console.log(
      'Status before tx:',
      JSON.stringify(statusBefore, null, 2)
    );
    expect(statusBefore.uea.deployed).toBe(false);

    // 5. Fresh wallet sends a tx → triggers fee-lock which deploys the UEA.
    //    executePayload may revert (empty UEA, no balance) but the UEA is
    //    already created on-chain by the time the error is thrown — so we
    //    catch and continue.
    const mainUEA = pushClient.universal.account;
    console.log('Fresh wallet sending tx to trigger UEA deployment...');
    try {
      const tx = await freshClient.universal.sendTransaction({
        to: mainUEA,
        value: BigInt(0),
        data: '0x',
      });
      console.log(`Tx hash: ${tx.hash}`);
      const receipt = await tx.wait();
      console.log(`Tx status: ${receipt.status}`);
    } catch (err) {
      console.log(
        `Expected executePayload revert (UEA still gets deployed): ${(err as Error).message}`
      );
    }

    // 6. Re-check: UEA should now be deployed with latest version
    const statusAfter = await freshClient.getAccountStatus({
      forceRefresh: true,
    });
    console.log(
      'Status after tx:',
      JSON.stringify(statusAfter, null, 2)
    );

    expect(statusAfter.mode).toBe('signer');
    expect(statusAfter.uea.loaded).toBe(true);
    expect(statusAfter.uea.deployed).toBe(true);
    expect(statusAfter.uea.version).not.toBe('');
    // Freshly deployed UEA should be on the latest version → no migration
    expect(statusAfter.uea.requiresUpgrade).toBe(false);
    console.log(
      `Fresh UEA deployed at version ${statusAfter.uea.version}, no migration needed`
    );

    // 7. upgradeAccount should be a no-op
    const upgradeEvents: ProgressEvent[] = [];
    await freshClient.upgradeAccount({
      progressHook: (event) => {
        upgradeEvents.push(event);
        console.log(
          `[fresh-upgrade] [${event.id}] ${event.title}: ${event.message}`
        );
      },
    });

    const upgradeEventIds = upgradeEvents.map((e) => e.id);
    expect(upgradeEventIds).toContain('UEA-MIG-01'); // Checking
    expect(upgradeEventIds).toContain('UEA-MIG-9903'); // No upgrade needed
  }, 180_000);

  it('should send transaction after upgrade', async () => {
    const status = await pushClient.getAccountStatus();

    if (!status.uea.deployed) {
      console.log('SKIP: UEA not deployed');
      return;
    }

    const to = '0x35B84d6848D16415177c64D64504663b998A6ab4';
    console.log('Sending test transaction post-migration...');

    const tx = await pushClient.universal.sendTransaction({
      to,
      value: BigInt(1),
    });

    console.log(`Transaction hash: ${tx.hash}`);
    expect(tx.hash).toMatch(/^0x/);

    const receipt = await tx.wait();
    console.log(`Receipt status: ${receipt.status}`);
  }, 120_000);
});

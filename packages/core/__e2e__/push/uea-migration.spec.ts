import '@e2e/shared/setup';
import { privateKeyToAccount } from 'viem/accounts';
import { createWalletClient, Hex, http } from 'viem';
import { PushChain } from '../../src';
import { UniversalSigner } from '../../src/lib/universal/universal.types';
import { PUSH_NETWORK, CHAIN } from '../../src/lib/constants/enums';
import { CHAIN_INFO } from '../../src/lib/constants/chain';
import { parseUEAVersion } from '../../src/lib/orchestrator/orchestrator.types';

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
  const pushNetwork = PUSH_NETWORK.TESTNET_DONUT;
  const originChain = CHAIN.ETHEREUM_SEPOLIA;
  let pushClient: PushChain;
  let universalSigner: UniversalSigner;

  beforeAll(async () => {
    const privateKey = process.env['EVM_PRIVATE_KEY'] as Hex;
    if (!privateKey) throw new Error('EVM_PRIVATE_KEY not set');

    const account = privateKeyToAccount(privateKey);
    const walletClient = createWalletClient({
      account,
      transport: http(CHAIN_INFO[originChain].defaultRPC[0]),
    });

    universalSigner = await PushChain.utils.signer.toUniversalFromKeypair(
      walletClient,
      {
        chain: originChain,
        library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
      }
    );

    pushClient = await PushChain.initialize(universalSigner, {
      network: pushNetwork,
      progressHook: (event: any) => {
        console.log(`[${event.id}] ${event.title}: ${event.message}`);
      },
    });
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

    const events: any[] = [];
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

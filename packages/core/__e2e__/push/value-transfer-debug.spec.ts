import '@e2e/shared/setup';
import { type Hex, createPublicClient, http, formatUnits } from 'viem';
import { PushChain } from '../../src';
import { CHAIN } from '../../src/lib/constants/enums';
import { CHAIN_INFO } from '../../src/lib/constants/chain';
import { createEvmPushClient } from '@e2e/shared/evm-client';

const RECIPIENT = '0xFaE3594C68EDFc2A61b7527164BDAe80bC302108' as `0x${string}`;
const TRANSFER_VALUE = PushChain.utils.helpers.parseUnits('0.001', 18);

const pushPublicClient = createPublicClient({
  transport: http(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]),
});

function formatPC(wei: bigint): string {
  return `${wei} wei (${formatUnits(wei, 18)} PC)`;
}

async function getBalance(address: `0x${string}`): Promise<bigint> {
  return pushPublicClient.getBalance({ address });
}

describe('Value Transfer Debug — data: "0x" vs undefined', () => {
  // =========================================================================
  // Push Chain Native Signer
  // =========================================================================
  describe('Push Chain Native Signer', () => {
    let pushClient: PushChain;
    const skipPush = !process.env['PUSH_PRIVATE_KEY'];

    beforeAll(async () => {
      if (skipPush) return;
      const setup = await createEvmPushClient({
        chain: CHAIN.PUSH_TESTNET_DONUT,
        privateKey: process.env['PUSH_PRIVATE_KEY'] as Hex,
        progressHook: (val) => console.log('[Push]', val),
      });
      pushClient = setup.pushClient;
    });

    it('should send value with data: "0x"', async () => {
      if (skipPush) return;

      const balanceBefore = await getBalance(RECIPIENT);
      console.log('--- Push native | data: "0x" ---');
      console.log('Balance before:', formatPC(balanceBefore));

      const tx = await pushClient.universal.sendTransaction({
        to: RECIPIENT,
        value: TRANSFER_VALUE,
        data: '0x',
      });

      console.log('TX Hash:', tx.hash);
      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

      const receipt = await tx.wait();
      console.log('Receipt status:', receipt.status);
      expect(receipt.status).toBe(1);

      const balanceAfter = await getBalance(RECIPIENT);
      const diff = balanceAfter - balanceBefore;
      console.log('Balance after:', formatPC(balanceAfter));
      console.log('Balance diff:', formatPC(diff));

      expect(balanceAfter).toBeGreaterThanOrEqual(balanceBefore + TRANSFER_VALUE);
    }, 60000);

    it('should send value with data: undefined', async () => {
      if (skipPush) return;

      const balanceBefore = await getBalance(RECIPIENT);
      console.log('--- Push native | data: undefined ---');
      console.log('Balance before:', formatPC(balanceBefore));

      const tx = await pushClient.universal.sendTransaction({
        to: RECIPIENT,
        value: TRANSFER_VALUE,
      });

      console.log('TX Hash:', tx.hash);
      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

      const receipt = await tx.wait();
      console.log('Receipt status:', receipt.status);
      expect(receipt.status).toBe(1);

      const balanceAfter = await getBalance(RECIPIENT);
      const diff = balanceAfter - balanceBefore;
      console.log('Balance after:', formatPC(balanceAfter));
      console.log('Balance diff:', formatPC(diff));

      expect(balanceAfter).toBeGreaterThanOrEqual(balanceBefore + TRANSFER_VALUE);
    }, 60000);
  });

  // =========================================================================
  // Ethereum Sepolia Signer
  // =========================================================================
  describe('Ethereum Sepolia Signer', () => {
    let sepoliaClient: PushChain;
    const skipSepolia = !process.env['EVM_PRIVATE_KEY'];

    beforeAll(async () => {
      if (skipSepolia) return;
      const setup = await createEvmPushClient({
        chain: CHAIN.ETHEREUM_SEPOLIA,
        privateKey: process.env['EVM_PRIVATE_KEY'] as Hex,
        progressHook: (val) => console.log('[Sepolia]', val),
      });
      sepoliaClient = setup.pushClient;
    });

    it('should send value with data: "0x"', async () => {
      if (skipSepolia) return;

      const balanceBefore = await getBalance(RECIPIENT);
      console.log('--- Sepolia | data: "0x" ---');
      console.log('Balance before:', formatPC(balanceBefore));

      const tx = await sepoliaClient.universal.sendTransaction({
        to: RECIPIENT,
        value: TRANSFER_VALUE,
        data: '0x',
      });

      console.log('TX Hash:', tx.hash);
      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

      const receipt = await tx.wait();
      console.log('Receipt status:', receipt.status);
      expect(receipt.status).toBe(1);

      const balanceAfter = await getBalance(RECIPIENT);
      const diff = balanceAfter - balanceBefore;
      console.log('Balance after:', formatPC(balanceAfter));
      console.log('Balance diff:', formatPC(diff));

      expect(balanceAfter).toBeGreaterThanOrEqual(balanceBefore + TRANSFER_VALUE);
    }, 120000);

    it('should send value with data: undefined', async () => {
      if (skipSepolia) return;

      const balanceBefore = await getBalance(RECIPIENT);
      console.log('--- Sepolia | data: undefined ---');
      console.log('Balance before:', formatPC(balanceBefore));

      const tx = await sepoliaClient.universal.sendTransaction({
        to: RECIPIENT,
        value: TRANSFER_VALUE,
      });

      console.log('TX Hash:', tx.hash);
      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

      const receipt = await tx.wait();
      console.log('Receipt status:', receipt.status);
      expect(receipt.status).toBe(1);

      const balanceAfter = await getBalance(RECIPIENT);
      const diff = balanceAfter - balanceBefore;
      console.log('Balance after:', formatPC(balanceAfter));
      console.log('Balance diff:', formatPC(diff));

      expect(balanceAfter).toBeGreaterThanOrEqual(balanceBefore + TRANSFER_VALUE);
    }, 120000);
  });
});

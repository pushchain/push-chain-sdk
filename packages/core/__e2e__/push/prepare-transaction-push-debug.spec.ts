/**
 * Debug E2E: prepareTransaction bug when signer is a Push native EOA.
 *
 * Bug: computeUEAOffchain() returns the EOA address directly for Push Chain
 * signers, so prepareTransaction builds UEA multicall payloads targeting an
 * EOA that has no multicall handler. CEA derivation is also wrong.
 *
 * This test logs diagnostic output to expose the issue side-by-side with
 * a Sepolia signer (which correctly derives a CREATE2 UEA address).
 */

import '@e2e/shared/setup';
import { Hex, createPublicClient, http } from 'viem';
import { PushChain } from '../../src';
import { CHAIN, PUSH_NETWORK } from '../../src/lib/constants/enums';
import { CHAIN_INFO } from '../../src/lib/constants/chain';
import { createEvmPushClient } from '@e2e/shared/evm-client';
import { TEST_TARGET_ADDRESS } from '@e2e/shared/constants';
import {
  COUNTER_ADDRESS_PAYABLE,
  COUNTER_ABI_PAYABLE,
} from '@e2e/shared/inbound-helpers';
import type { PreparedUniversalTx } from '../../src/lib/orchestrator/orchestrator.types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const bigintReplacer = (_key: string, value: any) =>
  typeof value === 'bigint' ? value.toString() : value;

function logPrepared(label: string, p: PreparedUniversalTx) {
  console.log(`\n=== ${label} ===`);
  console.log('  route:', p.route);
  console.log('  nonce:', p.nonce.toString());
  console.log('  estimatedGas:', p.estimatedGas.toString());
  console.log('  deadline:', p.deadline.toString());
  console.log('  payload (first 66):', p.payload.slice(0, 66) + '...');
  console.log(
    '  _hop.ueaAddress:',
    (p._hop as Record<string, unknown>).ueaAddress
  );
  console.log(
    '  _hop.pushMulticalls:',
    JSON.stringify((p._hop as Record<string, unknown>).pushMulticalls, bigintReplacer, 2)
  );
  if ((p._hop as Record<string, unknown>).ceaAddress) {
    console.log(
      '  _hop.ceaAddress:',
      (p._hop as Record<string, unknown>).ceaAddress
    );
  }
  if ((p._hop as Record<string, unknown>).targetChain) {
    console.log(
      '  _hop.targetChain:',
      (p._hop as Record<string, unknown>).targetChain
    );
  }
  if ((p._hop as Record<string, unknown>).prc20Token) {
    console.log(
      '  _hop.prc20Token:',
      (p._hop as Record<string, unknown>).prc20Token
    );
    console.log(
      '  _hop.burnAmount:',
      String((p._hop as Record<string, unknown>).burnAmount)
    );
    console.log(
      '  _hop.gasToken:',
      (p._hop as Record<string, unknown>).gasToken
    );
    console.log(
      '  _hop.gasFee:',
      String((p._hop as Record<string, unknown>).gasFee)
    );
  }
  console.log(
    '  gatewayRequest:',
    JSON.stringify(p.gatewayRequest, bigintReplacer).slice(0, 200) + '...'
  );
}

describe('prepareTransaction Push Native EOA Debug', () => {
  let pushClient: PushChain;
  let sepoliaClient: PushChain;
  let pushAccount: string;
  let sepoliaAccount: string;

  const pushPublicClient = createPublicClient({
    transport: http(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]),
  });

  beforeAll(async () => {
    const pushKey = process.env['PUSH_PRIVATE_KEY'] as Hex;
    const evmKey = process.env['EVM_PRIVATE_KEY'] as Hex;
    if (!pushKey) throw new Error('PUSH_PRIVATE_KEY not set');
    if (!evmKey) throw new Error('EVM_PRIVATE_KEY not set');

    const [pushSetup, sepoliaSetup] = await Promise.all([
      createEvmPushClient({
        chain: CHAIN.PUSH_TESTNET_DONUT,
        privateKey: pushKey,
        printTraces: true,
      }),
      createEvmPushClient({
        chain: CHAIN.ETHEREUM_SEPOLIA,
        privateKey: evmKey,
        printTraces: true,
      }),
    ]);

    pushClient = pushSetup.pushClient;
    sepoliaClient = sepoliaSetup.pushClient;
    pushAccount = pushClient.universal.account;
    sepoliaAccount = sepoliaClient.universal.account;

    // Diagnostic: check if the account addresses have contract code on Push Chain
    const [pushCode, sepoliaUeaCode] = await Promise.all([
      pushPublicClient.getCode({ address: pushAccount as `0x${string}` }),
      pushPublicClient.getCode({ address: sepoliaAccount as `0x${string}` }),
    ]);

    console.log('\n--- Account Diagnostics ---');
    console.log('Push native account:', pushAccount);
    console.log('  hasCode:', pushCode !== undefined, '(should be false for EOA)');
    console.log('Sepolia UEA account:', sepoliaAccount);
    console.log('  hasCode:', sepoliaUeaCode !== undefined, '(should be true for UEA)');
  }, 60000);

  // ========================================================================
  // A. Baseline: sendTransaction works for Push native EOA
  // ========================================================================
  describe('A. Baseline — sendTransaction works', () => {
    it('should send a simple value transfer', async () => {
      const tx = await pushClient.universal.sendTransaction({
        to: TEST_TARGET_ADDRESS,
        value: BigInt(1),
      });

      console.log('Baseline tx hash:', tx.hash);
      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

      const receipt = await tx.wait();
      console.log('Baseline receipt status:', receipt.status);
      expect(receipt.status).toBe(1);
    }, 60000);

    it('should send a contract call (counter increment)', async () => {
      const incrementData = PushChain.utils.helpers.encodeTxData({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        abi: COUNTER_ABI_PAYABLE as any[],
        functionName: 'increment',
      });

      const tx = await pushClient.universal.sendTransaction({
        to: COUNTER_ADDRESS_PAYABLE,
        data: incrementData,
      });

      console.log('Baseline contract call tx hash:', tx.hash);
      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

      const receipt = await tx.wait();
      console.log('Baseline contract call receipt status:', receipt.status);
      expect(receipt.status).toBe(1);
    }, 60000);
  });

  // ========================================================================
  // B. Route 1 (UOA_TO_PUSH): prepareTransaction should throw for Push native EOA
  // ========================================================================
  describe('B. Route 1 (UOA_TO_PUSH) — prepareTransaction blocked', () => {
    it('should throw clear error for value transfer', async () => {
      await expect(
        pushClient.universal.prepareTransaction({
          to: TEST_TARGET_ADDRESS,
          value: BigInt(1),
        })
      ).rejects.toThrow(
        'Push native accounts cannot use prepareTransaction for Push Chain transactions'
      );
      console.log('Route 1 value transfer: correctly blocked for Push native EOA');
    }, 30000);

    it('should throw clear error for contract call', async () => {
      const incrementData = PushChain.utils.helpers.encodeTxData({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        abi: COUNTER_ABI_PAYABLE as any[],
        functionName: 'increment',
      });

      await expect(
        pushClient.universal.prepareTransaction({
          to: COUNTER_ADDRESS_PAYABLE,
          data: incrementData,
        })
      ).rejects.toThrow(
        'Push native accounts cannot use prepareTransaction for Push Chain transactions'
      );
      console.log('Route 1 contract call: correctly blocked for Push native EOA');
    }, 30000);

    it('should still work for Sepolia signer (Route 1)', async () => {
      const prepared = await sepoliaClient.universal.prepareTransaction({
        to: TEST_TARGET_ADDRESS,
        value: BigInt(1),
      });

      logPrepared('Sepolia — Route 1', prepared);
      expect(prepared.route).toBe('UOA_TO_PUSH');

      // Sepolia signer should have a real UEA address (not the signer EOA)
      const hopUea = (prepared._hop as Record<string, unknown>).ueaAddress;
      console.log('  Sepolia ueaAddress:', hopUea);
      console.log('  Sepolia ueaAddress !== signer EOA:', hopUea !== sepoliaAccount);
    }, 30000);
  });

  // ========================================================================
  // C. Route 2 (UOA_TO_CEA): prepareTransaction should work for Push native EOA
  // ========================================================================
  describe('C. Route 2 (UOA_TO_CEA) — prepareTransaction allowed', () => {
    it('should return PreparedUniversalTx for cross-chain from Push native EOA', async () => {
      const prepared = await pushClient.universal.prepareTransaction({
        to: {
          address: TEST_TARGET_ADDRESS,
          chain: CHAIN.ETHEREUM_SEPOLIA,
        },
        value: BigInt(1),
      });

      logPrepared('Push Native — Route 2 -> Sepolia', prepared);

      expect(prepared.route).toBe('UOA_TO_CEA');
      expect(prepared.nonce).toBe(BigInt(0)); // Push native EOA uses nonce 0

      // For Push native EOA, ueaAddress = EOA address (valid — gateway doesn't check sender type)
      const hopUea = (prepared._hop as Record<string, unknown>).ueaAddress;
      const hopCea = (prepared._hop as Record<string, unknown>).ceaAddress;
      console.log('\n  ueaAddress (= Push EOA):', hopUea);
      console.log('  CEA derived from Push EOA:', hopCea);
    }, 60000);

    it('should compare Route 2 output: Push native vs Sepolia', async () => {
      const params = {
        to: {
          address: TEST_TARGET_ADDRESS,
          chain: CHAIN.ETHEREUM_SEPOLIA,
        },
        value: BigInt(1),
      };

      const [pushPrepared, sepoliaPrepared] = await Promise.all([
        pushClient.universal.prepareTransaction(params),
        sepoliaClient.universal.prepareTransaction(params),
      ]);

      logPrepared('Push Native — Route 2', pushPrepared);
      logPrepared('Sepolia — Route 2', sepoliaPrepared);

      const pushCea = (pushPrepared._hop as Record<string, unknown>).ceaAddress;
      const sepoliaCea = (sepoliaPrepared._hop as Record<string, unknown>).ceaAddress;
      const pushUea = (pushPrepared._hop as Record<string, unknown>).ueaAddress;
      const sepoliaUea = (sepoliaPrepared._hop as Record<string, unknown>).ueaAddress;

      console.log('\n--- Route 2 Side-by-Side ---');
      console.log('  Push ueaAddress (= EOA):', pushUea);
      console.log('  Sepolia ueaAddress (= UEA):', sepoliaUea);
      console.log('  Push ceaAddress:', pushCea);
      console.log('  Sepolia ceaAddress:', sepoliaCea);
      console.log('  Different CEAs (expected — different push accounts):', pushCea !== sepoliaCea);
    }, 60000);
  });

  // ========================================================================
  // D. executeTransactions behavior with Push native EOA
  // ========================================================================
  describe('D. executeTransactions with Push native prepared tx', () => {
    it('should block Route 1 at prepareTransaction level', async () => {
      // Route 1 is now blocked at prepareTransaction — can't even get to executeTransactions
      await expect(
        pushClient.universal.prepareTransaction({
          to: TEST_TARGET_ADDRESS,
          value: BigInt(1),
        })
      ).rejects.toThrow('Push native accounts cannot use prepareTransaction');
      console.log('Route 1 blocked at prepareTransaction level — clear error shown');
    }, 30000);

    it('should attempt executeTransactions with Route 2 prepared tx', async () => {
      const prepared = await pushClient.universal.prepareTransaction({
        to: {
          address: TEST_TARGET_ADDRESS,
          chain: CHAIN.ETHEREUM_SEPOLIA,
        },
        value: BigInt(1),
      });

      console.log('\n  Attempting executeTransactions with Route 2...');
      try {
        const result = await pushClient.universal.executeTransactions([prepared]);
        console.log('  executeTransactions SUCCEEDED');
        console.log('  initialTxHash:', result.initialTxHash);
        console.log('  hopCount:', result.hopCount);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log('  executeTransactions THREW:', msg);
        console.log('  (This may be expected if Push EOA lacks PRC-20 balance for outbound)');
      }
    }, 120000);
  });

  // ========================================================================
  // E. Route 3 exploration (CEA_TO_PUSH)
  // ========================================================================
  describe('E. Route 3 (CEA_TO_PUSH) — from.chain specified', () => {
    it('should inspect prepareTransaction with from.chain for Push native signer', async () => {
      try {
        const prepared = await pushClient.universal.prepareTransaction({
          from: { chain: CHAIN.ETHEREUM_SEPOLIA },
          to: TEST_TARGET_ADDRESS,
          value: BigInt(1),
        });

        logPrepared('Push Native — Route 3 (CEA_TO_PUSH)', prepared);
        expect(prepared.route).toBe('CEA_TO_PUSH');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(
          '\n  Route 3 prepareTransaction THREW:',
          msg
        );
        console.log(
          '  Note: Harsh says "some push native tx will work using route 2 and route 3 together"'
        );
      }
    }, 60000);
  });

  // ========================================================================
  // F. Direct diagnostics: UEA address and on-chain state
  // ========================================================================
  describe('F. UEA address diagnostics', () => {
    it('should show that Push native EOA address = account address (no UEA derivation)', async () => {
      // pushClient.universal.account IS the UEA address for Push native (the bug)
      const accountAddr = pushClient.universal.account as `0x${string}`;

      const [code, balance] = await Promise.all([
        pushPublicClient.getCode({ address: accountAddr }),
        pushPublicClient.getBalance({ address: accountAddr }),
      ]);

      console.log('\n--- Push Native Account On-Chain State ---');
      console.log('  address:', accountAddr);
      console.log('  hasContractCode:', code !== undefined, '(false = plain EOA, not a UEA)');
      console.log('  balance:', balance.toString(), 'wei');
    });

    it('should show that Sepolia signer gets a different UEA address via CREATE2', async () => {
      const accountAddr = sepoliaClient.universal.account as `0x${string}`;

      const [code, balance] = await Promise.all([
        pushPublicClient.getCode({ address: accountAddr }),
        pushPublicClient.getBalance({ address: accountAddr }),
      ]);

      console.log('\n--- Sepolia UEA On-Chain State ---');
      console.log('  address:', accountAddr);
      console.log('  hasContractCode:', code !== undefined, '(true = deployed UEA contract)');
      console.log('  balance:', balance.toString(), 'wei');
      console.log(
        '  NOTE: This address differs from the Sepolia signer EOA because it is a CREATE2-derived UEA'
      );
    });
  });
});

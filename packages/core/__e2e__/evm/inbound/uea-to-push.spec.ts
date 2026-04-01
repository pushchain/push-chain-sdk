import '@e2e/shared/setup';
/**
 * UEA → Push Chain: Inbound Transactions (Route 1)
 *
 * Tests for inbound transactions from external EVM chains to Push Chain.
 * Covers: Transfer, Funds (USDT/Native), Value+Funds+Data, Multicall,
 * Fresh Wallet, Progress Hooks, Error Handling, pcTx Regression.
 *
 * UTX Gap Coverage (S15-S25):
 * UTX-01 Value to Self, UTX-05 Data to Contract, UTX-07 Value+Data,
 * UTX-09/10 Value+Funds, UTX-11 Funds+Data, UTX-19 Value+NativeFunds,
 * UTX-21 Multicall (no funds). Fresh wallet variants for UTX-01/05/07/21.
 *
 * Core Scenarios are parameterised across all active EVM chains via chain-fixtures.
 */
import { PushChain } from '../../../src';
import { PUSH_NETWORK } from '../../../src/lib/constants/enums';
import { CHAIN_INFO } from '../../../src/lib/constants/chain';
import { MOVEABLE_TOKENS } from '../../../src/lib/constants/tokens';
import type { ProgressEvent } from '../../../src/lib/progress-hook/progress-hook.types';
import {
  createWalletClient,
  createPublicClient,
  http,
  Hex,
  parseEther,
  PublicClient,
} from 'viem';
import {
  generatePrivateKey,
  privateKeyToAccount,
  PrivateKeyAccount,
} from 'viem/accounts';
import { createEvmPushClient } from '@e2e/shared/evm-client';
import {
  createFreshFundedClient,
  createMainWalletClientWithHook,
} from '@e2e/shared/fresh-wallet';
import { createProgressTracker, expectBridgeHooks } from '@e2e/shared/progress-tracker';
import { txValidator } from '@e2e/shared/validators';
import {
  getActiveFixtures,
  type ChainTestFixture,
} from '@e2e/shared/chain-fixtures';
import {
  getToken,
  DIFFERENT_ADDRESS,
  TEST_TARGET_ADDRESS,
  ZERO_ADDRESS,
} from '@e2e/shared/constants';
import {
  COUNTER_ADDRESS_PAYABLE,
  COUNTER_ABI_PAYABLE,
} from '@e2e/shared/inbound-helpers';

const fixtures = getActiveFixtures();

const privateKey = process.env['EVM_PRIVATE_KEY'] as Hex;
const skipE2E = !privateKey;

describe('UEA → Push Chain: Inbound Transactions (Route 1)', () => {
  // ============================================================================
  // Core Scenarios — parameterised across EVM chains
  // ============================================================================
  describe.each(fixtures)(
    'Core Scenarios [$label]',
    (fixture: ChainTestFixture) => {
      let pushClient: PushChain;
      let walletClient: ReturnType<typeof createWalletClient>;
      let randomAccount: PrivateKeyAccount;

      beforeAll(async () => {
        if (skipE2E) return;

        const setup = await createEvmPushClient({
          chain: fixture.chain,
          privateKey,
          network: PUSH_NETWORK.TESTNET_DONUT,
          progressHook: (val: ProgressEvent) => {
            console.log(val);
          },
        });
        pushClient = setup.pushClient;
        walletClient = setup.walletClient;

        // Generate and fund random account for undeployed UEA test
        randomAccount = privateKeyToAccount(generatePrivateKey());
        const txHash = await walletClient.sendTransaction({
          to: randomAccount.address,
          chain: fixture.viemChain,
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          account: walletClient.account!,
          value: PushChain.utils.helpers.parseUnits('1', 15),
        });
        const publicClient = createPublicClient({
          chain: fixture.viemChain,
          transport: http(CHAIN_INFO[fixture.chain].defaultRPC[0]),
        });
        await publicClient.waitForTransactionReceipt({ hash: txHash });
      }, 100000);

      // ========================================================================
      // 1. Transfer
      // ========================================================================
      describe('1. Transfer', () => {
        it('should send transfer to Push Chain address', async () => {
          if (skipE2E) return;

          console.log(
            `\n=== Test: Transfer [${fixture.label}] ===`
          );

          const tx = await pushClient.universal.sendTransaction({
            to: TEST_TARGET_ADDRESS,
            value: BigInt(1e3),
          });

          const after =
            await PushChain.utils.account.convertOriginToExecutor(
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (pushClient as any).universal.origin,
              { onlyCompute: true }
            );
          expect(after.deployed).toBe(true);

          await txValidator(
            tx,
            pushClient.universal.origin.address as `0x${string}`,
            TEST_TARGET_ADDRESS
          );
        }, 300000);

        it('should send transfer to funded undeployed UEA', async () => {
          if (skipE2E) return;

          console.log(
            `\n=== Test: Undeployed UEA Transfer [${fixture.label}] ===`
          );

          const randWalletClient = createWalletClient({
            account: randomAccount,
            transport: http(CHAIN_INFO[fixture.chain].defaultRPC[0]),
          });
          const randomUniversalSigner =
            await PushChain.utils.signer.toUniversalFromKeypair(
              randWalletClient,
              {
                chain: fixture.chain,
                library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
              }
            );
          const UEA =
            await PushChain.utils.account.convertOriginToExecutor(
              randomUniversalSigner.account,
              { onlyCompute: true }
            );

          // Fund Undeployed UEA - 1PC
          await pushClient.universal.sendTransaction({
            to: UEA.address,
            value: BigInt(1e15),
          });

          // Send Tx via random address
          const randomPushClient = await PushChain.initialize(
            randomUniversalSigner,
            { network: PUSH_NETWORK.TESTNET_DONUT }
          );
          await randomPushClient.universal.sendTransaction({
            to: TEST_TARGET_ADDRESS,
            value: BigInt(1e6),
          });
        }, 300000);
      });

      // ========================================================================
      // 2. Funds — USDT
      // ========================================================================
      describe('2. Funds — USDT', () => {
        it('should bridge USDT to self', async () => {
          if (skipE2E) return;

          console.log(
            `\n=== Test: USDT to Self [${fixture.label}] ===`
          );

          const usdt = pushClient.moveable.token.USDT;
          const amount = PushChain.utils.helpers.parseUnits('0.0001', {
            decimals: usdt.decimals,
          });

          const tx = await pushClient.universal.sendTransaction({
            to: pushClient.universal.account,
            funds: { amount, token: usdt },
          });

          console.log(`TX Hash: ${tx.hash}`);
          const receipt = await tx.wait();
          console.log(`Receipt Status: ${receipt.status}`);
          expect(receipt.status).toBe(1);
        }, 300000);

        it('should bridge USDT to different address', async () => {
          if (skipE2E) return;

          console.log(
            `\n=== Test: USDT to Other [${fixture.label}] ===`
          );

          const usdt = pushClient.moveable.token.USDT;
          const amount = PushChain.utils.helpers.parseUnits('0.0001', {
            decimals: usdt.decimals,
          });

          const tx = await pushClient.universal.sendTransaction({
            to: DIFFERENT_ADDRESS,
            funds: { amount, token: usdt },
          });

          console.log(`TX Hash: ${tx.hash}`);
          const receipt = await tx.wait();
          console.log(`Receipt Status: ${receipt.status}`);
          expect(receipt.status).toBe(1);
        }, 300000);
      });

      // ========================================================================
      // 3. Funds — Native
      // ========================================================================
      describe('3. Funds — Native', () => {
        it('should bridge native token to self', async () => {
          if (skipE2E) return;

          console.log(
            `\n=== Test: Native to Self [${fixture.label}] ===`
          );

          const tokens = MOVEABLE_TOKENS[fixture.chain] || [];
          const nativeToken = tokens.find(
            (t) => t.mechanism === 'native'
          );
          if (!nativeToken) {
            console.log('Skipping - native token not found');
            return;
          }

          const tx = await pushClient.universal.sendTransaction({
            to: pushClient.universal.account as `0x${string}`,
            funds: {
              amount: PushChain.utils.helpers.parseUnits('0.00001', 18),
              token: nativeToken,
            },
          });

          console.log(`TX Hash: ${tx.hash}`);
          expect(tx.hash).toBeDefined();
        }, 300000);

        it('should bridge native token to different address', async () => {
          if (skipE2E) return;

          console.log(
            `\n=== Test: Native to Other [${fixture.label}] ===`
          );

          const tokens = MOVEABLE_TOKENS[fixture.chain] || [];
          const nativeToken = tokens.find(
            (t) => t.mechanism === 'native'
          );
          if (!nativeToken) {
            console.log('Skipping - native token not found');
            return;
          }

          const tx = await pushClient.universal.sendTransaction({
            to: DIFFERENT_ADDRESS,
            funds: {
              amount: PushChain.utils.helpers.parseUnits('0.00001', 18),
              token: nativeToken,
            },
          });

          console.log(`TX Hash: ${tx.hash}`);
          expect(tx.hash).toBeDefined();
        }, 300000);
      });

      // ========================================================================
      // 4. Value + Funds + Data
      // ========================================================================
      describe('4. Value + Funds + Data', () => {
        it('should send value + funds + data to counter contract', async () => {
          if (skipE2E) return;

          console.log(
            `\n=== Test: V+F+D to Counter [${fixture.label}] ===`
          );

          const usdt = pushClient.moveable.token.USDT;
          const valueAmount = PushChain.utils.helpers.parseUnits(
            '0.000000014',
            18
          );
          const fundsAmount = PushChain.utils.helpers.parseUnits(
            '0.000001',
            { decimals: usdt.decimals }
          );
          const incrementData = PushChain.utils.helpers.encodeTxData({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            abi: COUNTER_ABI_PAYABLE as any[],
            functionName: 'increment',
          });

          const tx = await pushClient.universal.sendTransaction({
            to: COUNTER_ADDRESS_PAYABLE,
            value: valueAmount,
            funds: { amount: fundsAmount, token: usdt },
            data: incrementData,
          });

          console.log(`TX Hash: ${tx.hash}`);
          expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

          const receipt = await tx.wait();
          console.log(`Receipt Status: ${receipt.status}`);
          expect(receipt.status).toBe(1);
        }, 600000);

        it('should send value + funds + data to different address', async () => {
          if (skipE2E) return;

          console.log(
            `\n=== Test: V+F+D to Address [${fixture.label}] ===`
          );

          const usdt = pushClient.moveable.token.USDT;
          const valueAmount = PushChain.utils.helpers.parseUnits(
            '0.000000014',
            18
          );
          const fundsAmount = PushChain.utils.helpers.parseUnits(
            '0.000001',
            { decimals: usdt.decimals }
          );
          const incrementData = PushChain.utils.helpers.encodeTxData({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            abi: COUNTER_ABI_PAYABLE as any[],
            functionName: 'increment',
          });

          const tx = await pushClient.universal.sendTransaction({
            to: DIFFERENT_ADDRESS,
            value: valueAmount,
            funds: { amount: fundsAmount, token: usdt },
            data: incrementData,
          });

          console.log(`TX Hash: ${tx.hash}`);
          expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

          const receipt = await tx.wait();
          console.log(`Receipt Status: ${receipt.status}`);
          expect(receipt.status).toBe(1);
        }, 600000);
      });

      // ========================================================================
      // 5. Bridge + Multicall
      // ========================================================================
      describe('5. Bridge + Multicall', () => {
        const createTestMulticall = (
          recipient: `0x${string}`,
          value: bigint
        ) => [{ to: recipient, value, data: '0x' as `0x${string}` }];

        it('should bridge USDT + execute single call', async () => {
          if (skipE2E) return;

          console.log(
            `\n=== Test: USDT + Single Call [${fixture.label}] ===`
          );

          const usdtToken = getToken(fixture.chain, 'USDT');
          const UEA = pushClient.universal.account as `0x${string}`;

          const tx = await pushClient.universal.sendTransaction({
            to: ZERO_ADDRESS,
            funds: {
              amount: PushChain.utils.helpers.parseUnits('0.0001', 6),
              token: usdtToken,
            },
            data: createTestMulticall(UEA, BigInt(0)),
          });

          console.log(`Hash: ${tx.hash}`);
          expect(tx.hash).toBeDefined();
          expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        }, 300000);

        it('should bridge USDT + execute multicall array', async () => {
          if (skipE2E) return;

          console.log(
            `\n=== Test: USDT + Multicall [${fixture.label}] ===`
          );

          const usdtToken = getToken(fixture.chain, 'USDT');
          const UEA = pushClient.universal.account as `0x${string}`;

          const multicallData = [
            { to: UEA, value: BigInt(0), data: '0x' as `0x${string}` },
            { to: UEA, value: BigInt(0), data: '0x' as `0x${string}` },
          ];

          const tx = await pushClient.universal.sendTransaction({
            to: ZERO_ADDRESS,
            funds: {
              amount: PushChain.utils.helpers.parseUnits('0.0001', 6),
              token: usdtToken,
            },
            data: multicallData,
          });

          console.log(`Hash: ${tx.hash}`);
          expect(tx.hash).toBeDefined();
        }, 300000);

        it('should bridge native + execute single call', async () => {
          if (skipE2E) return;

          console.log(
            `\n=== Test: Native + Single Call [${fixture.label}] ===`
          );

          const tokens = MOVEABLE_TOKENS[fixture.chain] || [];
          const nativeToken = tokens.find(
            (t) => t.mechanism === 'native'
          );
          if (!nativeToken) {
            console.log('Skipping - native token not found');
            return;
          }

          const UEA = pushClient.universal.account as `0x${string}`;

          const tx = await pushClient.universal.sendTransaction({
            to: ZERO_ADDRESS,
            funds: {
              amount: PushChain.utils.helpers.parseUnits('0.00001', 18),
              token: nativeToken,
            },
            data: createTestMulticall(UEA, BigInt(0)),
          });

          console.log(`Hash: ${tx.hash}`);
          expect(tx.hash).toBeDefined();
        }, 300000);

        it('should bridge native + execute multicall array', async () => {
          if (skipE2E) return;

          console.log(
            `\n=== Test: Native + Multicall [${fixture.label}] ===`
          );

          const tokens = MOVEABLE_TOKENS[fixture.chain] || [];
          const nativeToken = tokens.find(
            (t) => t.mechanism === 'native'
          );
          if (!nativeToken) {
            console.log('Skipping - native token not found');
            return;
          }

          const UEA = pushClient.universal.account as `0x${string}`;

          const multicallData = [
            { to: UEA, value: BigInt(0), data: '0x' as `0x${string}` },
            { to: UEA, value: BigInt(0), data: '0x' as `0x${string}` },
          ];

          const tx = await pushClient.universal.sendTransaction({
            to: ZERO_ADDRESS,
            funds: {
              amount: PushChain.utils.helpers.parseUnits('0.00001', 18),
              token: nativeToken,
            },
            data: multicallData,
          });

          console.log(`Hash: ${tx.hash}`);
          expect(tx.hash).toBeDefined();
        }, 300000);
      });

      // ========================================================================
      // 15. Value to Self (UTX-01)
      // ========================================================================
      describe('15. Value to Self (UTX-01)', () => {
        it('should send value to own UEA address', async () => {
          if (skipE2E) return;

          console.log(
            `\n=== Test: Value to Self [${fixture.label}] ===`
          );

          const UEA = pushClient.universal.account as `0x${string}`;

          const tx = await pushClient.universal.sendTransaction({
            to: UEA,
            value: BigInt(1e3),
          });

          console.log(`TX Hash: ${tx.hash}`);
          expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

          await txValidator(
            tx,
            pushClient.universal.origin.address as `0x${string}`,
            UEA
          );
        }, 300000);
      });

      // ========================================================================
      // 16. Data to Contract (UTX-05)
      // ========================================================================
      describe('16. Data to Contract (UTX-05)', () => {
        it('should send data-only to counter contract', async () => {
          if (skipE2E) return;

          console.log(
            `\n=== Test: Data to Contract [${fixture.label}] ===`
          );

          const incrementData = PushChain.utils.helpers.encodeTxData({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            abi: COUNTER_ABI_PAYABLE as any[],
            functionName: 'increment',
          });

          const tx = await pushClient.universal.sendTransaction({
            to: COUNTER_ADDRESS_PAYABLE,
            data: incrementData,
          });

          console.log(`TX Hash: ${tx.hash}`);
          expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

          const receipt = await tx.wait();
          console.log(`Receipt Status: ${receipt.status}`);
          expect(receipt.status).toBe(1);
        }, 300000);
      });

      // ========================================================================
      // 17. Value + Data to Contract (UTX-07)
      // ========================================================================
      describe('17. Value + Data to Contract (UTX-07)', () => {
        it('should send value + data to counter contract', async () => {
          if (skipE2E) return;

          console.log(
            `\n=== Test: Value + Data to Counter [${fixture.label}] ===`
          );

          const valueAmount = PushChain.utils.helpers.parseUnits(
            '0.000000007',
            18
          );
          const incrementData = PushChain.utils.helpers.encodeTxData({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            abi: COUNTER_ABI_PAYABLE as any[],
            functionName: 'increment',
          });

          const tx = await pushClient.universal.sendTransaction({
            to: COUNTER_ADDRESS_PAYABLE,
            value: valueAmount,
            data: incrementData,
          });

          console.log(`TX Hash: ${tx.hash}`);
          expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

          const receipt = await tx.wait();
          console.log(`Receipt Status: ${receipt.status}`);
          expect(receipt.status).toBe(1);
        }, 300000);
      });

      // ========================================================================
      // 18. Value + Funds (UTX-09, UTX-10)
      // ========================================================================
      describe('18. Value + Funds (UTX-09, UTX-10)', () => {
        it('should send value + funds to self (UTX-09)', async () => {
          if (skipE2E) return;

          console.log(
            `\n=== Test: Value + Funds to Self [${fixture.label}] ===`
          );

          const usdt = pushClient.moveable.token.USDT;
          const valueAmount = PushChain.utils.helpers.parseUnits(
            '0.000000009',
            18
          );
          const fundsAmount = PushChain.utils.helpers.parseUnits(
            '0.000001',
            { decimals: usdt.decimals }
          );

          const tx = await pushClient.universal.sendTransaction({
            to: pushClient.universal.account as `0x${string}`,
            value: valueAmount,
            funds: { amount: fundsAmount, token: usdt },
          });

          console.log(`TX Hash: ${tx.hash}`);
          expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

          const receipt = await tx.wait();
          console.log(`Receipt Status: ${receipt.status}`);
          expect(receipt.status).toBe(1);
        }, 300000);

        it('should send value + funds to others (UTX-10)', async () => {
          if (skipE2E) return;

          console.log(
            `\n=== Test: Value + Funds to Others [${fixture.label}] ===`
          );

          const usdt = pushClient.moveable.token.USDT;
          const valueAmount = PushChain.utils.helpers.parseUnits(
            '0.000000010',
            18
          );
          const fundsAmount = PushChain.utils.helpers.parseUnits(
            '0.000001',
            { decimals: usdt.decimals }
          );

          const tx = await pushClient.universal.sendTransaction({
            to: DIFFERENT_ADDRESS,
            value: valueAmount,
            funds: { amount: fundsAmount, token: usdt },
          });

          console.log(`TX Hash: ${tx.hash}`);
          expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

          const receipt = await tx.wait();
          console.log(`Receipt Status: ${receipt.status}`);
          expect(receipt.status).toBe(1);
        }, 300000);
      });

      // ========================================================================
      // 19. Funds + Data to Contract (UTX-11)
      // ========================================================================
      describe('19. Funds + Data to Contract (UTX-11)', () => {
        it('should send funds + data to counter contract', async () => {
          if (skipE2E) return;

          console.log(
            `\n=== Test: Funds + Data to Counter [${fixture.label}] ===`
          );

          const usdt = pushClient.moveable.token.USDT;
          const fundsAmount = PushChain.utils.helpers.parseUnits(
            '0.000001',
            { decimals: usdt.decimals }
          );
          const incrementData = PushChain.utils.helpers.encodeTxData({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            abi: COUNTER_ABI_PAYABLE as any[],
            functionName: 'increment',
          });

          const tx = await pushClient.universal.sendTransaction({
            to: COUNTER_ADDRESS_PAYABLE,
            funds: { amount: fundsAmount, token: usdt },
            data: incrementData,
          });

          console.log(`TX Hash: ${tx.hash}`);
          expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

          const receipt = await tx.wait();
          console.log(`Receipt Status: ${receipt.status}`);
          expect(receipt.status).toBe(1);
        }, 300000);
      });

      // ========================================================================
      // 20. Value + Native Funds (UTX-19)
      // ========================================================================
      describe('20. Value + Native Funds (UTX-19)', () => {
        it('should send value + native funds to self', async () => {
          if (skipE2E) return;

          console.log(
            `\n=== Test: Value + Native Funds [${fixture.label}] ===`
          );

          const tokens = MOVEABLE_TOKENS[fixture.chain] || [];
          const nativeToken = tokens.find(
            (t) => t.mechanism === 'native'
          );
          if (!nativeToken) {
            console.log('Skipping - native token not found');
            return;
          }

          const tx = await pushClient.universal.sendTransaction({
            to: pushClient.universal.account as `0x${string}`,
            value: BigInt(1e3),
            funds: {
              amount: PushChain.utils.helpers.parseUnits('0.00001', 18),
              token: nativeToken,
            },
          });

          console.log(`TX Hash: ${tx.hash}`);
          expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

          const receipt = await tx.wait();
          console.log(`Receipt Status: ${receipt.status}`);
          expect(receipt.status).toBe(1);
        }, 300000);
      });

      // ========================================================================
      // 21. Multicall — no Funds (UTX-21)
      // ========================================================================
      describe('21. Multicall — no Funds (UTX-21)', () => {
        it('should execute multicall without funds', async () => {
          if (skipE2E) return;

          console.log(
            `\n=== Test: Multicall no Funds [${fixture.label}] ===`
          );

          const incrementData = PushChain.utils.helpers.encodeTxData({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            abi: COUNTER_ABI_PAYABLE as any[],
            functionName: 'increment',
          });

          const multicallData = [
            {
              to: COUNTER_ADDRESS_PAYABLE,
              value: BigInt(0),
              data: incrementData,
            },
            {
              to: COUNTER_ADDRESS_PAYABLE,
              value: BigInt(0),
              data: incrementData,
            },
          ];

          const tx = await pushClient.universal.sendTransaction({
            to: COUNTER_ADDRESS_PAYABLE,
            data: multicallData,
          });

          console.log(`TX Hash: ${tx.hash}`);
          expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

          const receipt = await tx.wait();
          console.log(`Receipt Status: ${receipt.status}`);
          expect(receipt.status).toBe(1);
        }, 300000);
      });

      // ========================================================================
      // 33. Data to Self (UTX-06)
      // ========================================================================
      describe('33. Data to Self (UTX-06)', () => {
        it('should send empty data to own UEA', async () => {
          if (skipE2E) return;

          console.log(
            `\n=== Test: Data to Self [${fixture.label}] ===`
          );

          const UEA = pushClient.universal.account as `0x${string}`;

          const tx = await pushClient.universal.sendTransaction({
            to: UEA,
            data: '0x',
          });

          console.log(`TX Hash: ${tx.hash}`);
          expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

          const receipt = await tx.wait();
          expect(receipt.status).toBe(1);
        }, 300000);
      });

      // ========================================================================
      // 34. Value + Data to Self (UTX-08)
      // ========================================================================
      describe('34. Value + Data to Self (UTX-08)', () => {
        it('should send value + empty data to own UEA', async () => {
          if (skipE2E) return;

          console.log(
            `\n=== Test: Value + Data to Self [${fixture.label}] ===`
          );

          const UEA = pushClient.universal.account as `0x${string}`;

          const tx = await pushClient.universal.sendTransaction({
            to: UEA,
            value: BigInt(8),
            data: '0x',
          });

          console.log(`TX Hash: ${tx.hash}`);
          expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

          const receipt = await tx.wait();
          expect(receipt.status).toBe(1);
        }, 300000);
      });

      // ========================================================================
      // 35. Funds + Data to Self (UTX-12)
      // ========================================================================
      describe('35. Funds + Data to Self (UTX-12)', () => {
        it('should send funds + empty data to own UEA', async () => {
          if (skipE2E) return;

          console.log(
            `\n=== Test: Funds + Data to Self [${fixture.label}] ===`
          );

          const usdt = pushClient.moveable.token.USDT;
          const UEA = pushClient.universal.account as `0x${string}`;

          const tx = await pushClient.universal.sendTransaction({
            to: UEA,
            funds: {
              amount: PushChain.utils.helpers.parseUnits('0.000001', {
                decimals: usdt.decimals,
              }),
              token: usdt,
            },
            data: '0x',
          });

          console.log(`TX Hash: ${tx.hash}`);
          expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

          const receipt = await tx.wait();
          expect(receipt.status).toBe(1);
        }, 300000);
      });

      // ========================================================================
      // 36. V+F+D to Self (UTX-14)
      // ========================================================================
      describe('36. V+F+D to Self (UTX-14)', () => {
        it('should send value + funds + empty data to own UEA', async () => {
          if (skipE2E) return;

          console.log(
            `\n=== Test: V+F+D to Self [${fixture.label}] ===`
          );

          const usdt = pushClient.moveable.token.USDT;
          const UEA = pushClient.universal.account as `0x${string}`;

          const tx = await pushClient.universal.sendTransaction({
            to: UEA,
            value: BigInt(14),
            funds: {
              amount: PushChain.utils.helpers.parseUnits('0.000001', {
                decimals: usdt.decimals,
              }),
              token: usdt,
            },
            data: '0x',
          });

          console.log(`TX Hash: ${tx.hash}`);
          expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

          const receipt = await tx.wait();
          expect(receipt.status).toBe(1);
        }, 300000);
      });

      // ========================================================================
      // 37. Native Funds + Data to Self (UTX-18)
      // ========================================================================
      describe('37. Native Funds + Data to Self (UTX-18)', () => {
        it('should send native funds + empty data to own UEA', async () => {
          if (skipE2E) return;

          console.log(
            `\n=== Test: Native Funds + Data to Self [${fixture.label}] ===`
          );

          const tokens = MOVEABLE_TOKENS[fixture.chain] || [];
          const nativeToken = tokens.find(
            (t) => t.mechanism === 'native'
          );
          if (!nativeToken) {
            console.log('Skipping - native token not found');
            return;
          }

          const UEA = pushClient.universal.account as `0x${string}`;

          const tx = await pushClient.universal.sendTransaction({
            to: UEA,
            funds: {
              amount: PushChain.utils.helpers.parseUnits('0.00001', 18),
              token: nativeToken,
            },
            data: '0x',
          });

          console.log(`TX Hash: ${tx.hash}`);
          expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

          const receipt = await tx.wait();
          expect(receipt.status).toBe(1);
        }, 300000);
      });
    }
  );

  // ============================================================================
  // Fresh Wallet Scenarios — parameterised across EVM chains
  // ============================================================================
  describe.each(fixtures)(
    'Fresh Wallet Scenarios [$label]',
    (fixture: ChainTestFixture) => {
      let mainPushClient: PushChain;
      let mainWalletClient: ReturnType<typeof createWalletClient>;
      let publicClient: PublicClient;

      beforeAll(async () => {
        if (skipE2E) return;

        const setup = await createEvmPushClient({
          chain: fixture.chain,
          privateKey,
          network: PUSH_NETWORK.TESTNET_DONUT,
        });
        mainPushClient = setup.pushClient;
        mainWalletClient = setup.walletClient;
        publicClient = createPublicClient({
          transport: http(CHAIN_INFO[fixture.chain].defaultRPC[0]),
        }) as PublicClient;
      }, 100000);

      // ========================================================================
      // 6. Fresh Wallet — USDT
      // ========================================================================
      describe('6. Fresh Wallet — USDT', () => {
        it('should bridge USDT to self from fresh wallet', async () => {
          if (skipE2E) return;

          console.log(
            `\n=== Test: Fresh USDT to Self [${fixture.label}] ===`
          );

          const { pushClient: freshClient } =
            await createFreshFundedClient(
              mainWalletClient,
              publicClient,
              mainPushClient,
              {
                originChain: fixture.chain,
                viemChain: fixture.viemChain,
              }
            );

          const usdt = freshClient.moveable.token.USDT;
          const amount = PushChain.utils.helpers.parseUnits('0.0001', {
            decimals: usdt.decimals,
          });

          const tx = await freshClient.universal.sendTransaction({
            to: freshClient.universal.account,
            funds: { amount, token: usdt },
          });

          console.log(`TX Hash: ${tx.hash}`);
          const receipt = await tx.wait();
          console.log(`Receipt Status: ${receipt.status}`);
          expect(receipt.status).toBe(1);
        }, 600000);

        it('should bridge USDT to other from fresh wallet', async () => {
          if (skipE2E) return;

          console.log(
            `\n=== Test: Fresh USDT to Other [${fixture.label}] ===`
          );

          const { pushClient: freshClient } =
            await createFreshFundedClient(
              mainWalletClient,
              publicClient,
              mainPushClient,
              {
                originChain: fixture.chain,
                viemChain: fixture.viemChain,
              }
            );

          const usdt = freshClient.moveable.token.USDT;
          const amount = PushChain.utils.helpers.parseUnits('0.0001', {
            decimals: usdt.decimals,
          });

          const tx = await freshClient.universal.sendTransaction({
            to: DIFFERENT_ADDRESS,
            funds: { amount, token: usdt },
          });

          console.log(`TX Hash: ${tx.hash}`);
          const receipt = await tx.wait();
          console.log(`Receipt Status: ${receipt.status}`);
          expect(receipt.status).toBe(1);
        }, 600000);
      });

      // ========================================================================
      // 7. Fresh Wallet — Native
      // ========================================================================
      describe('7. Fresh Wallet — Native', () => {
        it('should send native value to self from fresh wallet', async () => {
          if (skipE2E) return;

          console.log(
            `\n=== Test: Fresh Native to Self [${fixture.label}] ===`
          );

          // Fund fresh wallet with native only (no USDT needed)
          const newPrivateKey = generatePrivateKey();
          const newAccount = privateKeyToAccount(newPrivateKey);
          console.log(`Fresh wallet: ${newAccount.address}`);

          const ethTxHash = await mainWalletClient.sendTransaction({
            to: newAccount.address,
            value: parseEther('0.0005'),
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            account: mainWalletClient.account!,
            chain: fixture.viemChain,
          });
          await publicClient.waitForTransactionReceipt({
            hash: ethTxHash,
          });

          const newWalletClient = createWalletClient({
            account: newAccount,
            chain: fixture.viemChain,
            transport: http(
              CHAIN_INFO[fixture.chain].defaultRPC[0]
            ),
          });
          const newSigner =
            await PushChain.utils.signer.toUniversalFromKeypair(
              newWalletClient,
              {
                chain: fixture.chain,
                library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
              }
            );
          const newPushClient = await PushChain.initialize(newSigner, {
            network: PUSH_NETWORK.TESTNET_DONUT,
            printTraces: true,
            progressHook: (val: ProgressEvent) => {
              console.log(`[Progress] ${val.id}: ${val.title}`);
            },
          });

          const value = parseEther('0.0000001');
          const tx = await newPushClient.universal.sendTransaction({
            to: newPushClient.universal.account,
            value,
          });

          console.log(`TX Hash: ${tx.hash}`);
          const receipt = await tx.wait();
          console.log(`Receipt Status: ${receipt.status}`);
          expect(receipt.status).toBe(1);
        }, 600000);

        it('should send native value to other from fresh wallet', async () => {
          if (skipE2E) return;

          console.log(
            `\n=== Test: Fresh Native to Other [${fixture.label}] ===`
          );

          const newPrivateKey = generatePrivateKey();
          const newAccount = privateKeyToAccount(newPrivateKey);
          console.log(`Fresh wallet: ${newAccount.address}`);

          const ethTxHash = await mainWalletClient.sendTransaction({
            to: newAccount.address,
            value: parseEther('0.0005'),
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            account: mainWalletClient.account!,
            chain: fixture.viemChain,
          });
          await publicClient.waitForTransactionReceipt({
            hash: ethTxHash,
          });

          const newWalletClient = createWalletClient({
            account: newAccount,
            chain: fixture.viemChain,
            transport: http(
              CHAIN_INFO[fixture.chain].defaultRPC[0]
            ),
          });
          const newSigner =
            await PushChain.utils.signer.toUniversalFromKeypair(
              newWalletClient,
              {
                chain: fixture.chain,
                library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
              }
            );
          const newPushClient = await PushChain.initialize(newSigner, {
            network: PUSH_NETWORK.TESTNET_DONUT,
            printTraces: true,
            progressHook: (val: ProgressEvent) => {
              console.log(`[Progress] ${val.id}: ${val.title}`);
            },
          });

          const value = parseEther('0.0000001');
          const tx = await newPushClient.universal.sendTransaction({
            to: DIFFERENT_ADDRESS,
            value,
          });

          console.log(`TX Hash: ${tx.hash}`);
          const receipt = await tx.wait();
          console.log(`Receipt Status: ${receipt.status}`);
          expect(receipt.status).toBe(1);
        }, 600000);
      });

      // ========================================================================
      // 8. Fresh Wallet — Value + Funds + Data
      // ========================================================================
      describe('8. Fresh Wallet — Value + Funds + Data', () => {
        it('should send v+f+d to counter from fresh wallet', async () => {
          if (skipE2E) return;

          console.log(
            `\n=== Test: Fresh V+F+D to Counter [${fixture.label}] ===`
          );

          const { pushClient: freshClient, progressEvents } =
            await createFreshFundedClient(
              mainWalletClient,
              publicClient,
              mainPushClient,
              {
                originChain: fixture.chain,
                viemChain: fixture.viemChain,
              }
            );

          const usdt = freshClient.moveable.token.USDT;
          const valueAmount = PushChain.utils.helpers.parseUnits(
            '0.000000014',
            18
          );
          const fundsAmount = PushChain.utils.helpers.parseUnits(
            '0.000001',
            { decimals: usdt.decimals }
          );
          const incrementData = PushChain.utils.helpers.encodeTxData({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            abi: COUNTER_ABI_PAYABLE as any[],
            functionName: 'increment',
          });

          const tx = await freshClient.universal.sendTransaction({
            to: COUNTER_ADDRESS_PAYABLE,
            value: valueAmount,
            funds: { amount: fundsAmount, token: usdt },
            data: incrementData,
          });

          console.log(`TX Hash: ${tx.hash}`);
          expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

          const receipt = await tx.wait();
          expect(receipt.status).toBe(1);

          const hookIds = progressEvents.map((e) => e.event.id);
          expectBridgeHooks(hookIds, { expectConfirmation: true });
        }, 600000);

        it('should send v+f+d to address from fresh wallet', async () => {
          if (skipE2E) return;

          console.log(
            `\n=== Test: Fresh V+F+D to Address [${fixture.label}] ===`
          );

          const { pushClient: freshClient, progressEvents } =
            await createFreshFundedClient(
              mainWalletClient,
              publicClient,
              mainPushClient,
              {
                originChain: fixture.chain,
                viemChain: fixture.viemChain,
              }
            );

          const usdt = freshClient.moveable.token.USDT;
          const valueAmount = PushChain.utils.helpers.parseUnits(
            '0.000000014',
            18
          );
          const fundsAmount = PushChain.utils.helpers.parseUnits(
            '0.000001',
            { decimals: usdt.decimals }
          );
          const incrementData = PushChain.utils.helpers.encodeTxData({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            abi: COUNTER_ABI_PAYABLE as any[],
            functionName: 'increment',
          });

          const tx = await freshClient.universal.sendTransaction({
            to: DIFFERENT_ADDRESS,
            value: valueAmount,
            funds: { amount: fundsAmount, token: usdt },
            data: incrementData,
          });

          console.log(`TX Hash: ${tx.hash}`);
          expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

          const receipt = await tx.wait();
          expect(receipt.status).toBe(1);

          const hookIds = progressEvents.map((e) => e.event.id);
          expectBridgeHooks(hookIds, { expectConfirmation: true });
        }, 600000);
      });

      // ========================================================================
      // 22. Fresh Wallet — Value to Self (UTX-01)
      // ========================================================================
      describe('22. Fresh Wallet — Value to Self (UTX-01)', () => {
        it('should send value to self from fresh wallet', async () => {
          if (skipE2E) return;

          console.log(
            `\n=== Test: Fresh Value to Self [${fixture.label}] ===`
          );

          const newPrivateKey = generatePrivateKey();
          const newAccount = privateKeyToAccount(newPrivateKey);
          console.log(`Fresh wallet: ${newAccount.address}`);

          const ethTxHash = await mainWalletClient.sendTransaction({
            to: newAccount.address,
            value: parseEther('0.0005'),
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            account: mainWalletClient.account!,
            chain: fixture.viemChain,
          });
          await publicClient.waitForTransactionReceipt({
            hash: ethTxHash,
          });

          const newWalletClient = createWalletClient({
            account: newAccount,
            chain: fixture.viemChain,
            transport: http(
              CHAIN_INFO[fixture.chain].defaultRPC[0]
            ),
          });
          const newSigner =
            await PushChain.utils.signer.toUniversalFromKeypair(
              newWalletClient,
              {
                chain: fixture.chain,
                library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
              }
            );
          const newPushClient = await PushChain.initialize(newSigner, {
            network: PUSH_NETWORK.TESTNET_DONUT,
          });

          const tx = await newPushClient.universal.sendTransaction({
            to: newPushClient.universal.account as `0x${string}`,
            value: BigInt(1e3),
          });

          console.log(`TX Hash: ${tx.hash}`);
          expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

          const receipt = await tx.wait();
          expect(receipt.status).toBe(1);
        }, 600000);
      });

      // ========================================================================
      // 23. Fresh Wallet — Data to Contract (UTX-05)
      // ========================================================================
      describe('23. Fresh Wallet — Data to Contract (UTX-05)', () => {
        it('should send data-only to contract from fresh wallet', async () => {
          if (skipE2E) return;

          console.log(
            `\n=== Test: Fresh Data to Contract [${fixture.label}] ===`
          );

          const newPrivateKey = generatePrivateKey();
          const newAccount = privateKeyToAccount(newPrivateKey);
          console.log(`Fresh wallet: ${newAccount.address}`);

          const ethTxHash = await mainWalletClient.sendTransaction({
            to: newAccount.address,
            value: parseEther('0.0005'),
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            account: mainWalletClient.account!,
            chain: fixture.viemChain,
          });
          await publicClient.waitForTransactionReceipt({
            hash: ethTxHash,
          });

          const newWalletClient = createWalletClient({
            account: newAccount,
            chain: fixture.viemChain,
            transport: http(
              CHAIN_INFO[fixture.chain].defaultRPC[0]
            ),
          });
          const newSigner =
            await PushChain.utils.signer.toUniversalFromKeypair(
              newWalletClient,
              {
                chain: fixture.chain,
                library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
              }
            );
          const newPushClient = await PushChain.initialize(newSigner, {
            network: PUSH_NETWORK.TESTNET_DONUT,
          });

          const incrementData = PushChain.utils.helpers.encodeTxData({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            abi: COUNTER_ABI_PAYABLE as any[],
            functionName: 'increment',
          });

          const tx = await newPushClient.universal.sendTransaction({
            to: COUNTER_ADDRESS_PAYABLE,
            data: incrementData,
          });

          console.log(`TX Hash: ${tx.hash}`);
          expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

          const receipt = await tx.wait();
          expect(receipt.status).toBe(1);
        }, 600000);
      });

      // ========================================================================
      // 24. Fresh Wallet — Value + Data (UTX-07)
      // ========================================================================
      describe('24. Fresh Wallet — Value + Data (UTX-07)', () => {
        it('should send value + data to contract from fresh wallet', async () => {
          if (skipE2E) return;

          console.log(
            `\n=== Test: Fresh V+D to Contract [${fixture.label}] ===`
          );

          const newPrivateKey = generatePrivateKey();
          const newAccount = privateKeyToAccount(newPrivateKey);
          console.log(`Fresh wallet: ${newAccount.address}`);

          const ethTxHash = await mainWalletClient.sendTransaction({
            to: newAccount.address,
            value: parseEther('0.0005'),
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            account: mainWalletClient.account!,
            chain: fixture.viemChain,
          });
          await publicClient.waitForTransactionReceipt({
            hash: ethTxHash,
          });

          const newWalletClient = createWalletClient({
            account: newAccount,
            chain: fixture.viemChain,
            transport: http(
              CHAIN_INFO[fixture.chain].defaultRPC[0]
            ),
          });
          const newSigner =
            await PushChain.utils.signer.toUniversalFromKeypair(
              newWalletClient,
              {
                chain: fixture.chain,
                library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
              }
            );
          const newPushClient = await PushChain.initialize(newSigner, {
            network: PUSH_NETWORK.TESTNET_DONUT,
          });

          const valueAmount = PushChain.utils.helpers.parseUnits(
            '0.000000007',
            18
          );
          const incrementData = PushChain.utils.helpers.encodeTxData({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            abi: COUNTER_ABI_PAYABLE as any[],
            functionName: 'increment',
          });

          const tx = await newPushClient.universal.sendTransaction({
            to: COUNTER_ADDRESS_PAYABLE,
            value: valueAmount,
            data: incrementData,
          });

          console.log(`TX Hash: ${tx.hash}`);
          expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

          const receipt = await tx.wait();
          expect(receipt.status).toBe(1);
        }, 600000);
      });

      // ========================================================================
      // 25. Fresh Wallet — Multicall no Funds (UTX-21)
      // ========================================================================
      describe('25. Fresh Wallet — Multicall no Funds (UTX-21)', () => {
        it('should execute multicall without funds from fresh wallet', async () => {
          if (skipE2E) return;

          console.log(
            `\n=== Test: Fresh Multicall no Funds [${fixture.label}] ===`
          );

          const newPrivateKey = generatePrivateKey();
          const newAccount = privateKeyToAccount(newPrivateKey);
          console.log(`Fresh wallet: ${newAccount.address}`);

          const ethTxHash = await mainWalletClient.sendTransaction({
            to: newAccount.address,
            value: parseEther('0.0005'),
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            account: mainWalletClient.account!,
            chain: fixture.viemChain,
          });
          await publicClient.waitForTransactionReceipt({
            hash: ethTxHash,
          });

          const newWalletClient = createWalletClient({
            account: newAccount,
            chain: fixture.viemChain,
            transport: http(
              CHAIN_INFO[fixture.chain].defaultRPC[0]
            ),
          });
          const newSigner =
            await PushChain.utils.signer.toUniversalFromKeypair(
              newWalletClient,
              {
                chain: fixture.chain,
                library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
              }
            );
          const newPushClient = await PushChain.initialize(newSigner, {
            network: PUSH_NETWORK.TESTNET_DONUT,
          });

          const incrementData = PushChain.utils.helpers.encodeTxData({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            abi: COUNTER_ABI_PAYABLE as any[],
            functionName: 'increment',
          });

          const multicallData = [
            {
              to: COUNTER_ADDRESS_PAYABLE,
              value: BigInt(0),
              data: incrementData,
            },
            {
              to: COUNTER_ADDRESS_PAYABLE,
              value: BigInt(0),
              data: incrementData,
            },
          ];

          const tx = await newPushClient.universal.sendTransaction({
            to: COUNTER_ADDRESS_PAYABLE,
            data: multicallData,
          });

          console.log(`TX Hash: ${tx.hash}`);
          expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

          const receipt = await tx.wait();
          expect(receipt.status).toBe(1);
        }, 600000);
      });

      // ========================================================================
      // 26. Fresh Wallet — Native Funds + Data (UTX-17)
      // ========================================================================
      describe('26. Fresh Wallet — Native Funds + Data (UTX-17)', () => {
        it('should bridge native + data to contract from fresh wallet', async () => {
          if (skipE2E) return;

          console.log(
            `\n=== Test: Fresh Native + Data [${fixture.label}] ===`
          );

          const newPrivateKey = generatePrivateKey();
          const newAccount = privateKeyToAccount(newPrivateKey);
          console.log(`Fresh wallet: ${newAccount.address}`);

          const ethTxHash = await mainWalletClient.sendTransaction({
            to: newAccount.address,
            value: parseEther('0.0005'),
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            account: mainWalletClient.account!,
            chain: fixture.viemChain,
          });
          await publicClient.waitForTransactionReceipt({
            hash: ethTxHash,
          });

          const newWalletClient = createWalletClient({
            account: newAccount,
            chain: fixture.viemChain,
            transport: http(
              CHAIN_INFO[fixture.chain].defaultRPC[0]
            ),
          });
          const newSigner =
            await PushChain.utils.signer.toUniversalFromKeypair(
              newWalletClient,
              {
                chain: fixture.chain,
                library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
              }
            );
          const newPushClient = await PushChain.initialize(newSigner, {
            network: PUSH_NETWORK.TESTNET_DONUT,
          });

          const tokens = MOVEABLE_TOKENS[fixture.chain] || [];
          const nativeToken = tokens.find(
            (t) => t.mechanism === 'native'
          );
          if (!nativeToken) {
            console.log('Skipping - native token not found');
            return;
          }

          const incrementData = PushChain.utils.helpers.encodeTxData({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            abi: COUNTER_ABI_PAYABLE as any[],
            functionName: 'increment',
          });

          const tx = await newPushClient.universal.sendTransaction({
            to: COUNTER_ADDRESS_PAYABLE,
            funds: {
              amount: PushChain.utils.helpers.parseUnits('0.00001', 18),
              token: nativeToken,
            },
            data: incrementData,
          });

          console.log(`TX Hash: ${tx.hash}`);
          expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

          const receipt = await tx.wait();
          expect(receipt.status).toBe(1);
        }, 600000);
      });

      // ========================================================================
      // 27. Fresh Wallet — Funds + Multicall (UTX-22)
      // ========================================================================
      describe('27. Fresh Wallet — Funds + Multicall (UTX-22)', () => {
        it('should bridge USDT + multicall from fresh wallet', async () => {
          if (skipE2E) return;

          console.log(
            `\n=== Test: Fresh USDT + Multicall [${fixture.label}] ===`
          );

          const { pushClient: freshClient } =
            await createFreshFundedClient(
              mainWalletClient,
              publicClient,
              mainPushClient,
              {
                originChain: fixture.chain,
                viemChain: fixture.viemChain,
              }
            );

          const usdtToken = freshClient.moveable.token.USDT;
          const UEA = freshClient.universal.account as `0x${string}`;

          const multicallData = [
            { to: UEA, value: BigInt(0), data: '0x' as `0x${string}` },
            { to: UEA, value: BigInt(0), data: '0x' as `0x${string}` },
          ];

          const tx = await freshClient.universal.sendTransaction({
            to: ZERO_ADDRESS,
            funds: {
              amount: PushChain.utils.helpers.parseUnits('0.0001', {
                decimals: usdtToken.decimals,
              }),
              token: usdtToken,
            },
            data: multicallData,
          });

          console.log(`TX Hash: ${tx.hash}`);
          expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

          const receipt = await tx.wait();
          expect(receipt.status).toBe(1);
        }, 600000);
      });

      // ========================================================================
      // 28. Fresh Wallet — Native Funds + Payload (UTX-23)
      // ========================================================================
      describe('28. Fresh Wallet — Native Funds + Payload (UTX-23)', () => {
        it('should bridge native + single call from fresh wallet', async () => {
          if (skipE2E) return;

          console.log(
            `\n=== Test: Fresh Native + Payload [${fixture.label}] ===`
          );

          const newPrivateKey = generatePrivateKey();
          const newAccount = privateKeyToAccount(newPrivateKey);
          console.log(`Fresh wallet: ${newAccount.address}`);

          const ethTxHash = await mainWalletClient.sendTransaction({
            to: newAccount.address,
            value: parseEther('0.0005'),
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            account: mainWalletClient.account!,
            chain: fixture.viemChain,
          });
          await publicClient.waitForTransactionReceipt({
            hash: ethTxHash,
          });

          const newWalletClient = createWalletClient({
            account: newAccount,
            chain: fixture.viemChain,
            transport: http(
              CHAIN_INFO[fixture.chain].defaultRPC[0]
            ),
          });
          const newSigner =
            await PushChain.utils.signer.toUniversalFromKeypair(
              newWalletClient,
              {
                chain: fixture.chain,
                library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
              }
            );
          const newPushClient = await PushChain.initialize(newSigner, {
            network: PUSH_NETWORK.TESTNET_DONUT,
          });

          const tokens = MOVEABLE_TOKENS[fixture.chain] || [];
          const nativeToken = tokens.find(
            (t) => t.mechanism === 'native'
          );
          if (!nativeToken) {
            console.log('Skipping - native token not found');
            return;
          }

          const UEA = newPushClient.universal.account as `0x${string}`;
          const singleCall = [
            { to: UEA, value: BigInt(0), data: '0x' as `0x${string}` },
          ];

          const tx = await newPushClient.universal.sendTransaction({
            to: ZERO_ADDRESS,
            funds: {
              amount: PushChain.utils.helpers.parseUnits('0.00001', 18),
              token: nativeToken,
            },
            data: singleCall,
          });

          console.log(`TX Hash: ${tx.hash}`);
          expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

          const receipt = await tx.wait();
          expect(receipt.status).toBe(1);
        }, 600000);
      });

      // ========================================================================
      // 29. Fresh Wallet — Value + Funds to Self (UTX-09)
      // ========================================================================
      describe('29. Fresh Wallet — Value + Funds to Self (UTX-09)', () => {
        it('should send value + funds to self from fresh wallet', async () => {
          if (skipE2E) return;

          console.log(
            `\n=== Test: Fresh V+F to Self [${fixture.label}] ===`
          );

          const { pushClient: freshClient } =
            await createFreshFundedClient(
              mainWalletClient,
              publicClient,
              mainPushClient,
              {
                originChain: fixture.chain,
                viemChain: fixture.viemChain,
              }
            );

          const usdt = freshClient.moveable.token.USDT;
          const valueAmount = PushChain.utils.helpers.parseUnits(
            '0.000000009',
            18
          );
          const fundsAmount = PushChain.utils.helpers.parseUnits(
            '0.000001',
            { decimals: usdt.decimals }
          );

          const tx = await freshClient.universal.sendTransaction({
            to: freshClient.universal.account as `0x${string}`,
            value: valueAmount,
            funds: { amount: fundsAmount, token: usdt },
          });

          console.log(`TX Hash: ${tx.hash}`);
          expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

          const receipt = await tx.wait();
          expect(receipt.status).toBe(1);
        }, 600000);
      });

      // ========================================================================
      // 30. Fresh Wallet — Value + Funds to Others (UTX-10)
      // ========================================================================
      describe('30. Fresh Wallet — Value + Funds to Others (UTX-10)', () => {
        it('should send value + funds to others from fresh wallet', async () => {
          if (skipE2E) return;

          console.log(
            `\n=== Test: Fresh V+F to Others [${fixture.label}] ===`
          );

          const { pushClient: freshClient } =
            await createFreshFundedClient(
              mainWalletClient,
              publicClient,
              mainPushClient,
              {
                originChain: fixture.chain,
                viemChain: fixture.viemChain,
              }
            );

          const usdt = freshClient.moveable.token.USDT;
          const valueAmount = PushChain.utils.helpers.parseUnits(
            '0.000000010',
            18
          );
          const fundsAmount = PushChain.utils.helpers.parseUnits(
            '0.000001',
            { decimals: usdt.decimals }
          );

          const tx = await freshClient.universal.sendTransaction({
            to: DIFFERENT_ADDRESS,
            value: valueAmount,
            funds: { amount: fundsAmount, token: usdt },
          });

          console.log(`TX Hash: ${tx.hash}`);
          expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

          const receipt = await tx.wait();
          expect(receipt.status).toBe(1);
        }, 600000);
      });

      // ========================================================================
      // 31. Fresh Wallet — Funds + Data to Contract (UTX-11)
      // ========================================================================
      describe('31. Fresh Wallet — Funds + Data to Contract (UTX-11)', () => {
        it('should send funds + data to contract from fresh wallet', async () => {
          if (skipE2E) return;

          console.log(
            `\n=== Test: Fresh F+D to Contract [${fixture.label}] ===`
          );

          const { pushClient: freshClient } =
            await createFreshFundedClient(
              mainWalletClient,
              publicClient,
              mainPushClient,
              {
                originChain: fixture.chain,
                viemChain: fixture.viemChain,
              }
            );

          const usdt = freshClient.moveable.token.USDT;
          const fundsAmount = PushChain.utils.helpers.parseUnits(
            '0.000001',
            { decimals: usdt.decimals }
          );
          const incrementData = PushChain.utils.helpers.encodeTxData({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            abi: COUNTER_ABI_PAYABLE as any[],
            functionName: 'increment',
          });

          const tx = await freshClient.universal.sendTransaction({
            to: COUNTER_ADDRESS_PAYABLE,
            funds: { amount: fundsAmount, token: usdt },
            data: incrementData,
          });

          console.log(`TX Hash: ${tx.hash}`);
          expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

          const receipt = await tx.wait();
          expect(receipt.status).toBe(1);
        }, 600000);
      });

      // ========================================================================
      // 32. Fresh Wallet — Value + Native Funds (UTX-19)
      // ========================================================================
      describe('32. Fresh Wallet — Value + Native Funds (UTX-19)', () => {
        it('should send value + native funds from fresh wallet', async () => {
          if (skipE2E) return;

          console.log(
            `\n=== Test: Fresh V + Native Funds [${fixture.label}] ===`
          );

          const newPrivateKey = generatePrivateKey();
          const newAccount = privateKeyToAccount(newPrivateKey);
          console.log(`Fresh wallet: ${newAccount.address}`);

          const ethTxHash = await mainWalletClient.sendTransaction({
            to: newAccount.address,
            value: parseEther('0.0005'),
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            account: mainWalletClient.account!,
            chain: fixture.viemChain,
          });
          await publicClient.waitForTransactionReceipt({
            hash: ethTxHash,
          });

          const newWalletClient = createWalletClient({
            account: newAccount,
            chain: fixture.viemChain,
            transport: http(
              CHAIN_INFO[fixture.chain].defaultRPC[0]
            ),
          });
          const newSigner =
            await PushChain.utils.signer.toUniversalFromKeypair(
              newWalletClient,
              {
                chain: fixture.chain,
                library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
              }
            );
          const newPushClient = await PushChain.initialize(newSigner, {
            network: PUSH_NETWORK.TESTNET_DONUT,
          });

          const tokens = MOVEABLE_TOKENS[fixture.chain] || [];
          const nativeToken = tokens.find(
            (t) => t.mechanism === 'native'
          );
          if (!nativeToken) {
            console.log('Skipping - native token not found');
            return;
          }

          const tx = await newPushClient.universal.sendTransaction({
            to: newPushClient.universal.account as `0x${string}`,
            value: BigInt(1e3),
            funds: {
              amount: PushChain.utils.helpers.parseUnits('0.00001', 18),
              token: nativeToken,
            },
          });

          console.log(`TX Hash: ${tx.hash}`);
          expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

          const receipt = await tx.wait();
          expect(receipt.status).toBe(1);
        }, 600000);
      });
    }
  );

  // ============================================================================
  // pcTx Selection Regression — parameterised across EVM chains
  // ============================================================================
  describe.each(fixtures)(
    'pcTx Last-Transaction Regression [$label]',
    (fixture: ChainTestFixture) => {
      let mainPushClient: PushChain;
      let mainWalletClient: ReturnType<typeof createWalletClient>;
      let publicClient: PublicClient;

      beforeAll(async () => {
        if (skipE2E) return;

        const setup = await createEvmPushClient({
          chain: fixture.chain,
          privateKey,
          network: PUSH_NETWORK.TESTNET_DONUT,
        });
        mainPushClient = setup.pushClient;
        mainWalletClient = setup.walletClient;
        publicClient = createPublicClient({
          transport: http(CHAIN_INFO[fixture.chain].defaultRPC[0]),
        }) as PublicClient;
      }, 100000);

      // ========================================================================
      // 9. pcTx — Fresh Wallet
      // ========================================================================
      describe('9. pcTx — Fresh Wallet', () => {
        it('should bridge USDT to self (fresh)', async () => {
          if (skipE2E) return;

          console.log(
            `\n=== pcTx: USDT Self Fresh [${fixture.label}] ===`
          );

          const { pushClient: freshClient, progressEvents } =
            await createFreshFundedClient(
              mainWalletClient,
              publicClient,
              mainPushClient,
              {
                originChain: fixture.chain,
                viemChain: fixture.viemChain,
              }
            );

          const usdt = freshClient.moveable.token.USDT;
          const amount = PushChain.utils.helpers.parseUnits('0.0001', {
            decimals: usdt.decimals,
          });

          const tx = await freshClient.universal.sendTransaction({
            to: freshClient.universal.account,
            funds: { amount, token: usdt },
          });

          console.log(`TX Hash: ${tx.hash}`);
          expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

          const receipt = await tx.wait();
          expect(receipt.status).toBe(1);

          const hookIds = progressEvents.map((e) => e.event.id);
          expectBridgeHooks(hookIds, { expectConfirmation: true });
        }, 600000);

        it('should bridge USDT to other (fresh)', async () => {
          if (skipE2E) return;

          console.log(
            `\n=== pcTx: USDT Other Fresh [${fixture.label}] ===`
          );

          const { pushClient: freshClient, progressEvents } =
            await createFreshFundedClient(
              mainWalletClient,
              publicClient,
              mainPushClient,
              {
                originChain: fixture.chain,
                viemChain: fixture.viemChain,
              }
            );

          const usdt = freshClient.moveable.token.USDT;
          const amount = PushChain.utils.helpers.parseUnits('0.0001', {
            decimals: usdt.decimals,
          });

          const tx = await freshClient.universal.sendTransaction({
            to: DIFFERENT_ADDRESS,
            funds: { amount, token: usdt },
          });

          console.log(`TX Hash: ${tx.hash}`);
          expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

          const receipt = await tx.wait();
          expect(receipt.status).toBe(1);

          const hookIds = progressEvents.map((e) => e.event.id);
          expectBridgeHooks(hookIds, { expectConfirmation: true });
        }, 600000);

        it('should bridge native to self (fresh)', async () => {
          if (skipE2E) return;

          console.log(
            `\n=== pcTx: Native Self Fresh [${fixture.label}] ===`
          );

          const { pushClient: freshClient, progressEvents } =
            await createFreshFundedClient(
              mainWalletClient,
              publicClient,
              mainPushClient,
              {
                originChain: fixture.chain,
                viemChain: fixture.viemChain,
              }
            );

          const tokens = MOVEABLE_TOKENS[fixture.chain] || [];
          const nativeToken = tokens.find(
            (t) => t.mechanism === 'native'
          );
          if (!nativeToken) {
            console.log('Skipping - native token not found');
            return;
          }

          const amount = PushChain.utils.helpers.parseUnits(
            '0.0001',
            18
          );

          const tx = await freshClient.universal.sendTransaction({
            to: freshClient.universal.account,
            funds: { amount, token: nativeToken },
          });

          console.log(`TX Hash: ${tx.hash}`);
          expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

          const receipt = await tx.wait();
          expect(receipt.status).toBe(1);

          const hookIds = progressEvents.map((e) => e.event.id);
          expectBridgeHooks(hookIds, { expectConfirmation: true });
        }, 600000);

        it('should bridge native to other (fresh)', async () => {
          if (skipE2E) return;

          console.log(
            `\n=== pcTx: Native Other Fresh [${fixture.label}] ===`
          );

          const { pushClient: freshClient, progressEvents } =
            await createFreshFundedClient(
              mainWalletClient,
              publicClient,
              mainPushClient,
              {
                originChain: fixture.chain,
                viemChain: fixture.viemChain,
              }
            );

          const tokens = MOVEABLE_TOKENS[fixture.chain] || [];
          const nativeToken = tokens.find(
            (t) => t.mechanism === 'native'
          );
          if (!nativeToken) {
            console.log('Skipping - native token not found');
            return;
          }

          const amount = PushChain.utils.helpers.parseUnits(
            '0.0001',
            18
          );

          const tx = await freshClient.universal.sendTransaction({
            to: DIFFERENT_ADDRESS,
            funds: { amount, token: nativeToken },
          });

          console.log(`TX Hash: ${tx.hash}`);
          expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

          const receipt = await tx.wait();
          expect(receipt.status).toBe(1);

          const hookIds = progressEvents.map((e) => e.event.id);
          expectBridgeHooks(hookIds, { expectConfirmation: true });
        }, 600000);
      });

      // ========================================================================
      // 10. pcTx — Existing Wallet
      // ========================================================================
      describe('10. pcTx — Existing Wallet', () => {
        it('should bridge USDT to self (existing)', async () => {
          if (skipE2E) return;

          console.log(
            `\n=== pcTx: USDT Self Existing [${fixture.label}] ===`
          );

          const { pushClient: client, progressEvents } =
            await createMainWalletClientWithHook(mainWalletClient, {
              originChain: fixture.chain,
            });

          const usdt = client.moveable.token.USDT;
          const amount = PushChain.utils.helpers.parseUnits('0.0001', {
            decimals: usdt.decimals,
          });

          const tx = await client.universal.sendTransaction({
            to: client.universal.account,
            funds: { amount, token: usdt },
          });

          console.log(`TX Hash: ${tx.hash}`);
          expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

          const receipt = await tx.wait();
          expect(receipt.status).toBe(1);

          const hookIds = progressEvents.map((e) => e.event.id);
          expectBridgeHooks(hookIds, { expectConfirmation: true });
        }, 600000);

        it('should bridge USDT to other (existing)', async () => {
          if (skipE2E) return;

          console.log(
            `\n=== pcTx: USDT Other Existing [${fixture.label}] ===`
          );

          const { pushClient: client, progressEvents } =
            await createMainWalletClientWithHook(mainWalletClient, {
              originChain: fixture.chain,
            });

          const usdt = client.moveable.token.USDT;
          const amount = PushChain.utils.helpers.parseUnits('0.0001', {
            decimals: usdt.decimals,
          });

          const tx = await client.universal.sendTransaction({
            to: DIFFERENT_ADDRESS,
            funds: { amount, token: usdt },
          });

          console.log(`TX Hash: ${tx.hash}`);
          expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

          const receipt = await tx.wait();
          expect(receipt.status).toBe(1);

          const hookIds = progressEvents.map((e) => e.event.id);
          expectBridgeHooks(hookIds, { expectConfirmation: true });
        }, 600000);

        it('should bridge native to self (existing)', async () => {
          if (skipE2E) return;

          console.log(
            `\n=== pcTx: Native Self Existing [${fixture.label}] ===`
          );

          const { pushClient: client, progressEvents } =
            await createMainWalletClientWithHook(mainWalletClient, {
              originChain: fixture.chain,
            });

          const tokens = MOVEABLE_TOKENS[fixture.chain] || [];
          const nativeToken = tokens.find(
            (t) => t.mechanism === 'native'
          );
          if (!nativeToken) {
            console.log('Skipping - native token not found');
            return;
          }

          const amount = PushChain.utils.helpers.parseUnits(
            '0.0001',
            18
          );

          const tx = await client.universal.sendTransaction({
            to: client.universal.account,
            funds: { amount, token: nativeToken },
          });

          console.log(`TX Hash: ${tx.hash}`);
          expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

          const receipt = await tx.wait();
          expect(receipt.status).toBe(1);

          const hookIds = progressEvents.map((e) => e.event.id);
          expectBridgeHooks(hookIds, { expectConfirmation: true });
        }, 600000);

        it('should bridge native to other (existing)', async () => {
          if (skipE2E) return;

          console.log(
            `\n=== pcTx: Native Other Existing [${fixture.label}] ===`
          );

          const { pushClient: client, progressEvents } =
            await createMainWalletClientWithHook(mainWalletClient, {
              originChain: fixture.chain,
            });

          const tokens = MOVEABLE_TOKENS[fixture.chain] || [];
          const nativeToken = tokens.find(
            (t) => t.mechanism === 'native'
          );
          if (!nativeToken) {
            console.log('Skipping - native token not found');
            return;
          }

          const amount = PushChain.utils.helpers.parseUnits(
            '0.0001',
            18
          );

          const tx = await client.universal.sendTransaction({
            to: DIFFERENT_ADDRESS,
            funds: { amount, token: nativeToken },
          });

          console.log(`TX Hash: ${tx.hash}`);
          expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

          const receipt = await tx.wait();
          expect(receipt.status).toBe(1);

          const hookIds = progressEvents.map((e) => e.event.id);
          expectBridgeHooks(hookIds, { expectConfirmation: true });
        }, 600000);
      });
    }
  );

  // ============================================================================
  // Error Handling — parameterised across EVM chains
  // ============================================================================
  describe.each(fixtures)(
    'Error Handling [$label]',
    (fixture: ChainTestFixture) => {
      let pushClient: PushChain;

      beforeAll(async () => {
        if (skipE2E) return;

        const setup = await createEvmPushClient({
          chain: fixture.chain,
          privateKey,
          network: PUSH_NETWORK.TESTNET_DONUT,
        });
        pushClient = setup.pushClient;
      }, 60000);

      describe('11. Invalid Inputs', () => {
        it('should fail with invalid feeLockTxHash', async () => {
          if (skipE2E) return;

          await expect(
            pushClient.universal.sendTransaction({
              to: TEST_TARGET_ADDRESS,
              feeLockTxHash: '0xABC', // Invalid txHash
              value: BigInt(1e3),
            })
          ).rejects.toThrow();
        }, 30000);
      });
    }
  );

  // ============================================================================
  // Progress Hooks — parameterised across EVM chains
  // ============================================================================
  describe.each(fixtures)(
    'Progress Hooks [$label]',
    (fixture: ChainTestFixture) => {
      let pushClient: PushChain;
      const tracker = createProgressTracker();

      beforeAll(async () => {
        if (skipE2E) return;

        const setup = await createEvmPushClient({
          chain: fixture.chain,
          privateKey,
          network: PUSH_NETWORK.TESTNET_DONUT,
          progressHook: tracker.hook,
        });
        pushClient = setup.pushClient;
      }, 60000);

      beforeEach(() => {
        tracker.reset();
      });

      // ========================================================================
      // 12. Hook Timing
      // ========================================================================
      describe('12. Hook Timing', () => {
        it('should emit all hooks and measure timing', async () => {
          if (skipE2E) return;

          console.log(
            `\n=== Test: Hook Timing [${fixture.label}] ===`
          );

          const tokens = MOVEABLE_TOKENS[fixture.chain] || [];
          const nativeToken = tokens.find(
            (t) => t.mechanism === 'native'
          );
          if (!nativeToken) {
            console.log('Skipping - native token not found');
            return;
          }

          const UEA = pushClient.universal.account as `0x${string}`;

          const tx = await pushClient.universal.sendTransaction({
            to: UEA,
            funds: {
              amount: PushChain.utils.helpers.parseUnits('0.00001', 18),
              token: nativeToken,
            },
          });

          console.log(`Hash: ${tx.hash}`);

          // Log step durations
          const durations = tracker.getDurations();
          console.log('\n=== STEP DURATIONS ===');
          durations.forEach((d, i) => {
            console.log(
              `${i + 1}. ${d.duration.toFixed(2)}s: ${d.step}`
            );
          });

          // Log confirmations
          const confirmationHooks = tracker.events.filter((p) =>
            p.event.id.startsWith('SEND-TX-06-03')
          );
          console.log(
            `\nConfirmation hooks: ${confirmationHooks.length}`
          );

          expectBridgeHooks(tracker.getIds(), {
            expectConfirmation: true,
          });
        }, 300000);
      });

      // ========================================================================
      // 13. Native Bridge Hooks
      // ========================================================================
      describe('13. Native Bridge Hooks', () => {
        it('should emit all hooks + tx.progressHook replay', async () => {
          if (skipE2E) return;

          console.log(
            `\n=== Test: Native Bridge Hooks [${fixture.label}] ===`
          );

          const tokens = MOVEABLE_TOKENS[fixture.chain] || [];
          const nativeToken = tokens.find(
            (t) => t.mechanism === 'native'
          );
          if (!nativeToken) {
            console.log('Skipping - native token not found');
            return;
          }

          const UEA = pushClient.universal.account as `0x${string}`;

          const tx = await pushClient.universal.sendTransaction({
            to: UEA,
            funds: {
              amount: PushChain.utils.helpers.parseUnits('0.00001', 18),
              token: nativeToken,
            },
          });

          console.log(`Hash: ${tx.hash}`);

          // Test tx.progressHook buffer replay
          const txEvents: ProgressEvent[] = [];
          tx.progressHook((event: ProgressEvent) => {
            txEvents.push(event);
            console.log(`[TX.HOOK] ${event.id}: ${event.message}`);
          });

          expect(
            txEvents.some((e) => e.id === 'SEND-TX-01')
          ).toBe(true);
          expect(
            txEvents.some((e) => e.id === 'SEND-TX-06-01')
          ).toBe(true);
          expect(
            txEvents.some((e) => e.id === 'SEND-TX-06-04')
          ).toBe(true);
          expect(
            txEvents.some((e) => e.id === 'SEND-TX-06-05')
          ).toBe(true);
          expect(
            txEvents.some((e) => e.id === 'SEND-TX-06-06')
          ).toBe(true);
          expect(
            txEvents.some((e) => e.id === 'SEND-TX-99-01')
          ).toBe(true);

          // Verify orchestrator also received events
          expectBridgeHooks(tracker.getIds(), {
            expectConfirmation: true,
          });

          console.log(
            `\ntx.progressHook: ${txEvents.length} events, orchestrator: ${tracker.events.length} events`
          );
        }, 300000);
      });

      // ========================================================================
      // 14. USDT Bridge Hooks
      // ========================================================================
      describe('14. USDT Bridge Hooks', () => {
        it('should emit all hooks + tx.progressHook replay', async () => {
          if (skipE2E) return;

          console.log(
            `\n=== Test: USDT Bridge Hooks [${fixture.label}] ===`
          );

          let usdtToken;
          try {
            usdtToken = getToken(fixture.chain, 'USDT');
          } catch {
            console.log('Skipping - USDT not found');
            return;
          }

          const UEA = pushClient.universal.account as `0x${string}`;

          const tx = await pushClient.universal.sendTransaction({
            to: UEA,
            funds: {
              amount: PushChain.utils.helpers.parseUnits('0.0001', 6),
              token: usdtToken,
            },
          });

          console.log(`Hash: ${tx.hash}`);

          // Test tx.progressHook buffer replay
          const txEvents: ProgressEvent[] = [];
          tx.progressHook((event: ProgressEvent) => {
            txEvents.push(event);
            console.log(`[TX.HOOK] ${event.id}: ${event.message}`);
          });

          expect(
            txEvents.some((e) => e.id === 'SEND-TX-01')
          ).toBe(true);
          expect(
            txEvents.some((e) => e.id === 'SEND-TX-06-01')
          ).toBe(true);
          expect(
            txEvents.some((e) => e.id === 'SEND-TX-06-04')
          ).toBe(true);
          expect(
            txEvents.some((e) => e.id === 'SEND-TX-06-05')
          ).toBe(true);
          expect(
            txEvents.some((e) => e.id === 'SEND-TX-06-06')
          ).toBe(true);
          expect(
            txEvents.some((e) => e.id === 'SEND-TX-99-01')
          ).toBe(true);

          // Verify orchestrator also received events
          expectBridgeHooks(tracker.getIds(), {
            expectConfirmation: true,
          });

          console.log(
            `\ntx.progressHook: ${txEvents.length} events, orchestrator: ${tracker.events.length} events`
          );
        }, 300000);
      });
    }
  );
});

import '@e2e/shared/setup';
import { CHAIN } from '../../../src/lib/constants/enums';
import {
  convertOriginToExecutor,
  convertExecutorToOrigin,
  deriveExecutorAccount,
  resolveControllerAccount,
} from '../../../src/lib/universal/account/account';
import { Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { getCEAAddress } from '../../../src/lib/orchestrator/cea-utils';

/**
 * Account conversion — Push-native and namespace-agnostic tests.
 *
 * Prerequisites:
 * - PUSH_PRIVATE_KEY set in .env (native Push Chain account) for Push-only tests.
 * - No env required for tests using hardcoded addresses.
 */
describe('Account Conversion Utilities — Push & generic', () => {
  const pushPrivateKey = process.env['PUSH_PRIVATE_KEY'] as Hex;
  const skipPush = !pushPrivateKey;
  let pushAddress: string;

  beforeAll(() => {
    if (!skipPush) {
      pushAddress = privateKeyToAccount(pushPrivateKey).address;
    }
  });

  describe('convertOriginToExecutor() — UEA (default)', () => {
    it('should return same address for Push Chain account', async () => {
      if (skipPush) return;

      const result = await convertOriginToExecutor(
        { chain: CHAIN.PUSH_TESTNET_DONUT, address: pushAddress },
        { onlyCompute: true }
      );

      expect(result.address).toBe(pushAddress);
      expect(result.deployed).toBe(false);
    });
  });

  describe('convertOriginToExecutor() — CEA (with options.chain)', () => {
    it('should return CEA for Push Chain account on external chain', async () => {
      if (skipPush) return;

      const result = await convertOriginToExecutor(
        { chain: CHAIN.PUSH_TESTNET_DONUT, address: pushAddress },
        { chain: CHAIN.ETHEREUM_SEPOLIA, onlyCompute: true }
      );

      expect(result.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(typeof result.deployed).toBe('boolean');
      console.log(`Push → CEA (ETH Sepolia): ${result.address} (deployed: ${result.deployed})`);
    }, 30000);
  });

  describe('convertExecutorToOrigin() — CEA to PushAccount (with chain)', () => {
    it('should return null for unknown CEA address', async () => {
      const unknownAddress = '0x0000000000000000000000000000000000000001';

      const result = await convertExecutorToOrigin(unknownAddress, {
        chain: CHAIN.ETHEREUM_SEPOLIA,
      });

      expect(result.account).toBeNull();
      expect(result.exists).toBe(false);
    }, 30000);

    it('should delegate to UEA lookup when chain is Push', async () => {
      const ueaAddress = '0x7AEE1699FeE2C906251863D24D35B3dEbe0932EC';

      const resultNoChain = await convertExecutorToOrigin(ueaAddress);
      const resultPushChain = await convertExecutorToOrigin(ueaAddress, {
        chain: CHAIN.PUSH_TESTNET_DONUT,
      });

      expect(resultNoChain.exists).toBe(resultPushChain.exists);
      if (resultNoChain.account && resultPushChain.account) {
        expect(resultNoChain.account.chain).toBe(resultPushChain.account.chain);
        expect(resultNoChain.account.address).toBe(
          resultPushChain.account.address
        );
      }
    }, 30000);
  });

  describe('deriveExecutorAccount() — Push Chain address (default)', () => {
    it('should return same address for Push Chain account with skipNetworkCheck', async () => {
      if (skipPush) return;

      const result = await deriveExecutorAccount(
        { chain: CHAIN.PUSH_TESTNET_DONUT, address: pushAddress },
        { skipNetworkCheck: true },
      );

      expect(result.address).toBe(pushAddress);
      expect(result.deployed).toBeNull();
    });

    it('should check deployment for Push Chain account without skipNetworkCheck', async () => {
      if (skipPush) return;

      const result = await deriveExecutorAccount(
        { chain: CHAIN.PUSH_TESTNET_DONUT, address: pushAddress },
      );

      expect(result.address).toBe(pushAddress);
      expect(typeof result.deployed).toBe('boolean');
    }, 30000);

    it('should return consistent results across calls', async () => {
      if (skipPush) return;

      const result1 = await deriveExecutorAccount(
        { chain: CHAIN.PUSH_TESTNET_DONUT, address: pushAddress },
        { skipNetworkCheck: true },
      );
      const result2 = await deriveExecutorAccount(
        { chain: CHAIN.PUSH_TESTNET_DONUT, address: pushAddress },
        { skipNetworkCheck: true },
      );

      expect(result1.address).toBe(result2.address);
      expect(result1.deployed).toBe(result2.deployed);
    });
  });

  describe('deriveExecutorAccount() — CEA (with options.chain)', () => {
    it('should return CEA for Push Chain account on external chain', async () => {
      if (skipPush) return;

      const result = await deriveExecutorAccount(
        { chain: CHAIN.PUSH_TESTNET_DONUT, address: pushAddress },
        { chain: CHAIN.ETHEREUM_SEPOLIA },
      );

      expect(result.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(typeof result.deployed).toBe('boolean');
      console.log(`[derive] Push → CEA (ETH Sepolia): ${result.address} (deployed: ${result.deployed})`);
    }, 30000);

    it('should match direct getCEAAddress result', async () => {
      if (skipPush) return;

      const ceaViaDerived = await deriveExecutorAccount(
        { chain: CHAIN.PUSH_TESTNET_DONUT, address: pushAddress },
        { chain: CHAIN.ETHEREUM_SEPOLIA },
      );

      const ceaDirect = await getCEAAddress(pushAddress as `0x${string}`, CHAIN.ETHEREUM_SEPOLIA);

      expect(ceaViaDerived.address).toBe(ceaDirect.cea);
    }, 30000);

    it('should return different CEA addresses for different target chains', async () => {
      if (skipPush) return;

      const pushAccount = { chain: CHAIN.PUSH_TESTNET_DONUT, address: pushAddress };
      const ceaEth = await deriveExecutorAccount(pushAccount, { chain: CHAIN.ETHEREUM_SEPOLIA });
      const ceaBnb = await deriveExecutorAccount(pushAccount, { chain: CHAIN.BNB_TESTNET });
      const ceaArb = await deriveExecutorAccount(pushAccount, { chain: CHAIN.ARBITRUM_SEPOLIA });
      const ceaBase = await deriveExecutorAccount(pushAccount, { chain: CHAIN.BASE_SEPOLIA });

      const addresses = [ceaEth.address, ceaBnb.address, ceaArb.address, ceaBase.address];
      addresses.forEach((addr) => expect(addr).toMatch(/^0x[a-fA-F0-9]{40}$/));
      expect(new Set(addresses).size).toBe(4);
    }, 60000);

    it('should return SVM CEA (PDA) for Solana target', async () => {
      if (skipPush) return;

      const result = await deriveExecutorAccount(
        { chain: CHAIN.PUSH_TESTNET_DONUT, address: pushAddress },
        { chain: CHAIN.SOLANA_DEVNET },
      );

      expect(result.address).toMatch(/^0x[a-fA-F0-9]{64}$/);
    }, 30000);

    it('should respect skipNetworkCheck on CEA derivation', async () => {
      if (skipPush) return;

      const result = await deriveExecutorAccount(
        { chain: CHAIN.PUSH_TESTNET_DONUT, address: pushAddress },
        { chain: CHAIN.ETHEREUM_SEPOLIA, skipNetworkCheck: true },
      );

      expect(result.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(result.deployed).toBeNull();
    }, 30000);
  });

  describe('resolveControllerAccount() — UEA to origin', () => {
    it('should return Push EOA as controller for non-UEA address', async () => {
      const eoaAddress = '0x0000000000000000000000000000000000000001';

      const result = await resolveControllerAccount(eoaAddress);

      expect(result.accounts.length).toBe(1);
      expect(result.accounts[0].type).toBe('uoa');
      expect(result.accounts[0].role).toBe('controller');
      expect(result.accounts[0].address).toBe(eoaAddress);
      expect(result.accounts[0].chain).toBe(CHAIN.PUSH_TESTNET_DONUT);
      expect(result.accounts[0].chainName).toBe('PUSH_TESTNET_DONUT');
    }, 30000);
  });

  describe('resolveControllerAccount() — CEA to UEA + origin', () => {
    it('should return empty accounts for unknown CEA', async () => {
      const unknownAddress = '0x0000000000000000000000000000000000000001';

      const result = await resolveControllerAccount(unknownAddress, {
        chain: CHAIN.ETHEREUM_SEPOLIA,
      });

      expect(result.accounts).toEqual([]);
    }, 30000);
  });
});

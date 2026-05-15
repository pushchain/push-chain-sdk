import '@e2e/shared/setup';
import { CHAIN } from '../../../src/lib/constants/enums';
import {
  convertOriginToExecutor,
  convertExecutorToOrigin,
  deriveExecutorAccount,
  resolveControllerAccount,
} from '../../../src/lib/universal/account/account';
import { getAddress, Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { getCEAAddress } from '../../../src/lib/orchestrator/cea-utils';

/**
 * Account conversion — EVM-origin tests.
 *
 * Prerequisites:
 * - EVM_PRIVATE_KEY set in .env (account with a deployed UEA on testnet donut)
 */
describe('Account Conversion Utilities — EVM', () => {
  const evmPrivateKey = process.env['EVM_PRIVATE_KEY'] as Hex;
  const skipEVM = !evmPrivateKey;
  let evmAddress: string;

  beforeAll(() => {
    if (!skipEVM) {
      evmAddress = privateKeyToAccount(evmPrivateKey).address;
    }
  });

  describe('convertOriginToExecutor() — UEA (default)', () => {
    it('should compute UEA for EVM origin account', async () => {
      if (skipEVM) return;

      const result = await convertOriginToExecutor(
        { chain: CHAIN.ETHEREUM_SEPOLIA, address: evmAddress },
        { onlyCompute: true }
      );

      expect(result.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(typeof result.deployed).toBe('boolean');
      console.log(`EVM → UEA: ${evmAddress} → ${result.address} (deployed: ${result.deployed})`);
    }, 30000);

    it('should return consistent results across calls (caching)', async () => {
      if (skipEVM) return;

      const account = { chain: CHAIN.ETHEREUM_SEPOLIA, address: evmAddress };
      const result1 = await convertOriginToExecutor(account, { onlyCompute: true });
      const result2 = await convertOriginToExecutor(account, { onlyCompute: true });

      expect(result1.address).toBe(result2.address);
      expect(result1.deployed).toBe(result2.deployed);
    }, 30000);
  });

  describe('convertOriginToExecutor() — CEA (with options.chain)', () => {
    it('should return CEA on external chain for EVM origin', async () => {
      if (skipEVM) return;

      const result = await convertOriginToExecutor(
        { chain: CHAIN.ETHEREUM_SEPOLIA, address: evmAddress },
        { chain: CHAIN.ETHEREUM_SEPOLIA, onlyCompute: true }
      );

      expect(result.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(typeof result.deployed).toBe('boolean');
      console.log(`EVM → CEA (ETH Sepolia): ${result.address} (deployed: ${result.deployed})`);
    }, 30000);

    it('should match direct getCEAAddress result', async () => {
      if (skipEVM) return;

      const ueaResult = await convertOriginToExecutor(
        { chain: CHAIN.ETHEREUM_SEPOLIA, address: evmAddress },
        { onlyCompute: false }
      );

      const ceaViaConvert = await convertOriginToExecutor(
        { chain: CHAIN.ETHEREUM_SEPOLIA, address: evmAddress },
        { chain: CHAIN.ETHEREUM_SEPOLIA, onlyCompute: true }
      );

      const ceaDirect = await getCEAAddress(ueaResult.address, CHAIN.ETHEREUM_SEPOLIA);

      expect(ceaViaConvert.address).toBe(ceaDirect.cea);
      expect(ceaViaConvert.deployed).toBe(ceaDirect.isDeployed);
    }, 30000);

    it('should return CEA without deployed when onlyCompute=false', async () => {
      if (skipEVM) return;

      const result = await convertOriginToExecutor(
        { chain: CHAIN.ETHEREUM_SEPOLIA, address: evmAddress },
        { chain: CHAIN.ETHEREUM_SEPOLIA, onlyCompute: false }
      );

      expect(result.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(result.deployed).toBeUndefined();
    }, 30000);

    it('should fall back to UEA behavior when options.chain is Push', async () => {
      if (skipEVM) return;

      const resultWithPushChain = await convertOriginToExecutor(
        { chain: CHAIN.ETHEREUM_SEPOLIA, address: evmAddress },
        { chain: CHAIN.PUSH_TESTNET_DONUT, onlyCompute: true }
      );
      const resultDefault = await convertOriginToExecutor(
        { chain: CHAIN.ETHEREUM_SEPOLIA, address: evmAddress },
        { onlyCompute: true }
      );

      expect(resultWithPushChain.address).toBe(resultDefault.address);
    }, 30000);

    it('should return different CEA addresses for different target chains', async () => {
      if (skipEVM) return;

      const ceaEth = await convertOriginToExecutor(
        { chain: CHAIN.ETHEREUM_SEPOLIA, address: evmAddress },
        { chain: CHAIN.ETHEREUM_SEPOLIA, onlyCompute: true }
      );
      const ceaBnb = await convertOriginToExecutor(
        { chain: CHAIN.ETHEREUM_SEPOLIA, address: evmAddress },
        { chain: CHAIN.BNB_TESTNET, onlyCompute: true }
      );
      const ceaArb = await convertOriginToExecutor(
        { chain: CHAIN.ETHEREUM_SEPOLIA, address: evmAddress },
        { chain: CHAIN.ARBITRUM_SEPOLIA, onlyCompute: true }
      );
      const ceaBase = await convertOriginToExecutor(
        { chain: CHAIN.ETHEREUM_SEPOLIA, address: evmAddress },
        { chain: CHAIN.BASE_SEPOLIA, onlyCompute: true }
      );

      const addresses = [ceaEth.address, ceaBnb.address, ceaArb.address, ceaBase.address];
      addresses.forEach((addr) => expect(addr).toMatch(/^0x[a-fA-F0-9]{40}$/));
      expect(new Set(addresses).size).toBe(4);

      console.log(`CEA on ETH Sepolia:     ${ceaEth.address}`);
      console.log(`CEA on BNB Testnet:     ${ceaBnb.address}`);
      console.log(`CEA on Arbitrum Sepolia: ${ceaArb.address}`);
      console.log(`CEA on Base Sepolia:     ${ceaBase.address}`);
    }, 60000);

    it('should throw for unsupported CEA chain (Solana has no CEAFactory)', async () => {
      if (skipEVM) return;

      await expect(
        convertOriginToExecutor(
          { chain: CHAIN.ETHEREUM_SEPOLIA, address: evmAddress },
          { chain: CHAIN.SOLANA_DEVNET, onlyCompute: true }
        )
      ).rejects.toThrow();
    }, 30000);
  });

  describe('convertExecutorToOrigin() — UEA to origin (no chain)', () => {
    it('should return origin for a known EVM UEA', async () => {
      if (skipEVM) return;

      const ueaResult = await convertOriginToExecutor(
        { chain: CHAIN.ETHEREUM_SEPOLIA, address: evmAddress },
        { onlyCompute: true }
      );

      if (!ueaResult.deployed) {
        console.log('SKIP: EVM UEA not deployed — cannot verify reverse lookup');
        return;
      }

      const origin = await convertExecutorToOrigin(ueaResult.address);

      expect(origin.exists).toBe(true);
      expect(origin.account).not.toBeNull();
      expect(origin.account!.chain).toBe(CHAIN.ETHEREUM_SEPOLIA);
      expect(origin.account!.address.toLowerCase()).toBe(
        evmAddress.toLowerCase()
      );
      console.log(
        `UEA → Origin (EVM): ${ueaResult.address} → ${origin.account!.chain}:${origin.account!.address}`
      );
    }, 30000);

    it('should return Ethereum origin for known UEA 0x7AEE1699FeE2C906251863D24D35B3dEbe0932EC', async () => {
      const ueaAddress = '0x7AEE1699FeE2C906251863D24D35B3dEbe0932EC';

      const result = await convertExecutorToOrigin(ueaAddress);

      expect(result.exists).toBe(true);
      expect(result.account).not.toBeNull();
      expect(result.account!.chain).toBe(CHAIN.ETHEREUM_SEPOLIA);
      expect(result.account!.address).toBe(
        getAddress('0xFd6C2fE69bE13d8bE379CCB6c9306e74193EC1A9')
      );
    }, 30000);

    it('should return exists=true for deployed UEA', async () => {
      if (skipEVM) return;

      const ueaResult = await convertOriginToExecutor(
        { chain: CHAIN.ETHEREUM_SEPOLIA, address: evmAddress },
        { onlyCompute: true }
      );

      if (!ueaResult.deployed) {
        console.log('SKIP: UEA not deployed — cannot verify exists flag');
        return;
      }

      const origin = await convertExecutorToOrigin(ueaResult.address);
      expect(origin.exists).toBe(true);
      expect(origin.account).not.toBeNull();
    }, 30000);
  });

  describe('convertExecutorToOrigin() — CEA to PushAccount (with chain)', () => {
    it('should return PushAccount for a known CEA', async () => {
      if (skipEVM) return;

      const ueaResult = await convertOriginToExecutor(
        { chain: CHAIN.ETHEREUM_SEPOLIA, address: evmAddress },
        { onlyCompute: false }
      );

      const ceaResult = await getCEAAddress(
        ueaResult.address,
        CHAIN.ETHEREUM_SEPOLIA
      );

      if (!ceaResult.isDeployed) {
        console.log(
          `SKIP: CEA not deployed on ETH Sepolia for UEA ${ueaResult.address} — reverse lookup requires deployment`
        );
        return;
      }

      const origin = await convertExecutorToOrigin(ceaResult.cea, {
        chain: CHAIN.ETHEREUM_SEPOLIA,
      });

      expect(origin.exists).toBe(true);
      expect(origin.account).not.toBeNull();
      expect(origin.account!.chain).toBe(CHAIN.PUSH_TESTNET_DONUT);
      expect(origin.account!.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(origin.account!.address.toLowerCase()).toBe(
        ueaResult.address.toLowerCase()
      );
      console.log(
        `CEA → PushAccount: ${ceaResult.cea} → ${origin.account!.chain}:${origin.account!.address}`
      );
    }, 30000);
  });

  describe('Round-trip conversions', () => {
    it('EVM origin → UEA → origin should preserve the original account', async () => {
      if (skipEVM) return;

      const originalAccount = {
        chain: CHAIN.ETHEREUM_SEPOLIA,
        address: evmAddress,
      };

      const ueaResult = await convertOriginToExecutor(originalAccount, {
        onlyCompute: true,
      });

      if (!ueaResult.deployed) {
        console.log('SKIP: EVM UEA not deployed — round-trip requires deployment');
        return;
      }

      const originResult = await convertExecutorToOrigin(ueaResult.address);

      expect(originResult.exists).toBe(true);
      expect(originResult.account).not.toBeNull();
      expect(originResult.account!.chain).toBe(originalAccount.chain);
      expect(originResult.account!.address.toLowerCase()).toBe(
        originalAccount.address.toLowerCase()
      );
    }, 30000);

    it('origin → CEA → PushAccount should map back to UEA', async () => {
      if (skipEVM) return;

      const originalAccount = {
        chain: CHAIN.ETHEREUM_SEPOLIA,
        address: evmAddress,
      };

      const ueaResult = await convertOriginToExecutor(originalAccount, {
        onlyCompute: false,
      });

      const ceaResult = await convertOriginToExecutor(originalAccount, {
        chain: CHAIN.ETHEREUM_SEPOLIA,
        onlyCompute: true,
      });

      if (!ceaResult.deployed) {
        console.log(
          'SKIP: CEA not deployed on ETH Sepolia — round-trip reverse lookup requires deployment'
        );
        return;
      }

      const pushAccountResult = await convertExecutorToOrigin(
        ceaResult.address,
        { chain: CHAIN.ETHEREUM_SEPOLIA }
      );

      expect(pushAccountResult.exists).toBe(true);
      expect(pushAccountResult.account).not.toBeNull();
      expect(pushAccountResult.account!.chain).toBe(CHAIN.PUSH_TESTNET_DONUT);
      expect(pushAccountResult.account!.address.toLowerCase()).toBe(
        ueaResult.address.toLowerCase()
      );

      console.log(
        `Round-trip: ${evmAddress} → UEA(${ueaResult.address}) → CEA(${ceaResult.address}) → PushAccount(${pushAccountResult.account!.address})`
      );
    }, 30000);
  });

  describe('deriveExecutorAccount() — CEA (with options.chain)', () => {
    it('should return CEA for EVM origin on external chain', async () => {
      if (skipEVM) return;

      const result = await deriveExecutorAccount(
        { chain: CHAIN.ETHEREUM_SEPOLIA, address: evmAddress },
        { chain: CHAIN.ETHEREUM_SEPOLIA },
      );

      expect(result.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(typeof result.deployed).toBe('boolean');
      console.log(`[derive] EVM origin → CEA (ETH Sepolia): ${result.address} (deployed: ${result.deployed})`);
    }, 30000);
  });

  describe('resolveControllerAccount() — UEA to origin', () => {
    it('should resolve known Ethereum UEA to origin', async () => {
      const ueaAddress = '0x7AEE1699FeE2C906251863D24D35B3dEbe0932EC';

      const result = await resolveControllerAccount(ueaAddress);

      expect(result.accounts.length).toBeGreaterThan(0);

      const controller = result.accounts.find((a) => a.role === 'controller');
      expect(controller).toBeDefined();
      expect(controller!.type).toBe('uoa');
      expect(controller!.chain).toBe(CHAIN.ETHEREUM_SEPOLIA);
      expect(controller!.address).toBe(
        getAddress('0xFd6C2fE69bE13d8bE379CCB6c9306e74193EC1A9')
      );
      expect(controller!.exists).toBe(true);
      expect(controller!.chainName).toBe('ETHEREUM_SEPOLIA');
    }, 30000);

    it('should resolve EVM UEA from env to origin', async () => {
      if (skipEVM) return;

      const ueaResult = await convertOriginToExecutor(
        { chain: CHAIN.ETHEREUM_SEPOLIA, address: evmAddress },
        { onlyCompute: true }
      );

      if (!ueaResult.deployed) {
        console.log('SKIP: EVM UEA not deployed');
        return;
      }

      const result = await resolveControllerAccount(ueaResult.address);

      expect(result.accounts.length).toBeGreaterThan(0);

      const controller = result.accounts.find((a) => a.role === 'controller');
      expect(controller).toBeDefined();
      expect(controller!.type).toBe('uoa');
      expect(controller!.chain).toBe(CHAIN.ETHEREUM_SEPOLIA);
      expect(controller!.address.toLowerCase()).toBe(evmAddress.toLowerCase());
    }, 30000);
  });

  describe('resolveControllerAccount() — CEA to UEA + origin', () => {
    it('should resolve CEA to UEA and origin', async () => {
      if (skipEVM) return;

      const ueaResult = await convertOriginToExecutor(
        { chain: CHAIN.ETHEREUM_SEPOLIA, address: evmAddress },
        { onlyCompute: false }
      );

      const ceaResult = await getCEAAddress(ueaResult.address, CHAIN.ETHEREUM_SEPOLIA);

      if (!ceaResult.isDeployed) {
        console.log('SKIP: CEA not deployed — cannot verify resolve');
        return;
      }

      const result = await resolveControllerAccount(ceaResult.cea, {
        chain: CHAIN.ETHEREUM_SEPOLIA,
      });

      expect(result.accounts.length).toBe(2);

      const uea = result.accounts.find((a) => a.type === 'uea');
      expect(uea).toBeDefined();
      expect(uea!.chain).toBe(CHAIN.PUSH_TESTNET_DONUT);
      expect(uea!.chainName).toBe('PUSH_TESTNET_DONUT');
      expect(uea!.address.toLowerCase()).toBe(ueaResult.address.toLowerCase());
      expect(uea!.exists).toBe(true);

      const controller = result.accounts.find((a) => a.role === 'controller');
      expect(controller).toBeDefined();
      expect(controller!.type).toBe('uoa');
      expect(controller!.chain).toBe(CHAIN.ETHEREUM_SEPOLIA);
      expect(controller!.address.toLowerCase()).toBe(evmAddress.toLowerCase());

      console.log(
        `[resolve] CEA(${ceaResult.cea}) → UEA(${uea!.address}) → Origin(${controller!.chain}:${controller!.address})`
      );
    }, 60000);
  });

  describe('Round-trip: deriveExecutorAccount → resolveControllerAccount', () => {
    it('EVM UEA → resolve should return original account', async () => {
      if (skipEVM) return;

      const ueaResult = await deriveExecutorAccount(
        { chain: CHAIN.ETHEREUM_SEPOLIA, address: evmAddress },
      );

      if (!ueaResult.deployed) {
        console.log('SKIP: UEA not deployed — round-trip requires deployment');
        return;
      }

      const resolved = await resolveControllerAccount(ueaResult.address);

      const controller = resolved.accounts.find((a) => a.role === 'controller');
      expect(controller).toBeDefined();
      expect(controller!.chain).toBe(CHAIN.ETHEREUM_SEPOLIA);
      expect(controller!.address.toLowerCase()).toBe(evmAddress.toLowerCase());
    }, 30000);

    it('EVM origin → CEA → resolve should return UEA + origin', async () => {
      if (skipEVM) return;

      const ceaResult = await deriveExecutorAccount(
        { chain: CHAIN.ETHEREUM_SEPOLIA, address: evmAddress },
        { chain: CHAIN.ETHEREUM_SEPOLIA },
      );

      if (!ceaResult.deployed) {
        console.log('SKIP: CEA not deployed — round-trip requires deployment');
        return;
      }

      const resolved = await resolveControllerAccount(ceaResult.address, {
        chain: CHAIN.ETHEREUM_SEPOLIA,
      });

      expect(resolved.accounts.length).toBe(2);

      const uea = resolved.accounts.find((a) => a.type === 'uea');
      expect(uea).toBeDefined();

      const controller = resolved.accounts.find((a) => a.role === 'controller');
      expect(controller).toBeDefined();
      expect(controller!.chain).toBe(CHAIN.ETHEREUM_SEPOLIA);
      expect(controller!.address.toLowerCase()).toBe(evmAddress.toLowerCase());

      console.log(
        `[round-trip] ${evmAddress} → CEA(${ceaResult.address}) → UEA(${uea!.address}) → Origin(${controller!.address})`
      );
    }, 60000);
  });
});

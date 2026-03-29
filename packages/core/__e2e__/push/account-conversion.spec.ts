import '@e2e/shared/setup';
import { PushChain } from '../../src';
import { CHAIN, PUSH_NETWORK } from '../../src/lib/constants/enums';
import { CHAIN_INFO } from '../../src/lib/constants/chain';
import {
  convertOriginToExecutor,
  convertExecutorToOrigin,
} from '../../src/lib/universal/account/account';
import { createWalletClient, getAddress, http, Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { getCEAAddress } from '../../src/lib/orchestrator/cea-utils';

/**
 * E2E tests for convertOriginToExecutor (with options.chain)
 * and convertExecutorToOrigin.
 *
 * Prerequisites:
 * - EVM_PRIVATE_KEY set in .env (account with a deployed UEA on testnet donut)
 * - PUSH_PRIVATE_KEY set in .env (native Push Chain account)
 * - SOLANA_PRIVATE_KEY set in .env (Solana account)
 */
describe('Account Conversion Utilities', () => {
  const pushNetwork = PUSH_NETWORK.TESTNET_DONUT;
  const evmPrivateKey = process.env['EVM_PRIVATE_KEY'] as Hex;
  const pushPrivateKey = process.env['PUSH_PRIVATE_KEY'] as Hex;
  const solanaPrivateKey = process.env['SOLANA_PRIVATE_KEY'] as string;
  const skipEVM = !evmPrivateKey;
  const skipPush = !pushPrivateKey;
  const skipSolana = !solanaPrivateKey;

  let evmAddress: string;
  let pushAddress: string;
  let solanaAddress: string;

  beforeAll(() => {
    if (!skipEVM) {
      evmAddress = privateKeyToAccount(evmPrivateKey).address;
    }
    if (!skipPush) {
      pushAddress = privateKeyToAccount(pushPrivateKey).address;
    }
    if (!skipSolana) {
      const keypair = Keypair.fromSecretKey(bs58.decode(solanaPrivateKey));
      solanaAddress = keypair.publicKey.toBase58();
    }
  });

  // =========================================================================
  // convertOriginToExecutor — default (UEA) behavior
  // =========================================================================
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

    it('should compute UEA for Solana origin account', async () => {
      if (skipSolana) return;

      const result = await convertOriginToExecutor(
        { chain: CHAIN.SOLANA_DEVNET, address: solanaAddress },
        { onlyCompute: true }
      );

      expect(result.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(typeof result.deployed).toBe('boolean');
      console.log(`Solana → UEA: ${solanaAddress} → ${result.address} (deployed: ${result.deployed})`);
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

  // =========================================================================
  // convertOriginToExecutor — with options.chain (CEA)
  // =========================================================================
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

    it('should return CEA on external chain for Solana origin', async () => {
      if (skipSolana) return;

      const result = await convertOriginToExecutor(
        { chain: CHAIN.SOLANA_DEVNET, address: solanaAddress },
        { chain: CHAIN.ETHEREUM_SEPOLIA, onlyCompute: true }
      );

      expect(result.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(typeof result.deployed).toBe('boolean');
      console.log(`Solana → CEA (ETH Sepolia): ${result.address} (deployed: ${result.deployed})`);
    }, 30000);

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

    it('should match direct getCEAAddress result', async () => {
      if (skipEVM) return;

      // Get UEA first
      const ueaResult = await convertOriginToExecutor(
        { chain: CHAIN.ETHEREUM_SEPOLIA, address: evmAddress },
        { onlyCompute: false }
      );

      // Get CEA via convertOriginToExecutor with chain
      const ceaViaConvert = await convertOriginToExecutor(
        { chain: CHAIN.ETHEREUM_SEPOLIA, address: evmAddress },
        { chain: CHAIN.ETHEREUM_SEPOLIA, onlyCompute: true }
      );

      // Get CEA directly via getCEAAddress
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

      // Both should return UEA, not CEA
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
      // All should be valid hex addresses
      addresses.forEach((addr) => expect(addr).toMatch(/^0x[a-fA-F0-9]{40}$/));
      // All should be unique
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

  // =========================================================================
  // convertExecutorToOrigin — UEA → origin (no chain)
  // =========================================================================
  describe('convertExecutorToOrigin() — UEA to origin (no chain)', () => {
    it('should return origin for a known EVM UEA', async () => {
      if (skipEVM) return;

      // Compute the UEA
      const ueaResult = await convertOriginToExecutor(
        { chain: CHAIN.ETHEREUM_SEPOLIA, address: evmAddress },
        { onlyCompute: true }
      );

      if (!ueaResult.deployed) {
        console.log('SKIP: EVM UEA not deployed — cannot verify reverse lookup');
        return;
      }

      // Reverse: UEA → origin
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

    it('should return origin for a known Solana UEA', async () => {
      if (skipSolana) return;

      // Compute the UEA for Solana account
      const ueaResult = await convertOriginToExecutor(
        { chain: CHAIN.SOLANA_DEVNET, address: solanaAddress },
        { onlyCompute: true }
      );

      if (!ueaResult.deployed) {
        console.log('SKIP: Solana UEA not deployed — cannot verify reverse lookup');
        return;
      }

      // Reverse: UEA → origin
      const origin = await convertExecutorToOrigin(ueaResult.address);

      expect(origin.exists).toBe(true);
      expect(origin.account).not.toBeNull();
      expect(origin.account!.chain).toBe(CHAIN.SOLANA_DEVNET);
      expect(origin.account!.address).toBe(solanaAddress);
      console.log(
        `UEA → Origin (Solana): ${ueaResult.address} → ${origin.account!.chain}:${origin.account!.address}`
      );
    }, 30000);

    // Known hardcoded UEA addresses for regression
    it('should return Solana origin for known UEA 0xbCfaD05E5f19Ae46feAab2F72Ad9977BC239b395', async () => {
      const ueaAddress = '0xbCfaD05E5f19Ae46feAab2F72Ad9977BC239b395';

      const result = await convertExecutorToOrigin(ueaAddress);

      expect(result.exists).toBe(true);
      expect(result.account).not.toBeNull();
      expect(result.account!.chain).toBe(CHAIN.SOLANA_DEVNET);
      expect(result.account!.address).toBe(
        '72JBejJFXrRKpQ69Hmaqr7vWJr6pdZXFEL6jt3sadsXU'
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

  // =========================================================================
  // convertExecutorToOrigin — CEA → PushAccount (with chain)
  // =========================================================================
  describe('convertExecutorToOrigin() — CEA to PushAccount (with chain)', () => {
    it('should return PushAccount for a known CEA', async () => {
      if (skipEVM) return;

      // Get UEA for the EVM account
      const ueaResult = await convertOriginToExecutor(
        { chain: CHAIN.ETHEREUM_SEPOLIA, address: evmAddress },
        { onlyCompute: false }
      );

      // Get CEA on Ethereum Sepolia
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

      // Reverse: CEA → PushAccount
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

    it('should return null for unknown CEA address', async () => {
      const unknownAddress = '0x0000000000000000000000000000000000000001';

      const result = await convertExecutorToOrigin(unknownAddress, {
        chain: CHAIN.ETHEREUM_SEPOLIA,
      });

      expect(result.account).toBeNull();
      expect(result.exists).toBe(false);
    }, 30000);

    it('should delegate to UEA lookup when chain is Push', async () => {
      // Known Ethereum UEA — when chain=Push, should behave same as no chain
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

  // =========================================================================
  // Round-trip tests
  // =========================================================================
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

    it('Solana origin → UEA → origin should preserve the original account', async () => {
      if (skipSolana) return;

      const originalAccount = {
        chain: CHAIN.SOLANA_DEVNET,
        address: solanaAddress,
      };

      const ueaResult = await convertOriginToExecutor(originalAccount, {
        onlyCompute: true,
      });

      if (!ueaResult.deployed) {
        console.log('SKIP: Solana UEA not deployed — round-trip requires deployment');
        return;
      }

      const originResult = await convertExecutorToOrigin(ueaResult.address);

      expect(originResult.exists).toBe(true);
      expect(originResult.account).not.toBeNull();
      expect(originResult.account!.chain).toBe(originalAccount.chain);
      expect(originResult.account!.address).toBe(originalAccount.address);
    }, 30000);

    it('origin → CEA → PushAccount should map back to UEA', async () => {
      if (skipEVM) return;

      const originalAccount = {
        chain: CHAIN.ETHEREUM_SEPOLIA,
        address: evmAddress,
      };

      // origin → UEA
      const ueaResult = await convertOriginToExecutor(originalAccount, {
        onlyCompute: false,
      });

      // origin → CEA
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

      // CEA → PushAccount
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
});

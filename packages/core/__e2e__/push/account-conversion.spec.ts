import '@e2e/shared/setup';
import { PushChain } from '../../src';
import { CHAIN, PUSH_NETWORK } from '../../src/lib/constants/enums';
import { CHAIN_INFO } from '../../src/lib/constants/chain';
import {
  convertOriginToExecutor,
  convertExecutorToOrigin,
  deriveExecutorAccount,
  resolveControllerAccount,
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

  // =========================================================================
  // deriveExecutorAccount — Push Chain address (default)
  // =========================================================================
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

  // =========================================================================
  // deriveExecutorAccount — CEA (with options.chain)
  // =========================================================================
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

    it('should match direct getCEAAddress result', async () => {
      if (skipPush) return;

      // Get CEA via deriveExecutorAccount with chain
      const ceaViaDerived = await deriveExecutorAccount(
        { chain: CHAIN.PUSH_TESTNET_DONUT, address: pushAddress },
        { chain: CHAIN.ETHEREUM_SEPOLIA },
      );

      // Get CEA directly via getCEAAddress
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

  // =========================================================================
  // resolveControllerAccount — UEA on Push → origin
  // =========================================================================
  describe('resolveControllerAccount() — UEA to origin', () => {
    it('should resolve known Solana UEA to origin', async () => {
      const ueaAddress = '0xbCfaD05E5f19Ae46feAab2F72Ad9977BC239b395';

      const result = await resolveControllerAccount(ueaAddress);

      expect(result.accounts.length).toBeGreaterThan(0);

      const controller = result.accounts.find((a) => a.role === 'controller');
      expect(controller).toBeDefined();
      expect(controller!.type).toBe('uoa');
      expect(controller!.chain).toBe(CHAIN.SOLANA_DEVNET);
      expect(controller!.address).toBe('72JBejJFXrRKpQ69Hmaqr7vWJr6pdZXFEL6jt3sadsXU');
      expect(controller!.exists).toBe(true);
      expect(controller!.chainName).toBe('SOLANA_DEVNET');
    }, 30000);

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

      // Get UEA
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

    it('should resolve Solana UEA from env to origin', async () => {
      if (skipSolana) return;

      const ueaResult = await convertOriginToExecutor(
        { chain: CHAIN.SOLANA_DEVNET, address: solanaAddress },
        { onlyCompute: true }
      );

      if (!ueaResult.deployed) {
        console.log('SKIP: Solana UEA not deployed');
        return;
      }

      const result = await resolveControllerAccount(ueaResult.address);

      const controller = result.accounts.find((a) => a.role === 'controller');
      expect(controller).toBeDefined();
      expect(controller!.type).toBe('uoa');
      expect(controller!.chain).toBe(CHAIN.SOLANA_DEVNET);
      expect(controller!.address).toBe(solanaAddress);
    }, 30000);

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

  // =========================================================================
  // resolveControllerAccount — CEA on external chain → UEA + origin
  // =========================================================================
  describe('resolveControllerAccount() — CEA to UEA + origin', () => {
    it('should resolve CEA to UEA and origin', async () => {
      if (skipEVM) return;

      // Get UEA
      const ueaResult = await convertOriginToExecutor(
        { chain: CHAIN.ETHEREUM_SEPOLIA, address: evmAddress },
        { onlyCompute: false }
      );

      // Get CEA on Ethereum Sepolia
      const ceaResult = await getCEAAddress(ueaResult.address, CHAIN.ETHEREUM_SEPOLIA);

      if (!ceaResult.isDeployed) {
        console.log('SKIP: CEA not deployed — cannot verify resolve');
        return;
      }

      const result = await resolveControllerAccount(ceaResult.cea, {
        chain: CHAIN.ETHEREUM_SEPOLIA,
      });

      expect(result.accounts.length).toBe(2);

      // First should be UEA
      const uea = result.accounts.find((a) => a.type === 'uea');
      expect(uea).toBeDefined();
      expect(uea!.chain).toBe(CHAIN.PUSH_TESTNET_DONUT);
      expect(uea!.chainName).toBe('PUSH_TESTNET_DONUT');
      expect(uea!.address.toLowerCase()).toBe(ueaResult.address.toLowerCase());
      expect(uea!.exists).toBe(true);

      // Second should be origin UOA
      const controller = result.accounts.find((a) => a.role === 'controller');
      expect(controller).toBeDefined();
      expect(controller!.type).toBe('uoa');
      expect(controller!.chain).toBe(CHAIN.ETHEREUM_SEPOLIA);
      expect(controller!.address.toLowerCase()).toBe(evmAddress.toLowerCase());

      console.log(
        `[resolve] CEA(${ceaResult.cea}) → UEA(${uea!.address}) → Origin(${controller!.chain}:${controller!.address})`
      );
    }, 60000);

    it('should return empty accounts for unknown CEA', async () => {
      const unknownAddress = '0x0000000000000000000000000000000000000001';

      const result = await resolveControllerAccount(unknownAddress, {
        chain: CHAIN.ETHEREUM_SEPOLIA,
      });

      expect(result.accounts).toEqual([]);
    }, 30000);
  });

  // =========================================================================
  // deriveExecutorAccount + resolveControllerAccount — Round-trip
  // =========================================================================
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

    it('Solana UEA → resolve should return original account', async () => {
      if (skipSolana) return;

      const ueaResult = await deriveExecutorAccount(
        { chain: CHAIN.SOLANA_DEVNET, address: solanaAddress },
      );

      if (!ueaResult.deployed) {
        console.log('SKIP: UEA not deployed — round-trip requires deployment');
        return;
      }

      const resolved = await resolveControllerAccount(ueaResult.address);

      const controller = resolved.accounts.find((a) => a.role === 'controller');
      expect(controller).toBeDefined();
      expect(controller!.chain).toBe(CHAIN.SOLANA_DEVNET);
      expect(controller!.address).toBe(solanaAddress);
    }, 30000);

    it('EVM origin → CEA → resolve should return UEA + origin', async () => {
      if (skipEVM) return;

      // Derive CEA from the EVM origin account
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

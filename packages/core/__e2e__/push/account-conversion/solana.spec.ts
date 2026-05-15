import '@e2e/shared/setup';
import { CHAIN } from '../../../src/lib/constants/enums';
import {
  convertOriginToExecutor,
  convertExecutorToOrigin,
  deriveExecutorAccount,
  resolveControllerAccount,
} from '../../../src/lib/universal/account/account';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

/**
 * Account conversion — Solana-origin tests.
 *
 * Prerequisites:
 * - SOLANA_PRIVATE_KEY set in .env (Solana account)
 */
describe('Account Conversion Utilities — Solana', () => {
  const solanaPrivateKey = process.env['SOLANA_PRIVATE_KEY'] as string;
  const skipSolana = !solanaPrivateKey;
  let solanaAddress: string;

  beforeAll(() => {
    if (!skipSolana) {
      const keypair = Keypair.fromSecretKey(bs58.decode(solanaPrivateKey));
      solanaAddress = keypair.publicKey.toBase58();
    }
  });

  describe('convertOriginToExecutor() — UEA (default)', () => {
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
  });

  describe('convertOriginToExecutor() — CEA (with options.chain)', () => {
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
  });

  describe('convertExecutorToOrigin() — UEA to origin (no chain)', () => {
    it('should return origin for a known Solana UEA', async () => {
      if (skipSolana) return;

      const ueaResult = await convertOriginToExecutor(
        { chain: CHAIN.SOLANA_DEVNET, address: solanaAddress },
        { onlyCompute: true }
      );

      if (!ueaResult.deployed) {
        console.log('SKIP: Solana UEA not deployed — cannot verify reverse lookup');
        return;
      }

      const origin = await convertExecutorToOrigin(ueaResult.address);

      expect(origin.exists).toBe(true);
      expect(origin.account).not.toBeNull();
      expect(origin.account!.chain).toBe(CHAIN.SOLANA_DEVNET);
      expect(origin.account!.address).toBe(solanaAddress);
      console.log(
        `UEA → Origin (Solana): ${ueaResult.address} → ${origin.account!.chain}:${origin.account!.address}`
      );
    }, 30000);

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
  });

  describe('Round-trip conversions', () => {
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
  });

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
  });

  describe('Round-trip: deriveExecutorAccount → resolveControllerAccount', () => {
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
  });
});

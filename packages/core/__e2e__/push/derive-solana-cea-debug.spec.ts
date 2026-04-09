import '@e2e/shared/setup';
import { PushChain } from '../../src';
import { CHAIN } from '../../src/lib/constants/enums';

/**
 * Debug E2E: deriveExecutorAccount → Solana CEA
 *
 * Reproduces the bug where calling deriveExecutorAccount with
 * chain: SOLANA_DEVNET throws "CEAFactory not available on chain
 * solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1".
 *
 * Root cause: deriveExecutorAccount routes ALL external target chains
 * through getCEAAddress(), which only supports EVM chains with a
 * CEAFactory contract. Solana uses PDA derivation instead.
 */

// Hardcoded addresses — no private keys or env vars needed
const EVM_ADDRESS = '0xD8d6aF611a17C236b13235B5318508FA61dE3Dba';
const PUSH_ADDRESS = '0x98cA97d2FB78B3C0597E2F78cd11868cACF423C5';

describe('deriveExecutorAccount → Solana CEA Debug', () => {
  // =========================================================================
  // Scenario 1: EVM UOA → Solana CEA (user's first snippet)
  // =========================================================================
  describe('EVM UOA → Solana CEA (skipNetworkCheck)', () => {
    it('should derive Solana CEA from an Ethereum Sepolia UOA', async () => {
      const uoa = PushChain.utils.account.toUniversal(EVM_ADDRESS, {
        chain: PushChain.CONSTANTS.CHAIN.ETHEREUM_SEPOLIA,
      });

      console.log('Input UOA:', JSON.stringify(uoa, null, 2));
      console.log('Target chain: SOLANA_DEVNET');

      // This is the exact call from the user's script that fails:
      // "CEAFactory not available on chain solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"
      const solanaCEA =
        await PushChain.utils.account.deriveExecutorAccount(uoa, {
          chain: PushChain.CONSTANTS.CHAIN.SOLANA_DEVNET,
          skipNetworkCheck: true,
        });

      console.log('Solana CEA result:', JSON.stringify(solanaCEA, null, 2));

      expect(solanaCEA).toBeDefined();
      // Solana addresses are 32 bytes (64 hex chars) → 0x + 64 hex = 66 chars
      expect(solanaCEA.address).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(solanaCEA.deployed).toBeNull(); // skipNetworkCheck = true
    }, 60000);
  });

  // =========================================================================
  // Scenario 2: Push Chain address → Solana CEA
  // =========================================================================
  describe('Push Chain address → Solana CEA (skipNetworkCheck)', () => {
    it('should derive Solana CEA from a Push Chain address', async () => {
      const pushAccount = PushChain.utils.account.toUniversal(PUSH_ADDRESS, {
        chain: PushChain.CONSTANTS.CHAIN.PUSH_TESTNET,
      });

      console.log('Input Push account:', JSON.stringify(pushAccount, null, 2));
      console.log('Target chain: SOLANA_DEVNET');

      // Case 2 in deriveExecutorAccount — Push Chain → external
      // Also fails with CEAFactory error
      const solanaCEA =
        await PushChain.utils.account.deriveExecutorAccount(pushAccount, {
          chain: PushChain.CONSTANTS.CHAIN.SOLANA_DEVNET,
          skipNetworkCheck: true,
        });

      console.log('Solana CEA result:', JSON.stringify(solanaCEA, null, 2));

      expect(solanaCEA).toBeDefined();
      expect(solanaCEA.address).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(solanaCEA.deployed).toBeNull();
    }, 60000);
  });

  // =========================================================================
  // Scenario 3: Sanity — EVM CEA still works (BNB Testnet)
  // =========================================================================
  describe('EVM UOA → BNB CEA (sanity check)', () => {
    it('should still work for EVM target chains', async () => {
      const uoa = PushChain.utils.account.toUniversal(EVM_ADDRESS, {
        chain: PushChain.CONSTANTS.CHAIN.ETHEREUM_SEPOLIA,
      });

      const bnbCEA =
        await PushChain.utils.account.deriveExecutorAccount(uoa, {
          chain: PushChain.CONSTANTS.CHAIN.BNB_TESTNET,
          skipNetworkCheck: true,
        });

      console.log('BNB CEA result:', JSON.stringify(bnbCEA, null, 2));

      expect(bnbCEA).toBeDefined();
      // EVM CEA is 20 bytes → 0x + 40 hex
      expect(bnbCEA.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(bnbCEA.deployed).toBeNull();
    }, 60000);
  });

  // =========================================================================
  // Scenario 4: Deterministic — same input should yield same Solana CEA
  // =========================================================================
  describe('Deterministic Solana CEA derivation', () => {
    it('should return the same Solana CEA for the same UEA', async () => {
      const uoa = PushChain.utils.account.toUniversal(EVM_ADDRESS, {
        chain: PushChain.CONSTANTS.CHAIN.ETHEREUM_SEPOLIA,
      });

      const result1 =
        await PushChain.utils.account.deriveExecutorAccount(uoa, {
          chain: PushChain.CONSTANTS.CHAIN.SOLANA_DEVNET,
          skipNetworkCheck: true,
        });

      const result2 =
        await PushChain.utils.account.deriveExecutorAccount(uoa, {
          chain: PushChain.CONSTANTS.CHAIN.SOLANA_DEVNET,
          skipNetworkCheck: true,
        });

      console.log('Run 1:', result1.address);
      console.log('Run 2:', result2.address);

      expect(result1.address).toBe(result2.address);
    }, 60000);
  });
});

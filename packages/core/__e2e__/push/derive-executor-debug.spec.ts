import '@e2e/shared/setup';
import { PushChain } from '../../src';
import { CHAIN } from '../../src/lib/constants/enums';

/**
 * Debug E2E: deriveExecutorAccount
 *
 * Reproduces the exact code paths from the developer's script using hardcoded
 * addresses. No private keys or env vars needed — all calls are read-only RPC.
 *
 * Covers:
 *   1. UEA from EVM UOA (Ethereum Sepolia)
 *   2. UEA from Solana account (Solana Devnet)
 *   3. CEA from Push Chain account → BNB Testnet
 *   4. Deterministic derivation (skipNetworkCheck)
 */

// Exact addresses from the developer's script
const EVM_ADDRESS = '0xD8d6aF611a17C236b13235B5318508FA61dE3Dba';
const SOLANA_ADDRESS = 'EUYcfSUScdFgKMbB3rRdgRZwXmcxY7QCRQa2JwrchP1Q';
const PUSH_ADDRESS = '0x98cA97d2FB78B3C0597E2F78cd11868cACF423C5';

describe('deriveExecutorAccount Debug', () => {
  // Store results for cross-checks
  let ueaFromEvm: { address: `0x${string}`; deployed: boolean | null };
  let ueaFromSolana: { address: `0x${string}`; deployed: boolean | null };
  let ceaFromPush: { address: `0x${string}`; deployed: boolean | null };
  let deterministicResult: { address: `0x${string}`; deployed: boolean | null };

  // =========================================================================
  // Example 1: UEA from EVM UOA
  // =========================================================================
  describe('Example 1: UEA from EVM UOA (Ethereum Sepolia)', () => {
    it('should create valid UniversalAccount via toUniversal', () => {
      const account = PushChain.utils.account.toUniversal(EVM_ADDRESS, {
        chain: PushChain.CONSTANTS.CHAIN.ETHEREUM_SEPOLIA,
      });

      console.log('toUniversal result:', JSON.stringify(account, null, 2));

      expect(account).toBeDefined();
      expect(account.chain).toBe(CHAIN.ETHEREUM_SEPOLIA);
      expect(account.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
    });

    it('should derive UEA address and deployment status', async () => {
      const uoaAccount = PushChain.utils.account.toUniversal(EVM_ADDRESS, {
        chain: PushChain.CONSTANTS.CHAIN.ETHEREUM_SEPOLIA,
      });

      console.log('Calling deriveExecutorAccount for EVM UOA...');
      console.log('Input:', JSON.stringify(uoaAccount, null, 2));

      ueaFromEvm = await PushChain.utils.account.deriveExecutorAccount(uoaAccount);

      console.log('UEA from Ethereum UOA:', JSON.stringify(ueaFromEvm, null, 2));

      expect(ueaFromEvm).toBeDefined();
      expect(ueaFromEvm.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(typeof ueaFromEvm.deployed).toBe('boolean');
    }, 30000);
  });

  // =========================================================================
  // Example 2: UEA from Solana account
  // =========================================================================
  describe('Example 2: UEA from Solana account (Solana Devnet)', () => {
    it('should create valid UniversalAccount via toUniversal', () => {
      const account = PushChain.utils.account.toUniversal(SOLANA_ADDRESS, {
        chain: PushChain.CONSTANTS.CHAIN.SOLANA_DEVNET,
      });

      console.log('toUniversal result:', JSON.stringify(account, null, 2));

      expect(account).toBeDefined();
      expect(account.chain).toBe(CHAIN.SOLANA_DEVNET);
      expect(account.address).toBe(SOLANA_ADDRESS);
    });

    it('should derive UEA for Solana account', async () => {
      const solanaAccount = PushChain.utils.account.toUniversal(SOLANA_ADDRESS, {
        chain: PushChain.CONSTANTS.CHAIN.SOLANA_DEVNET,
      });

      console.log('Calling deriveExecutorAccount for Solana account...');
      console.log('Input:', JSON.stringify(solanaAccount, null, 2));

      ueaFromSolana = await PushChain.utils.account.deriveExecutorAccount(solanaAccount);

      console.log('UEA from Solana account:', JSON.stringify(ueaFromSolana, null, 2));

      expect(ueaFromSolana).toBeDefined();
      expect(ueaFromSolana.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(typeof ueaFromSolana.deployed).toBe('boolean');
    }, 30000);
  });

  // =========================================================================
  // Example 3: CEA from Push account → BNB Testnet
  // =========================================================================
  describe('Example 3: CEA from Push account (BNB Testnet)', () => {
    it('should create valid UniversalAccount via toUniversal', () => {
      const account = PushChain.utils.account.toUniversal(PUSH_ADDRESS, {
        chain: PushChain.CONSTANTS.CHAIN.PUSH_TESTNET,
      });

      console.log('toUniversal result:', JSON.stringify(account, null, 2));

      expect(account).toBeDefined();
      // PUSH_TESTNET === PUSH_TESTNET_DONUT (both 'eip155:42101')
      expect(account.chain).toBe(CHAIN.PUSH_TESTNET_DONUT);
      expect(account.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
    });

    it('should derive CEA on BNB Testnet', async () => {
      const pushAccount = PushChain.utils.account.toUniversal(PUSH_ADDRESS, {
        chain: PushChain.CONSTANTS.CHAIN.PUSH_TESTNET,
      });

      console.log('Calling deriveExecutorAccount for Push account → BNB Testnet CEA...');
      console.log('Input:', JSON.stringify(pushAccount, null, 2));
      console.log('Options:', JSON.stringify({ chain: CHAIN.BNB_TESTNET }, null, 2));

      ceaFromPush = await PushChain.utils.account.deriveExecutorAccount(
        pushAccount,
        { chain: PushChain.CONSTANTS.CHAIN.BNB_TESTNET }
      );

      console.log('CEA on BNB Testnet:', JSON.stringify(ceaFromPush, null, 2));

      expect(ceaFromPush).toBeDefined();
      expect(ceaFromPush.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
      // deployed is boolean (network check not skipped)
      expect(typeof ceaFromPush.deployed).toBe('boolean');
      // CEA should differ from the input Push address
      expect(ceaFromPush.address.toLowerCase()).not.toBe(PUSH_ADDRESS.toLowerCase());
    }, 30000);
  });

  // =========================================================================
  // Example 4: Deterministic (skipNetworkCheck)
  // =========================================================================
  describe('Example 4: Deterministic derivation (skipNetworkCheck)', () => {
    it('should return UEA with deployed: null', async () => {
      const uoaAccount = PushChain.utils.account.toUniversal(EVM_ADDRESS, {
        chain: PushChain.CONSTANTS.CHAIN.ETHEREUM_SEPOLIA,
      });

      console.log('Calling deriveExecutorAccount with skipNetworkCheck: true...');

      deterministicResult = await PushChain.utils.account.deriveExecutorAccount(
        uoaAccount,
        { skipNetworkCheck: true }
      );

      console.log('Deterministic derivation:', JSON.stringify(deterministicResult, null, 2));

      expect(deterministicResult).toBeDefined();
      expect(deterministicResult.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(deterministicResult.deployed).toBeNull();
    }, 30000);
  });

  // =========================================================================
  // Cross-checks
  // =========================================================================
  describe('Cross-checks', () => {
    it('Example 1 and 4 should return the same UEA address', () => {
      if (!ueaFromEvm || !deterministicResult) return;

      console.log(`Example 1 address: ${ueaFromEvm.address}`);
      console.log(`Example 4 address: ${deterministicResult.address}`);
      console.log(`Example 1 deployed: ${ueaFromEvm.deployed}`);
      console.log(`Example 4 deployed: ${deterministicResult.deployed}`);

      expect(deterministicResult.address).toBe(ueaFromEvm.address);
    });

    it('EVM and Solana UEAs should be different addresses', () => {
      if (!ueaFromEvm || !ueaFromSolana) return;

      console.log(`EVM UEA:    ${ueaFromEvm.address}`);
      console.log(`Solana UEA: ${ueaFromSolana.address}`);

      expect(ueaFromEvm.address).not.toBe(ueaFromSolana.address);
    });
  });
});

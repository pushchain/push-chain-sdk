/**
 * Chain Test Fixtures
 *
 * Centralised per-chain constants used by the parameterised outbound E2E tests.
 * Add a new entry to EVM_CHAIN_FIXTURES (and optionally STAKING_CHAIN_FIXTURES)
 * to run every Core Scenario test on an additional chain.
 *
 * Contract addresses that are already in the SDK constants (CEA_FACTORY_ADDRESSES,
 * UNIVERSAL_GATEWAY_ADDRESSES, VAULT_ADDRESSES, CHAIN_INFO) are NOT duplicated here.
 * Only test-specific deployments (counter contracts, staking proxy, etc.) live here.
 */
import { CHAIN, PUSH_NETWORK } from '../../src/lib/constants/enums';
import {
  CEA_FACTORY_ADDRESSES,
  UNIVERSAL_GATEWAY_ADDRESSES,
  SYNTHETIC_PUSH_ERC20,
} from '../../src/lib/constants/chain';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChainTestFixture {
  /** CHAIN enum value — used in all SDK calls */
  chain: CHAIN;
  /** Human-readable label for describe block names */
  label: string;
  /** Payable counter contract deployed on this external chain */
  contracts: {
    counter: `0x${string}`;
  };
}

export interface StakingChainFixture extends ChainTestFixture {
  staking: {
    /** StakingExample proxy on Push Chain (same address for all chains) */
    stakingProxy: `0x${string}`;
    /** PRC-20 wrapped native token on Push Chain for this chain (pETH, pBNB, etc.) */
    pNativeToken: `0x${string}`;
    /** PRC-20 pUSDT on Push Chain bridged from this chain */
    pUsdtToken: `0x${string}`;
  };
}

// ---------------------------------------------------------------------------
// Fixture Data
// ---------------------------------------------------------------------------

export const EVM_CHAIN_FIXTURES: ChainTestFixture[] = [
  {
    chain: CHAIN.BNB_TESTNET,
    label: 'BNB Testnet',
    contracts: {
      counter: '0xf4bd8c13da0f5831d7b6dd3275a39f14ec7ddaa6',
    },
  },
  {
    chain: CHAIN.ETHEREUM_SEPOLIA,
    label: 'Ethereum Sepolia',
    contracts: {
      counter: '0xF1552eD5ac48C273570500bD10b10C00E1C418bB',
    },
  },
  {
    chain: CHAIN.ARBITRUM_SEPOLIA,
    label: 'Arbitrum Sepolia',
    contracts: {
      counter: '0x7F0936bB90e7dcF3eDB47199C2005e7184E44Cf8',
    },
  },
  {
    chain: CHAIN.BASE_SEPOLIA,
    label: 'Base Sepolia',
    contracts: {
      counter: '0x25a62134B57C42b1733BDF577E48C91d13053138',
    },
  },
];

const s = SYNTHETIC_PUSH_ERC20[PUSH_NETWORK.TESTNET_DONUT];

export const STAKING_CHAIN_FIXTURES: StakingChainFixture[] = [
  {
    ...EVM_CHAIN_FIXTURES.find((f) => f.chain === CHAIN.BNB_TESTNET)!,
    staking: {
      stakingProxy: '0xd5d727D5eCE07BD5557f50e58DA092FCEDC1bf29',
      pNativeToken: s.pETH_BNB,
      pUsdtToken: s.USDT_BNB,
    },
  },
  {
    ...EVM_CHAIN_FIXTURES.find((f) => f.chain === CHAIN.ETHEREUM_SEPOLIA)!,
    staking: {
      stakingProxy: '0xd5d727D5eCE07BD5557f50e58DA092FCEDC1bf29',
      pNativeToken: s.pETH,
      pUsdtToken: s.USDT_ETH,
    },
  },
  {
    ...EVM_CHAIN_FIXTURES.find((f) => f.chain === CHAIN.ARBITRUM_SEPOLIA)!,
    staking: {
      stakingProxy: '0xd5d727D5eCE07BD5557f50e58DA092FCEDC1bf29',
      pNativeToken: s.pETH_ARB,
      pUsdtToken: s.USDT_ARB,
    },
  },
  {
    ...EVM_CHAIN_FIXTURES.find((f) => f.chain === CHAIN.BASE_SEPOLIA)!,
    staking: {
      stakingProxy: '0xd5d727D5eCE07BD5557f50e58DA092FCEDC1bf29',
      pNativeToken: s.pETH_BASE,
      pUsdtToken: s.USDT_BASE,
    },
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns true when all required contract addresses have been filled in. */
export function isFixtureReady(fixture: ChainTestFixture): boolean {
  return !fixture.contracts.counter.startsWith('0xTBD');
}

/** Returns true when the staking fixture is also ready (pToken addresses filled). */
export function isStakingFixtureReady(fixture: StakingChainFixture): boolean {
  return (
    isFixtureReady(fixture) &&
    !fixture.staking.pNativeToken.startsWith('0xTBD') &&
    !fixture.staking.pUsdtToken.startsWith('0xTBD')
  );
}

/**
 * Returns the list of chain fixtures whose contracts are actually deployed.
 * Optionally filtered by E2E_TARGET_CHAINS env var (comma-separated labels).
 *
 * @example E2E_TARGET_CHAINS="BNB Testnet,Ethereum Sepolia"
 */
export function getActiveFixtures(): ChainTestFixture[] {
  let fixtures = EVM_CHAIN_FIXTURES.filter(isFixtureReady);

  const envChains = process.env['E2E_TARGET_CHAINS'];
  if (envChains) {
    const allowed = envChains.split(',').map((s) => s.trim());
    fixtures = fixtures.filter((f) => allowed.includes(f.label));
  }

  return fixtures;
}

/** Same as getActiveFixtures but for staking fixtures. */
export function getActiveStakingFixtures(): StakingChainFixture[] {
  let fixtures = STAKING_CHAIN_FIXTURES.filter(isStakingFixtureReady);

  const envChains = process.env['E2E_TARGET_CHAINS'];
  if (envChains) {
    const allowed = envChains.split(',').map((s) => s.trim());
    fixtures = fixtures.filter((f) => allowed.includes(f.label));
  }

  return fixtures;
}

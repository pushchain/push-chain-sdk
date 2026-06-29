import { CHAIN, PUSH_NETWORK, VM } from './enums';
import { defineChain, type Chain } from 'viem';
import {
  mainnet,
  arbitrumSepolia,
  baseSepolia,
  bscTestnet,
} from 'viem/chains';

/**
 * Maps VM type to its namespace
 * References -
 * https://chainagnostic.org/CAIPs/caip-2
 */
export const VM_NAMESPACE: Record<VM, string> = {
  [VM.EVM]: 'eip155',
  [VM.SVM]: 'solana',
};

/**
 * Maps Push Network → VM → UEA implementation address.
 */
export const UEA_PROXY: Record<PUSH_NETWORK, `0x${string}`> = {
  [PUSH_NETWORK.MAINNET]: '0xTBD',
  [PUSH_NETWORK.TESTNET_DONUT]: '0x53179F638eC4613015EC1aA83e89B48BE6ed6d6d',
  [PUSH_NETWORK.TESTNET]: '0x53179F638eC4613015EC1aA83e89B48BE6ed6d6d',
  [PUSH_NETWORK.LOCALNET]: '0x2FE70447492307108Bdc7Ff6BaB33Ff37Dacc479',
};

/**
 * UEAFactory contract address on Push Chain.
 * Used to read UEA_VERSION (minRequiredVersion) and UEA_MIGRATION_CONTRACT.
 */
export const UEA_FACTORY: Record<PUSH_NETWORK, `0x${string}`> = {
  [PUSH_NETWORK.MAINNET]: '0xTBD',
  [PUSH_NETWORK.TESTNET_DONUT]: '0x00000000000000000000000000000000000000eA',
  [PUSH_NETWORK.TESTNET]: '0x00000000000000000000000000000000000000eA',
  [PUSH_NETWORK.LOCALNET]: '0x00000000000000000000000000000000000000eA',
};

/**
 * UEAMigration contract address on Push Chain.
 * Used in MsgMigrateUEA to specify which migration contract to delegatecall.
 */
export const UEA_MIGRATION: Record<PUSH_NETWORK, `0x${string}`> = {
  [PUSH_NETWORK.MAINNET]: '0xTBD',
  [PUSH_NETWORK.TESTNET_DONUT]: '0x862F13DBb7E21e552f7DAF6D954E7155e7f666AD',
  [PUSH_NETWORK.TESTNET]: '0x862F13DBb7E21e552f7DAF6D954E7155e7f666AD',
  [PUSH_NETWORK.LOCALNET]: '0xTBD',
};

/**
 * Addresses for wrapped ETH/SOL/ARBITRUM assets by Push network.
 * Includes pETH and PUSDT bridged from origin on test networks.
 */
export const SYNTHETIC_PUSH_ERC20: Record<
  PUSH_NETWORK,
  {
    pETH: `0x${string}`;
    pETH_ARB: `0x${string}`;
    pETH_BASE: `0x${string}`;
    pBNB: `0x${string}`;
    pSOL: `0x${string}`;
    USDT_ETH: `0x${string}`;
    USDC_ETH: `0x${string}`;
    USDT_ARB: `0x${string}`;
    USDC_ARB: `0x${string}`;
    USDT_SOL: `0x${string}`;
    USDC_SOL: `0x${string}`;
    USDT_BSC: `0x${string}`;
    /** @deprecated Use USDT_BSC instead. */
    USDT_BNB: `0x${string}`;
    USDC_BSC: `0x${string}`;
    /** @deprecated Use USDC_BSC instead. */
    USDC_BNB: `0x${string}`;
    USDT_BASE: `0x${string}`;
    USDC_BASE: `0x${string}`;
    WETH_ETH: `0x${string}`;
    stETH_ETH: `0x${string}`;
    DAI_SOL: `0x${string}`;
  }
> = {
  [PUSH_NETWORK.TESTNET_DONUT]: {
    pETH: '0x2971824Db68229D087931155C2b8bB820B275809',
    pETH_ARB: '0xc0a821a1AfEd1322c5e15f1F4586C0B8cE65400e',
    pETH_BASE: '0xc7007af2B24D4eb963fc9633B0c66e1d2D90Fc21',
    pBNB: '0x7a9082dA308f3fa005beA7dB0d203b3b86664E36',
    pSOL: '0x5D525Df2bD99a6e7ec58b76aF2fd95F39874EBed',
    USDT_ETH: '0x0f97A213207703923F5f0C613C9827f7C9A0f96B',
    USDC_ETH: '0x7A58048036206bB898008b5bBDA85697DB1e5d66',
    USDT_ARB: '0xFE6E9DF2BbC9ce05D98b83B1365df6DcA9951891',
    USDC_ARB: '0x1091cCBA2FF8d2A131AE4B35e34cf3308C48572C',
    USDT_SOL: '0x4f1A3D22d170a2F4Bddb37845a962322e24f4e34',
    USDC_SOL: '0x04B8F634ABC7C879763F623e0f0550a4b5c4426F',
    USDT_BSC: '0x731aF1Da5365259d27528557EE4aFBA4baC90ef2',
    USDT_BNB: '0x731aF1Da5365259d27528557EE4aFBA4baC90ef2',
    USDC_BSC: '0x120EBf25Dad7D6a09Ad2316f23f9Be95DBb90639',
    USDC_BNB: '0x120EBf25Dad7D6a09Ad2316f23f9Be95DBb90639',
    USDT_BASE: '0x148823809B853e1db187BC09A9ac909BC42F971a',
    USDC_BASE: '0xD7C6cA1e2c0CE260BE0c0AD39C1540de460e3Be1',
    WETH_ETH: '0x0d0dF7E8807430A81104EA84d926139816eC7586',
    stETH_ETH: '0xaf89E805949c628ebde3262e91dc4ab9eA12668E',
    DAI_SOL: '0x5861f56A556c990358cc9cccd8B5baa3767982A8',
  },
  [PUSH_NETWORK.TESTNET]: {
    pETH: '0x2971824Db68229D087931155C2b8bB820B275809',
    pETH_ARB: '0xc0a821a1AfEd1322c5e15f1F4586C0B8cE65400e',
    pETH_BASE: '0xc7007af2B24D4eb963fc9633B0c66e1d2D90Fc21',
    pBNB: '0x7a9082dA308f3fa005beA7dB0d203b3b86664E36',
    pSOL: '0x5D525Df2bD99a6e7ec58b76aF2fd95F39874EBed',
    USDT_ETH: '0x0f97A213207703923F5f0C613C9827f7C9A0f96B',
    USDC_ETH: '0x7A58048036206bB898008b5bBDA85697DB1e5d66',
    USDT_ARB: '0xFE6E9DF2BbC9ce05D98b83B1365df6DcA9951891',
    USDC_ARB: '0x1091cCBA2FF8d2A131AE4B35e34cf3308C48572C',
    USDT_SOL: '0x4f1A3D22d170a2F4Bddb37845a962322e24f4e34',
    USDC_SOL: '0x04B8F634ABC7C879763F623e0f0550a4b5c4426F',
    USDT_BSC: '0x731aF1Da5365259d27528557EE4aFBA4baC90ef2',
    USDT_BNB: '0x731aF1Da5365259d27528557EE4aFBA4baC90ef2',
    USDC_BSC: '0x120EBf25Dad7D6a09Ad2316f23f9Be95DBb90639',
    USDC_BNB: '0x120EBf25Dad7D6a09Ad2316f23f9Be95DBb90639',
    USDT_BASE: '0x148823809B853e1db187BC09A9ac909BC42F971a',
    USDC_BASE: '0xD7C6cA1e2c0CE260BE0c0AD39C1540de460e3Be1',
    WETH_ETH: '0x0d0dF7E8807430A81104EA84d926139816eC7586',
    stETH_ETH: '0xaf89E805949c628ebde3262e91dc4ab9eA12668E',
    DAI_SOL: '0x5861f56A556c990358cc9cccd8B5baa3767982A8',
  },
  [PUSH_NETWORK.LOCALNET]: {
    pETH: '0xTBD',
    pETH_ARB: '0xTBD',
    pETH_BASE: '0xTBD',
    pBNB: '0xTBD',
    pSOL: '0xTBD',
    USDT_ETH: '0xTBD',
    USDC_ETH: '0xTBD',
    USDT_ARB: '0xTBD',
    USDC_ARB: '0xTBD',
    USDT_SOL: '0xTBD',
    USDC_SOL: '0xTBD',
    USDT_BSC: '0xTBD',
    USDT_BNB: '0xTBD',
    USDC_BSC: '0xTBD',
    USDC_BNB: '0xTBD',
    USDT_BASE: '0xTBD',
    USDC_BASE: '0xTBD',
    WETH_ETH: '0xTBD',
    stETH_ETH: '0xTBD',
    DAI_SOL: '0xTBD',
  },
  [PUSH_NETWORK.MAINNET]: {
    pETH: '0xTBD',
    pETH_ARB: '0xTBD',
    pETH_BASE: '0xTBD',
    pBNB: '0xTBD',
    pSOL: '0xTBD',
    USDT_ETH: '0xTBD',
    USDC_ETH: '0xTBD',
    USDT_ARB: '0xTBD',
    USDC_ARB: '0xTBD',
    USDT_SOL: '0xTBD',
    USDC_SOL: '0xTBD',
    USDT_BSC: '0xTBD',
    USDT_BNB: '0xTBD',
    USDC_BSC: '0xTBD',
    USDC_BNB: '0xTBD',
    USDT_BASE: '0xTBD',
    USDC_BASE: '0xTBD',
    WETH_ETH: '0xTBD',
    stETH_ETH: '0xTBD',
    DAI_SOL: '0xTBD',
  },
};

/**
 * Canonical metadata for each chain supported by the SDK.
 * Acts as a single source of truth for chainId, vm type, locker contract, etc.
 * References -
 * https://namespaces.chainagnostic.org/solana/caip2
 */
export const CHAIN_INFO: Record<
  CHAIN,
  {
    chainId: string;
    vm: VM;
    lockerContract?: string;
    gatewayVersion?: 'v0' | 'v1'; // v0 = RevertInstructions struct, v1 = revertRecipient address
    defaultRPC: string[];
    // Full-history (archive) EVM JSON-RPC, used as a fallback when the prune
    // `defaultRPC` can't serve an older tx (a pruned-history miss). Unset for
    // chains without a dedicated archive endpoint (fallback becomes a no-op).
    archiveRPC?: string[];
    confirmations: number; // Confirmations required to mark a tx as finalized
    fastConfirmations: number; // Confirmations for GAS tx types (0, 1) - typically 0 for fast mode
    timeout: number; // Wait timeout in ms for required confirmations : Ideal value = (confirmations + 1)* Avg Chain Block time
    explorerUrl?: string; // Block explorer base URL for transaction links
    dex?: {
      uniV3Factory?: `0x${string}`;
      uniV3QuoterV2?: `0x${string}`;
      uniV3SwapRouter?: `0x${string}`;
      weth?: `0x${string}`;
    };
  }
> = {
  // Push
  [CHAIN.PUSH_MAINNET]: {
    chainId: 'TBD',
    vm: VM.EVM,
    defaultRPC: [''],
    confirmations: 1,
    fastConfirmations: 0,
    timeout: 30000,
    explorerUrl: 'https://explorer.push.org',
  },
  [CHAIN.PUSH_TESTNET_DONUT]: {
    chainId: '42101',
    vm: VM.EVM,
    defaultRPC: ['https://evm.donut.rpc.push.org/'],
    // Archive (full-history) EVM RPC — fallback for tracking older txs the
    // prune `defaultRPC` has dropped.
    archiveRPC: ['https://archive.evm.donut.rpc.push.org/'],
    confirmations: 1,
    fastConfirmations: 0,
    timeout: 30000,
    explorerUrl: 'https://explorer.donut.push.org',
    // Push Chain AMM - Uniswap V3
    // Source: https://push.org/agents/contract-addresses.json
    dex: {
      uniV3Factory: '0x81b8Bca02580C7d6b636051FDb7baAC436bFb454',
      uniV3QuoterV2: '0x83316275f7C2F79BC4E26f089333e88E89093037',
      uniV3SwapRouter: '0x5D548bB9E305AAe0d6dc6e6fdc3ab419f6aC0037',
      weth: '0xE17DD2E0509f99E9ee9469Cf6634048Ec5a3ADe9',
    },
  },
  [CHAIN.PUSH_LOCALNET]: {
    chainId: '9000',
    vm: VM.EVM,
    defaultRPC: ['http://localhost:8545'],
    confirmations: 1,
    fastConfirmations: 0,
    timeout: 30000,
    explorerUrl: 'http://localhost:8545',
  },

  // Ethereum
  [CHAIN.ETHEREUM_MAINNET]: {
    chainId: '1',
    vm: VM.EVM,
    lockerContract: 'TBD',
    defaultRPC: [mainnet.rpcUrls.default.http[0]],
    confirmations: 1,
    fastConfirmations: 0,
    timeout: 60000,
    explorerUrl: 'https://etherscan.io',
  },
  [CHAIN.ETHEREUM_SEPOLIA]: {
    chainId: '11155111',
    vm: VM.EVM,
    lockerContract: '0x05bD7a3D18324c1F7e216f7fBF2b15985aE5281A',
    defaultRPC: [
      'https://ethereum-sepolia-rpc.publicnode.com',
      'https://rpc.sepolia.org',
      'https://sepolia.drpc.org',
    ],
    confirmations: 1,
    fastConfirmations: 0,
    timeout: 120000,
    explorerUrl: 'https://sepolia.etherscan.io',
    dex: {
      uniV3Factory: '0x0227628f3F023bb0B980b67D528571c95c6DaC1c',
      uniV3QuoterV2: '0xEd1f6473345F45b75F8179591dd5bA1888cf2FB3',
      weth: '0xfff9976782d46cc05630d1f6ebab18b2324d6b14',
    },
  },
  [CHAIN.ARBITRUM_SEPOLIA]: {
    chainId: '421614',
    vm: VM.EVM,
    lockerContract: '0x2cd870e0166Ba458dEC615168Fd659AacD795f34',
    defaultRPC: [
      arbitrumSepolia.rpcUrls.default.http[0],
      'https://sepolia-rollup.arbitrum.io/rpc',
      'https://arbitrum-sepolia-rpc.publicnode.com',
    ],
    confirmations: 1,
    fastConfirmations: 0,
    timeout: 30000,
    explorerUrl: 'https://sepolia.arbiscan.io',
    dex: {
      uniV3Factory: '0x248AB79Bbb9bC29bB72f7Cd42F17e054Fc40188e',
      uniV3QuoterV2: '0x2779a0CC1c3e0E44D2542EC3e79e3864Ae93Ef0B',
      weth: '0x980B62Da83eFf3D4576C647993b0c1D7faf17c73',
    },
  },
  [CHAIN.BASE_SEPOLIA]: {
    chainId: '84532',
    vm: VM.EVM,
    lockerContract: '0xFD4fef1F43aFEc8b5bcdEEc47f35a1431479aC16',
    defaultRPC: [
      baseSepolia.rpcUrls.default.http[0],
      'https://sepolia.base.org',
      'https://base-sepolia-rpc.publicnode.com',
    ],
    confirmations: 1,
    fastConfirmations: 0,
    timeout: 30000,
    explorerUrl: 'https://sepolia.basescan.org',
    dex: {
      uniV3Factory: '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24',
      uniV3QuoterV2: '0xC5290058841028F1614F3A6F0F5816cAd0df5E27',
      weth: '0x4200000000000000000000000000000000000006',
    },
  },
  [CHAIN.BNB_TESTNET]: {
    chainId: '97',
    vm: VM.EVM,
    lockerContract: '0x44aFFC61983F4348DdddB886349eb992C061EaC0',
    gatewayVersion: 'v1',
    defaultRPC: [
      bscTestnet.rpcUrls.default.http[0],
      'https://bsc-testnet-rpc.publicnode.com',
      'https://data-seed-prebsc-1-s1.bnbchain.org:8545',
    ],
    confirmations: 1,
    fastConfirmations: 0,
    timeout: 30000,
    explorerUrl: 'https://testnet.bscscan.com',
  },

  // Solana
  [CHAIN.SOLANA_MAINNET]: {
    chainId: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    vm: VM.SVM,
    lockerContract: 'TBD',
    defaultRPC: [''],
    confirmations: 1,
    fastConfirmations: 0,
    timeout: 15000,
    explorerUrl: 'https://explorer.solana.com',
  },
  [CHAIN.SOLANA_TESTNET]: {
    chainId: '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z',
    vm: VM.SVM,
    lockerContract: '',
    defaultRPC: ['https://api.testnet.solana.com'],
    confirmations: 1,
    fastConfirmations: 0,
    timeout: 55000,
    explorerUrl: 'https://explorer.solana.com',
  },
  [CHAIN.SOLANA_DEVNET]: {
    chainId: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
    vm: VM.SVM,
    lockerContract: 'CFVSincHYbETh2k7w6u1ENEkjbSLtveRCEBupKidw2VS',
    defaultRPC: [
      'https://api.devnet.solana.com',
      'https://solana-devnet.g.alchemy.com/v2/demo',
    ],
    confirmations: 1,
    fastConfirmations: 0,
    timeout: 120000,
    explorerUrl: 'https://explorer.solana.com',
  },
};

/**
 * Extra required info regarding Push Chain
 */
export const PUSH_CHAIN_INFO: Record<
  CHAIN.PUSH_MAINNET | CHAIN.PUSH_TESTNET_DONUT | CHAIN.PUSH_LOCALNET,
  (typeof CHAIN_INFO)[CHAIN.PUSH_MAINNET] & {
    denom: string;
    tendermintRpc: string[];
    // Full-history (archive) Tendermint RPC, used as a fallback when the prune
    // `tendermintRpc` can't serve an older tx (e.g. `tx_search` for a leg
    // outside the prune window). Unset where there is no archive endpoint
    // (fallback becomes a no-op).
    archiveTendermintRpc?: string[];
    prefix: string;
    factoryAddress: `0x${string}`;
    pushDecimals: bigint;
    usdcDecimals: bigint;
    pushToUsdcNumerator: bigint;
    pushToUsdcDenominator: bigint;
  }
> = {
  [CHAIN.PUSH_MAINNET]: {
    ...CHAIN_INFO[CHAIN.PUSH_MAINNET],
    denom: 'upc',
    tendermintRpc: ['TBD'],
    prefix: 'push',
    factoryAddress: '0xTBD',
    pushDecimals: BigInt(1e18),
    usdcDecimals: BigInt(1e8),
    pushToUsdcNumerator: BigInt(1e7), // 0.1 USDC
    pushToUsdcDenominator: BigInt(1e18),
  },
  [CHAIN.PUSH_TESTNET_DONUT]: {
    ...CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT],
    denom: 'upc',
    tendermintRpc: ['https://donut.rpc.push.org/'],
    // Archive (full-history) Tendermint RPC — fallback for tracking older txs
    // whose legs fall outside the prune window.
    archiveTendermintRpc: ['https://archive.donut.rpc.push.org/'],
    prefix: 'push',
    factoryAddress: '0x00000000000000000000000000000000000000eA',
    pushDecimals: BigInt(1e18),
    usdcDecimals: BigInt(1e8),
    pushToUsdcNumerator: BigInt(1e7), // 0.1 USDC
    pushToUsdcDenominator: BigInt(1e18),
  },
  [CHAIN.PUSH_LOCALNET]: {
    ...CHAIN_INFO[CHAIN.PUSH_LOCALNET],
    denom: 'upc',
    tendermintRpc: ['http://localhost:26657'],
    prefix: 'push',
    factoryAddress: '0x00000000000000000000000000000000000000eA',
    pushDecimals: BigInt(1e18),
    usdcDecimals: BigInt(1e8),
    pushToUsdcNumerator: BigInt(1e7), // 0.1 USDC
    pushToUsdcDenominator: BigInt(1e18),
  },
};

// ============================================================================
// Push Chain viem definitions
// ============================================================================

// viem uses `chain.nativeCurrency.symbol` to format error messages
// (e.g. `value: 1 PC` in InsufficientFundsError). A PublicClient built
// without a chain falls back to "ETH".
export const PUSH_VIEM_CHAINS: Record<
  CHAIN.PUSH_MAINNET | CHAIN.PUSH_TESTNET_DONUT | CHAIN.PUSH_LOCALNET,
  Chain
> = {
  [CHAIN.PUSH_MAINNET]: defineChain({
    id: Number.isFinite(parseInt(CHAIN_INFO[CHAIN.PUSH_MAINNET].chainId))
      ? parseInt(CHAIN_INFO[CHAIN.PUSH_MAINNET].chainId)
      : 0,
    name: 'Push Mainnet',
    nativeCurrency: { name: 'PC', symbol: 'PC', decimals: 18 },
    rpcUrls: {
      default: { http: CHAIN_INFO[CHAIN.PUSH_MAINNET].defaultRPC },
    },
    blockExplorers: CHAIN_INFO[CHAIN.PUSH_MAINNET].explorerUrl
      ? {
          default: {
            name: 'Push Explorer',
            url: CHAIN_INFO[CHAIN.PUSH_MAINNET].explorerUrl as string,
          },
        }
      : undefined,
  }),
  [CHAIN.PUSH_TESTNET_DONUT]: defineChain({
    id: parseInt(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].chainId),
    name: 'Push Testnet Donut',
    nativeCurrency: { name: 'PC', symbol: 'PC', decimals: 18 },
    rpcUrls: {
      default: { http: CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC },
    },
    blockExplorers: {
      default: {
        name: 'Push Explorer',
        url: CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].explorerUrl as string,
      },
    },
  }),
  [CHAIN.PUSH_LOCALNET]: defineChain({
    id: parseInt(CHAIN_INFO[CHAIN.PUSH_LOCALNET].chainId),
    name: 'Push Localnet',
    nativeCurrency: { name: 'PC', symbol: 'PC', decimals: 18 },
    rpcUrls: {
      default: { http: CHAIN_INFO[CHAIN.PUSH_LOCALNET].defaultRPC },
    },
  }),
};

export function getPushViemChain(chain: CHAIN): Chain | undefined {
  return (PUSH_VIEM_CHAINS as Partial<Record<CHAIN, Chain>>)[chain];
}

// ============================================================================
// Multi-Chain Gateway & CEA Configuration
// ============================================================================

/**
 * UniversalGateway contract addresses on external chains
 * These are the contracts that handle inbound/outbound universal transactions
 */
export const UNIVERSAL_GATEWAY_ADDRESSES: Partial<Record<CHAIN, `0x${string}`>> = {
  [CHAIN.ETHEREUM_SEPOLIA]: '0x05bD7a3D18324c1F7e216f7fBF2b15985aE5281A',
  [CHAIN.BNB_TESTNET]: '0x44aFFC61983F4348DdddB886349eb992C061EaC0',
  // Arbitrum Sepolia and Base Sepolia use same as locker for now
  [CHAIN.ARBITRUM_SEPOLIA]: '0x2cd870e0166Ba458dEC615168Fd659AacD795f34',
  [CHAIN.BASE_SEPOLIA]: '0xFD4fef1F43aFEc8b5bcdEEc47f35a1431479aC16',
};

/**
 * Pyth price feed account for SVM gateway gas estimation
 */
export const SVM_PYTH_PRICE_FEED = '7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE';

/**
 * Vault contract addresses on external chains
 * Vaults hold locked assets for cross-chain operations
 */
export const VAULT_ADDRESSES: Partial<Record<CHAIN, `0x${string}`>> = {
  [CHAIN.ETHEREUM_SEPOLIA]: '0xD019Eb12D0d6eF8D299661f22B4B7d262eD4b965',
  [CHAIN.BNB_TESTNET]: '0xE52AC4f8DD3e0263bDF748F3390cdFA1f02be881',
  [CHAIN.ARBITRUM_SEPOLIA]: '0x233B1B1B378eb0Aa723097634025A47C4b73A8F7',
  [CHAIN.BASE_SEPOLIA]: '0xb4Ba4D5542D1dD48BD3589543660B265B41f16CB',
};

/**
 * CEAFactory contract addresses on external chains
 * Factories deploy and manage Chain Executor Accounts
 */
export const CEA_FACTORY_ADDRESSES: Partial<Record<CHAIN, `0x${string}`>> = {
  [CHAIN.ETHEREUM_SEPOLIA]: '0x5E191fbBe22F8866C5e4250557664fCE760e8870',
  [CHAIN.BNB_TESTNET]: '0x3f1B16e0B072d472951C4563d29d3da6a3EE3Ce8',
  [CHAIN.ARBITRUM_SEPOLIA]: '0x65572FFa81c230360a8a53C1682C7f0Ee321E5E7',
  [CHAIN.BASE_SEPOLIA]: '0x7e8CeeDA043ED1460540616103dD57581a66C856',
};

/**
 * Block explorer URLs for each chain
 * Used to generate transaction and address URLs
 */
export const CHAIN_EXPLORERS: Partial<Record<CHAIN, { testnet?: string[]; mainnet?: string[] }>> = {
  // Push Chain
  [CHAIN.PUSH_TESTNET_DONUT]: {
    testnet: ['https://donut.push.network'],
  },
  [CHAIN.PUSH_LOCALNET]: {
    testnet: ['http://localhost:3000'],
  },
  // Ethereum
  [CHAIN.ETHEREUM_MAINNET]: {
    mainnet: ['https://etherscan.io'],
  },
  [CHAIN.ETHEREUM_SEPOLIA]: {
    testnet: ['https://sepolia.etherscan.io'],
  },
  // Arbitrum
  [CHAIN.ARBITRUM_SEPOLIA]: {
    testnet: ['https://sepolia.arbiscan.io'],
  },
  // Base
  [CHAIN.BASE_SEPOLIA]: {
    testnet: ['https://sepolia.basescan.org'],
  },
  // BNB
  [CHAIN.BNB_TESTNET]: {
    testnet: ['https://testnet.bscscan.com'],
  },
  // Solana
  [CHAIN.SOLANA_DEVNET]: {
    testnet: ['https://explorer.solana.com'],
  },
  [CHAIN.SOLANA_TESTNET]: {
    testnet: ['https://explorer.solana.com'],
  },
  [CHAIN.SOLANA_MAINNET]: {
    mainnet: ['https://explorer.solana.com'],
  },
};

/**
 * Get the Solana cluster query param for a given chain
 */
function getSvmClusterParam(chain: CHAIN): string {
  if (chain === CHAIN.SOLANA_DEVNET) return '?cluster=devnet';
  if (chain === CHAIN.SOLANA_TESTNET) return '?cluster=testnet';
  return '';
}

/**
 * Get explorer URL for a transaction on a specific chain
 * @param txHash - Transaction hash
 * @param chain - Target chain
 * @param network - Network type (testnet/mainnet)
 * @returns Explorer URL
 */
export function getExplorerTxUrl(
  txHash: string,
  chain: CHAIN,
  network: 'testnet' | 'mainnet' = 'testnet'
): string | undefined {
  const explorers = CHAIN_EXPLORERS[chain];
  const urls = network === 'mainnet' ? explorers?.mainnet : explorers?.testnet;
  if (!urls?.length) return undefined;

  // Solana needs cluster query param appended after the path
  if (CHAIN_INFO[chain].vm === VM.SVM) {
    return `${urls[0]}/tx/${txHash}${getSvmClusterParam(chain)}`;
  }

  return `${urls[0]}/tx/${txHash}`;
}

/**
 * Get explorer URL for an address on a specific chain
 * @param address - Address to explore
 * @param chain - Target chain
 * @param network - Network type (testnet/mainnet)
 * @returns Explorer URL
 */
export function getExplorerAddressUrl(
  address: string,
  chain: CHAIN,
  network: 'testnet' | 'mainnet' = 'testnet'
): string | undefined {
  const explorers = CHAIN_EXPLORERS[chain];
  const urls = network === 'mainnet' ? explorers?.mainnet : explorers?.testnet;
  if (!urls?.length) return undefined;

  // Solana needs cluster query param appended after the path
  if (CHAIN_INFO[chain].vm === VM.SVM) {
    return `${urls[0]}/address/${address}${getSvmClusterParam(chain)}`;
  }

  return `${urls[0]}/address/${address}`;
}

import { CHAIN, PUSH_NETWORK, VM } from './enums';
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
 * Addresses for wrapped ETH/SOL/ARBITRUM assets by Push network.
 * Includes pETH and PUSDT bridged from origin on test networks.
 */
export const SYNTHETIC_PUSH_ERC20: Record<
  PUSH_NETWORK,
  {
    pETH: `0x${string}`;
    pETH_ARB: `0x${string}`;
    pETH_BASE: `0x${string}`;
    pETH_BNB: `0x${string}`;
    pSOL: `0x${string}`;
    USDT_ETH: `0x${string}`;
    USDC_ETH: `0x${string}`;
    USDT_ARB: `0x${string}`;
    USDC_ARB: `0x${string}`;
    USDT_SOL: `0x${string}`;
    USDC_SOL: `0x${string}`;
    USDT_BNB: `0x${string}`;
    USDT_BASE: `0x${string}`;
    USDC_BASE: `0x${string}`;
  }
> = {
  [PUSH_NETWORK.TESTNET_DONUT]: {
    pETH: '0x2971824Db68229D087931155C2b8bB820B275809',
    pETH_ARB: '0xc0a821a1AfEd1322c5e15f1F4586C0B8cE65400e',
    pETH_BASE: '0xc7007af2B24D4eb963fc9633B0c66e1d2D90Fc21',
    pETH_BNB: '0x7a9082dA308f3fa005beA7dB0d203b3b86664E36',
    pSOL: '0x5D525Df2bD99a6e7ec58b76aF2fd95F39874EBed',
    USDT_ETH: '0xCA0C5E6F002A389E1580F0DB7cd06e4549B5F9d3',
    USDC_ETH: '0x387b9C8Db60E74999aAAC5A2b7825b400F12d68E',
    USDT_ARB: '0x76Ad08339dF606BeEDe06f90e3FaF82c5b2fb2E9',
    USDC_ARB: '0xa261A10e94aE4bA88EE8c5845CbE7266bD679DD6',
    USDT_SOL: '0x4f1A3D22d170a2F4Bddb37845a962322e24f4e34',
    USDC_SOL: '0x04B8F634ABC7C879763F623e0f0550a4b5c4426F',
    USDT_BNB: '0x2f98B4235FD2BA0173a2B056D722879360B12E7b',
    USDT_BASE: '0x2C455189D2af6643B924A981a9080CcC63d5a567',
    USDC_BASE: '0x84B62e44F667F692F7739Ca6040cD17DA02068A8',
  },
  [PUSH_NETWORK.TESTNET]: {
    pETH: '0x2971824Db68229D087931155C2b8bB820B275809',
    pETH_ARB: '0xc0a821a1AfEd1322c5e15f1F4586C0B8cE65400e',
    pETH_BASE: '0xc7007af2B24D4eb963fc9633B0c66e1d2D90Fc21',
    pETH_BNB: '0x7a9082dA308f3fa005beA7dB0d203b3b86664E36',
    pSOL: '0x5D525Df2bD99a6e7ec58b76aF2fd95F39874EBed',
    USDT_ETH: '0xCA0C5E6F002A389E1580F0DB7cd06e4549B5F9d3',
    USDC_ETH: '0x387b9C8Db60E74999aAAC5A2b7825b400F12d68E',
    USDT_ARB: '0x76Ad08339dF606BeEDe06f90e3FaF82c5b2fb2E9',
    USDC_ARB: '0xa261A10e94aE4bA88EE8c5845CbE7266bD679DD6',
    USDT_SOL: '0x4f1A3D22d170a2F4Bddb37845a962322e24f4e34',
    USDC_SOL: '0x04B8F634ABC7C879763F623e0f0550a4b5c4426F',
    USDT_BNB: '0x2f98B4235FD2BA0173a2B056D722879360B12E7b',
    USDT_BASE: '0x2C455189D2af6643B924A981a9080CcC63d5a567',
    USDC_BASE: '0x84B62e44F667F692F7739Ca6040cD17DA02068A8',
  },
  [PUSH_NETWORK.LOCALNET]: {
    pETH: '0xTBD',
    pETH_ARB: '0xTBD',
    pETH_BASE: '0xTBD',
    pETH_BNB: '0xTBD',
    pSOL: '0xTBD',
    USDT_ETH: '0xTBD',
    USDC_ETH: '0xTBD',
    USDT_ARB: '0xTBD',
    USDC_ARB: '0xTBD',
    USDT_SOL: '0xTBD',
    USDC_SOL: '0xTBD',
    USDT_BNB: '0xTBD',
    USDT_BASE: '0xTBD',
    USDC_BASE: '0xTBD',
  },
  [PUSH_NETWORK.MAINNET]: {
    pETH: '0xTBD',
    pETH_ARB: '0xTBD',
    pETH_BASE: '0xTBD',
    pETH_BNB: '0xTBD',
    pSOL: '0xTBD',
    USDT_ETH: '0xTBD',
    USDC_ETH: '0xTBD',
    USDT_ARB: '0xTBD',
    USDC_ARB: '0xTBD',
    USDT_SOL: '0xTBD',
    USDC_SOL: '0xTBD',
    USDT_BNB: '0xTBD',
    USDT_BASE: '0xTBD',
    USDC_BASE: '0xTBD',
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
    confirmations: number; // Confirmations required to mark a tx as finalized
    fastConfirmations: number; // Confirmations for GAS tx types (0, 1) - typically 0 for fast mode
    timeout: number; // Wait timeout in ms for required confirmations : Ideal value = (confirmations + 1)* Avg Chain Block time
    explorerUrl?: string; // Block explorer base URL for transaction links
    dex?: {
      uniV3Factory?: `0x${string}`;
      uniV3QuoterV2?: `0x${string}`;
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
    confirmations: 1,
    fastConfirmations: 0,
    timeout: 30000,
    explorerUrl: 'https://explorer.donut.push.org',
    // Push Chain AMM - Uniswap V3
    dex: {
      uniV3Factory: '0x81b8Bca02580C7d6b636051FDb7baAC436bFb454',
      uniV3QuoterV2: '0x83316275f7C2F79BC4E26f089333e88E89093037',
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
      uniV3Factory: '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24',
      uniV3QuoterV2: '0xTBD',
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
      uniV3QuoterV2: '0xTBD',
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
    lockerContract: 'DJoFYDpgbTfxbXBv1QYhYGc9FK4J5FUKpYXAfSkHryXp',
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
// Multi-Chain Gateway & CEA Configuration
// ============================================================================

/**
 * UniversalGateway contract addresses on external chains
 * These are the contracts that handle inbound/outbound universal transactions
 */
export const UNIVERSAL_GATEWAY_ADDRESSES: Partial<Record<CHAIN, `0x${string}`>> = {
  [CHAIN.ETHEREUM_SEPOLIA]: '0x4DCab975cDe839632db6695e2e936A29ce3e325E',
  [CHAIN.BNB_TESTNET]: '0x44aFFC61983F4348DdddB886349eb992C061EaC0',
  // Arbitrum Sepolia and Base Sepolia use same as locker for now
  [CHAIN.ARBITRUM_SEPOLIA]: '0x2cd870e0166Ba458dEC615168Fd659AacD795f34',
  [CHAIN.BASE_SEPOLIA]: '0xFD4fef1F43aFEc8b5bcdEEc47f35a1431479aC16',
};

/**
 * Vault contract addresses on external chains
 * Vaults hold locked assets for cross-chain operations
 */
export const VAULT_ADDRESSES: Partial<Record<CHAIN, `0x${string}`>> = {
  [CHAIN.ETHEREUM_SEPOLIA]: '0xe8D77b8BC708aeA8E3735f686DcD33004a7Cd294',
  [CHAIN.BNB_TESTNET]: '0xE52AC4f8DD3e0263bDF748F3390cdFA1f02be881',
};

/**
 * CEAFactory contract addresses on external chains
 * Factories deploy and manage Chain Executor Accounts
 */
export const CEA_FACTORY_ADDRESSES: Partial<Record<CHAIN, `0x${string}`>> = {
  [CHAIN.ETHEREUM_SEPOLIA]: '0x8b9c9FfEc0507cf1BE9FCf3d91C8E1e98105D451',
  [CHAIN.BNB_TESTNET]: '0xe2182dae2dc11cBF6AA6c8B1a7f9c8315A6B0719',
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

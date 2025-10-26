import { CHAIN, PUSH_NETWORK, VM } from './enums';
import { mainnet, sepolia, arbitrumSepolia, baseSepolia } from 'viem/chains';

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
    pSOL: `0x${string}`;
    USDT_ETH: `0x${string}`;
    USDT_ARB: `0x${string}`;
    USDT_SOL: `0x${string}`;
  }
> = {
  [PUSH_NETWORK.TESTNET_DONUT]: {
    pETH: '0x2971824Db68229D087931155C2b8bB820B275809',
    pSOL: '0x5D525Df2bD99a6e7ec58b76aF2fd95F39874EBed',
    USDT_ETH: '0xCA0C5E6F002A389E1580F0DB7cd06e4549B5F9d3',
    USDT_ARB: '0x76Ad08339dF606BeEDe06f90e3FaF82c5b2fb2E9',
    USDT_SOL: '0x4f1A3D22d170a2F4Bddb37845a962322e24f4e34',
  },
  [PUSH_NETWORK.TESTNET]: {
    pETH: '0x2971824Db68229D087931155C2b8bB820B275809',
    pSOL: '0x5D525Df2bD99a6e7ec58b76aF2fd95F39874EBed',
    USDT_ETH: '0xCA0C5E6F002A389E1580F0DB7cd06e4549B5F9d3',
    USDT_ARB: '0x76Ad08339dF606BeEDe06f90e3FaF82c5b2fb2E9',
    USDT_SOL: '0x4f1A3D22d170a2F4Bddb37845a962322e24f4e34',
  },
  [PUSH_NETWORK.LOCALNET]: {
    pETH: '0xTBD',
    pSOL: '0xTBD',
    USDT_ETH: '0xTBD',
    USDT_ARB: '0xTBD',
    USDT_SOL: '0xTBD',
  },
  [PUSH_NETWORK.MAINNET]: {
    pETH: '0xTBD',
    pSOL: '0xTBD',
    USDT_ETH: '0xTBD',
    USDT_ARB: '0xTBD',
    USDT_SOL: '0xTBD',
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
    defaultRPC: string[];
    confirmations: number; // Confirmations required to mark a tx as finalized
    timeout: number; // Wait timeout in ms for required confirmations : Ideal value = (confirmations + 1)* Avg Chain Block time
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
    confirmations: 6,
    timeout: 30000,
  },
  [CHAIN.PUSH_TESTNET_DONUT]: {
    chainId: '42101',
    vm: VM.EVM,
    defaultRPC: [
      'https://evm.rpc-testnet-donut-node1.push.org/',
      'https://evm.rpc-testnet-donut-node2.push.org/',
    ],
    confirmations: 3,
    timeout: 30000,
  },
  [CHAIN.PUSH_LOCALNET]: {
    chainId: '9000',
    vm: VM.EVM,
    defaultRPC: ['http://localhost:8545'],
    confirmations: 3,
    timeout: 30000,
  },

  // Ethereum
  [CHAIN.ETHEREUM_MAINNET]: {
    chainId: '1',
    vm: VM.EVM,
    lockerContract: 'TBD',
    defaultRPC: [mainnet.rpcUrls.default.http[0]],
    confirmations: 6,
    timeout: 60000,
  },
  [CHAIN.ETHEREUM_SEPOLIA]: {
    chainId: '11155111',
    vm: VM.EVM,
    lockerContract: '0x05bD7a3D18324c1F7e216f7fBF2b15985aE5281A',
    defaultRPC: [sepolia.rpcUrls.default.http[0]],
    confirmations: 1,
    timeout: 30000,
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
    defaultRPC: [arbitrumSepolia.rpcUrls.default.http[0]],
    confirmations: 1,
    timeout: 30000,
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
    defaultRPC: [baseSepolia.rpcUrls.default.http[0]],
    confirmations: 1,
    timeout: 30000,
    dex: {
      uniV3Factory: '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24',
      uniV3QuoterV2: '0xTBD',
      weth: '0x4200000000000000000000000000000000000006',
    },
  },

  // Solana
  [CHAIN.SOLANA_MAINNET]: {
    chainId: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    vm: VM.SVM,
    lockerContract: 'TBD',
    defaultRPC: [''],
    confirmations: 6,
    timeout: 15000,
  },
  [CHAIN.SOLANA_TESTNET]: {
    chainId: '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z',
    vm: VM.SVM,
    lockerContract: '',
    defaultRPC: ['https://api.testnet.solana.com'],
    confirmations: 6,
    timeout: 55000,
  },
  [CHAIN.SOLANA_DEVNET]: {
    chainId: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
    vm: VM.SVM,
    lockerContract: 'CFVSincHYbETh2k7w6u1ENEkjbSLtveRCEBupKidw2VS',
    defaultRPC: ['https://api.devnet.solana.com'],
    confirmations: 1,
    timeout: 35000,
  },
};

/**
 * Extra required info regarding Push Chain
 */
export const PUSH_CHAIN_INFO: Record<
  CHAIN.PUSH_MAINNET | CHAIN.PUSH_TESTNET_DONUT | CHAIN.PUSH_LOCALNET,
  (typeof CHAIN_INFO)[CHAIN.PUSH_MAINNET] & {
    denom: string;
    tendermintRpc: string;
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
    tendermintRpc: 'TBD',
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
    tendermintRpc: 'https://rpc-testnet-donut-node1.push.org/',
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
    tendermintRpc: 'http://localhost:26657',
    prefix: 'push',
    factoryAddress: '0x00000000000000000000000000000000000000eA',
    pushDecimals: BigInt(1e18),
    usdcDecimals: BigInt(1e8),
    pushToUsdcNumerator: BigInt(1e7), // 0.1 USDC
    pushToUsdcDenominator: BigInt(1e18),
  },
};

import { CHAIN, PUSH_NETWORK, VM } from './enums';
import { mainnet, sepolia } from 'viem/chains';

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
  [PUSH_NETWORK.TESTNET_DONUT]: '0x2FE70447492307108Bdc7Ff6BaB33Ff37Dacc479', // TODO: CHANGE THIS
  [PUSH_NETWORK.TESTNET]: '0x2FE70447492307108Bdc7Ff6BaB33Ff37Dacc479', // TODO: CHANGE THIS
  [PUSH_NETWORK.LOCALNET]: '0x2FE70447492307108Bdc7Ff6BaB33Ff37Dacc479',
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
    lockerContract: '0x28E0F09bE2321c1420Dc60Ee146aACbD68B335Fe',
    defaultRPC: [sepolia.rpcUrls.default.http[0]],
    confirmations: 1,
    timeout: 30000,
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
    timeout: 15000,
  },
  [CHAIN.SOLANA_DEVNET]: {
    chainId: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
    vm: VM.SVM,
    lockerContract: '3zrWaMknHTRQpZSxY4BvQxw9TStSXiHcmcp3NMPTFkke',
    defaultRPC: ['https://api.devnet.solana.com'],
    confirmations: 1,
    timeout: 5000,
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

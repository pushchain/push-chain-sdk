import { CHAIN, VM } from './enums';

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
  }
> = {
  // Push
  [CHAIN.PUSH_MAINNET]: {
    chainId: 'TBD',
    vm: VM.EVM,
  },
  [CHAIN.PUSH_TESTNET]: {
    chainId: '9000',
    vm: VM.EVM,
  },

  // Ethereum
  [CHAIN.ETHEREUM_MAINNET]: {
    chainId: '1',
    vm: VM.EVM,
    lockerContract: 'TBD',
  },
  [CHAIN.ETHEREUM_SEPOLIA]: {
    chainId: '11155111',
    vm: VM.EVM,
    lockerContract: 'TBD',
  },

  // Solana
  [CHAIN.SOLANA_MAINNET]: {
    chainId: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    vm: VM.SVM,
    lockerContract: 'TBD',
  },
  [CHAIN.SOLANA_TESTNET]: {
    chainId: '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z',
    vm: VM.SVM,
    lockerContract: 'TBD',
  },
  [CHAIN.SOLANA_DEVNET]: {
    chainId: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
    vm: VM.SVM,
    lockerContract: 'TBD',
  },
};

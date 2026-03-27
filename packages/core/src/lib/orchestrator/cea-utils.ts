/**
 * CEA (Chain Executor Account) Utilities
 *
 * Functions for computing CEA addresses and interacting with CEAFactory contracts
 */

import { createPublicClient, http, type Chain } from 'viem';
import {
  sepolia,
  arbitrumSepolia,
  baseSepolia,
  bscTestnet,
} from 'viem/chains';
import { CHAIN, VM } from '../constants/enums';
import { CHAIN_INFO, CEA_FACTORY_ADDRESSES } from '../constants/chain';
import { CEA_FACTORY_EVM } from '../constants/abi';

/**
 * Map CHAIN enum to viem chain object
 */
const VIEM_CHAINS: Partial<Record<CHAIN, Chain>> = {
  [CHAIN.ETHEREUM_SEPOLIA]: sepolia,
  [CHAIN.ARBITRUM_SEPOLIA]: arbitrumSepolia,
  [CHAIN.BASE_SEPOLIA]: baseSepolia,
  [CHAIN.BNB_TESTNET]: bscTestnet,
};

/**
 * Get viem chain object for a CHAIN enum
 */
function getViemChain(chain: CHAIN): Chain {
  const viemChain = VIEM_CHAINS[chain];
  if (!viemChain) {
    throw new Error(`No viem chain mapping for ${chain}`);
  }
  return viemChain;
}

// ============================================================================
// CEA Address Computation
// ============================================================================

/**
 * Result of CEA address lookup
 */
export interface CEAAddressResult {
  /** CEA address (deployed or predicted) */
  cea: `0x${string}`;
  /** Whether the CEA has been deployed */
  isDeployed: boolean;
}

/**
 * Get CEA address for a UEA on a specific chain
 *
 * @param ueaAddress - UEA address on Push Chain
 * @param chain - Target external chain
 * @param rpcUrl - Optional custom RPC URL
 * @returns CEA address and deployment status
 * @throws Error if chain doesn't have CEAFactory
 */
export async function getCEAAddress(
  ueaAddress: `0x${string}`,
  chain: CHAIN,
  rpcUrl?: string
): Promise<CEAAddressResult> {
  const factoryAddress = CEA_FACTORY_ADDRESSES[chain];
  if (!factoryAddress) {
    throw new Error(`CEAFactory not available on chain ${chain}`);
  }

  const viemChain = getViemChain(chain);
  const client = createPublicClient({
    chain: viemChain,
    transport: http(rpcUrl),
  });

  const [cea, isDeployed] = await client.readContract({
    abi: CEA_FACTORY_EVM,
    address: factoryAddress,
    functionName: 'getCEAForPushAccount',
    args: [ueaAddress],
  });

  return { cea, isDeployed };
}

/**
 * Get Push Account (UEA) address for a CEA on a specific chain
 *
 * @param ceaAddress - CEA address on external chain
 * @param chain - External chain where CEA is deployed
 * @param rpcUrl - Optional custom RPC URL
 * @returns Push account address on Push Chain
 * @throws Error if chain doesn't have CEAFactory
 */
export async function getPushAccountForCEA(
  ceaAddress: `0x${string}`,
  chain: CHAIN,
  rpcUrl?: string
): Promise<`0x${string}`> {
  const factoryAddress = CEA_FACTORY_ADDRESSES[chain];
  if (!factoryAddress) {
    throw new Error(`CEAFactory not available on chain ${chain}`);
  }

  const viemChain = getViemChain(chain);
  const client = createPublicClient({
    chain: viemChain,
    transport: http(rpcUrl),
  });

  const uea = await client.readContract({
    abi: CEA_FACTORY_EVM,
    address: factoryAddress,
    functionName: 'getPushAccountForCEA',
    args: [ceaAddress],
  });

  return uea;
}

/**
 * Check if an address is a CEA on a specific chain
 *
 * @param address - Address to check
 * @param chain - External chain to check
 * @param rpcUrl - Optional custom RPC URL
 * @returns True if address is a CEA deployed by the factory
 * @throws Error if chain doesn't have CEAFactory
 */
export async function isCEA(
  address: `0x${string}`,
  chain: CHAIN,
  rpcUrl?: string
): Promise<boolean> {
  const factoryAddress = CEA_FACTORY_ADDRESSES[chain];
  if (!factoryAddress) {
    throw new Error(`CEAFactory not available on chain ${chain}`);
  }

  const viemChain = getViemChain(chain);
  const client = createPublicClient({
    chain: viemChain,
    transport: http(rpcUrl),
  });

  return client.readContract({
    abi: CEA_FACTORY_EVM,
    address: factoryAddress,
    functionName: 'isCEA',
    args: [address],
  });
}

/**
 * Check if a chain supports CEA operations (EVM only)
 *
 * @param chain - Chain to check
 * @returns True if CEAFactory is available
 */
export function chainSupportsCEA(chain: CHAIN): boolean {
  return CEA_FACTORY_ADDRESSES[chain] !== undefined;
}

/**
 * Check if a chain supports outbound operations (Route 2).
 * - For EVM chains: checks CEAFactory availability
 * - For SVM chains: always true (gateway-based, no CEA needed)
 *
 * @param chain - Chain to check
 * @returns True if outbound transactions are supported
 */
export function chainSupportsOutbound(chain: CHAIN): boolean {
  if (CHAIN_INFO[chain]?.vm === VM.SVM) {
    return true; // SVM uses gateway program, not CEA
  }
  return CEA_FACTORY_ADDRESSES[chain] !== undefined;
}

/**
 * Get CEAFactory address for a chain
 *
 * @param chain - Target chain
 * @returns CEAFactory address or undefined
 */
export function getCEAFactoryAddress(
  chain: CHAIN
): `0x${string}` | undefined {
  return CEA_FACTORY_ADDRESSES[chain];
}

// ============================================================================
// Multi-Chain CEA Lookup
// ============================================================================

/**
 * Result of multi-chain CEA lookup
 */
export interface MultiChainCEAResult {
  chain: CHAIN;
  cea: `0x${string}`;
  isDeployed: boolean;
  error?: string;
}

/**
 * Get CEA addresses for a UEA across all supported chains
 *
 * @param ueaAddress - UEA address on Push Chain
 * @param rpcUrls - Optional custom RPC URLs per chain
 * @returns Array of CEA addresses per chain
 */
export async function getAllCEAAddresses(
  ueaAddress: `0x${string}`,
  rpcUrls?: Partial<Record<CHAIN, string>>
): Promise<MultiChainCEAResult[]> {
  const chains = Object.keys(CEA_FACTORY_ADDRESSES) as CHAIN[];

  const results = await Promise.all(
    chains.map(async (chain) => {
      try {
        const { cea, isDeployed } = await getCEAAddress(
          ueaAddress,
          chain,
          rpcUrls?.[chain]
        );
        return { chain, cea, isDeployed };
      } catch (error) {
        return {
          chain,
          cea: '0x0000000000000000000000000000000000000000' as `0x${string}`,
          isDeployed: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    })
  );

  return results;
}

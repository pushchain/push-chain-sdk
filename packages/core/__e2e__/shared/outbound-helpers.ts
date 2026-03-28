/**
 * Shared helpers and constants for outbound E2E tests.
 *
 * Extracted from cea-to-eoa, cea-to-uea, eoa-to-cea, uea-to-cea to eliminate
 * duplication across the parameterised outbound test suites.
 */
import { createPublicClient, http, formatEther } from 'viem';
import { PushChain } from '../../src';
import { CHAIN } from '../../src/lib/constants/enums';
import { CHAIN_INFO } from '../../src/lib/constants/chain';
import { ERC20_EVM } from '../../src/lib/constants/abi/erc20.evm';
import type { MoveableToken } from '../../src/lib/constants/tokens';

// ---------------------------------------------------------------------------
// Common test addresses
// ---------------------------------------------------------------------------

export const TEST_TARGET =
  '0x1234567890123456789012345678901234567890' as `0x${string}`;
export const NATIVE_ADDRESS =
  '0x0000000000000000000000000000000000000000' as `0x${string}`;

// ---------------------------------------------------------------------------
// Counter ABI (payable — deployed identically on all external EVM chains)
// ---------------------------------------------------------------------------

export const COUNTER_ABI = [
  {
    type: 'function' as const,
    name: 'count' as const,
    inputs: [] as const,
    outputs: [{ name: '' as const, type: 'uint256' as const }] as const,
    stateMutability: 'view' as const,
  },
  {
    type: 'function' as const,
    name: 'increment' as const,
    inputs: [] as const,
    outputs: [] as const,
    stateMutability: 'payable' as const,
  },
] as const;

// ---------------------------------------------------------------------------
// CEA balance helpers (used by cea-to-eoa and cea-to-uea tests)
// ---------------------------------------------------------------------------

/**
 * Ensures CEA has at least `requiredAmount` of an ERC20 token on the external chain.
 * If balance is insufficient, funds CEA via Route 2 (UEA -> CEA) and waits for relay.
 */
export async function ensureCeaErc20Balance(opts: {
  pushClient: Awaited<ReturnType<typeof PushChain.initialize>>;
  ceaAddress: `0x${string}`;
  token: MoveableToken;
  requiredAmount: bigint;
  targetChain: CHAIN;
}): Promise<void> {
  const { pushClient, ceaAddress, token, requiredAmount, targetChain } = opts;

  const publicClient = createPublicClient({
    transport: http(CHAIN_INFO[targetChain].defaultRPC[0]),
  });
  const balance = (await publicClient.readContract({
    address: token.address as `0x${string}`,
    abi: ERC20_EVM,
    functionName: 'balanceOf',
    args: [ceaAddress],
  })) as bigint;

  console.log(
    `[ensureCeaBalance] CEA ${token.symbol} balance: ${balance.toString()}, required: ${requiredAmount.toString()}`
  );

  if (balance >= requiredAmount) {
    console.log(
      `[ensureCeaBalance] Sufficient ${token.symbol} balance, no funding needed.`
    );
    return;
  }

  const deficit = requiredAmount - balance;
  const fundAmount = deficit + requiredAmount; // fund extra buffer
  console.log(
    `[ensureCeaBalance] Insufficient ${token.symbol}. Funding CEA with ${fundAmount.toString()} via Route 2 (UEA -> CEA)...`
  );

  const tx = await pushClient.universal.sendTransaction({
    to: {
      address: ceaAddress,
      chain: targetChain,
    },
    funds: {
      amount: fundAmount,
      token,
    },
  });
  console.log(`[ensureCeaBalance] Funding TX hash: ${tx.hash}`);

  const receipt = await tx.wait();
  console.log(
    `[ensureCeaBalance] Funding complete. Status: ${receipt.status}, External TX: ${receipt.externalTxHash}`
  );

  if (receipt.status !== 1) {
    throw new Error(`CEA ERC20 funding failed with status ${receipt.status}`);
  }
}

/**
 * Ensures CEA has at least `requiredAmount` of native token on the external chain.
 * If balance is insufficient, funds CEA via Route 2 (UEA -> CEA) and waits for relay.
 */
export async function ensureCeaNativeBalance(opts: {
  pushClient: Awaited<ReturnType<typeof PushChain.initialize>>;
  ceaAddress: `0x${string}`;
  requiredAmount: bigint;
  targetChain: CHAIN;
}): Promise<void> {
  const { pushClient, ceaAddress, requiredAmount, targetChain } = opts;

  const publicClient = createPublicClient({
    transport: http(CHAIN_INFO[targetChain].defaultRPC[0]),
  });
  const balance = await publicClient.getBalance({ address: ceaAddress });

  console.log(
    `[ensureCeaBalance] CEA native balance: ${formatEther(balance)}, required: ${formatEther(requiredAmount)}`
  );

  if (balance >= requiredAmount) {
    console.log(
      `[ensureCeaBalance] Sufficient native balance, no funding needed.`
    );
    return;
  }

  const deficit = requiredAmount - balance;
  const fundAmount = deficit + requiredAmount; // fund extra buffer
  console.log(
    `[ensureCeaBalance] Insufficient native balance. Funding CEA with ${formatEther(fundAmount)} via Route 2 (UEA -> CEA)...`
  );

  const tx = await pushClient.universal.sendTransaction({
    to: {
      address: ceaAddress,
      chain: targetChain,
    },
    value: fundAmount,
  });
  console.log(`[ensureCeaBalance] Funding TX hash: ${tx.hash}`);

  const receipt = await tx.wait();
  console.log(
    `[ensureCeaBalance] Funding complete. Status: ${receipt.status}, External TX: ${receipt.externalTxHash}`
  );

  if (receipt.status !== 1) {
    throw new Error(`CEA native funding failed with status ${receipt.status}`);
  }
}

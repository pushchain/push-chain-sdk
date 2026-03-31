/**
 * Shared helpers and constants for outbound E2E tests.
 *
 * Extracted from cea-to-eoa, cea-to-uea, eoa-to-cea, uea-to-cea to eliminate
 * duplication across the parameterised outbound test suites.
 */
import {
  createPublicClient,
  http,
  formatEther,
  encodeAbiParameters,
  keccak256,
  toBytes,
} from 'viem';
import { PushChain } from '../../src';
import { CHAIN, PUSH_NETWORK, VM } from '../../src/lib/constants/enums';
import { CHAIN_INFO } from '../../src/lib/constants/chain';
import { ERC20_EVM } from '../../src/lib/constants/abi/erc20.evm';
import { UNIVERSAL_GATEWAY_PC } from '../../src/lib/constants/abi/universalGatewayPC.evm';
import { UNIVERSAL_CORE_EVM } from '../../src/lib/constants/abi/prc20.evm';
import { UEA_MULTICALL_SELECTOR } from '../../src/lib/constants/selectors';
import { PushClient } from '../../src/lib/push-client/push-client';
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

// ---------------------------------------------------------------------------
// UGPC Precompile address (Push Chain)
// ---------------------------------------------------------------------------

export const UGPC_PRECOMPILE =
  '0x00000000000000000000000000000000000000C1' as `0x${string}`;

// ---------------------------------------------------------------------------
// CEAFactory ABI (for CEA verification on external chains)
// ---------------------------------------------------------------------------

export const CEA_FACTORY_ABI = [
  {
    inputs: [{ name: 'pushAccount', type: 'address' }],
    name: 'getCEAForPushAccount',
    outputs: [
      { name: 'cea', type: 'address' },
      { name: 'isDeployed', type: 'bool' },
    ],
    stateMutability: 'view' as const,
    type: 'function' as const,
  },
  {
    inputs: [{ name: 'ceaAddress', type: 'address' }],
    name: 'getPushAccountForCEA',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view' as const,
    type: 'function' as const,
  },
] as const;

// ---------------------------------------------------------------------------
// Helper: Query gas fees for outbound via UGPC
// ---------------------------------------------------------------------------

export async function queryOutboundGasFees(
  pushPublicClient: ReturnType<typeof createPublicClient>,
  prc20Token: `0x${string}`,
  gasLimit = BigInt(0)
): Promise<{ gasFee: bigint; protocolFee: bigint; totalFee: bigint; nativeValueForGas: bigint }> {
  const universalCoreAddress = (await pushPublicClient.readContract({
    address: UGPC_PRECOMPILE,
    abi: UNIVERSAL_GATEWAY_PC,
    functionName: 'UNIVERSAL_CORE',
  })) as `0x${string}`;

  console.log(`[GasFees] UniversalCore address: ${universalCoreAddress}`);

  const result = (await pushPublicClient.readContract({
    address: universalCoreAddress,
    abi: UNIVERSAL_CORE_EVM,
    functionName: 'getOutboundTxGasAndFees',
    args: [prc20Token, gasLimit],
  })) as [string, bigint, bigint, bigint, string];

  const gasFee = result[1];
  const protocolFee = result[2];
  const totalFee = gasFee + protocolFee;
  const nativeValueForGas = protocolFee + gasFee * BigInt(1000);

  console.log(
    `[GasFees] gasFee: ${gasFee}, protocolFee: ${protocolFee}, totalFee: ${totalFee}, nativeValueForGas: ${nativeValueForGas}`
  );

  return { gasFee, protocolFee, totalFee, nativeValueForGas };
}

// ---------------------------------------------------------------------------
// Helper: Build multicall payload for outbound (wraps calls in UEA_MULTICALL_SELECTOR)
// ---------------------------------------------------------------------------

export function buildOutboundMulticallPayload(
  calls: Array<{ to: `0x${string}`; value: bigint; data: `0x${string}` }>
): `0x${string}` {
  const multicallEncoded = encodeAbiParameters(
    [
      {
        type: 'tuple[]',
        components: [
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'data', type: 'bytes' },
        ],
      },
    ],
    [calls]
  );
  return `${UEA_MULTICALL_SELECTOR}${multicallEncoded.slice(2)}` as `0x${string}`;
}

// ---------------------------------------------------------------------------
// Helper: Wait for outbound relay and return external chain details
// ---------------------------------------------------------------------------

const OUTBOUND_INITIAL_WAIT_MS = 30000;
const OUTBOUND_POLL_INTERVAL_MS = 5000;
const OUTBOUND_TIMEOUT_MS = 180000;

export async function waitForOutboundRelay(
  pushChainTxHash: string,
  pushNetwork: PUSH_NETWORK
): Promise<{ externalTxHash: string; externalChain: CHAIN; explorerUrl: string }> {
  const pushChainEnum =
    pushNetwork === PUSH_NETWORK.MAINNET ? CHAIN.PUSH_MAINNET : CHAIN.PUSH_TESTNET_DONUT;
  const pushChainId = CHAIN_INFO[pushChainEnum].chainId;

  const universalTxId = keccak256(toBytes(`eip155:${pushChainId}:${pushChainTxHash}`));
  const queryId = universalTxId.startsWith('0x') ? universalTxId.slice(2) : universalTxId;

  const client = new PushClient({
    rpcUrls: CHAIN_INFO[pushChainEnum].defaultRPC,
    network: pushNetwork,
  });

  console.log(`[waitForOutboundRelay] txHash: ${pushChainTxHash}, universalTxId: ${universalTxId}`);
  console.log(`[waitForOutboundRelay] Initial wait ${OUTBOUND_INITIAL_WAIT_MS}ms...`);
  await new Promise((r) => setTimeout(r, OUTBOUND_INITIAL_WAIT_MS));

  // Try extracting utx_id from cosmos events
  let resolvedQueryId = queryId;
  try {
    const cosmosTx = await client.getCosmosTx(pushChainTxHash);
    if (cosmosTx?.events) {
      for (const event of cosmosTx.events) {
        if (event.type === 'outbound_created') {
          const utxIdAttr = event.attributes?.find(
            (attr: { key: string; value?: string }) => attr.key === 'utx_id'
          );
          if (utxIdAttr?.value) {
            resolvedQueryId = utxIdAttr.value.startsWith('0x')
              ? utxIdAttr.value.slice(2)
              : utxIdAttr.value;
            console.log(`[waitForOutboundRelay] Resolved utx_id from cosmos event: ${resolvedQueryId}`);
            break;
          }
        }
      }
    }
  } catch (err) {
    console.log(`[waitForOutboundRelay] Could not extract utx_id from cosmos events: ${err}`);
  }

  // Build namespace → CHAIN map for matching
  const namespaceToChain = new Map<string, CHAIN>();
  for (const [chainKey, info] of Object.entries(CHAIN_INFO)) {
    const ns = info.vm === VM.EVM ? 'eip155' : 'solana';
    namespaceToChain.set(`${ns}:${info.chainId}`, chainKey as CHAIN);
  }

  const startTime = Date.now();
  let pollCount = 0;

  while (Date.now() - startTime < OUTBOUND_TIMEOUT_MS) {
    pollCount++;
    try {
      const utxResponse = await client.getUniversalTxByIdV2(resolvedQueryId);
      const outbounds = utxResponse?.universalTx?.outboundTx || [];

      for (const ob of outbounds) {
        if (ob.observedTx?.txHash) {
          const chain = namespaceToChain.get(ob.destinationChain);
          if (chain) {
            const explorerBase = CHAIN_INFO[chain]?.explorerUrl;
            const explorerUrl = explorerBase ? `${explorerBase}/tx/${ob.observedTx.txHash}` : '';

            console.log(
              `[waitForOutboundRelay] FOUND on poll #${pollCount} | externalTxHash: ${ob.observedTx.txHash} | chain: ${chain}`
            );
            return { externalTxHash: ob.observedTx.txHash, externalChain: chain, explorerUrl };
          }
        }
      }
    } catch (err) {
      console.log(`[waitForOutboundRelay] Poll #${pollCount} error: ${err}`);
    }

    await new Promise((r) => setTimeout(r, OUTBOUND_POLL_INTERVAL_MS));
  }

  throw new Error(
    `[waitForOutboundRelay] Timeout after ${OUTBOUND_TIMEOUT_MS}ms. Push Chain TX: ${pushChainTxHash}`
  );
}

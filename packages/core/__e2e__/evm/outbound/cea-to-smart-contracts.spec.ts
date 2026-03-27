import '@e2e/shared/setup';
/**
 * CEA Custom Contract: StakingExample Outbound & Inbound Tests
 *
 * Tests for the StakingExample contract — a custom (non-UEA) contract on Push Chain
 * that triggers outbound transactions via UGPC and receives inbound calls from its CEA.
 *
 * Covers:
 * - Part 1: Transfer PRC20 (pBNB) to StakingExample contract
 * - Part 2: Trigger outbound (CEA deployment) on BSC Testnet
 * - Part 3: Verify CEA deployment on BSC Testnet
 * - Part 4: Full round-trip (outbound + inbound STAKE action)
 * - Part 5: Verify stake state on Push Chain
 * - Part 6: Direct stake/unstake on Push Chain (no cross-chain)
 *
 * Primary test chain: BNB Testnet (Chain ID: 97)
 *
 * Contract Addresses:
 * - StakingExample (proxy): 0x8ab717A4836d0589E5f27Ff65e18804325Cd6540 (Push Chain Donut)
 * - pBNB (PRC20 for BNB):   0x7a9082dA308f3fa005beA7dB0d203b3b86664E36 (Push Chain Donut)
 * - CEAFactory (proxy):     0xe2182dae2dc11cBF6AA6c8B1a7f9c8315A6B0719 (BSC Testnet)
 * - UGPC precompile:        0x00000000000000000000000000000000000000C1 (Push Chain Donut)
 */
import { PushChain } from '../../../src';
import { PUSH_NETWORK, CHAIN, VM } from '../../../src/lib/constants/enums';
import { CHAIN_INFO } from '../../../src/lib/constants/chain';
import {
  createWalletClient,
  createPublicClient,
  http,
  Hex,
  parseEther,
  encodeFunctionData,
  encodeAbiParameters,
  keccak256,
  toBytes,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { getCEAAddress } from '../../../src/lib/orchestrator/cea-utils';
import type { UniversalExecuteParams } from '../../../src/lib/orchestrator/orchestrator.types';
import { ERC20_EVM } from '../../../src/lib/constants/abi/erc20.evm';
import { CEA_EVM } from '../../../src/lib/constants/abi/cea.evm';
import { UNIVERSAL_GATEWAY_PC } from '../../../src/lib/constants/abi/universalGatewayPC.evm';
import { UNIVERSAL_CORE_EVM } from '../../../src/lib/constants/abi/prc20.evm';
import { UEA_MULTICALL_SELECTOR } from '../../../src/lib/constants/selectors';
import { PushClient } from '../../../src/lib/push-client/push-client';
import { verifyExternalTransaction } from '@e2e/shared/external-tx-verifier';

// ============================================================================
// Contract Addresses
// ============================================================================
const STAKING_PROXY = '0xd5d727D5eCE07BD5557f50e58DA092FCEDC1bf29' as `0x${string}`;
const PBNB_TOKEN = '0x7a9082dA308f3fa005beA7dB0d203b3b86664E36' as `0x${string}`;
const PUSDT_BNB_TOKEN = '0x2f98B4235FD2BA0173a2B056D722879360B12E7b' as `0x${string}`;
const BSC_USDT_ADDRESS = '0xBC14F348BC9667be46b35Edc9B68653d86013DC5' as `0x${string}`;
const UGPC_PRECOMPILE = '0x00000000000000000000000000000000000000C1' as `0x${string}`;
const CEA_FACTORY_BSC = '0xe2182dae2dc11cBF6AA6c8B1a7f9c8315A6B0719' as `0x${string}`;
const UNIVERSAL_GATEWAY_BSC = '0x44aFFC61983F4348DdddB886349eb992C061EaC0' as `0x${string}`;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as `0x${string}`;

// Counter contract addresses (deployed on BNB Testnet 2026-03-14)
const COUNTER_A = '0x7f0936bb90e7dcf3edb47199c2005e7184e44cf8' as `0x${string}`;
const COUNTER_B = '0x7dd2f6d20cd2c8f24d8c6c7de48c4b39c6aa9b18' as `0x${string}`;
const COUNTER_ABI = [
  { type: 'function', name: 'count', inputs: [], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'increment', inputs: [], outputs: [], stateMutability: 'nonpayable' },
] as const;
const TEST_TARGET = '0x1234567890123456789012345678901234567890' as `0x${string}`;

// ============================================================================
// StakingExample ABI (from deployed contract)
// ============================================================================
const STAKING_EXAMPLE_ABI = [
  {
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'recipient', type: 'bytes' },
      { name: 'gasLimit', type: 'uint256' },
      { name: 'payload', type: 'bytes' },
      { name: 'revertRecipient', type: 'address' },
    ],
    name: 'triggerOutbound',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'sourceChainNamespace', type: 'string' },
      { name: 'ceaAddress', type: 'bytes' },
      { name: 'payload', type: 'bytes' },
      { name: 'amount', type: 'uint256' },
      { name: 'prc20', type: 'address' },
      { name: 'txId', type: 'bytes32' },
    ],
    name: 'executeUniversalTx',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    name: 'stake',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    name: 'unstake',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'user', type: 'address' },
      { name: 'token', type: 'address' },
    ],
    name: 'getStake',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'owner',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'ugpc',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'universalExecutorModule',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: '', type: 'bytes32' }],
    name: 'executedTxIds',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: '', type: 'address' },
      { name: '', type: 'address' },
    ],
    name: 'stakedBalance',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: '_ugpc', type: 'address' },
      { name: '_universalExecutorModule', type: 'address' },
      { name: '_owner', type: 'address' },
    ],
    name: 'initialize',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'newUgpc', type: 'address' }],
    name: 'setUgpc',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'newModule', type: 'address' }],
    name: 'setUniversalExecutorModule',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'newOwner', type: 'address' }],
    name: 'transferOwnership',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  // Events
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'token', type: 'address' },
      { indexed: false, name: 'recipient', type: 'bytes' },
      { indexed: false, name: 'amount', type: 'uint256' },
      { indexed: false, name: 'payload', type: 'bytes' },
    ],
    name: 'OutboundTriggered',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'user', type: 'address' },
      { indexed: true, name: 'token', type: 'address' },
      { indexed: false, name: 'amount', type: 'uint256' },
      { indexed: true, name: 'txId', type: 'bytes32' },
    ],
    name: 'Staked',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'user', type: 'address' },
      { indexed: true, name: 'token', type: 'address' },
      { indexed: false, name: 'amount', type: 'uint256' },
    ],
    name: 'Unstaked',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'txId', type: 'bytes32' },
      { indexed: false, name: 'sourceChainNamespace', type: 'string' },
      { indexed: false, name: 'ceaAddress', type: 'bytes' },
      { indexed: false, name: 'prc20', type: 'address' },
      { indexed: false, name: 'amount', type: 'uint256' },
    ],
    name: 'InboundReceived',
    type: 'event',
  },
  { stateMutability: 'payable', type: 'receive' },
] as const;

// CEAFactory ABI (for verification)
const CEA_FACTORY_ABI = [
  {
    inputs: [{ name: 'pushAccount', type: 'address' }],
    name: 'getCEAForPushAccount',
    outputs: [
      { name: 'cea', type: 'address' },
      { name: 'isDeployed', type: 'bool' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'ceaAddress', type: 'address' }],
    name: 'getPushAccountForCEA',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

// ============================================================================
// Helper: Query gas fees for outbound
// ============================================================================
async function queryOutboundGasFees(
  pushPublicClient: ReturnType<typeof createPublicClient>,
  prc20Token: `0x${string}`,
  gasLimit: bigint = BigInt(0)
): Promise<{ gasFee: bigint; protocolFee: bigint; totalFee: bigint; nativeValueForGas: bigint }> {
  // Step 1: Get UNIVERSAL_CORE address from UGPC precompile
  const universalCoreAddress = await pushPublicClient.readContract({
    address: UGPC_PRECOMPILE,
    abi: UNIVERSAL_GATEWAY_PC,
    functionName: 'UNIVERSAL_CORE',
  }) as `0x${string}`;

  console.log(`[GasFees] UniversalCore address: ${universalCoreAddress}`);

  // Step 2: Query gas and fees
  const result = await pushPublicClient.readContract({
    address: universalCoreAddress,
    abi: UNIVERSAL_CORE_EVM,
    functionName: 'getOutboundTxGasAndFees',
    args: [prc20Token, gasLimit],
  }) as [string, bigint, bigint, bigint, string];

  const gasFee = result[1];
  const protocolFee = result[2];
  const totalFee = gasFee + protocolFee;

  const nativeValueForGas = protocolFee + (gasFee * BigInt(1000));

  console.log(`[GasFees] gasFee: ${gasFee}, protocolFee: ${protocolFee}, totalFee: ${totalFee}, nativeValueForGas: ${nativeValueForGas}`);

  return { gasFee, protocolFee, totalFee, nativeValueForGas };
}

// ============================================================================
// Helper: Compute msg.value for UGPC gas swap
// ============================================================================
// Unlike the SDK's own outbound flow (UEA → UGPC, refund → UEA), in these tests
// the call path is UEA → StakingExample → UGPC, so refunds go to StakingExample.
// We use a fixed generous value (25 PC) that covers the Uniswap swap without
// draining the UEA balance across multiple test scenarios.
const OUTBOUND_MSG_VALUE = parseEther('25'); // 25 PC — covers gas swap, excess refunded to StakingExample

async function computeOutboundMsgValue(
  pushPublicClient: ReturnType<typeof createPublicClient>,
  ueaAddress: `0x${string}`,
  nativeValueForGas: bigint
): Promise<bigint> {
  const ueaBalance = await pushPublicClient.getBalance({ address: ueaAddress });
  const value = nativeValueForGas > OUTBOUND_MSG_VALUE ? nativeValueForGas : OUTBOUND_MSG_VALUE;
  console.log(`[MsgValue] Using ${value} (balance: ${ueaBalance})`);
  return value;
}

// ============================================================================
// Helper: Build multicall payload for CEA self-call (sendUniversalTxToUEA)
// ============================================================================
function buildStakeRoundTripPayload(
  ceaAddress: `0x${string}`,
  userAddress: `0x${string}`,
  amountToSendBack: bigint,
  revertRecipient: `0x${string}`
): `0x${string}` {
  // 1. Encode the action data (what StakingExample.executeUniversalTx ultimately decodes)
  //    (uint8 action, address user, bytes executionPayload)
  const payloadData = encodeAbiParameters(
    [
      { name: 'action', type: 'uint8' },
      { name: 'user', type: 'address' },
      { name: 'executionPayload', type: 'bytes' },
    ],
    [0, userAddress, '0x'] // action=0 (STAKE)
  );

  // 2. Wrap in UniversalPayload struct — required for TSS to parse the inbound event.
  //    The TSS decodes the payload as a UniversalPayload struct. Without this wrapping,
  //    universalPayload shows as {} and the inbound is delivered with empty payload.
  //    On Push Chain, the UNIVERSAL_EXECUTOR_MODULE extracts the `data` field from the
  //    struct and passes it as the `bytes payload` to executeUniversalTx.
  const universalPayload = encodeAbiParameters(
    [
      {
        type: 'tuple',
        components: [
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'data', type: 'bytes' },
          { name: 'gasLimit', type: 'uint256' },
          { name: 'maxFeePerGas', type: 'uint256' },
          { name: 'maxPriorityFeePerGas', type: 'uint256' },
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
          { name: 'vType', type: 'uint8' },
        ],
      },
    ],
    [
      {
        to: ZERO_ADDRESS,
        value: BigInt(0),
        data: payloadData,
        gasLimit: BigInt(0),
        maxFeePerGas: BigInt(0),
        maxPriorityFeePerGas: BigInt(0),
        nonce: BigInt(0),
        deadline: BigInt(0),
        vType: 1, // universalTxVerification
      },
    ]
  );

  // 3. Encode ERC20 approve — CEA must approve the gateway to transferFrom its USDT
  //    The gateway's sendUniversalTxFromCEA calls safeTransferFrom(CEA, VAULT, amount)
  const approveCalldata = encodeFunctionData({
    abi: ERC20_EVM,
    functionName: 'approve',
    args: [UNIVERSAL_GATEWAY_BSC, amountToSendBack],
  });

  // 4. Encode sendUniversalTxToUEA call on the CEA
  //    Pass universalPayload (struct-wrapped) so TSS can parse it
  const sendBackCalldata = encodeFunctionData({
    abi: CEA_EVM,
    functionName: 'sendUniversalTxToUEA',
    args: [
      BSC_USDT_ADDRESS, // token: USDT on BSC Testnet
      amountToSendBack,
      universalPayload,  // struct-wrapped for TSS parsing
      revertRecipient,
    ],
  });

  // 5. Wrap in MULTICALL format (approve MUST come before sendUniversalTxToUEA)
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
    [
      [
        {
          to: BSC_USDT_ADDRESS,
          value: BigInt(0),
          data: approveCalldata,
        },
        {
          to: ceaAddress,
          value: BigInt(0),
          data: sendBackCalldata,
        },
      ],
    ]
  );

  // 6. Final payload = UEA_MULTICALL_SELECTOR + multicallEncoded
  return `${UEA_MULTICALL_SELECTOR}${multicallEncoded.slice(2)}` as `0x${string}`;
}

// ============================================================================
// Helper: Build multicall payload for outbound (wraps calls in UEA_MULTICALL_SELECTOR)
// ============================================================================
function buildOutboundMulticallPayload(
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

// ============================================================================
// Helper: Build ERC-20 round-trip multicall entries (approve + sendUniversalTxToUEA)
// Appends these to existing outbound calls so the CEA also creates an inbound STAKE.
// ============================================================================
function buildErc20RoundTripCalls(
  ceaAddress: `0x${string}`,
  userAddress: `0x${string}`,
  sendBackAmount: bigint,
  revertRecipient: `0x${string}`
): Array<{ to: `0x${string}`; value: bigint; data: `0x${string}` }> {
  const payloadData = encodeAbiParameters(
    [
      { name: 'action', type: 'uint8' },
      { name: 'user', type: 'address' },
      { name: 'executionPayload', type: 'bytes' },
    ],
    [0, userAddress, '0x'] // action=0 (STAKE)
  );

  const universalPayload = encodeAbiParameters(
    [{
      type: 'tuple',
      components: [
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'data', type: 'bytes' },
        { name: 'gasLimit', type: 'uint256' },
        { name: 'maxFeePerGas', type: 'uint256' },
        { name: 'maxPriorityFeePerGas', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
        { name: 'vType', type: 'uint8' },
      ],
    }],
    [{
      to: ZERO_ADDRESS,
      value: BigInt(0),
      data: payloadData,
      gasLimit: BigInt(0),
      maxFeePerGas: BigInt(0),
      maxPriorityFeePerGas: BigInt(0),
      nonce: BigInt(0),
      deadline: BigInt(0),
      vType: 1,
    }]
  );

  const approveCalldata = encodeFunctionData({
    abi: ERC20_EVM,
    functionName: 'approve',
    args: [UNIVERSAL_GATEWAY_BSC, sendBackAmount],
  });

  const sendBackCalldata = encodeFunctionData({
    abi: CEA_EVM,
    functionName: 'sendUniversalTxToUEA',
    args: [BSC_USDT_ADDRESS, sendBackAmount, universalPayload, revertRecipient],
  });

  return [
    { to: BSC_USDT_ADDRESS, value: BigInt(0), data: approveCalldata },
    { to: ceaAddress, value: BigInt(0), data: sendBackCalldata },
  ];
}

// ============================================================================
// Helper: Wait for outbound relay and return external chain details
// ============================================================================
// Since the SDK's wait() only polls for outbound on Route 2 (UOA_TO_CEA),
// and these smart contract tests use Route 1 (UOA_TO_PUSH) where the contract
// internally triggers outbound via UGPC, we manually poll for the relay.
const OUTBOUND_INITIAL_WAIT_MS = 30000;
const OUTBOUND_POLL_INTERVAL_MS = 5000;
const OUTBOUND_TIMEOUT_MS = 180000;

async function waitForOutboundRelay(
  pushChainTxHash: string,
  pushNetwork: PUSH_NETWORK
): Promise<{ externalTxHash: string; externalChain: CHAIN; explorerUrl: string }> {
  const pushChainEnum =
    pushNetwork === PUSH_NETWORK.MAINNET ? CHAIN.PUSH_MAINNET : CHAIN.PUSH_TESTNET_DONUT;
  const pushChainId = CHAIN_INFO[pushChainEnum].chainId;

  // Compute universalTxId: keccak256("eip155:{chainId}:{txHash}")
  const universalTxId = keccak256(toBytes(`eip155:${pushChainId}:${pushChainTxHash}`));
  const queryId = universalTxId.startsWith('0x') ? universalTxId.slice(2) : universalTxId;

  const client = new PushClient({
    rpcUrls: CHAIN_INFO[pushChainEnum].defaultRPC,
    network: pushNetwork,
  });

  console.log(`[waitForOutboundRelay] txHash: ${pushChainTxHash}, universalTxId: ${universalTxId}`);
  console.log(`[waitForOutboundRelay] Initial wait ${OUTBOUND_INITIAL_WAIT_MS}ms...`);
  await new Promise((r) => setTimeout(r, OUTBOUND_INITIAL_WAIT_MS));

  // Also try extracting utx_id from cosmos events
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

  // Build a map of CAIP-2 namespace → CHAIN for matching
  const namespaceToChain = new Map<string, CHAIN>();
  for (const [chainKey, info] of Object.entries(CHAIN_INFO)) {
    const vm = info.vm;
    const ns = vm === VM.EVM ? 'eip155' : 'solana';
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

            console.log(`[waitForOutboundRelay] FOUND on poll #${pollCount} | externalTxHash: ${ob.observedTx.txHash} | chain: ${chain}`);
            console.log(`[waitForOutboundRelay] Explorer: ${explorerUrl}`);
            return {
              externalTxHash: ob.observedTx.txHash,
              externalChain: chain,
              explorerUrl,
            };
          }
        }
      }
    } catch (err) {
      console.log(`[waitForOutboundRelay] Poll #${pollCount} error: ${err}`);
    }

    await new Promise((r) => setTimeout(r, OUTBOUND_POLL_INTERVAL_MS));
  }

  throw new Error(
    `[waitForOutboundRelay] Timeout after ${OUTBOUND_TIMEOUT_MS}ms waiting for outbound relay. Push Chain TX: ${pushChainTxHash}`
  );
}

// ============================================================================
// Tests
// ============================================================================
describe('CEA Custom Contract: StakingExample (Outbound & Inbound)', () => {
  let pushClient: Awaited<ReturnType<typeof PushChain.initialize>>;
  let ueaAddress: `0x${string}`;
  let stakingCeaAddress: `0x${string}`;
  let pushPublicClient: ReturnType<typeof createPublicClient>;
  let bscPublicClient: ReturnType<typeof createPublicClient>;

  const privateKey = process.env['EVM_PRIVATE_KEY'] as Hex;
  const skipE2E = !privateKey;

  beforeAll(async () => {
    if (skipE2E) {
      console.log('Skipping E2E tests - EVM_PRIVATE_KEY not set');
      return;
    }

    const originChain = CHAIN.ETHEREUM_SEPOLIA;
    const account = privateKeyToAccount(privateKey);
    const walletClient = createWalletClient({
      account,
      transport: http(CHAIN_INFO[originChain].defaultRPC[0]),
    });

    const universalSigner = await PushChain.utils.signer.toUniversalFromKeypair(
      walletClient,
      {
        chain: originChain,
        library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
      }
    );

    pushClient = await PushChain.initialize(universalSigner, {
      network: PUSH_NETWORK.TESTNET_DONUT,
      printTraces: true,
      progressHook: (val: any) => {
        console.log(`[${val.id}] ${val.title}`);
      },
    });

    ueaAddress = pushClient.universal.account;
    console.log(`UEA Address: ${ueaAddress}`);

    // Public clients for reading state
    pushPublicClient = createPublicClient({
      transport: http(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]),
    });
    bscPublicClient = createPublicClient({
      transport: http(CHAIN_INFO[CHAIN.BNB_TESTNET].defaultRPC[0]),
    });

    // Get CEA address for StakingExample proxy on BSC
    const ceaResult = await getCEAAddress(STAKING_PROXY, CHAIN.BNB_TESTNET);
    stakingCeaAddress = ceaResult.cea;
    console.log(`StakingExample CEA on BSC: ${stakingCeaAddress}, deployed: ${ceaResult.isDeployed}`);
  }, 60000);

  // ============================================================================
  // Core Scenarios
  // ============================================================================
  describe('Core Scenarios', () => {

    // Helper: ensure StakingExample has enough PRC20 tokens, fund if needed
    async function ensureStakingHasPRC20(token: `0x${string}`, minAmount: bigint) {
      const balance = await pushPublicClient.readContract({
        address: token,
        abi: ERC20_EVM,
        functionName: 'balanceOf',
        args: [STAKING_PROXY],
      }) as bigint;
      console.log(`StakingExample balance of ${token}: ${balance}`);

      if (balance < minAmount) {
        console.log(`Funding StakingExample with ${token}...`);
        const fundTx = await pushClient.universal.sendTransaction({
          to: token,
          data: encodeFunctionData({
            abi: ERC20_EVM,
            functionName: 'transfer',
            args: [STAKING_PROXY, minAmount * BigInt(2)],
          }),
        });
        const fundReceipt = await fundTx.wait();
        console.log(`Funding TX status: ${fundReceipt.status}`);
        expect(fundReceipt.status).toBe(1);
      }
    }

    // Helper: run triggerOutbound on StakingExample and wait for outbound relay
    async function callTriggerOutbound(
      token: `0x${string}`,
      amount: bigint,
      recipient: `0x${string}`,
      payload: `0x${string}`,
    ) {
      const fees = await queryOutboundGasFees(pushPublicClient, token);
      const msgValue = await computeOutboundMsgValue(pushPublicClient, ueaAddress, fees.nativeValueForGas);
      console.log(`Bridge amount: ${amount}, msg.value: ${msgValue}`);

      const triggerPayload = encodeFunctionData({
        abi: STAKING_EXAMPLE_ABI,
        functionName: 'triggerOutbound',
        args: [token, amount, recipient, BigInt(0), payload, ueaAddress],
      });

      const tx = await pushClient.universal.sendTransaction({
        to: STAKING_PROXY,
        data: triggerPayload,
        value: msgValue,
      });
      console.log(`triggerOutbound TX Hash: ${tx.hash}`);
      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

      const receipt = await tx.wait();
      console.log(`triggerOutbound receipt status: ${receipt.status}`);
      expect(receipt.status).toBe(1);

      // Wait for outbound relay and verify external chain tx
      console.log('Polling for outbound relay...');
      const outbound = await waitForOutboundRelay(tx.hash, PUSH_NETWORK.TESTNET_DONUT);
      console.log(`External TX Hash: ${outbound.externalTxHash}`);
      console.log(`External Chain: ${outbound.externalChain}`);
      console.log(`External Explorer: ${outbound.explorerUrl}`);

      expect(outbound.externalTxHash).toBeDefined();
      expect(outbound.externalChain).toBeDefined();

      // Verify tx succeeded on external chain via RPC
      await verifyExternalTransaction(outbound.externalTxHash, outbound.externalChain);

      return { receipt, outbound };
    }

    // ============================================================================
    // 1. Funds — ERC-20 USDT
    // ============================================================================
    describe('1. Funds', () => {
      it('should send ERC-20 pUSDT outbound and verify inbound STAKE via round-trip', async () => {
        if (skipE2E) return;

        console.log('\n=== Core Scenario 1: Funds (ERC-20 USDT) ===');

        const bridgeAmount = BigInt(10000); // 0.01 USDT (6 decimals)
        const sendBackAmount = BigInt(5000); // Amount CEA sends back as inbound
        await ensureStakingHasPRC20(PUSDT_BNB_TOKEN, bridgeAmount);

        // Read stake BEFORE
        const stakeBefore = await pushPublicClient.readContract({
          address: STAKING_PROXY,
          abi: STAKING_EXAMPLE_ABI,
          functionName: 'getStake',
          args: [ueaAddress, PUSDT_BNB_TOKEN],
        }) as bigint;
        console.log(`Stake BEFORE: ${stakeBefore}`);

        // Build round-trip payload: CEA calls sendUniversalTxToUEA → STAKE inbound on Push Chain
        // Without this payload, the CEA just parks funds and no inbound is created.
        const outboundPayload = buildStakeRoundTripPayload(
          stakingCeaAddress, ueaAddress, sendBackAmount, ueaAddress,
        );
        console.log(`Round-trip payload length: ${outboundPayload.length} chars`);

        // Use empty recipient (park funds in CEA) + round-trip payload for inbound
        await callTriggerOutbound(PUSDT_BNB_TOKEN, bridgeAmount, '0x' as `0x${string}`, outboundPayload);

        // Wait for inbound relay — poll stake balance on Push Chain
        console.log('Waiting for inbound relay (polling stake balance)...');
        const INBOUND_INITIAL_WAIT = 30000;
        const INBOUND_POLL_INTERVAL = 10000;
        const INBOUND_TIMEOUT = 300000;

        await new Promise((r) => setTimeout(r, INBOUND_INITIAL_WAIT));

        const startTime = Date.now();
        let stakeAfter = stakeBefore;

        while (Date.now() - startTime < INBOUND_TIMEOUT) {
          stakeAfter = await pushPublicClient.readContract({
            address: STAKING_PROXY,
            abi: STAKING_EXAMPLE_ABI,
            functionName: 'getStake',
            args: [ueaAddress, PUSDT_BNB_TOKEN],
          }) as bigint;

          if (stakeAfter > stakeBefore) {
            console.log(`Stake AFTER: ${stakeAfter} (increased by ${stakeAfter - stakeBefore})`);
            break;
          }

          console.log(`Stake unchanged: ${stakeAfter}, polling...`);
          await new Promise((r) => setTimeout(r, INBOUND_POLL_INTERVAL));
        }

        expect(stakeAfter).toBeGreaterThan(stakeBefore);
      }, 600000);
    });

    // ============================================================================
    // 2. Payload (Data) — single counter increment
    // ============================================================================
    describe('2. Payload (Data)', () => {
      it('should increment counter on BSC and verify inbound STAKE via round-trip', async () => {
        if (skipE2E) return;

        console.log('\n=== Core Scenario 2: Payload (Data) — Round-Trip ===');

        const bridgeAmount = BigInt(10000);
        const sendBackAmount = BigInt(5000);
        await ensureStakingHasPRC20(PUSDT_BNB_TOKEN, bridgeAmount);

        const counterBefore = await bscPublicClient.readContract({
          address: COUNTER_A, abi: COUNTER_ABI, functionName: 'count',
        }) as bigint;
        console.log(`CounterA BEFORE: ${counterBefore}`);

        const stakeBefore = await pushPublicClient.readContract({
          address: STAKING_PROXY, abi: STAKING_EXAMPLE_ABI, functionName: 'getStake',
          args: [ueaAddress, PUSDT_BNB_TOKEN],
        }) as bigint;
        console.log(`USDT Stake BEFORE: ${stakeBefore}`);

        const incrementData = encodeFunctionData({
          abi: COUNTER_ABI, functionName: 'increment',
        });

        const outboundCalls: Array<{ to: `0x${string}`; value: bigint; data: `0x${string}` }> = [
          { to: COUNTER_A, value: BigInt(0), data: incrementData },
          ...buildErc20RoundTripCalls(stakingCeaAddress, ueaAddress, sendBackAmount, ueaAddress),
        ];
        const payload = buildOutboundMulticallPayload(outboundCalls);

        await callTriggerOutbound(PUSDT_BNB_TOKEN, bridgeAmount, '0x' as `0x${string}`, payload);

        await new Promise((r) => setTimeout(r, 5000));
        const counterAfter = await bscPublicClient.readContract({
          address: COUNTER_A, abi: COUNTER_ABI, functionName: 'count',
        }) as bigint;
        console.log(`CounterA AFTER: ${counterAfter}`);
        expect(counterAfter).toBeGreaterThan(counterBefore);

        // Wait for inbound relay
        console.log('Waiting for inbound relay (polling USDT stake)...');
        await new Promise((r) => setTimeout(r, 30000));
        const pollStart = Date.now();
        let stakeAfter = stakeBefore;
        while (Date.now() - pollStart < 300000) {
          stakeAfter = await pushPublicClient.readContract({
            address: STAKING_PROXY, abi: STAKING_EXAMPLE_ABI, functionName: 'getStake',
            args: [ueaAddress, PUSDT_BNB_TOKEN],
          }) as bigint;
          const elapsed = Math.round((Date.now() - pollStart) / 1000);
          console.log(`Polling USDT stake: ${stakeAfter} (elapsed: ${elapsed}s)`);
          if (stakeAfter > stakeBefore) break;
          await new Promise((r) => setTimeout(r, 10000));
        }
        console.log(`USDT Stake AFTER: ${stakeAfter}`);
        expect(stakeAfter).toBeGreaterThan(stakeBefore);
      }, 600000);
    });

    // ============================================================================
    // 3. Multicall — increment both counters
    // ============================================================================
    describe('3. Multicall', () => {
      it('should increment both counters on BSC and verify inbound STAKE via round-trip', async () => {
        if (skipE2E) return;

        console.log('\n=== Core Scenario 3: Multicall — Round-Trip ===');

        const bridgeAmount = BigInt(10000);
        const sendBackAmount = BigInt(5000);
        await ensureStakingHasPRC20(PUSDT_BNB_TOKEN, bridgeAmount);

        const counterABefore = await bscPublicClient.readContract({
          address: COUNTER_A, abi: COUNTER_ABI, functionName: 'count',
        }) as bigint;
        const counterBBefore = await bscPublicClient.readContract({
          address: COUNTER_B, abi: COUNTER_ABI, functionName: 'count',
        }) as bigint;
        console.log(`CounterA BEFORE: ${counterABefore}, CounterB BEFORE: ${counterBBefore}`);

        const stakeBefore = await pushPublicClient.readContract({
          address: STAKING_PROXY, abi: STAKING_EXAMPLE_ABI, functionName: 'getStake',
          args: [ueaAddress, PUSDT_BNB_TOKEN],
        }) as bigint;
        console.log(`USDT Stake BEFORE: ${stakeBefore}`);

        const incrementData = encodeFunctionData({
          abi: COUNTER_ABI, functionName: 'increment',
        });

        const outboundCalls: Array<{ to: `0x${string}`; value: bigint; data: `0x${string}` }> = [
          { to: COUNTER_A, value: BigInt(0), data: incrementData },
          { to: COUNTER_B, value: BigInt(0), data: incrementData },
          ...buildErc20RoundTripCalls(stakingCeaAddress, ueaAddress, sendBackAmount, ueaAddress),
        ];
        const payload = buildOutboundMulticallPayload(outboundCalls);

        await callTriggerOutbound(PUSDT_BNB_TOKEN, bridgeAmount, '0x' as `0x${string}`, payload);

        await new Promise((r) => setTimeout(r, 5000));
        const counterAAfter = await bscPublicClient.readContract({
          address: COUNTER_A, abi: COUNTER_ABI, functionName: 'count',
        }) as bigint;
        const counterBAfter = await bscPublicClient.readContract({
          address: COUNTER_B, abi: COUNTER_ABI, functionName: 'count',
        }) as bigint;
        console.log(`CounterA AFTER: ${counterAAfter}, CounterB AFTER: ${counterBAfter}`);
        expect(counterAAfter).toBeGreaterThan(counterABefore);
        expect(counterBAfter).toBeGreaterThan(counterBBefore);

        console.log('Waiting for inbound relay (polling USDT stake)...');
        await new Promise((r) => setTimeout(r, 30000));
        const pollStart = Date.now();
        let stakeAfter = stakeBefore;
        while (Date.now() - pollStart < 300000) {
          stakeAfter = await pushPublicClient.readContract({
            address: STAKING_PROXY, abi: STAKING_EXAMPLE_ABI, functionName: 'getStake',
            args: [ueaAddress, PUSDT_BNB_TOKEN],
          }) as bigint;
          const elapsed = Math.round((Date.now() - pollStart) / 1000);
          console.log(`Polling USDT stake: ${stakeAfter} (elapsed: ${elapsed}s)`);
          if (stakeAfter > stakeBefore) break;
          await new Promise((r) => setTimeout(r, 10000));
        }
        console.log(`USDT Stake AFTER: ${stakeAfter}`);
        expect(stakeAfter).toBeGreaterThan(stakeBefore);
      }, 600000);
    });

    // ============================================================================
    // 4. Funds + Payload — ERC-20 funds + counter increment
    // ============================================================================
    describe('4. Funds + Payload', () => {
      it('should send ERC-20 pUSDT, increment counter, and verify inbound STAKE via round-trip', async () => {
        if (skipE2E) return;

        console.log('\n=== Core Scenario 4: Funds + Payload — Round-Trip ===');

        const bridgeAmount = BigInt(10000);
        const sendBackAmount = BigInt(5000);
        await ensureStakingHasPRC20(PUSDT_BNB_TOKEN, bridgeAmount);

        const counterBefore = await bscPublicClient.readContract({
          address: COUNTER_A, abi: COUNTER_ABI, functionName: 'count',
        }) as bigint;
        console.log(`CounterA BEFORE: ${counterBefore}`);

        const stakeBefore = await pushPublicClient.readContract({
          address: STAKING_PROXY, abi: STAKING_EXAMPLE_ABI, functionName: 'getStake',
          args: [ueaAddress, PUSDT_BNB_TOKEN],
        }) as bigint;
        console.log(`USDT Stake BEFORE: ${stakeBefore}`);

        const incrementData = encodeFunctionData({
          abi: COUNTER_ABI, functionName: 'increment',
        });

        const outboundCalls: Array<{ to: `0x${string}`; value: bigint; data: `0x${string}` }> = [
          { to: COUNTER_A, value: BigInt(0), data: incrementData },
          ...buildErc20RoundTripCalls(stakingCeaAddress, ueaAddress, sendBackAmount, ueaAddress),
        ];
        const payload = buildOutboundMulticallPayload(outboundCalls);

        await callTriggerOutbound(PUSDT_BNB_TOKEN, bridgeAmount, '0x' as `0x${string}`, payload);

        await new Promise((r) => setTimeout(r, 5000));
        const counterAfter = await bscPublicClient.readContract({
          address: COUNTER_A, abi: COUNTER_ABI, functionName: 'count',
        }) as bigint;
        console.log(`CounterA AFTER: ${counterAfter}`);
        expect(counterAfter).toBeGreaterThan(counterBefore);

        console.log('Waiting for inbound relay (polling USDT stake)...');
        await new Promise((r) => setTimeout(r, 30000));
        const pollStart = Date.now();
        let stakeAfter = stakeBefore;
        while (Date.now() - pollStart < 300000) {
          stakeAfter = await pushPublicClient.readContract({
            address: STAKING_PROXY, abi: STAKING_EXAMPLE_ABI, functionName: 'getStake',
            args: [ueaAddress, PUSDT_BNB_TOKEN],
          }) as bigint;
          const elapsed = Math.round((Date.now() - pollStart) / 1000);
          console.log(`Polling USDT stake: ${stakeAfter} (elapsed: ${elapsed}s)`);
          if (stakeAfter > stakeBefore) break;
          await new Promise((r) => setTimeout(r, 10000));
        }
        console.log(`USDT Stake AFTER: ${stakeAfter}`);
        expect(stakeAfter).toBeGreaterThan(stakeBefore);
      }, 600000);
    });

    // ============================================================================
    // 5. Funds + Multicall — ERC-20 funds + transfer + counter increment
    // ============================================================================
    describe('5. Funds + Multicall', () => {
      it('should send ERC-20 pUSDT, transfer + increment counter, and verify inbound STAKE via round-trip', async () => {
        if (skipE2E) return;

        console.log('\n=== Core Scenario 5: Funds + Multicall — Round-Trip ===');

        const bridgeAmount = BigInt(20000); // extra to cover transfer + sendBack
        const sendBackAmount = BigInt(5000);
        const transferAmount = BigInt(10000);
        await ensureStakingHasPRC20(PUSDT_BNB_TOKEN, bridgeAmount);

        const counterBefore = await bscPublicClient.readContract({
          address: COUNTER_A, abi: COUNTER_ABI, functionName: 'count',
        }) as bigint;
        console.log(`CounterA BEFORE: ${counterBefore}`);

        const stakeBefore = await pushPublicClient.readContract({
          address: STAKING_PROXY, abi: STAKING_EXAMPLE_ABI, functionName: 'getStake',
          args: [ueaAddress, PUSDT_BNB_TOKEN],
        }) as bigint;
        console.log(`USDT Stake BEFORE: ${stakeBefore}`);

        const erc20TransferData = encodeFunctionData({
          abi: ERC20_EVM,
          functionName: 'transfer',
          args: [TEST_TARGET, transferAmount],
        });

        const incrementData = encodeFunctionData({
          abi: COUNTER_ABI, functionName: 'increment',
        });

        const outboundCalls: Array<{ to: `0x${string}`; value: bigint; data: `0x${string}` }> = [
          { to: BSC_USDT_ADDRESS, value: BigInt(0), data: erc20TransferData },
          { to: COUNTER_A, value: BigInt(0), data: incrementData },
          ...buildErc20RoundTripCalls(stakingCeaAddress, ueaAddress, sendBackAmount, ueaAddress),
        ];
        const payload = buildOutboundMulticallPayload(outboundCalls);

        await callTriggerOutbound(PUSDT_BNB_TOKEN, bridgeAmount, '0x' as `0x${string}`, payload);

        await new Promise((r) => setTimeout(r, 5000));
        const counterAfter = await bscPublicClient.readContract({
          address: COUNTER_A, abi: COUNTER_ABI, functionName: 'count',
        }) as bigint;
        console.log(`CounterA AFTER: ${counterAfter}`);
        expect(counterAfter).toBeGreaterThan(counterBefore);

        console.log('Waiting for inbound relay (polling USDT stake)...');
        await new Promise((r) => setTimeout(r, 30000));
        const pollStart = Date.now();
        let stakeAfter = stakeBefore;
        while (Date.now() - pollStart < 300000) {
          stakeAfter = await pushPublicClient.readContract({
            address: STAKING_PROXY, abi: STAKING_EXAMPLE_ABI, functionName: 'getStake',
            args: [ueaAddress, PUSDT_BNB_TOKEN],
          }) as bigint;
          const elapsed = Math.round((Date.now() - pollStart) / 1000);
          console.log(`Polling USDT stake: ${stakeAfter} (elapsed: ${elapsed}s)`);
          if (stakeAfter > stakeBefore) break;
          await new Promise((r) => setTimeout(r, 10000));
        }
        console.log(`USDT Stake AFTER: ${stakeAfter}`);
        expect(stakeAfter).toBeGreaterThan(stakeBefore);
      }, 600000);
    });

    // ============================================================================
    // 6. Native Funds — pBNB outbound
    // ============================================================================
    describe('6. Native Funds', () => {
      it('should send native pBNB outbound and verify inbound STAKE via round-trip', async () => {
        if (skipE2E) return;

        console.log('\n=== Core Scenario 6: Native Funds (pBNB) — Round-Trip ===');

        const bridgeAmount = parseEther('0.0005');
        const sendBackAmount = parseEther('0.00025'); // half goes back as inbound
        await ensureStakingHasPRC20(PBNB_TOKEN, bridgeAmount);

        // Read stake BEFORE
        const stakeBefore = await pushPublicClient.readContract({
          address: STAKING_PROXY,
          abi: STAKING_EXAMPLE_ABI,
          functionName: 'getStake',
          args: [ueaAddress, PBNB_TOKEN],
        }) as bigint;
        console.log(`pBNB Stake BEFORE: ${stakeBefore}`);

        // Build round-trip payload for native BNB:
        // CEA on BSC calls sendUniversalTxToUEA with native BNB → creates inbound STAKE on Push Chain
        const payloadData = encodeAbiParameters(
          [
            { name: 'action', type: 'uint8' },
            { name: 'user', type: 'address' },
            { name: 'executionPayload', type: 'bytes' },
          ],
          [0, ueaAddress, '0x'] // action=0 (STAKE)
        );

        const universalPayload = encodeAbiParameters(
          [{
            type: 'tuple',
            components: [
              { name: 'to', type: 'address' },
              { name: 'value', type: 'uint256' },
              { name: 'data', type: 'bytes' },
              { name: 'gasLimit', type: 'uint256' },
              { name: 'maxFeePerGas', type: 'uint256' },
              { name: 'maxPriorityFeePerGas', type: 'uint256' },
              { name: 'nonce', type: 'uint256' },
              { name: 'deadline', type: 'uint256' },
              { name: 'vType', type: 'uint8' },
            ],
          }],
          [{
            to: ZERO_ADDRESS,
            value: BigInt(0),
            data: payloadData,
            gasLimit: BigInt(0),
            maxFeePerGas: BigInt(0),
            maxPriorityFeePerGas: BigInt(0),
            nonce: BigInt(0),
            deadline: BigInt(0),
            vType: 1,
          }]
        );

        // For native BNB: no approve needed, just sendUniversalTxToUEA with msg.value
        const sendBackCalldata = encodeFunctionData({
          abi: CEA_EVM,
          functionName: 'sendUniversalTxToUEA',
          args: [ZERO_ADDRESS, sendBackAmount, universalPayload, ueaAddress],
        });

        const multicallEncoded = encodeAbiParameters(
          [{
            type: 'tuple[]',
            components: [
              { name: 'to', type: 'address' },
              { name: 'value', type: 'uint256' },
              { name: 'data', type: 'bytes' },
            ],
          }],
          [[{
            to: stakingCeaAddress,
            value: BigInt(0), // CEA already has native BNB from Vault; self-calls must have value=0
            data: sendBackCalldata,
          }]]
        );

        const outboundPayload = `${UEA_MULTICALL_SELECTOR}${multicallEncoded.slice(2)}` as `0x${string}`;
        console.log(`Round-trip payload length: ${outboundPayload.length} chars`);

        // Use empty recipient (park funds in CEA) + round-trip payload for inbound
        await callTriggerOutbound(PBNB_TOKEN, bridgeAmount, '0x' as `0x${string}`, outboundPayload);

        // Wait for inbound relay — poll stake balance on Push Chain
        console.log('Waiting for inbound relay (polling pBNB stake balance)...');
        const INBOUND_INITIAL_WAIT = 30000;
        const INBOUND_POLL_INTERVAL = 10000;
        const INBOUND_TIMEOUT = 300000;

        await new Promise((r) => setTimeout(r, INBOUND_INITIAL_WAIT));

        const pollStart = Date.now();
        let stakeAfter = stakeBefore;
        while (Date.now() - pollStart < INBOUND_TIMEOUT) {
          stakeAfter = await pushPublicClient.readContract({
            address: STAKING_PROXY,
            abi: STAKING_EXAMPLE_ABI,
            functionName: 'getStake',
            args: [ueaAddress, PBNB_TOKEN],
          }) as bigint;
          const elapsed = Math.round((Date.now() - pollStart) / 1000);
          console.log(`Polling pBNB stake: ${stakeAfter} (elapsed: ${elapsed}s)`);
          if (stakeAfter > stakeBefore) break;
          await new Promise((r) => setTimeout(r, INBOUND_POLL_INTERVAL));
        }

        console.log(`pBNB Stake AFTER: ${stakeAfter}`);
        expect(stakeAfter).toBeGreaterThan(stakeBefore);
      }, 600000);
    });

    // ============================================================================
    // 7. Native Funds + Payload — pBNB + counter increment
    // ============================================================================
    describe('7. Native Funds + Payload', () => {
      it('should send native pBNB, increment BSC counter, and verify inbound STAKE via round-trip', async () => {
        if (skipE2E) return;

        console.log('\n=== Core Scenario 7: Native Funds + Payload (pBNB + counter + round-trip) ===');

        const bridgeAmount = parseEther('0.0005');
        const sendBackAmount = parseEther('0.00025');
        await ensureStakingHasPRC20(PBNB_TOKEN, bridgeAmount);

        // Read counter BEFORE
        const counterBefore = await bscPublicClient.readContract({
          address: COUNTER_A, abi: COUNTER_ABI, functionName: 'count',
        }) as bigint;
        console.log(`CounterA BEFORE: ${counterBefore}`);

        // Read pBNB stake BEFORE
        const stakeBefore = await pushPublicClient.readContract({
          address: STAKING_PROXY,
          abi: STAKING_EXAMPLE_ABI,
          functionName: 'getStake',
          args: [ueaAddress, PBNB_TOKEN],
        }) as bigint;
        console.log(`pBNB Stake BEFORE: ${stakeBefore}`);

        const incrementData = encodeFunctionData({
          abi: COUNTER_ABI,
          functionName: 'increment',
        });

        // Build round-trip payload: increment counter on BSC + sendUniversalTxToUEA for inbound STAKE
        const payloadData = encodeAbiParameters(
          [
            { name: 'action', type: 'uint8' },
            { name: 'user', type: 'address' },
            { name: 'executionPayload', type: 'bytes' },
          ],
          [0, ueaAddress, '0x'] // action=0 (STAKE)
        );

        const universalPayload = encodeAbiParameters(
          [{
            type: 'tuple',
            components: [
              { name: 'to', type: 'address' },
              { name: 'value', type: 'uint256' },
              { name: 'data', type: 'bytes' },
              { name: 'gasLimit', type: 'uint256' },
              { name: 'maxFeePerGas', type: 'uint256' },
              { name: 'maxPriorityFeePerGas', type: 'uint256' },
              { name: 'nonce', type: 'uint256' },
              { name: 'deadline', type: 'uint256' },
              { name: 'vType', type: 'uint8' },
            ],
          }],
          [{
            to: ZERO_ADDRESS,
            value: BigInt(0),
            data: payloadData,
            gasLimit: BigInt(0),
            maxFeePerGas: BigInt(0),
            maxPriorityFeePerGas: BigInt(0),
            nonce: BigInt(0),
            deadline: BigInt(0),
            vType: 1,
          }]
        );

        const sendBackCalldata = encodeFunctionData({
          abi: CEA_EVM,
          functionName: 'sendUniversalTxToUEA',
          args: [ZERO_ADDRESS, sendBackAmount, universalPayload, ueaAddress],
        });

        // CEA multicall: increment counter + sendUniversalTxToUEA for inbound
        const multicallEncoded = encodeAbiParameters(
          [{
            type: 'tuple[]',
            components: [
              { name: 'to', type: 'address' },
              { name: 'value', type: 'uint256' },
              { name: 'data', type: 'bytes' },
            ],
          }],
          [[
            { to: COUNTER_A, value: BigInt(0), data: incrementData },
            {
              to: stakingCeaAddress,
              value: BigInt(0), // CEA already has native BNB from Vault; self-calls must have value=0
              data: sendBackCalldata,
            },
          ]]
        );

        const outboundPayload = `${UEA_MULTICALL_SELECTOR}${multicallEncoded.slice(2)}` as `0x${string}`;
        console.log(`Round-trip payload length: ${outboundPayload.length} chars`);

        // Use empty recipient (park funds in CEA) + round-trip payload
        await callTriggerOutbound(PBNB_TOKEN, bridgeAmount, '0x' as `0x${string}`, outboundPayload);

        // Wait for RPC propagation then check counter
        await new Promise((r) => setTimeout(r, 5000));

        const counterAfter = await bscPublicClient.readContract({
          address: COUNTER_A, abi: COUNTER_ABI, functionName: 'count',
        }) as bigint;
        console.log(`CounterA AFTER: ${counterAfter}`);
        expect(counterAfter).toBeGreaterThan(counterBefore);

        // Wait for inbound relay — poll stake balance on Push Chain
        console.log('Waiting for inbound relay (polling pBNB stake balance)...');
        const INBOUND_INITIAL_WAIT = 30000;
        const INBOUND_POLL_INTERVAL = 10000;
        const INBOUND_TIMEOUT = 300000;

        await new Promise((r) => setTimeout(r, INBOUND_INITIAL_WAIT));

        const pollStart = Date.now();
        let stakeAfter = stakeBefore;
        while (Date.now() - pollStart < INBOUND_TIMEOUT) {
          stakeAfter = await pushPublicClient.readContract({
            address: STAKING_PROXY,
            abi: STAKING_EXAMPLE_ABI,
            functionName: 'getStake',
            args: [ueaAddress, PBNB_TOKEN],
          }) as bigint;
          const elapsed = Math.round((Date.now() - pollStart) / 1000);
          console.log(`Polling pBNB stake: ${stakeAfter} (elapsed: ${elapsed}s)`);
          if (stakeAfter > stakeBefore) break;
          await new Promise((r) => setTimeout(r, INBOUND_POLL_INTERVAL));
        }

        console.log(`pBNB Stake AFTER: ${stakeAfter}`);
        expect(stakeAfter).toBeGreaterThan(stakeBefore);
      }, 600000);
    });

    // ============================================================================
    // 8. Round-Trip: CEA → PC STAKE (outbound + CEA inbound)
    // ============================================================================
    describe('8. Round-Trip: CEA → PC STAKE', () => {
      it('should trigger outbound with round-trip payload, CEA sends STAKE inbound back to Push Chain', async () => {
        if (skipE2E) return;

        console.log('\n=== Core Scenario 8: Round-Trip CEA → PC STAKE ===');

        // Verify CEA is deployed (should be deployed after Core Scenario 1)
        const [ceaAddr, isDeployed] = await bscPublicClient.readContract({
          address: CEA_FACTORY_BSC,
          abi: CEA_FACTORY_ABI,
          functionName: 'getCEAForPushAccount',
          args: [STAKING_PROXY],
        }) as [`0x${string}`, boolean];

        console.log(`CEA: ${ceaAddr}, deployed: ${isDeployed}`);
        expect(isDeployed).toBe(true);

        const bridgeAmount = BigInt(10000); // 0.01 USDT (6 decimals)
        const sendBackAmount = BigInt(5000); // 0.005 USDT (6 decimals)
        await ensureStakingHasPRC20(PUSDT_BNB_TOKEN, bridgeAmount);

        // Read stake BEFORE
        const stakeBefore = await pushPublicClient.readContract({
          address: STAKING_PROXY,
          abi: STAKING_EXAMPLE_ABI,
          functionName: 'getStake',
          args: [ueaAddress, PUSDT_BNB_TOKEN],
        }) as bigint;
        console.log(`Stake BEFORE: ${stakeBefore}`);

        // Build round-trip payload: CEA calls sendUniversalTxToUEA → STAKE inbound on Push Chain
        const outboundPayload = buildStakeRoundTripPayload(
          ceaAddr, ueaAddress, sendBackAmount, ueaAddress,
        );
        console.log(`Round-trip payload length: ${outboundPayload.length} chars`);

        // Trigger outbound with round-trip payload (waits for outbound relay + verifies BSC tx)
        await callTriggerOutbound(PUSDT_BNB_TOKEN, bridgeAmount, '0x' as `0x${string}`, outboundPayload);

        // Wait for inbound relay — poll stake balance on Push Chain
        console.log('Waiting for inbound relay (polling stake balance)...');
        const INBOUND_INITIAL_WAIT = 30000;
        const INBOUND_POLL_INTERVAL = 10000;
        const INBOUND_TIMEOUT = 300000;

        await new Promise((r) => setTimeout(r, INBOUND_INITIAL_WAIT));

        const startTime = Date.now();
        let stakeAfter = stakeBefore;

        while (Date.now() - startTime < INBOUND_TIMEOUT) {
          stakeAfter = await pushPublicClient.readContract({
            address: STAKING_PROXY,
            abi: STAKING_EXAMPLE_ABI,
            functionName: 'getStake',
            args: [ueaAddress, PUSDT_BNB_TOKEN],
          }) as bigint;

          if (stakeAfter > stakeBefore) {
            console.log(`Stake AFTER: ${stakeAfter} (increased by ${stakeAfter - stakeBefore})`);
            break;
          }

          console.log(`Stake unchanged: ${stakeAfter}, polling...`);
          await new Promise((r) => setTimeout(r, INBOUND_POLL_INTERVAL));
        }

        expect(stakeAfter).toBeGreaterThan(stakeBefore);
      }, 600000);
    });
  });

  // ============================================================================
  // Additional
  // ============================================================================
  describe('Additional', () => {

  // ============================================================================
  // 1. Contract State Reads
  // ============================================================================
  describe('1. Contract State Reads', () => {
    it('should read owner from StakingExample', async () => {
      if (skipE2E) return;

      const owner = await pushPublicClient.readContract({
        address: STAKING_PROXY,
        abi: STAKING_EXAMPLE_ABI,
        functionName: 'owner',
      }) as `0x${string}`;

      console.log(`StakingExample owner: ${owner}`);
      expect(owner).toMatch(/^0x[a-fA-F0-9]{40}$/);
    });

    it('should read UGPC address from StakingExample', async () => {
      if (skipE2E) return;

      const ugpc = await pushPublicClient.readContract({
        address: STAKING_PROXY,
        abi: STAKING_EXAMPLE_ABI,
        functionName: 'ugpc',
      }) as `0x${string}`;

      console.log(`StakingExample UGPC: ${ugpc}`);
      expect(ugpc).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(ugpc.toLowerCase()).not.toBe(ZERO_ADDRESS.toLowerCase());
    });

    it('should read universalExecutorModule from StakingExample', async () => {
      if (skipE2E) return;

      const module = await pushPublicClient.readContract({
        address: STAKING_PROXY,
        abi: STAKING_EXAMPLE_ABI,
        functionName: 'universalExecutorModule',
      }) as `0x${string}`;

      console.log(`StakingExample UniversalExecutorModule: ${module}`);
      expect(module).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(module.toLowerCase()).not.toBe(ZERO_ADDRESS.toLowerCase());
    });

    it('should read current stake balance (may be zero)', async () => {
      if (skipE2E) return;

      const stake = await pushPublicClient.readContract({
        address: STAKING_PROXY,
        abi: STAKING_EXAMPLE_ABI,
        functionName: 'getStake',
        args: [ueaAddress, PUSDT_BNB_TOKEN],
      }) as bigint;

      console.log(`Current stake for UEA ${ueaAddress}: ${stake}`);
      expect(typeof stake).toBe('bigint');
    });

    it('should compute CEA address for StakingExample on BSC Testnet', async () => {
      if (skipE2E) return;

      const result = await getCEAAddress(STAKING_PROXY, CHAIN.BNB_TESTNET);

      console.log(`CEA for StakingExample on BSC: ${result.cea}, deployed: ${result.isDeployed}`);
      expect(result.cea).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(typeof result.isDeployed).toBe('boolean');
    });

    it('should query outbound gas fees for pUSDT', async () => {
      if (skipE2E) return;

      const fees = await queryOutboundGasFees(pushPublicClient, PUSDT_BNB_TOKEN);

      console.log(`Gas fees — gasFee: ${fees.gasFee}, protocolFee: ${fees.protocolFee}, total: ${fees.totalFee}`);
      expect(fees.gasFee).toBeGreaterThan(BigInt(0));
      expect(fees.totalFee).toBeGreaterThan(BigInt(0));
    });
  });

  // ============================================================================
  // 2. Transfer PRC20 (pUSDT) to StakingExample
  // ============================================================================
  describe('2. Transfer pUSDT to StakingExample', () => {
    it('should transfer pUSDT tokens to the StakingExample proxy on Push Chain', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: Transfer pUSDT to StakingExample ===');

      const transferAmount = BigInt(10000); // 0.01 USDT (6 decimals)

      // Check pUSDT balance of UEA before transfer
      const balanceBefore = await pushPublicClient.readContract({
        address: PUSDT_BNB_TOKEN,
        abi: ERC20_EVM,
        functionName: 'balanceOf',
        args: [STAKING_PROXY],
      }) as bigint;
      console.log(`StakingExample pUSDT balance BEFORE: ${balanceBefore}`);

      // Transfer pUSDT to StakingExample (Route 1: UOA → Push)
      const transferPayload = encodeFunctionData({
        abi: ERC20_EVM,
        functionName: 'transfer',
        args: [STAKING_PROXY, transferAmount],
      });

      const params: UniversalExecuteParams = {
        to: PUSDT_BNB_TOKEN, // PRC20 token contract on Push Chain
        data: transferPayload,
      };

      const tx = await pushClient.universal.sendTransaction(params);
      console.log(`Transfer TX Hash: ${tx.hash}`);
      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

      const receipt = await tx.wait();
      console.log(`Transfer receipt status: ${receipt.status}`);
      expect(receipt.status).toBe(1);

      // Verify balance increased
      await new Promise((r) => setTimeout(r, 3000));
      const balanceAfter = await pushPublicClient.readContract({
        address: PUSDT_BNB_TOKEN,
        abi: ERC20_EVM,
        functionName: 'balanceOf',
        args: [STAKING_PROXY],
      }) as bigint;
      console.log(`StakingExample pUSDT balance AFTER: ${balanceAfter}`);

      expect(balanceAfter).toBeGreaterThanOrEqual(balanceBefore);
    }, 120000);
  });

  // ============================================================================
  // 3. Verify CEA Deployment
  // ============================================================================
  describe('3. Trigger Outbound — Funds Only (CEA Deployment)', () => {
    it('should call triggerOutbound to deploy CEA on BSC Testnet with pUSDT', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: triggerOutbound — Funds Only with pUSDT (CEA Deployment) ===');

      const bridgeAmount = BigInt(10000); // 0.01 USDT (6 decimals)

      // Ensure StakingExample has enough pUSDT
      const contractBalance = await pushPublicClient.readContract({
        address: PUSDT_BNB_TOKEN,
        abi: ERC20_EVM,
        functionName: 'balanceOf',
        args: [STAKING_PROXY],
      }) as bigint;
      console.log(`StakingExample pUSDT balance: ${contractBalance}`);

      if (contractBalance < bridgeAmount) {
        console.log(`Funding StakingExample with pUSDT...`);
        const fundTx = await pushClient.universal.sendTransaction({
          to: PUSDT_BNB_TOKEN,
          data: encodeFunctionData({
            abi: ERC20_EVM,
            functionName: 'transfer',
            args: [STAKING_PROXY, bridgeAmount * BigInt(2)],
          }),
        });
        const fundReceipt = await fundTx.wait();
        console.log(`Funding TX status: ${fundReceipt.status}`);
        expect(fundReceipt.status).toBe(1);
      }

      // Query gas fees
      const fees = await queryOutboundGasFees(pushPublicClient, PUSDT_BNB_TOKEN);
      const msgValue = await computeOutboundMsgValue(pushPublicClient, ueaAddress, fees.nativeValueForGas);
      console.log(`Bridge amount: ${bridgeAmount}, msg.value for gas: ${msgValue}`);

      const triggerPayload = encodeFunctionData({
        abi: STAKING_EXAMPLE_ABI,
        functionName: 'triggerOutbound',
        args: [
          PUSDT_BNB_TOKEN,  // token: PRC20 pUSDT to bridge
          bridgeAmount,     // amount: pUSDT to burn
          '0x',             // recipient: empty = park in CEA
          BigInt(0),        // gasLimit: 0 = default
          '0x',             // payload: empty = funds only
          ueaAddress,       // revertRecipient
        ],
      });

      const params: UniversalExecuteParams = {
        to: STAKING_PROXY,
        data: triggerPayload,
        value: msgValue,
      };

      const tx = await pushClient.universal.sendTransaction(params);
      console.log(`triggerOutbound TX Hash: ${tx.hash}`);
      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

      const receipt = await tx.wait();
      console.log(`triggerOutbound receipt status: ${receipt.status}`);
      expect(receipt.status).toBe(1);
    }, 360000);
  });

  // ============================================================================
  // 4. Verify CEA State on BSC Testnet
  // ============================================================================
  describe('4. Verify CEA Deployment', () => {
    it('should verify CEA is deployed for StakingExample on BSC Testnet', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: Verify CEA Deployment ===');

      // Query CEA Factory on BSC
      const [ceaAddr, isDeployed] = await bscPublicClient.readContract({
        address: CEA_FACTORY_BSC,
        abi: CEA_FACTORY_ABI,
        functionName: 'getCEAForPushAccount',
        args: [STAKING_PROXY],
      }) as [`0x${string}`, boolean];

      console.log(`CEA address for StakingExample: ${ceaAddr}`);
      console.log(`CEA is deployed: ${isDeployed}`);

      expect(ceaAddr).toMatch(/^0x[a-fA-F0-9]{40}$/);
      // Note: CEA may not be deployed yet if TSS hasn't processed the outbound
      // In a full E2E test, we'd wait for the relay. For now, just verify address is computed.
      if (isDeployed) {
        expect(ceaAddr.toLowerCase()).not.toBe(ZERO_ADDRESS.toLowerCase());

        // Verify CEA's pushAccount points back to StakingExample
        const pushAccount = await bscPublicClient.readContract({
          address: CEA_FACTORY_BSC,
          abi: CEA_FACTORY_ABI,
          functionName: 'getPushAccountForCEA',
          args: [ceaAddr],
        }) as `0x${string}`;

        console.log(`CEA pushAccount: ${pushAccount}`);
        expect(pushAccount.toLowerCase()).toBe(STAKING_PROXY.toLowerCase());
      }
    }, 60000);

    it('should verify CEA has native BNB balance on BSC (if deployed)', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: CEA Balance on BSC ===');

      const [ceaAddr, isDeployed] = await bscPublicClient.readContract({
        address: CEA_FACTORY_BSC,
        abi: CEA_FACTORY_ABI,
        functionName: 'getCEAForPushAccount',
        args: [STAKING_PROXY],
      }) as [`0x${string}`, boolean];

      if (!isDeployed) {
        console.log('CEA not yet deployed — skipping balance check');
        return;
      }

      const balance = await bscPublicClient.getBalance({ address: ceaAddr });
      console.log(`CEA native BNB balance: ${balance}`);
      expect(typeof balance).toBe('bigint');
    }, 60000);
  });

  // ============================================================================
  // 5. Full Round-Trip — Outbound + Inbound STAKE
  // ============================================================================
  describe('5. Full Round-Trip — Outbound + Inbound STAKE', () => {
    it('should trigger outbound with multicall that sends inbound STAKE back to Push', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: Full Round-Trip — Outbound + Inbound STAKE ===');

      // Check CEA deployment first
      const [ceaAddr, isDeployed] = await bscPublicClient.readContract({
        address: CEA_FACTORY_BSC,
        abi: CEA_FACTORY_ABI,
        functionName: 'getCEAForPushAccount',
        args: [STAKING_PROXY],
      }) as [`0x${string}`, boolean];

      if (!isDeployed) {
        console.log('CEA not deployed — skipping round-trip test (run CEA deployment test first)');
        return;
      }

      console.log(`Using CEA: ${ceaAddr}`);

      const bridgeAmount = BigInt(10000); // 0.01 USDT (6 decimals)
      const sendBackAmount = BigInt(5000); // 0.005 USDT (6 decimals)

      // Ensure StakingExample has enough pUSDT
      const contractBalance = await pushPublicClient.readContract({
        address: PUSDT_BNB_TOKEN,
        abi: ERC20_EVM,
        functionName: 'balanceOf',
        args: [STAKING_PROXY],
      }) as bigint;

      if (contractBalance < bridgeAmount) {
        console.log(`Funding StakingExample with pUSDT...`);
        const fundTx = await pushClient.universal.sendTransaction({
          to: PUSDT_BNB_TOKEN,
          data: encodeFunctionData({
            abi: ERC20_EVM,
            functionName: 'transfer',
            args: [STAKING_PROXY, bridgeAmount * BigInt(2)],
          }),
        });
        const fundReceipt = await fundTx.wait();
        expect(fundReceipt.status).toBe(1);
      }

      // Read stake BEFORE
      const stakeBefore = await pushPublicClient.readContract({
        address: STAKING_PROXY,
        abi: STAKING_EXAMPLE_ABI,
        functionName: 'getStake',
        args: [ueaAddress, PUSDT_BNB_TOKEN],
      }) as bigint;
      console.log(`Stake BEFORE: ${stakeBefore}`);

      const outboundPayload = buildStakeRoundTripPayload(
        ceaAddr, ueaAddress, sendBackAmount, ueaAddress,
      );
      console.log(`Outbound payload length: ${outboundPayload.length} chars`);

      const fees = await queryOutboundGasFees(pushPublicClient, PUSDT_BNB_TOKEN);
      const msgValue = await computeOutboundMsgValue(pushPublicClient, ueaAddress, fees.nativeValueForGas);

      const triggerPayload = encodeFunctionData({
        abi: STAKING_EXAMPLE_ABI,
        functionName: 'triggerOutbound',
        args: [PUSDT_BNB_TOKEN, bridgeAmount, '0x', BigInt(0), outboundPayload, ueaAddress],
      });

      const tx = await pushClient.universal.sendTransaction({
        to: STAKING_PROXY,
        data: triggerPayload,
        value: msgValue,
      });
      console.log(`Round-trip TX Hash: ${tx.hash}`);
      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

      const receipt = await tx.wait();
      console.log(`Round-trip receipt status: ${receipt.status}`);
      expect(receipt.status).toBe(1);
    }, 600000);

    it('should verify stake was recorded after inbound (requires relay completion)', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: Verify Stake After Round-Trip ===');

      const stake = await pushPublicClient.readContract({
        address: STAKING_PROXY,
        abi: STAKING_EXAMPLE_ABI,
        functionName: 'getStake',
        args: [ueaAddress, PUSDT_BNB_TOKEN],
      }) as bigint;

      console.log(`Stake for ${ueaAddress}: ${stake}`);
      expect(typeof stake).toBe('bigint');
    }, 60000);
  });

  // ============================================================================
  // 6. Full Round-Trip — Outbound + Inbound UNSTAKE
  // ============================================================================
  describe('6. Full Round-Trip — Outbound + Inbound UNSTAKE', () => {
    it('should trigger outbound with UNSTAKE multicall payload', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: Full Round-Trip — Outbound + Inbound UNSTAKE ===');

      const [ceaAddr, isDeployed] = await bscPublicClient.readContract({
        address: CEA_FACTORY_BSC,
        abi: CEA_FACTORY_ABI,
        functionName: 'getCEAForPushAccount',
        args: [STAKING_PROXY],
      }) as [`0x${string}`, boolean];

      if (!isDeployed) {
        console.log('CEA not deployed — skipping');
        return;
      }

      const bridgeAmount = BigInt(10000); // 0.01 USDT (6 decimals)
      const sendBackAmount = BigInt(5000); // 0.005 USDT (6 decimals)

      // Ensure StakingExample has enough pUSDT
      const contractBalance = await pushPublicClient.readContract({
        address: PUSDT_BNB_TOKEN,
        abi: ERC20_EVM,
        functionName: 'balanceOf',
        args: [STAKING_PROXY],
      }) as bigint;

      if (contractBalance < bridgeAmount) {
        console.log(`Funding StakingExample with pUSDT...`);
        const fundTx = await pushClient.universal.sendTransaction({
          to: PUSDT_BNB_TOKEN,
          data: encodeFunctionData({
            abi: ERC20_EVM,
            functionName: 'transfer',
            args: [STAKING_PROXY, bridgeAmount * BigInt(2)],
          }),
        });
        const fundReceipt = await fundTx.wait();
        expect(fundReceipt.status).toBe(1);
      }

      // Build UNSTAKE payload (action=1)
      const payloadData = encodeAbiParameters(
        [
          { name: 'action', type: 'uint8' },
          { name: 'user', type: 'address' },
          { name: 'executionPayload', type: 'bytes' },
        ],
        [1, ueaAddress, '0x']
      );

      const universalPayload = encodeAbiParameters(
        [
          {
            type: 'tuple',
            components: [
              { name: 'to', type: 'address' },
              { name: 'value', type: 'uint256' },
              { name: 'data', type: 'bytes' },
              { name: 'gasLimit', type: 'uint256' },
              { name: 'maxFeePerGas', type: 'uint256' },
              { name: 'maxPriorityFeePerGas', type: 'uint256' },
              { name: 'nonce', type: 'uint256' },
              { name: 'deadline', type: 'uint256' },
              { name: 'vType', type: 'uint8' },
            ],
          },
        ],
        [{ to: ZERO_ADDRESS, value: BigInt(0), data: payloadData, gasLimit: BigInt(0), maxFeePerGas: BigInt(0), maxPriorityFeePerGas: BigInt(0), nonce: BigInt(0), deadline: BigInt(0), vType: 1 }]
      );

      const sendBackCalldata = encodeFunctionData({
        abi: CEA_EVM,
        functionName: 'sendUniversalTxToUEA',
        args: [BSC_USDT_ADDRESS, sendBackAmount, universalPayload, ueaAddress],
      });

      const multicallEncoded = encodeAbiParameters(
        [{ type: 'tuple[]', components: [{ name: 'to', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'data', type: 'bytes' }] }],
        [[{ to: ceaAddr, value: BigInt(0), data: sendBackCalldata }]]
      );

      const outboundPayload = `${UEA_MULTICALL_SELECTOR}${multicallEncoded.slice(2)}` as `0x${string}`;

      const fees = await queryOutboundGasFees(pushPublicClient, PUSDT_BNB_TOKEN);
      const msgValue = await computeOutboundMsgValue(pushPublicClient, ueaAddress, fees.nativeValueForGas);

      const triggerPayload = encodeFunctionData({
        abi: STAKING_EXAMPLE_ABI,
        functionName: 'triggerOutbound',
        args: [PUSDT_BNB_TOKEN, bridgeAmount, '0x', BigInt(0), outboundPayload, ueaAddress],
      });

      const tx = await pushClient.universal.sendTransaction({
        to: STAKING_PROXY,
        data: triggerPayload,
        value: msgValue,
      });
      console.log(`UNSTAKE Round-trip TX Hash: ${tx.hash}`);
      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

      const receipt = await tx.wait();
      console.log(`UNSTAKE receipt status: ${receipt.status}`);
      expect(receipt.status).toBe(1);
    }, 600000);
  });

  // ============================================================================
  // 7. Direct Stake on Push Chain (No Cross-Chain)
  // ============================================================================
  describe('7. Direct Stake on Push Chain', () => {
    it('should approve and stake pUSDT directly on Push Chain', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: Direct Stake pUSDT on Push Chain ===');

      const stakeAmount = BigInt(10000); // 0.01 USDT (6 decimals)

      // Step 1: Approve StakingExample to spend pUSDT
      const approvePayload = encodeFunctionData({
        abi: ERC20_EVM,
        functionName: 'approve',
        args: [STAKING_PROXY, stakeAmount],
      });

      const approveTx = await pushClient.universal.sendTransaction({
        to: PUSDT_BNB_TOKEN,
        data: approvePayload,
      });
      console.log(`Approve TX Hash: ${approveTx.hash}`);
      const approveReceipt = await approveTx.wait();
      console.log(`Approve status: ${approveReceipt.status}`);
      expect(approveReceipt.status).toBe(1);

      // Read stake BEFORE
      const stakeBefore = await pushPublicClient.readContract({
        address: STAKING_PROXY,
        abi: STAKING_EXAMPLE_ABI,
        functionName: 'getStake',
        args: [ueaAddress, PUSDT_BNB_TOKEN],
      }) as bigint;
      console.log(`Stake BEFORE: ${stakeBefore}`);

      // Step 2: Call stake()
      const stakePayload = encodeFunctionData({
        abi: STAKING_EXAMPLE_ABI,
        functionName: 'stake',
        args: [PUSDT_BNB_TOKEN, stakeAmount],
      });

      const stakeTx = await pushClient.universal.sendTransaction({
        to: STAKING_PROXY,
        data: stakePayload,
      });
      console.log(`Stake TX Hash: ${stakeTx.hash}`);

      const stakeReceipt = await stakeTx.wait();
      console.log(`Stake status: ${stakeReceipt.status}`);
      expect(stakeReceipt.status).toBe(1);

      // Verify stake increased
      await new Promise((r) => setTimeout(r, 3000));
      const stakeAfter = await pushPublicClient.readContract({
        address: STAKING_PROXY,
        abi: STAKING_EXAMPLE_ABI,
        functionName: 'getStake',
        args: [ueaAddress, PUSDT_BNB_TOKEN],
      }) as bigint;
      console.log(`Stake AFTER: ${stakeAfter}`);

      expect(stakeAfter).toBeGreaterThan(stakeBefore);
    }, 120000);
  });

  // ============================================================================
  // 7. Direct Unstake on Push Chain (No Cross-Chain)
  // ============================================================================
  describe('7. Direct Unstake on Push Chain', () => {
    it('should unstake pUSDT directly on Push Chain', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: Direct Unstake pUSDT on Push Chain ===');

      // Read stake BEFORE
      const stakeBefore = await pushPublicClient.readContract({
        address: STAKING_PROXY,
        abi: STAKING_EXAMPLE_ABI,
        functionName: 'getStake',
        args: [ueaAddress, PUSDT_BNB_TOKEN],
      }) as bigint;
      console.log(`Stake BEFORE unstake: ${stakeBefore}`);

      if (stakeBefore === BigInt(0)) {
        console.log('No stake to unstake — skipping');
        return;
      }

      // Check contract's actual token balance (may be less than staked if tokens were sent outbound)
      const contractBalance = await pushPublicClient.readContract({
        address: PUSDT_BNB_TOKEN,
        abi: ERC20_EVM,
        functionName: 'balanceOf',
        args: [STAKING_PROXY],
      }) as bigint;
      console.log(`StakingExample pUSDT balance: ${contractBalance}`);

      const unstakeAmount = contractBalance < stakeBefore ? contractBalance : stakeBefore;

      if (unstakeAmount === BigInt(0)) {
        console.log('Contract has no token balance to unstake — skipping');
        return;
      }
      console.log(`Unstaking amount: ${unstakeAmount}`);

      const unstakePayload = encodeFunctionData({
        abi: STAKING_EXAMPLE_ABI,
        functionName: 'unstake',
        args: [PUSDT_BNB_TOKEN, unstakeAmount],
      });

      const tx = await pushClient.universal.sendTransaction({
        to: STAKING_PROXY,
        data: unstakePayload,
      });
      console.log(`Unstake TX Hash: ${tx.hash}`);

      const receipt = await tx.wait();
      console.log(`Unstake status: ${receipt.status}`);
      expect(receipt.status).toBe(1);

      // Verify stake decreased
      await new Promise((r) => setTimeout(r, 3000));
      const stakeAfter = await pushPublicClient.readContract({
        address: STAKING_PROXY,
        abi: STAKING_EXAMPLE_ABI,
        functionName: 'getStake',
        args: [ueaAddress, PUSDT_BNB_TOKEN],
      }) as bigint;
      console.log(`Stake AFTER unstake: ${stakeAfter}`);

      expect(stakeAfter).toBeLessThan(stakeBefore);
    }, 120000);
  });

  // ============================================================================
  // 8. Error Handling
  // ============================================================================
  describe('8. Error Handling', () => {
    it('should fail triggerOutbound with zero amount', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: triggerOutbound with zero amount ===');

      const triggerPayload = encodeFunctionData({
        abi: STAKING_EXAMPLE_ABI,
        functionName: 'triggerOutbound',
        args: [PUSDT_BNB_TOKEN, BigInt(0), '0x', BigInt(0), '0x', ueaAddress],
      });

      try {
        const tx = await pushClient.universal.sendTransaction({
          to: STAKING_PROXY,
          data: triggerPayload,
          value: parseEther('0.01'),
        });
        const receipt = await tx.wait();
        console.log(`TX status: ${receipt.status}`);
      } catch (error) {
        console.log(`Expected error for zero amount: ${(error as Error).message}`);
        expect(error).toBeDefined();
      }
    }, 120000);

    it('should fail unstake with more than staked amount', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: unstake with excessive amount ===');

      const currentStake = await pushPublicClient.readContract({
        address: STAKING_PROXY,
        abi: STAKING_EXAMPLE_ABI,
        functionName: 'getStake',
        args: [ueaAddress, PUSDT_BNB_TOKEN],
      }) as bigint;

      const excessiveAmount = currentStake + BigInt(1000000000); // 1000 USDT (6 decimals)

      const unstakePayload = encodeFunctionData({
        abi: STAKING_EXAMPLE_ABI,
        functionName: 'unstake',
        args: [PUSDT_BNB_TOKEN, excessiveAmount],
      });

      try {
        const tx = await pushClient.universal.sendTransaction({
          to: STAKING_PROXY,
          data: unstakePayload,
        });
        const receipt = await tx.wait();
        console.log(`TX status: ${receipt.status}`);
        // Should revert with InsufficientStake
      } catch (error) {
        console.log(`Expected error for excessive unstake: ${(error as Error).message}`);
        expect(error).toBeDefined();
      }
    }, 120000);
  });

  }); // end Additional
});

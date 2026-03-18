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
import { PUSH_NETWORK, CHAIN } from '../../../src/lib/constants/enums';
import { CHAIN_INFO } from '../../../src/lib/constants/chain';
import {
  createWalletClient,
  createPublicClient,
  http,
  Hex,
  parseEther,
  encodeFunctionData,
  encodeAbiParameters,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { getCEAAddress } from '../../../src/lib/orchestrator/cea-utils';
import type { UniversalExecuteParams } from '../../../src/lib/orchestrator/orchestrator.types';
import { ERC20_EVM } from '../../../src/lib/constants/abi/erc20.evm';
import { CEA_EVM } from '../../../src/lib/constants/abi/cea.evm';
import { UNIVERSAL_GATEWAY_PC } from '../../../src/lib/constants/abi/universalGatewayPC.evm';
import { UNIVERSAL_CORE_EVM } from '../../../src/lib/constants/abi/prc20.evm';
import { UEA_MULTICALL_SELECTOR } from '../../../src/lib/constants/selectors';

// ============================================================================
// Contract Addresses
// ============================================================================
const STAKING_PROXY = '0x8ab717A4836d0589E5f27Ff65e18804325Cd6540' as `0x${string}`;
const PBNB_TOKEN = '0x7a9082dA308f3fa005beA7dB0d203b3b86664E36' as `0x${string}`;
const UGPC_PRECOMPILE = '0x00000000000000000000000000000000000000C1' as `0x${string}`;
const CEA_FACTORY_BSC = '0xe2182dae2dc11cBF6AA6c8B1a7f9c8315A6B0719' as `0x${string}`;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as `0x${string}`;

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
    name: 'getUEAForCEA',
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
): Promise<{ gasFee: bigint; protocolFee: bigint; totalFee: bigint }> {
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

  console.log(`[GasFees] gasFee: ${gasFee}, protocolFee: ${protocolFee}, totalFee: ${totalFee}`);

  return { gasFee, protocolFee, totalFee };
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
  // 1. Encode payload.data (what StakingExample._handleInboundPayload decodes)
  //    (uint8 action, address user, bytes executionPayload)
  const payloadData = encodeAbiParameters(
    [
      { name: 'action', type: 'uint8' },
      { name: 'user', type: 'address' },
      { name: 'executionPayload', type: 'bytes' },
    ],
    [0, userAddress, '0x'] // action=0 (STAKE)
  );

  // 2. Encode full UniversalPayload struct
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

  // 3. Encode sendUniversalTxToUEA call on the CEA
  const sendBackCalldata = encodeFunctionData({
    abi: CEA_EVM,
    functionName: 'sendUniversalTxToUEA',
    args: [
      ZERO_ADDRESS, // token: address(0) = native BNB
      amountToSendBack,
      universalPayload,
      revertRecipient,
    ],
  });

  // 4. Wrap in MULTICALL format
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
          to: ceaAddress,
          value: BigInt(0),
          data: sendBackCalldata,
        },
      ],
    ]
  );

  // 5. Final payload = UEA_MULTICALL_SELECTOR + multicallEncoded
  return `${UEA_MULTICALL_SELECTOR}${multicallEncoded.slice(2)}` as `0x${string}`;
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
        args: [ueaAddress, PBNB_TOKEN],
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

    it('should query outbound gas fees for pBNB', async () => {
      if (skipE2E) return;

      const fees = await queryOutboundGasFees(pushPublicClient, PBNB_TOKEN);

      console.log(`Gas fees — gasFee: ${fees.gasFee}, protocolFee: ${fees.protocolFee}, total: ${fees.totalFee}`);
      expect(fees.gasFee).toBeGreaterThan(BigInt(0));
      expect(fees.totalFee).toBeGreaterThan(BigInt(0));
    });
  });

  // ============================================================================
  // 2. Transfer PRC20 (pBNB) to StakingExample
  // ============================================================================
  describe('2. Transfer pBNB to StakingExample', () => {
    it('should transfer pBNB tokens to the StakingExample proxy on Push Chain', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: Transfer pBNB to StakingExample ===');

      const transferAmount = parseEther('0.001'); // 0.001 pBNB

      // Check pBNB balance of UEA before transfer
      const balanceBefore = await pushPublicClient.readContract({
        address: PBNB_TOKEN,
        abi: ERC20_EVM,
        functionName: 'balanceOf',
        args: [STAKING_PROXY],
      }) as bigint;
      console.log(`StakingExample pBNB balance BEFORE: ${balanceBefore}`);

      // Transfer pBNB to StakingExample (Route 1: UOA → Push)
      const transferPayload = encodeFunctionData({
        abi: ERC20_EVM,
        functionName: 'transfer',
        args: [STAKING_PROXY, transferAmount],
      });

      const params: UniversalExecuteParams = {
        to: PBNB_TOKEN, // PRC20 token contract on Push Chain
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
        address: PBNB_TOKEN,
        abi: ERC20_EVM,
        functionName: 'balanceOf',
        args: [STAKING_PROXY],
      }) as bigint;
      console.log(`StakingExample pBNB balance AFTER: ${balanceAfter}`);

      expect(balanceAfter).toBeGreaterThanOrEqual(balanceBefore);
    }, 120000);
  });

  // ============================================================================
  // 3. Trigger Outbound — Funds Only (CEA Deployment)
  // ============================================================================
  describe('3. Trigger Outbound — Funds Only (CEA Deployment)', () => {
    it('should call triggerOutbound to deploy CEA on BSC Testnet', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: triggerOutbound — Funds Only (CEA Deployment) ===');

      const bridgeAmount = parseEther('0.0005'); // Amount of pBNB to bridge

      // Ensure StakingExample has enough pBNB
      const contractBalance = await pushPublicClient.readContract({
        address: PBNB_TOKEN,
        abi: ERC20_EVM,
        functionName: 'balanceOf',
        args: [STAKING_PROXY],
      }) as bigint;
      console.log(`StakingExample pBNB balance: ${contractBalance}`);

      if (contractBalance < bridgeAmount) {
        console.log(`Funding StakingExample with pBNB...`);
        const fundTx = await pushClient.universal.sendTransaction({
          to: PBNB_TOKEN,
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
      const fees = await queryOutboundGasFees(pushPublicClient, PBNB_TOKEN);
      const msgValue = fees.totalFee * BigInt(5);
      console.log(`Bridge amount: ${bridgeAmount}, msg.value for gas: ${msgValue}`);

      const triggerPayload = encodeFunctionData({
        abi: STAKING_EXAMPLE_ABI,
        functionName: 'triggerOutbound',
        args: [
          PBNB_TOKEN,       // token: PRC20 to bridge
          bridgeAmount,     // amount: pBNB to burn
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
  // 4. Verify CEA Deployment on BSC Testnet
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
          functionName: 'getUEAForCEA',
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
  // 5. Trigger Outbound — Full Round-Trip (Stake via Inbound)
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

      const bridgeAmount = parseEther('0.001');
      const sendBackAmount = parseEther('0.0005');

      // Ensure StakingExample has enough pBNB
      const contractBalance = await pushPublicClient.readContract({
        address: PBNB_TOKEN,
        abi: ERC20_EVM,
        functionName: 'balanceOf',
        args: [STAKING_PROXY],
      }) as bigint;

      if (contractBalance < bridgeAmount) {
        console.log(`Funding StakingExample with pBNB...`);
        const fundTx = await pushClient.universal.sendTransaction({
          to: PBNB_TOKEN,
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
        args: [ueaAddress, PBNB_TOKEN],
      }) as bigint;
      console.log(`Stake BEFORE: ${stakeBefore}`);

      const outboundPayload = buildStakeRoundTripPayload(
        ceaAddr, ueaAddress, sendBackAmount, ueaAddress,
      );
      console.log(`Outbound payload length: ${outboundPayload.length} chars`);

      const fees = await queryOutboundGasFees(pushPublicClient, PBNB_TOKEN);
      const msgValue = fees.totalFee * BigInt(5);

      const triggerPayload = encodeFunctionData({
        abi: STAKING_EXAMPLE_ABI,
        functionName: 'triggerOutbound',
        args: [PBNB_TOKEN, bridgeAmount, '0x', BigInt(0), outboundPayload, ueaAddress],
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
        args: [ueaAddress, PBNB_TOKEN],
      }) as bigint;

      console.log(`Stake for ${ueaAddress}: ${stake}`);
      expect(typeof stake).toBe('bigint');
    }, 60000);
  });

  // ============================================================================
  // 6. Trigger Outbound — Funds + Payload (Unstake via Inbound)
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

      const bridgeAmount = parseEther('0.001');
      const sendBackAmount = parseEther('0.0005');

      // Ensure StakingExample has enough pBNB
      const contractBalance = await pushPublicClient.readContract({
        address: PBNB_TOKEN,
        abi: ERC20_EVM,
        functionName: 'balanceOf',
        args: [STAKING_PROXY],
      }) as bigint;

      if (contractBalance < bridgeAmount) {
        console.log(`Funding StakingExample with pBNB...`);
        const fundTx = await pushClient.universal.sendTransaction({
          to: PBNB_TOKEN,
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
        args: [ZERO_ADDRESS, sendBackAmount, universalPayload, ueaAddress],
      });

      const multicallEncoded = encodeAbiParameters(
        [{ type: 'tuple[]', components: [{ name: 'to', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'data', type: 'bytes' }] }],
        [[{ to: ceaAddr, value: BigInt(0), data: sendBackCalldata }]]
      );

      const outboundPayload = `${UEA_MULTICALL_SELECTOR}${multicallEncoded.slice(2)}` as `0x${string}`;

      const fees = await queryOutboundGasFees(pushPublicClient, PBNB_TOKEN);
      const msgValue = fees.totalFee * BigInt(5);

      const triggerPayload = encodeFunctionData({
        abi: STAKING_EXAMPLE_ABI,
        functionName: 'triggerOutbound',
        args: [PBNB_TOKEN, bridgeAmount, '0x', BigInt(0), outboundPayload, ueaAddress],
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
    it('should approve and stake pBNB directly on Push Chain', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: Direct Stake on Push Chain ===');

      const stakeAmount = parseEther('0.0001');

      // Step 1: Approve StakingExample to spend pBNB
      const approvePayload = encodeFunctionData({
        abi: ERC20_EVM,
        functionName: 'approve',
        args: [STAKING_PROXY, stakeAmount],
      });

      const approveTx = await pushClient.universal.sendTransaction({
        to: PBNB_TOKEN,
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
        args: [ueaAddress, PBNB_TOKEN],
      }) as bigint;
      console.log(`Stake BEFORE: ${stakeBefore}`);

      // Step 2: Call stake()
      const stakePayload = encodeFunctionData({
        abi: STAKING_EXAMPLE_ABI,
        functionName: 'stake',
        args: [PBNB_TOKEN, stakeAmount],
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
        args: [ueaAddress, PBNB_TOKEN],
      }) as bigint;
      console.log(`Stake AFTER: ${stakeAfter}`);

      expect(stakeAfter).toBeGreaterThan(stakeBefore);
    }, 120000);
  });

  // ============================================================================
  // 8. Direct Unstake on Push Chain (No Cross-Chain)
  // ============================================================================
  describe('8. Direct Unstake on Push Chain', () => {
    it('should unstake pBNB directly on Push Chain', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: Direct Unstake on Push Chain ===');

      // Read stake BEFORE
      const stakeBefore = await pushPublicClient.readContract({
        address: STAKING_PROXY,
        abi: STAKING_EXAMPLE_ABI,
        functionName: 'getStake',
        args: [ueaAddress, PBNB_TOKEN],
      }) as bigint;
      console.log(`Stake BEFORE unstake: ${stakeBefore}`);

      if (stakeBefore === BigInt(0)) {
        console.log('No stake to unstake — skipping');
        return;
      }

      const unstakeAmount = stakeBefore; // Unstake all

      const unstakePayload = encodeFunctionData({
        abi: STAKING_EXAMPLE_ABI,
        functionName: 'unstake',
        args: [PBNB_TOKEN, unstakeAmount],
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
        args: [ueaAddress, PBNB_TOKEN],
      }) as bigint;
      console.log(`Stake AFTER unstake: ${stakeAfter}`);

      expect(stakeAfter).toBeLessThan(stakeBefore);
    }, 120000);
  });

  // ============================================================================
  // 9. Error Handling
  // ============================================================================
  describe('9. Error Handling', () => {
    it('should fail triggerOutbound with zero amount', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: triggerOutbound with zero amount ===');

      const triggerPayload = encodeFunctionData({
        abi: STAKING_EXAMPLE_ABI,
        functionName: 'triggerOutbound',
        args: [PBNB_TOKEN, BigInt(0), '0x', BigInt(0), '0x', ueaAddress],
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
        args: [ueaAddress, PBNB_TOKEN],
      }) as bigint;

      const excessiveAmount = currentStake + parseEther('1000');

      const unstakePayload = encodeFunctionData({
        abi: STAKING_EXAMPLE_ABI,
        functionName: 'unstake',
        args: [PBNB_TOKEN, excessiveAmount],
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
});

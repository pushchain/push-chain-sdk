import '@e2e/shared/setup';
/**
 * Mirrors all runnable examples in docs/chain/03-build/08-Send-Multichain-Transactions.mdx.
 * Each `it()` cites the customPropGTagEvent slug + MDX line range.
 *
 * The 3 cascade tests previously lived in __e2e__/push/multichain-docs-examples.spec.ts
 * (since deleted). Funding amounts updated to match the new docs prompts (1 PC, etc.).
 */
import { createWalletClient, http, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { ethers } from 'ethers';
import { PushChain } from '../../../src';
import { CHAIN, PUSH_NETWORK } from '../../../src/lib/constants/enums';
import { CHAIN_INFO } from '../../../src/lib/constants/chain';
import {
  fundSepoliaUoa,
  fundUeaPC,
  fundUeaPRC20,
  makeSepoliaContext,
  makePushContext,
} from '../_helpers/docs-fund';
const COUNTER_PUSH = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const COUNTER_BNB = '0x7f0936bb90e7dcf3edb47199c2005e7184e44cf8';
const SOL_TEST_PROGRAM = '8yNqjrMnFiFbVTVQcKij8tNWWTMdFkrDf9abCGgc2sgx'; // Solana Devnet, base58

// Inlined Anchor IDL — trimmed to just the `receive_sol` instruction used below.
// The full program IDL lives at
// `__fixtures__/test_counter.idl.json`; we inline here so docs readers see the shape.
const testCounterIdl = {
  address: SOL_TEST_PROGRAM,
  metadata: { name: 'test_counter', version: '0.1.0', spec: '0.1.0' },
  instructions: [
    {
      name: 'receive_sol',
      discriminator: [121, 244, 250, 3, 8, 229, 225, 1],
      accounts: [
        { name: 'counter', writable: true, pda: { seeds: [{ kind: 'const', value: [99, 111, 117, 110, 116, 101, 114] }] } }, // 'counter'
        { name: 'recipient', writable: true, address: '89q1AUFb7YREHtjc1aYaPywovPq6tb3GYNPyDUJ3rshi' },
        { name: 'cea_authority', writable: true }, // auto-populated with sender's CEA
        { name: 'system_program', address: '11111111111111111111111111111111' },
      ],
      args: [{ name: 'amount', type: 'u64' }],
    },
  ],
} as const;
const COUNTER_ABI = [
  { inputs: [], name: 'increment', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [], name: 'count', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'countPC', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
] as const;

// AMM swap router on Push Chain testnet (Uniswap V3 fork)
const SWAP_ROUTER_ADDRESS = '0x81b8Bca02580C7d6b636051FDb7baAC436bFb454';
const SWAP_ROUTER_ABI = [
  {
    inputs: [
      {
        components: [
          { internalType: 'address', name: 'tokenIn', type: 'address' },
          { internalType: 'address', name: 'tokenOut', type: 'address' },
          { internalType: 'uint24', name: 'fee', type: 'uint24' },
          { internalType: 'address', name: 'recipient', type: 'address' },
          { internalType: 'uint256', name: 'amountIn', type: 'uint256' },
          { internalType: 'uint256', name: 'amountOutMinimum', type: 'uint256' },
          { internalType: 'uint160', name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
        internalType: 'struct ISwapRouter.ExactInputSingleParams',
        name: 'params',
        type: 'tuple',
      },
    ],
    name: 'exactInputSingle',
    outputs: [{ internalType: 'uint256', name: 'amountOut', type: 'uint256' }],
    stateMutability: 'payable',
    type: 'function',
  },
] as const;
const pETH_ADDRESS = '0x2971824Db68229D087931155C2b8bB820B275809' as `0x${string}`;
const pSOL_ADDRESS = '0x5D525Df2bD99a6e7ec58b76aF2fd95F39874EBed' as `0x${string}`;
const SEPOLIA_CEA_FACTORY = '0x8ED594A83301FEc545fC6c19fc12cF7111777029' as `0x${string}`;

const evmKey = process.env['EVM_PRIVATE_KEY'] as Hex | undefined;
const pushKey = process.env['PUSH_PRIVATE_KEY'] as Hex | undefined;

describe('docs-examples › 08-multichain-transactions', () => {
  /**
   * slug: prepare_transaction
   * MDX: 08:92-149. Demonstrates `prepareTransaction` for Route 1 + Route 2 (no broadcast).
   */
  (evmKey ? it : it.skip)('prepare_transaction — prepares Route 1 + Route 2 transactions', async () => {
    const sepoliaCtx = makeSepoliaContext(evmKey as Hex);
    const account = privateKeyToAccount(generatePrivateKey());
    const walletClient = createWalletClient({
      account,
      chain: sepolia,
      transport: http(CHAIN_INFO[CHAIN.ETHEREUM_SEPOLIA].defaultRPC[0]),
    });
    await fundSepoliaUoa(sepoliaCtx, account.address, '0.005');

    const universalSigner = await PushChain.utils.signer.toUniversalFromKeypair(walletClient, {
      chain: CHAIN.ETHEREUM_SEPOLIA,
      library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
    });
    const client = await PushChain.initialize(universalSigner, {
      network: PUSH_NETWORK.TESTNET_DONUT,
    });

    const data = PushChain.utils.helpers.encodeTxData({
      abi: [...COUNTER_ABI],
      functionName: 'increment',
    });

    const prepared = await client.universal.prepareTransaction({
      to: COUNTER_PUSH,
      value: BigInt(0),
      data,
    });
    expect(prepared.route).toBeDefined();
    expect(typeof prepared.estimatedGas).toBe('bigint');
    expect(typeof prepared.nonce).toBe('bigint');
    expect(typeof prepared.deadline).toBe('bigint');

    const preparedCrossChain = await client.universal.prepareTransaction({
      to: { address: COUNTER_PUSH, chain: PushChain.CONSTANTS.CHAIN.ETHEREUM_SEPOLIA },
      value: BigInt(0),
      data,
    });
    expect(preparedCrossChain.route).toBeDefined();
    expect(typeof preparedCrossChain.estimatedGas).toBe('bigint');
  }, 60_000);

  /**
   * slug: execute_transactions_counter
   * MDX: 08:231-313. 3-hop cascade: Push counter + BNB counter + Solana counter via CPI.
   * Fund 0.005 ETH (UOA) + 1 PC (UEA).
   */
  ((evmKey && pushKey) ? it : it.skip)('execute_transactions_counter — Push + BNB + Solana counter cascade', async () => {
    const sepoliaCtx = makeSepoliaContext(evmKey as Hex);
    const pushCtx = makePushContext(pushKey as Hex);
    const account = privateKeyToAccount(generatePrivateKey());
    const walletClient = createWalletClient({
      account,
      chain: sepolia,
      transport: http(CHAIN_INFO[CHAIN.ETHEREUM_SEPOLIA].defaultRPC[0]),
    });

    const universalSigner = await PushChain.utils.signer.toUniversalFromKeypair(walletClient, {
      chain: CHAIN.ETHEREUM_SEPOLIA,
      library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
    });
    const client = await PushChain.initialize(universalSigner, {
      network: PUSH_NETWORK.TESTNET_DONUT,
    });

    PushChain.utils.svm.registerIdl(SOL_TEST_PROGRAM, testCounterIdl as any);

    await fundSepoliaUoa(sepoliaCtx, account.address, '0.005');
    await fundUeaPC(pushCtx, client.universal.account as `0x${string}`, '5');

    const calldata = PushChain.utils.helpers.encodeTxData({
      abi: [...COUNTER_ABI],
      functionName: 'increment',
    });

    const hop0 = await client.universal.prepareTransaction({ to: COUNTER_PUSH, value: BigInt(0), data: calldata });
    const hop1 = await client.universal.prepareTransaction({
      to: { address: COUNTER_BNB, chain: PushChain.CONSTANTS.CHAIN.BNB_TESTNET },
      value: BigInt(0),
      data: calldata,
    });
    const solCalldata = PushChain.utils.helpers.encodeTxData({
      abi: testCounterIdl as any,
      functionName: 'receive_sol',
      args: [BigInt(0)],
    });
    const hop2 = await client.universal.prepareTransaction({
      to: { address: SOL_TEST_PROGRAM, chain: PushChain.CONSTANTS.CHAIN.SOLANA_DEVNET },
      value: BigInt(0),
      data: solCalldata,
    });

    const cascade = await client.universal.executeTransactions([hop0, hop1, hop2]);
    expect(cascade.hopCount).toBe(3);

    const result = await cascade.wait({
      progressHook: (e: any) => console.log(`  [Hop ${e.hopIndex}] ${e.status} on ${e.chain}`),
    });
    expect(result.success).toBe(true);
  }, 600_000);

  /**
   * slug: execute_transactions
   * MDX: 08:334-471. Cross-chain AMM swap — CEA→Push pulls 0.001 ETH, swaps pETH→pSOL, bridges pSOL to Solana.
   * Fund 0.005 ETH (UOA) + 0.005 ETH (Sepolia CEA) + 1 PC + 0.002 pETH (UEA).
   */
  ((evmKey && pushKey) ? it : it.skip)('execute_transactions — 3-hop CEA→Push AMM→Solana cascade', async () => {
    const sepoliaCtx = makeSepoliaContext(evmKey as Hex);
    const pushCtx = makePushContext(pushKey as Hex);
    const account = privateKeyToAccount(generatePrivateKey());
    const walletClient = createWalletClient({
      account,
      chain: sepolia,
      transport: http(CHAIN_INFO[CHAIN.ETHEREUM_SEPOLIA].defaultRPC[0]),
    });

    const universalSigner = await PushChain.utils.signer.toUniversalFromKeypair(walletClient, {
      chain: CHAIN.ETHEREUM_SEPOLIA,
      library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
    });
    const client = await PushChain.initialize(universalSigner, {
      network: PUSH_NETWORK.TESTNET_DONUT,
    });

    // Derive Sepolia CEA so we can fund it
    const result = (await sepoliaCtx.publicClient.readContract({
      address: SEPOLIA_CEA_FACTORY,
      abi: [
        {
          name: 'getCEAForPushAccount',
          type: 'function',
          stateMutability: 'view',
          inputs: [{ name: 'a', type: 'address' }],
          outputs: [
            { name: 'cea', type: 'address' },
            { name: 'deployed', type: 'bool' },
          ],
        },
      ] as const,
      functionName: 'getCEAForPushAccount',
      args: [client.universal.account as `0x${string}`],
    })) as readonly [`0x${string}`, boolean];
    const sepoliaCEA = result[0];

    const AMOUNT_IN = PushChain.utils.helpers.parseUnits('0.001', 18);

    await fundSepoliaUoa(sepoliaCtx, account.address, '0.005');
    await fundSepoliaUoa(sepoliaCtx, sepoliaCEA, '0.005');
    await fundUeaPC(pushCtx, client.universal.account as `0x${string}`, '5');
    await fundUeaPRC20(
      pushCtx,
      client.universal.account as `0x${string}`,
      pETH_ADDRESS,
      '0.002',
      18,
      'pETH'
    );

    const hop0 = await client.universal.prepareTransaction({
      from: { chain: PushChain.CONSTANTS.CHAIN.ETHEREUM_SEPOLIA },
      to: account.address,
      value: BigInt(0),
      data: '0x',
      funds: { amount: AMOUNT_IN, token: PushChain.CONSTANTS.MOVEABLE.TOKEN.ETHEREUM_SEPOLIA.ETH },
    });
    const hop1 = await client.universal.prepareTransaction({
      to: SWAP_ROUTER_ADDRESS,
      value: BigInt(0),
      data: PushChain.utils.helpers.encodeTxData({
        abi: [...SWAP_ROUTER_ABI],
        functionName: 'exactInputSingle',
        args: [
          {
            tokenIn: pETH_ADDRESS,
            tokenOut: pSOL_ADDRESS,
            fee: 3000,
            recipient: client.universal.account as `0x${string}`,
            amountIn: AMOUNT_IN,
            amountOutMinimum: BigInt(0),
            sqrtPriceLimitX96: BigInt(0),
          },
        ],
      }),
    });
    const uoa = PushChain.utils.account.toUniversal(account.address, {
      chain: PushChain.CONSTANTS.CHAIN.ETHEREUM_SEPOLIA,
    });
    const solanaCEA = await PushChain.utils.account.deriveExecutorAccount(uoa, {
      chain: PushChain.CONSTANTS.CHAIN.SOLANA_DEVNET,
      skipNetworkCheck: true,
    });
    const hop2 = await client.universal.prepareTransaction({
      to: { address: solanaCEA.address, chain: PushChain.CONSTANTS.CHAIN.SOLANA_DEVNET },
      value: BigInt(0),
      data: '0x',
      funds: { amount: AMOUNT_IN, token: PushChain.CONSTANTS.MOVEABLE.TOKEN.PUSH_TESTNET_DONUT.pSol },
    });

    const cascade = await client.universal.executeTransactions([hop0, hop1, hop2]);
    expect(cascade.hopCount).toBe(3);

    const cascadeResult = await cascade.wait({
      progressHook: (e: any) => console.log(`  [Hop ${e.hopIndex}] ${e.status} on ${e.chain}`),
    });
    expect(cascadeResult.success).toBe(true);
  }, 600_000);

  /**
   * slug: execute_transactions_fund_and_call
   * MDX: 08:489-567. 2-hop cascade: Hop 0 (Route 1) Push counter, Hop 1 (Route 2) BNB counter via CEA.
   * Fund 0.005 ETH (UOA) + 1 PC (UEA).
   */
  ((evmKey && pushKey) ? it : it.skip)('execute_transactions_fund_and_call — Route 1 + Route 2 cascade', async () => {
    const sepoliaCtx = makeSepoliaContext(evmKey as Hex);
    const pushCtx = makePushContext(pushKey as Hex);
    const account = privateKeyToAccount(generatePrivateKey());
    const walletClient = createWalletClient({
      account,
      chain: sepolia,
      transport: http(CHAIN_INFO[CHAIN.ETHEREUM_SEPOLIA].defaultRPC[0]),
    });

    const universalSigner = await PushChain.utils.signer.toUniversalFromKeypair(walletClient, {
      chain: CHAIN.ETHEREUM_SEPOLIA,
      library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
    });
    const client = await PushChain.initialize(universalSigner, {
      network: PUSH_NETWORK.TESTNET_DONUT,
    });

    await fundSepoliaUoa(sepoliaCtx, account.address, '0.005');
    await fundUeaPC(pushCtx, client.universal.account as `0x${string}`, '5');

    const pushProvider = new ethers.JsonRpcProvider(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]);
    const bnbProvider = new ethers.JsonRpcProvider(CHAIN_INFO[CHAIN.BNB_TESTNET].defaultRPC[0]);
    const pushCounter = new ethers.Contract(COUNTER_PUSH, [...COUNTER_ABI], pushProvider);
    const bnbCounter = new ethers.Contract(COUNTER_BNB, [...COUNTER_ABI], bnbProvider);
    const pushBefore = (await pushCounter['countPC']()) as bigint;
    const bnbBefore = (await bnbCounter['count']()) as bigint;

    const calldata = PushChain.utils.helpers.encodeTxData({
      abi: [...COUNTER_ABI],
      functionName: 'increment',
    });
    const hop0 = await client.universal.prepareTransaction({
      to: COUNTER_PUSH,
      value: BigInt(0),
      data: calldata,
    });
    const hop1 = await client.universal.prepareTransaction({
      to: { address: COUNTER_BNB, chain: PushChain.CONSTANTS.CHAIN.BNB_TESTNET },
      value: BigInt(0),
      data: calldata,
    });

    const cascade = await client.universal.executeTransactions([hop0, hop1]);
    expect(cascade.hopCount).toBe(2);
    const eventStream: string[] = [];
    const result = await cascade.wait({
      progressHook: (e: any) => console.log(`  [Hop ${e.hopIndex}] ${e.status} on ${e.chain}`),
      eventHook: (event) => {
        eventStream.push(event.id);
        console.log(`  [event] ${event.id} | ${event.title}`);
      },
    });
    expect(result.success).toBe(true);

    const pushAfter = (await pushCounter['countPC']()) as bigint;
    const bnbAfter = (await bnbCounter['count']()) as bigint;
    expect(pushAfter).toBe(pushBefore + BigInt(1));
    expect(bnbAfter).toBe(bnbBefore + BigInt(1));

    // Multichain marker assertions — confirm 001/002/999 wired through cascade
    expect(eventStream).toContain('SEND-TX-001');
    expect(eventStream).toContain('SEND-TX-002-01');
    expect(eventStream).toContain('SEND-TX-002-99-99');
    expect(eventStream).toContain('SEND-TX-999-01');
  }, 600_000);

  /**
   * slug: execute_transactions_batch
   * MDX: 08:584-679. 3-hop cascade: Push + BNB + Solana counters in one signature.
   * Fund 0.005 ETH (UOA) + 1 PC (UEA).
   */
  ((evmKey && pushKey) ? it : it.skip)('execute_transactions_batch — Push + BNB + Solana cascade asserts counter increments', async () => {
    const sepoliaCtx = makeSepoliaContext(evmKey as Hex);
    const pushCtx = makePushContext(pushKey as Hex);
    const account = privateKeyToAccount(generatePrivateKey());
    const walletClient = createWalletClient({
      account,
      chain: sepolia,
      transport: http(CHAIN_INFO[CHAIN.ETHEREUM_SEPOLIA].defaultRPC[0]),
    });

    const universalSigner = await PushChain.utils.signer.toUniversalFromKeypair(walletClient, {
      chain: CHAIN.ETHEREUM_SEPOLIA,
      library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
    });
    const client = await PushChain.initialize(universalSigner, {
      network: PUSH_NETWORK.TESTNET_DONUT,
    });

    PushChain.utils.svm.registerIdl(SOL_TEST_PROGRAM, testCounterIdl as any);

    await fundSepoliaUoa(sepoliaCtx, account.address, '0.005');
    await fundUeaPC(pushCtx, client.universal.account as `0x${string}`, '5');

    const pushProvider = new ethers.JsonRpcProvider(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]);
    const bnbProvider = new ethers.JsonRpcProvider(CHAIN_INFO[CHAIN.BNB_TESTNET].defaultRPC[0]);
    const pushCounter = new ethers.Contract(COUNTER_PUSH, [...COUNTER_ABI], pushProvider);
    const bnbCounter = new ethers.Contract(COUNTER_BNB, [...COUNTER_ABI], bnbProvider);
    const pushBefore = (await pushCounter['countPC']()) as bigint;
    const bnbBefore = (await bnbCounter['count']()) as bigint;

    const calldata = PushChain.utils.helpers.encodeTxData({
      abi: [...COUNTER_ABI],
      functionName: 'increment',
    });
    const hop0 = await client.universal.prepareTransaction({
      to: COUNTER_PUSH,
      value: BigInt(0),
      data: calldata,
    });
    const hop1 = await client.universal.prepareTransaction({
      to: { address: COUNTER_BNB, chain: PushChain.CONSTANTS.CHAIN.BNB_TESTNET },
      value: BigInt(0),
      data: calldata,
    });
    const solCalldata = PushChain.utils.helpers.encodeTxData({
      abi: testCounterIdl as any,
      functionName: 'receive_sol',
      args: [BigInt(0)],
    });
    const hop2 = await client.universal.prepareTransaction({
      to: { address: SOL_TEST_PROGRAM, chain: PushChain.CONSTANTS.CHAIN.SOLANA_DEVNET },
      value: BigInt(0),
      data: solCalldata,
    });

    const cascade = await client.universal.executeTransactions([hop0, hop1, hop2]);
    expect(cascade.hopCount).toBe(3);
    const result = await cascade.wait({
      progressHook: (e: any) => console.log(`  [Hop ${e.hopIndex}] ${e.status} on ${e.chain}`),
    });
    expect(result.success).toBe(true);

    const pushAfter = (await pushCounter['countPC']()) as bigint;
    const bnbAfter = (await bnbCounter['count']()) as bigint;
    expect(pushAfter).toBe(pushBefore + BigInt(1));
    expect(bnbAfter).toBe(bnbBefore + BigInt(1));
  }, 600_000);
});

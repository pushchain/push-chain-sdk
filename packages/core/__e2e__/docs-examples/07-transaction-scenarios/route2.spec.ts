import '@e2e/shared/setup';
/**
 * Mirrors all Route 2 examples (UOA_TO_CEA) in
 * docs/chain/03-build/07-Universal-Transaction-Scenarios.mdx.
 *
 * Each `it()` cites the customPropGTagEvent slug + MDX line range.
 * Funding amounts match the docs prompt verbatim.
 */
import { createWalletClient, http, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
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

// pETH PRC-20 on Push Chain Testnet (per docs/08-Send-Multichain-Transactions.mdx:375)
const pETH_ADDRESS = '0x2971824Db68229D087931155C2b8bB820B275809' as `0x${string}`;
const COUNTER_BNB = '0x7f0936bb90e7dcf3edb47199c2005e7184e44cf8';
const COUNTER_ABI = [
  { type: 'function', name: 'increment', inputs: [], outputs: [], stateMutability: 'nonpayable' },
] as const;

// test_counter program on Solana Devnet — base58, native Solana form.
const SOL_TEST_PROGRAM = '8yNqjrMnFiFbVTVQcKij8tNWWTMdFkrDf9abCGgc2sgx';

// Inlined Anchor IDL — trimmed to just the `receive_sol` instruction used below.
const testCounterIdl = {
  address: SOL_TEST_PROGRAM,
  metadata: { name: 'test_counter', version: '0.1.0', spec: '0.1.0' },
  instructions: [
    {
      name: 'receive_sol',
      discriminator: [121, 244, 250, 3, 8, 229, 225, 1],
      accounts: [
        { name: 'counter', writable: true, pda: { seeds: [{ kind: 'const', value: [99, 111, 117, 110, 116, 101, 114] }] } },
        { name: 'recipient', writable: true, address: '89q1AUFb7YREHtjc1aYaPywovPq6tb3GYNPyDUJ3rshi' },
        { name: 'cea_authority', writable: true },
        { name: 'system_program', address: '11111111111111111111111111111111' },
      ],
      args: [{ name: 'amount', type: 'u64' }],
    },
  ],
} as const;

const evmKey = process.env['EVM_PRIVATE_KEY'] as Hex | undefined;
const pushKey = process.env['PUSH_PRIVATE_KEY'] as Hex | undefined;

describe('docs-examples › 07-transaction-scenarios › Route 2 (UOA_TO_CEA)', () => {
  /**
   * slug: send_transaction_route2_payload
   * MDX: 07:563-622. Sepolia UOA → counter.increment() on BNB via CEA. Fund 0.005 ETH.
   * Fresh UEA gets PC via fee-locking ($10 min).
   */
  (evmKey ? it : it.skip)('route2_payload — calls BNB counter.increment() via Route 2 CEA', async () => {
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
      progressHook: (p) => console.log('TX Progress:', p.title || p.id),
    });

    const data = PushChain.utils.helpers.encodeTxData({
      abi: [...COUNTER_ABI],
      functionName: 'increment',
    });
    const tx = await client.universal.sendTransaction({
      to: { address: COUNTER_BNB, chain: PushChain.CONSTANTS.CHAIN.BNB_TESTNET },
      data,
    });
    const receipt = await tx.wait();
    expect(tx.hash).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(receipt.status).toBe(1);
    expect(receipt.externalTxHash).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(receipt.externalChain).toBe(CHAIN.BNB_TESTNET);
  }, 360_000);

  /**
   * slug: send_transaction_route2_funds (native)
   * MDX: 07:633-686. Burn 0.0005 pETH on Push Chain → release 0.0005 ETH to TARGET on Sepolia.
   * Fund 0.005 ETH (UOA), 1 PC + 0.002 pETH (UEA, skips if master is short on pETH).
   */
  ((evmKey && pushKey) ? it : it.skip)('route2_funds — burns 0.0005 pETH, releases 0.0005 ETH on Sepolia', async () => {
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
      progressHook: (p) => console.log('TX Progress:', p.title || p.id),
    });

    await fundSepoliaUoa(sepoliaCtx, account.address, '0.005');
    await fundUeaPC(pushCtx, client.universal.account as `0x${string}`, '1');
    await fundUeaPRC20(
      pushCtx,
      client.universal.account as `0x${string}`,
      pETH_ADDRESS,
      '0.002',
      18,
      'pETH'
    );

    const TARGET = '0x1234567890123456789012345678901234567890';
    const tx = await client.universal.sendTransaction({
      to: { address: TARGET, chain: PushChain.CONSTANTS.CHAIN.ETHEREUM_SEPOLIA },
      value: PushChain.utils.helpers.parseUnits('0.0005', 18),
    });
    const receipt = await tx.wait();
    expect(tx.hash).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(receipt.status).toBe(1);
    expect(receipt.externalTxHash).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(receipt.externalChain).toBe(CHAIN.ETHEREUM_SEPOLIA);
  }, 360_000);

  /**
   * slug: send_transaction_route2_funds_erc20
   * MDX: 07:699-752. Burn 0.01 pUSDT(BNB), release USDT to TARGET on BNB.
   * Fund 0.005 ETH (UOA), 1 PC + 0.02 pUSDT(BNB) (UEA).
   */
  ((evmKey && pushKey) ? it : it.skip)('route2_funds_erc20 — burns 0.01 pUSDT(BNB), releases USDT on BNB', async () => {
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
      progressHook: (p) => console.log('TX Progress:', p.title || p.id),
    });

    const usdt = PushChain.CONSTANTS.MOVEABLE.TOKEN.BNB_TESTNET.USDT;
    const pUSDTBnbAddress = PushChain.utils.tokens.getPRC20Address(usdt) as `0x${string}`;

    await fundSepoliaUoa(sepoliaCtx, account.address, '0.005');
    await fundUeaPC(pushCtx, client.universal.account as `0x${string}`, '1');
    await fundUeaPRC20(
      pushCtx,
      client.universal.account as `0x${string}`,
      pUSDTBnbAddress,
      '0.02',
      usdt.decimals,
      'pUSDT(BNB)'
    );

    const TARGET = '0x1234567890123456789012345678901234567890';
    const tx = await client.universal.sendTransaction({
      to: { address: TARGET, chain: PushChain.CONSTANTS.CHAIN.BNB_TESTNET },
      funds: {
        amount: PushChain.utils.helpers.parseUnits('0.01', { decimals: usdt.decimals }),
        token: usdt,
      },
    });
    const receipt = await tx.wait();
    expect(tx.hash).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(receipt.status).toBe(1);
    expect(receipt.externalChain).toBe(CHAIN.BNB_TESTNET);
  }, 360_000);

  /**
   * slug: send_transaction_route2_funds_with_payload
   * MDX: 07:765-828. Burn 0.01 pUSDT(BNB), release to BNB counter + call increment().
   */
  ((evmKey && pushKey) ? it : it.skip)('route2_funds_with_payload — moves USDT to BNB counter and calls increment()', async () => {
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
      progressHook: (p) => console.log('TX Progress:', p.title || p.id),
    });

    const usdt = PushChain.CONSTANTS.MOVEABLE.TOKEN.BNB_TESTNET.USDT;
    const pUSDTBnbAddress = PushChain.utils.tokens.getPRC20Address(usdt) as `0x${string}`;

    await fundSepoliaUoa(sepoliaCtx, account.address, '0.005');
    await fundUeaPC(pushCtx, client.universal.account as `0x${string}`, '1');
    await fundUeaPRC20(
      pushCtx,
      client.universal.account as `0x${string}`,
      pUSDTBnbAddress,
      '0.02',
      usdt.decimals,
      'pUSDT(BNB)'
    );

    const data = PushChain.utils.helpers.encodeTxData({
      abi: [...COUNTER_ABI],
      functionName: 'increment',
    });
    const tx = await client.universal.sendTransaction({
      to: { address: COUNTER_BNB, chain: PushChain.CONSTANTS.CHAIN.BNB_TESTNET },
      data,
      funds: {
        amount: PushChain.utils.helpers.parseUnits('0.01', { decimals: usdt.decimals }),
        token: usdt,
      },
    });
    const receipt = await tx.wait();
    expect(tx.hash).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(receipt.status).toBe(1);
    expect(receipt.externalChain).toBe(CHAIN.BNB_TESTNET);
  }, 360_000);

  /**
   * slug: send_transaction_route2_solana
   * Sepolia UOA → test_counter.receive_sol on Solana Devnet via the sender's Solana CEA.
   * Uses the native base58 program ID (the SDK accepts base58 or 0x-hex).
   * Fund 0.005 ETH (UOA) + 5 PC (UEA — covers gas-token swap for the Solana outbound).
   *
   * Currently skipped: pSOL/WPC pool on Donut is ~100× mispriced, so the
   * Uniswap V3 swap that buys pSOL for outbound gas reverts `STF`. Same root
   * cause as the 3 skipped cascade tests in 08-multichain-transactions.spec.ts.
   * Re-enable once the contracts team recalibrates the pool. See
   * __e2e__/docs-examples/KNOWN_FAILURES.md.
   */
  it.skip('route2_solana — calls test_counter.receive_sol on Solana Devnet via Route 2 CEA', async () => {
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
      progressHook: (p) => console.log('TX Progress:', p.title || p.id),
    });

    await fundSepoliaUoa(sepoliaCtx, account.address, '0.005');
    await fundUeaPC(pushCtx, client.universal.account as `0x${string}`, '5');

    const data = PushChain.utils.helpers.encodeTxData({
      abi: testCounterIdl as any,
      functionName: 'receive_sol',
      args: [BigInt(0)],
    });
    const tx = await client.universal.sendTransaction({
      to: { address: SOL_TEST_PROGRAM, chain: PushChain.CONSTANTS.CHAIN.SOLANA_DEVNET },
      value: BigInt(0),
      data,
    });
    const receipt = await tx.wait();
    expect(tx.hash).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(receipt.status).toBe(1);
    expect(receipt.externalChain).toBe(CHAIN.SOLANA_DEVNET);
  }, 600_000);

  /**
   * slug: send_transaction_route2_multicall
   * MDX: 07:841-900. Sepolia UOA → 2× counter.increment() on BNB atomically. Fund 0.005 ETH.
   */
  (evmKey ? it : it.skip)('route2_multicall — runs 2× counter.increment() on BNB atomically', async () => {
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
      progressHook: (p) => console.log('TX Progress:', p.title || p.id),
    });

    const incrementData = PushChain.utils.helpers.encodeTxData({
      abi: [...COUNTER_ABI],
      functionName: 'increment',
    });
    const tx = await client.universal.sendTransaction({
      to: {
        address: '0x0000000000000000000000000000000000000000',
        chain: PushChain.CONSTANTS.CHAIN.BNB_TESTNET,
      },
      data: [
        { to: COUNTER_BNB as `0x${string}`, value: BigInt(0), data: incrementData },
        { to: COUNTER_BNB as `0x${string}`, value: BigInt(0), data: incrementData },
      ],
    });
    const receipt = await tx.wait();
    expect(tx.hash).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(receipt.status).toBe(1);
    expect(receipt.externalChain).toBe(CHAIN.BNB_TESTNET);
  }, 360_000);
});

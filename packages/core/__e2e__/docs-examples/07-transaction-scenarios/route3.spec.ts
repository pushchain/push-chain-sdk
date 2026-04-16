import '@e2e/shared/setup';
/**
 * Mirrors all Route 3 examples (CEA_TO_PUSH) in
 * docs/chain/03-build/07-Universal-Transaction-Scenarios.mdx.
 *
 * Each `it()` cites the customPropGTagEvent slug + MDX line range.
 * `EVM_PRIVATE_KEY` is reused for both the Sepolia UOA (signer gas) and the BNB CEA
 * funding — same address holds both balances since BSC Testnet is EVM.
 */
import { createWalletClient, http, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { PushChain } from '../../../src';
import { CHAIN, PUSH_NETWORK } from '../../../src/lib/constants/enums';
import { CHAIN_INFO } from '../../../src/lib/constants/chain';
import {
  fundSepoliaUoa,
  fundBnbCea,
  fundBnbCeaUsdt,
  deriveBnbCea,
  makeSepoliaContext,
  makeBnbContext,
} from '../_helpers/docs-fund';

const COUNTER_PUSH = '0x70d8f7a0fF8e493fb9cbEE19Eb780E40Aa872aaf';
const COUNTER_ABI = [
  { type: 'function', name: 'increment', inputs: [], outputs: [], stateMutability: 'payable' },
] as const;

const evmKey = process.env['EVM_PRIVATE_KEY'] as Hex | undefined;

describe('docs-examples › 07-transaction-scenarios › Route 3 (CEA_TO_PUSH)', () => {
  /**
   * slug: send_transaction_route3_payload
   * MDX: 07:915-979. BNB CEA → counter.increment() on Push Chain.
   * Fund 0.005 ETH (UOA) + 0.02 BNB (CEA).
   */
  (evmKey ? it : it.skip)('route3_payload — BNB CEA → counter.increment() on Push Chain', async () => {
    const sepoliaCtx = makeSepoliaContext(evmKey as Hex);
    const bnbCtx = makeBnbContext(evmKey as Hex);
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

    const ceaAddress = await deriveBnbCea(bnbCtx, client.universal.account as `0x${string}`);
    console.log('CEA on BNB Testnet:', ceaAddress);
    await fundSepoliaUoa(sepoliaCtx, account.address, '0.005');
    await fundBnbCea(bnbCtx, ceaAddress, '0.02');

    const data = PushChain.utils.helpers.encodeTxData({
      abi: [...COUNTER_ABI],
      functionName: 'increment',
    });
    const tx = await client.universal.sendTransaction({
      from: { chain: PushChain.CONSTANTS.CHAIN.BNB_TESTNET },
      to: COUNTER_PUSH,
      data,
    });
    const receipt = await tx.wait();
    expect(tx.hash).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(receipt.status).toBe(1);
  }, 360_000);

  /**
   * slug: send_transaction_route3_native
   * MDX: 07:993-1048. BNB CEA bridges 0.00005 BNB → Push Chain UEA.
   * Fund 0.005 ETH (UOA) + 0.02 BNB (CEA).
   */
  (evmKey ? it : it.skip)('route3_native — bridges 0.00005 BNB from BNB CEA → Push Chain UEA', async () => {
    const sepoliaCtx = makeSepoliaContext(evmKey as Hex);
    const bnbCtx = makeBnbContext(evmKey as Hex);
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

    const ceaAddress = await deriveBnbCea(bnbCtx, client.universal.account as `0x${string}`);
    await fundSepoliaUoa(sepoliaCtx, account.address, '0.005');
    await fundBnbCea(bnbCtx, ceaAddress, '0.02');

    const tx = await client.universal.sendTransaction({
      from: { chain: PushChain.CONSTANTS.CHAIN.BNB_TESTNET },
      to: client.universal.account,
      value: PushChain.utils.helpers.parseUnits('0.00005', 18),
    });
    const receipt = await tx.wait();
    expect(tx.hash).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(receipt.status).toBe(1);
  }, 360_000);

  /**
   * slug: send_transaction_route3_funds
   * MDX: 07:1062-1117. BNB CEA bridges 0.01 USDT → Push Chain UEA.
   * Fund 0.005 ETH (UOA) + 0.02 BNB + 0.02 USDT (CEA).
   */
  (evmKey ? it : it.skip)('route3_funds — bridges 0.01 USDT from BNB CEA → Push Chain UEA', async () => {
    const sepoliaCtx = makeSepoliaContext(evmKey as Hex);
    const bnbCtx = makeBnbContext(evmKey as Hex);
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

    const ceaAddress = await deriveBnbCea(bnbCtx, client.universal.account as `0x${string}`);
    const usdt = PushChain.CONSTANTS.MOVEABLE.TOKEN.BNB_TESTNET.USDT;
    await fundSepoliaUoa(sepoliaCtx, account.address, '0.005');
    await fundBnbCeaUsdt(bnbCtx, ceaAddress, '0.02', '0.02', usdt);

    const tx = await client.universal.sendTransaction({
      from: { chain: PushChain.CONSTANTS.CHAIN.BNB_TESTNET },
      to: client.universal.account,
      funds: { amount: BigInt(10000), token: usdt },
    });
    const receipt = await tx.wait();
    expect(tx.hash).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(receipt.status).toBe(1);
  }, 360_000);

  /**
   * slug: send_transaction_route3_funds_with_payload
   * MDX: 07:1131-1195. BNB CEA bridges 0.01 USDT and calls counter.increment() on Push Chain.
   */
  (evmKey ? it : it.skip)('route3_funds_with_payload — bridges 0.01 USDT + calls counter.increment()', async () => {
    const sepoliaCtx = makeSepoliaContext(evmKey as Hex);
    const bnbCtx = makeBnbContext(evmKey as Hex);
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

    const ceaAddress = await deriveBnbCea(bnbCtx, client.universal.account as `0x${string}`);
    const usdt = PushChain.CONSTANTS.MOVEABLE.TOKEN.BNB_TESTNET.USDT;
    await fundSepoliaUoa(sepoliaCtx, account.address, '0.005');
    await fundBnbCeaUsdt(bnbCtx, ceaAddress, '0.02', '0.02', usdt);

    const data = PushChain.utils.helpers.encodeTxData({
      abi: [...COUNTER_ABI],
      functionName: 'increment',
    });
    const tx = await client.universal.sendTransaction({
      from: { chain: PushChain.CONSTANTS.CHAIN.BNB_TESTNET },
      to: COUNTER_PUSH,
      data,
      funds: { amount: BigInt(10000), token: usdt },
    });
    const receipt = await tx.wait();
    expect(tx.hash).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(receipt.status).toBe(1);
  }, 360_000);

  /**
   * slug: send_transaction_route3_multicall
   * MDX: 07:1209-1271. BNB CEA → 2× counter.increment() on Push Chain. Fund 0.005 ETH + 0.02 BNB.
   */
  (evmKey ? it : it.skip)('route3_multicall — 2× counter.increment() on Push Chain via Route 3 multicall', async () => {
    const sepoliaCtx = makeSepoliaContext(evmKey as Hex);
    const bnbCtx = makeBnbContext(evmKey as Hex);
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

    const ceaAddress = await deriveBnbCea(bnbCtx, client.universal.account as `0x${string}`);
    await fundSepoliaUoa(sepoliaCtx, account.address, '0.005');
    await fundBnbCea(bnbCtx, ceaAddress, '0.02');

    const incrementData = PushChain.utils.helpers.encodeTxData({
      abi: [...COUNTER_ABI],
      functionName: 'increment',
    });
    const tx = await client.universal.sendTransaction({
      from: { chain: PushChain.CONSTANTS.CHAIN.BNB_TESTNET },
      to: '0x0000000000000000000000000000000000000000',
      data: [
        { to: COUNTER_PUSH as `0x${string}`, value: BigInt(0), data: incrementData },
        { to: COUNTER_PUSH as `0x${string}`, value: BigInt(0), data: incrementData },
      ],
    });
    const receipt = await tx.wait();
    expect(tx.hash).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(receipt.status).toBe(1);
  }, 360_000);
});

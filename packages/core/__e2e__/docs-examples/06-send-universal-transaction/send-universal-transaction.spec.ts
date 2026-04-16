import '@e2e/shared/setup';
/**
 * Mirrors all runnable examples in docs/chain/03-build/06-Send-Universal-Transaction.mdx.
 * Each `it()` cites the customPropGTagEvent slug + MDX line range it mirrors.
 *
 * Funding for each test matches the docs ":::prompt:::" line verbatim, but is performed
 * automatically from a master wallet (env vars) instead of asking the user.
 */
import { createWalletClient, http, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { Keypair } from '@solana/web3.js';
import { PushChain } from '../../../src';
import { CHAIN, PUSH_NETWORK } from '../../../src/lib/constants/enums';
import { CHAIN_INFO } from '../../../src/lib/constants/chain';
import {
  PUSH_CHAIN_DEF,
  fundUeaPC,
  fundSepoliaUoa,
  fundSolanaUoa,
  makePushContext,
  makeSepoliaContext,
  makeSolanaContext,
} from '../_helpers/docs-fund';

const RECIPIENT = '0x0000000000000000000000000000000000042101' as `0x${string}`;

const evmKey = process.env['EVM_PRIVATE_KEY'] as Hex | undefined;
const pushKey = process.env['PUSH_PRIVATE_KEY'] as Hex | undefined;
const solanaKey = process.env['SOLANA_PRIVATE_KEY'];

describe('docs-examples › 06-send-universal-transaction', () => {
  /**
   * slug: send_transaction_ethers_basic | viem_basic
   * MDX: 06:343-378 (ethers) and 06:493-585 (viem). SDK calls are identical, so one
   * test covers both — Push Chain UOA sends 0.001 PC to a dummy address.
   */
  (pushKey ? it : it.skip)('send_transaction_ethers_basic / viem_basic — Push UOA sends 0.001 PC', async () => {
    const pushCtx = makePushContext(pushKey as Hex);
    const account = privateKeyToAccount(generatePrivateKey());
    const walletClient = createWalletClient({
      account,
      chain: PUSH_CHAIN_DEF,
      transport: http(PUSH_CHAIN_DEF.rpcUrls.default.http[0]),
    });

    await fundUeaPC(pushCtx, account.address, '1');

    const universalSigner = await PushChain.utils.signer.toUniversalFromKeypair(walletClient, {
      chain: CHAIN.PUSH_TESTNET_DONUT,
      library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
    });
    const client = await PushChain.initialize(universalSigner, {
      network: PUSH_NETWORK.TESTNET_DONUT,
      progressHook: (p) => console.log('Progress:', p.title || p.id),
    });

    const tx = await client.universal.sendTransaction({
      to: RECIPIENT,
      value: PushChain.utils.helpers.parseUnits('0.001', 18),
    });
    expect(tx.hash).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(tx.chainId).toBeDefined();
    const receipt = await tx.wait();
    expect(receipt.status).toBe(1);
  }, 120_000);

  /**
   * slug: send_transaction_solana_basic
   * MDX: 06:598-665. Solana UOA on devnet sends 0.001 PC via Push Chain.
   * Funded with 0.02 SOL.
   */
  (solanaKey ? it : it.skip)('send_transaction_solana_basic — Solana UOA sends 0.001 PC', async () => {
    const ctx = makeSolanaContext(solanaKey as string);
    const keypair = Keypair.generate();
    await fundSolanaUoa(ctx, keypair.publicKey.toBase58(), '0.02');

    const universalSigner = await PushChain.utils.signer.toUniversalFromKeypair(keypair, {
      chain: PushChain.CONSTANTS.CHAIN.SOLANA_DEVNET,
      library: PushChain.CONSTANTS.LIBRARY.SOLANA_WEB3JS,
    });
    const client = await PushChain.initialize(universalSigner, {
      network: PUSH_NETWORK.TESTNET_DONUT,
      progressHook: (p) => console.log('Progress:', p.title || p.id),
    });

    const tx = await client.universal.sendTransaction({
      to: RECIPIENT,
      value: PushChain.utils.helpers.parseUnits('0.001', 18),
    });
    expect(tx.hash).toBeDefined();
    const receipt = await tx.wait();
    expect(receipt.status).toBe(1);
  }, 180_000);

  /**
   * slug: send_transaction_ethers_with_prompt
   * MDX: 06:391-480. Docs example asks user to pick origin chain at runtime
   * (1=Push Testnet, 2=Sepolia). Both branches exercise identical SDK calls; we test both.
   */
  (pushKey ? it : it.skip)('send_transaction_ethers_with_prompt — chain=1 (Push Chain)', async () => {
    const pushCtx = makePushContext(pushKey as Hex);
    const account = privateKeyToAccount(generatePrivateKey());
    const walletClient = createWalletClient({
      account,
      chain: PUSH_CHAIN_DEF,
      transport: http(PUSH_CHAIN_DEF.rpcUrls.default.http[0]),
    });
    await fundUeaPC(pushCtx, account.address, '1');

    const universalSigner = await PushChain.utils.signer.toUniversalFromKeypair(walletClient, {
      chain: CHAIN.PUSH_TESTNET_DONUT,
      library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
    });
    const client = await PushChain.initialize(universalSigner, {
      network: PUSH_NETWORK.TESTNET_DONUT,
    });
    const tx = await client.universal.sendTransaction({
      to: RECIPIENT,
      value: PushChain.utils.helpers.parseUnits('0.001', 18),
    });
    expect(tx.hash).toMatch(/^0x[0-9a-fA-F]{64}$/);
    const receipt = await tx.wait();
    expect(receipt.status).toBe(1);
  }, 120_000);

  (evmKey ? it : it.skip)('send_transaction_ethers_with_prompt — chain=2 (Sepolia)', async () => {
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
    const tx = await client.universal.sendTransaction({
      to: RECIPIENT,
      value: PushChain.utils.helpers.parseUnits('0.001', 18),
    });
    expect(tx.hash).toMatch(/^0x[0-9a-fA-F]{64}$/);
    const receipt = await tx.wait();
    expect(receipt.status).toBe(1);
  }, 240_000);
});

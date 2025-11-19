import { sepolia } from 'viem/chains';
import bs58 from 'bs58';
import { CHAIN_INFO } from '../constants/chain';
import { CHAIN } from '../constants/enums';
import { UniversalSigner } from '../universal/universal.types';
import { PushChain } from './push-chain';
import dotenv from 'dotenv';
import path from 'path';
import { privateKeyToAccount } from 'viem/accounts';
import { createWalletClient, defineChain, http, isAddress } from 'viem';
import { Keypair, PublicKey } from '@solana/web3.js';

dotenv.config({ path: path.resolve(process.cwd(), 'packages/core/.env') }) ||
  dotenv.config({ path: path.resolve(__dirname, '../../.env') });
const EVM_RPC =
  process.env['EVM_RPC'] || CHAIN_INFO[CHAIN.ETHEREUM_SEPOLIA].defaultRPC[0];

describe('universal.account and universal.origin', () => {
  let pushClientEVM: PushChain;
  let pushChainPush: PushChain;
  let pushChainSVM: PushChain;
  let universalSignerEVM: UniversalSigner;
  let universalSignerPush: UniversalSigner;
  let universalSignerSVM: UniversalSigner;

  beforeAll(async () => {
    const evmPrivateKey = process.env['EVM_PRIVATE_KEY'];
    if (!evmPrivateKey) throw new Error('EVM_PRIVATE_KEY not set in core/.env');
    const account = privateKeyToAccount(evmPrivateKey as `0x${string}`);
    const walletClient = createWalletClient({
      account,
      chain: sepolia,
      transport: http(EVM_RPC),
    });
    universalSignerEVM = await PushChain.utils.signer.toUniversalFromKeypair(
      walletClient,
      {
        chain: PushChain.CONSTANTS.CHAIN.ETHEREUM_SEPOLIA,
        library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
      }
    );
    pushClientEVM = await PushChain.initialize(universalSignerEVM, {
      network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
      rpcUrls: { [CHAIN.ETHEREUM_SEPOLIA]: [EVM_RPC] },
      progressHook: (progress) => console.log(progress),
    });

    const pushTestnet = defineChain({
      id: parseInt(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].chainId),
      name: 'Push Testnet',
      nativeCurrency: {
        decimals: 18,
        name: 'PC',
        symbol: '$PC',
      },
      rpcUrls: {
        default: {
          http: [CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]],
        },
      },
      blockExplorers: {
        default: {
          name: 'Push Testnet Explorer',
          url: 'https://explorer.testnet.push.org/',
        },
      },
    });
    const accountPush = privateKeyToAccount(evmPrivateKey as `0x${string}`);
    const walletClientPush = createWalletClient({
      account: accountPush,
      chain: pushTestnet,
      transport: http(),
    });
    universalSignerPush = await PushChain.utils.signer.toUniversalFromKeypair(
      walletClientPush,
      {
        chain: PushChain.CONSTANTS.CHAIN.PUSH_TESTNET_DONUT,
        library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
      }
    );
    pushChainPush = await PushChain.initialize(universalSignerPush, {
      network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
      rpcUrls: { [CHAIN.ETHEREUM_SEPOLIA]: [EVM_RPC] },
      progressHook: (progress) => console.log(progress),
    });

    const privateKeyHex = process.env['SOLANA_PRIVATE_KEY'];
    if (!privateKeyHex) throw new Error('SOLANA_PRIVATE_KEY not set');

    const privateKey = bs58.decode(privateKeyHex);

    const accountSVM = Keypair.fromSecretKey(privateKey);

    universalSignerSVM = await PushChain.utils.signer.toUniversalFromKeypair(
      accountSVM,
      {
        chain: PushChain.CONSTANTS.CHAIN.SOLANA_DEVNET,
        library: PushChain.CONSTANTS.LIBRARY.SOLANA_WEB3JS,
      }
    );
    pushChainSVM = await PushChain.initialize(universalSignerSVM, {
      network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
      rpcUrls: { [CHAIN.ETHEREUM_SEPOLIA]: [EVM_RPC] },
      progressHook: (progress) => console.log(progress),
    });
  });

  describe('get account', () => {
    it('EVM', async () => {
      const address = pushClientEVM.universal.account;
      expect(isAddress(address)).toBeTruthy();
      expect(address).not.toBe(universalSignerEVM.account.address);
    });

    it('Push', async () => {
      const address = pushChainPush.universal.account;
      expect(address).toBeDefined();
      expect(address).toBe(universalSignerPush.account.address);
    });

    it('SVM', async () => {
      const address = pushChainSVM.universal.account;
      expect(isAddress(address)).toBeTruthy();
      expect(address).not.toBe(universalSignerSVM.account.address);
    });
  });

  describe('get origin', () => {
    it('EVM', async () => {
      const uoa = pushClientEVM.universal.origin;
      expect(uoa).toBeDefined();
      expect(uoa.chain).toBe(universalSignerEVM.account.chain);
      expect(isAddress(uoa.address)).toBe(true);
    });

    it('Push', async () => {
      const uoa = pushChainPush.universal.origin;
      expect(uoa).toBeDefined();
      expect(uoa.chain).toBe(universalSignerPush.account.chain);
      expect(isAddress(uoa.address)).toBe(true);
    });

    it('SVM', async () => {
      const uoa = pushChainSVM.universal.origin;
      expect(uoa).toBeDefined();
      expect(uoa.chain).toBe(universalSignerSVM.account.chain);

      let isValid = true;
      try {
        new PublicKey(uoa.address);
      } catch {
        isValid = false;
      }

      expect(isValid).toBe(true);
    });
  });
});

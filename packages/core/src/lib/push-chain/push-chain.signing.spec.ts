import { createWalletClient, defineChain, http, verifyMessage } from 'viem';
import bs58 from 'bs58';
import { UniversalSigner } from '../universal/universal.types';
import { PushChain } from './push-chain';
import { privateKeyToAccount } from 'viem/accounts';
import dotenv from 'dotenv';
import path from 'path';
import { CHAIN_INFO } from '../constants/chain';
import { CHAIN } from '../constants/enums';
import { sepolia } from 'viem/chains';
import { Keypair } from '@solana/web3.js';

dotenv.config({ path: path.resolve(process.cwd(), 'packages/core/.env') }) ||
  dotenv.config({ path: path.resolve(__dirname, '../../.env') });
const EVM_RPC =
  process.env['EVM_RPC'] || CHAIN_INFO[CHAIN.ETHEREUM_SEPOLIA].defaultRPC[0];

describe('Signing Methods', () => {
  let pushClientEVM: PushChain;
  let pushChainPush: PushChain;
  let pushChainSVM: PushChain;
  let universalSignerEVM: UniversalSigner;
  let universalSignerPush: UniversalSigner;
  let universalSignerSVM: UniversalSigner;

  describe('signMessage', () => {
    beforeAll(async () => {
      const evmPrivateKey = process.env['EVM_PRIVATE_KEY'];
      if (!evmPrivateKey)
        throw new Error('EVM_PRIVATE_KEY not set in core/.env');
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

    it('should signMessage - EVM format', async () => {
      const testMessage = new TextEncoder().encode('Hello, Push Chain!');
      const signatureEVM = await pushClientEVM.universal.signMessage(
        testMessage
      );
      const signaturePush = await pushChainPush.universal.signMessage(
        testMessage
      );

      // Verify signature format (should be hex for EVM)
      expect(signatureEVM).toMatch(/^0x[a-fA-F0-9]+$/);
      expect(signatureEVM.length).toBeGreaterThan(2); // At least 0x + some hex chars

      expect(signaturePush).toMatch(/^0x[a-fA-F0-9]+$/);
      expect(signaturePush.length).toBeGreaterThan(2); // At least 0x + some hex chars

      // Verify the signature is valid
      const isValidEVM = await verifyMessage({
        address: universalSignerEVM.account.address as `0x${string}`,
        message: { raw: testMessage },
        signature: signatureEVM as `0x${string}`,
      });

      expect(isValidEVM).toBe(true);

      const isValidPush = await verifyMessage({
        address: universalSignerPush.account.address as `0x${string}`,
        message: { raw: testMessage },
        signature: signaturePush as `0x${string}`,
      });

      expect(isValidPush).toBe(true);
    });

    it('should signMessage - binary data', async () => {
      const binaryData = new Uint8Array([1, 2, 3, 4, 5, 255, 0, 128]);
      const signatureEVM = await pushClientEVM.universal.signMessage(
        binaryData
      );
      const signaturePush = await pushChainPush.universal.signMessage(
        binaryData
      );

      expect(signatureEVM).toMatch(/^0x[a-fA-F0-9]+$/);
      expect(signatureEVM.length).toBeGreaterThan(2); // At least 0x + some hex chars

      // Verify the signature is valid
      const isValidEVM = await verifyMessage({
        address: universalSignerEVM.account.address as `0x${string}`,
        message: { raw: binaryData },
        signature: signatureEVM as `0x${string}`,
      });

      expect(isValidEVM).toBe(true);

      const isValidPush = await verifyMessage({
        address: universalSignerPush.account.address as `0x${string}`,
        message: { raw: binaryData },
        signature: signaturePush as `0x${string}`,
      });

      expect(isValidPush).toBe(true);
    });
  });

  describe('signTypedData', () => {
    it('should signTypedData - EIP-712 format', async () => {
      const domain = {
        name: 'Push Chain',
        version: '1',
        chainId: 42101, // Push testnet
        verifyingContract:
          '0x1234567890123456789012345678901234567890' as `0x${string}`,
      };

      const types = {
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address' },
        ],
      };

      const message = {
        name: 'Alice',
        wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826' as `0x${string}`,
      };

      const signatureEVM = await pushClientEVM.universal.signTypedData({
        domain,
        types,
        primaryType: 'Person',
        message,
      });

      // Verify signature format (should be hex for EVM)
      expect(signatureEVM).toMatch(/^0x[a-fA-F0-9]+$/);
      expect(signatureEVM.length).toBeGreaterThan(2);

      expect(typeof signatureEVM).toBe('string');

      const signaturePush = await pushChainPush.universal.signTypedData({
        domain,
        types,
        primaryType: 'Person',
        message,
      });

      expect(signaturePush).toMatch(/^0x[a-fA-F0-9]+$/);
      expect(signaturePush.length).toBeGreaterThan(2);

      expect(typeof signaturePush).toBe('string');
    });
  });
});

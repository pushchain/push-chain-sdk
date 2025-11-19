import { Keypair } from '@solana/web3.js';
import { createWalletClient, defineChain, http } from 'viem';
import bs58 from 'bs58';
import { UniversalSigner } from '../universal/universal.types';
import { UniversalAccount } from '../universal/universal.types';
import { PushChain } from './push-chain';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import dotenv from 'dotenv';
import path from 'path';
import { CHAIN } from '../constants/enums';
import { CHAIN_INFO } from '../constants/chain';

dotenv.config({ path: path.resolve(process.cwd(), 'packages/core/.env') }) ||
  dotenv.config({ path: path.resolve(__dirname, '../../.env') });
const EVM_RPC =
  process.env['EVM_RPC'] || CHAIN_INFO[CHAIN.ETHEREUM_SEPOLIA].defaultRPC[0];

describe('Read Only Mode', () => {
  let pushClientEVM: PushChain;
  let pushChainPush: PushChain;
  let pushChainSVM: PushChain;
  let universalSignerEVM: UniversalSigner;
  let universalSignerPush: UniversalSigner;
  let universalSignerSVM: UniversalSigner;

  let readOnlyAccountEVM: UniversalAccount;
  let readOnlyAccountPush: UniversalAccount;
  let readOnlyAccountSVM: UniversalAccount;
  let readOnlyPushClientEVM: PushChain;
  let readOnlyPushClientPush: PushChain;
  let readOnlyPushClientSVM: PushChain;

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

    // Create read-only accounts from existing signers
    readOnlyAccountEVM = {
      address: pushClientEVM.universal.origin.address,
      chain: pushClientEVM.universal.origin.chain,
    };

    readOnlyAccountPush = {
      address: pushChainPush.universal.origin.address,
      chain: pushChainPush.universal.origin.chain,
    };

    readOnlyAccountSVM = {
      address: pushChainSVM.universal.origin.address,
      chain: pushChainSVM.universal.origin.chain,
    };

    // Initialize read-only clients
    readOnlyPushClientEVM = await PushChain.initialize(readOnlyAccountEVM, {
      network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
    });

    readOnlyPushClientPush = await PushChain.initialize(readOnlyAccountPush, {
      network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
    });

    readOnlyPushClientSVM = await PushChain.initialize(readOnlyAccountSVM, {
      network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
    });
  });

  describe('Initialization', () => {
    it('should successfully initialize with UniversalAccount (EVM)', async () => {
      expect(readOnlyPushClientEVM).toBeDefined();
      expect(readOnlyPushClientEVM.universal).toBeDefined();
    });

    it('should successfully initialize with UniversalAccount (Push)', async () => {
      expect(readOnlyPushClientPush).toBeDefined();
      expect(readOnlyPushClientPush.universal).toBeDefined();
    });

    it('should successfully initialize with UniversalAccount (SVM)', async () => {
      expect(readOnlyPushClientSVM).toBeDefined();
      expect(readOnlyPushClientSVM.universal).toBeDefined();
    });
  });

  describe('Read-only restrictions', () => {
    it('should throw error when calling signMessage on read-only EVM client', async () => {
      const testMessage = new TextEncoder().encode('Hello, Push Chain!');

      await expect(
        readOnlyPushClientEVM.universal.signMessage(testMessage)
      ).rejects.toThrow('Read only mode cannot call signMessage function');
    });

    it('should throw error when calling signMessage on read-only Push client', async () => {
      const testMessage = new TextEncoder().encode('Hello, Push Chain!');

      await expect(
        readOnlyPushClientPush.universal.signMessage(testMessage)
      ).rejects.toThrow('Read only mode cannot call signMessage function');
    });

    it('should throw error when calling signMessage on read-only SVM client', async () => {
      const testMessage = new TextEncoder().encode('Hello, Push Chain!');

      await expect(
        readOnlyPushClientSVM.universal.signMessage(testMessage)
      ).rejects.toThrow('Read only mode cannot call signMessage function');
    });

    it('should throw error when calling sendTransaction on read-only EVM client', () => {
      const mockTxData = {
        to: '0x1234567890123456789012345678901234567890' as `0x${string}`,
        value: BigInt(1000000000000000000), // 1 ETH
        data: '0x' as `0x${string}`,
        gas: BigInt(21000),
      };

      expect(() =>
        readOnlyPushClientEVM.universal.sendTransaction(mockTxData)
      ).toThrow('Read only mode cannot call sendTransaction function');
    });

    it('should throw error when calling sendTransaction on read-only Push client', () => {
      const mockTxData = {
        to: '0x1234567890123456789012345678901234567890' as `0x${string}`,
        value: BigInt(1000000000000000000), // 1 ETH
        data: '0x' as `0x${string}`,
        gas: BigInt(21000),
      };

      expect(() =>
        readOnlyPushClientPush.universal.sendTransaction(mockTxData)
      ).toThrow('Read only mode cannot call sendTransaction function');
    });

    it('should throw error when calling sendTransaction on read-only SVM client', () => {
      const mockTxData = {
        to: '0x1234567890123456789012345678901234567890' as `0x${string}`,
        value: BigInt(1000000000000000000), // 1 ETH
        data: '0x' as `0x${string}`,
        gas: BigInt(21000),
      };

      expect(() =>
        readOnlyPushClientSVM.universal.sendTransaction(mockTxData)
      ).toThrow('Read only mode cannot call sendTransaction function');
    });

    it('should throw error when calling signTypedData on read-only EVM client', async () => {
      const typedData = {
        domain: {
          name: 'Test',
          version: '1',
          chainId: 11155111,
        },
        types: {
          Message: [{ name: 'content', type: 'string' }],
        },
        primaryType: 'Message',
        message: {
          content: 'Hello, typed data!',
        },
      };

      await expect(
        readOnlyPushClientEVM.universal.signTypedData(typedData)
      ).rejects.toThrow('Typed data signing not supported');
    });
  });

  describe('Read-only allowed operations', () => {
    it('should allow accessing origin property on read-only client', () => {
      const origin = readOnlyPushClientEVM.universal.origin;
      expect(origin).toBeDefined();
      expect(typeof origin.address).toBe('string');
      expect(typeof origin.chain).toBe('string');
    });

    it('should allow accessing account property on read-only client', () => {
      const account = readOnlyPushClientEVM.universal.account;
      expect(account).toBeDefined();
      expect(typeof account).toBe('string');
      expect(account.startsWith('0x')).toBe(true);
    });

    it('should allow accessing explorer methods on read-only client', () => {
      const txUrl = readOnlyPushClientEVM.explorer.getTransactionUrl('0x123');
      expect(typeof txUrl).toBe('string');
      expect(txUrl).toContain('0x123');

      const { urls } = readOnlyPushClientEVM.explorer.listUrls();
      expect(Array.isArray(urls)).toBe(true);
    });

    it('should allow accessing static constants and utils on read-only client', () => {
      expect(PushChain.CONSTANTS).toBeDefined();
      expect(PushChain.utils).toBeDefined();
    });
  });

  describe('Comparison with writable clients', () => {
    it('should have same origin and account addresses as writable client', () => {
      // Compare EVM clients
      expect(readOnlyPushClientEVM.universal.origin.address).toBe(
        pushClientEVM.universal.origin.address
      );
      expect(readOnlyPushClientEVM.universal.account).toBe(
        pushClientEVM.universal.account
      );

      // Compare Push clients
      expect(readOnlyPushClientPush.universal.origin.address).toBe(
        pushChainPush.universal.origin.address
      );
      expect(readOnlyPushClientPush.universal.account).toBe(
        pushChainPush.universal.account
      );

      // Compare SVM clients
      expect(readOnlyPushClientSVM.universal.origin.address).toBe(
        pushChainSVM.universal.origin.address
      );
      expect(readOnlyPushClientSVM.universal.account).toBe(
        pushChainSVM.universal.account
      );
    });

    it('should allow signMessage on writable client but not on read-only client', async () => {
      const testMessage = new TextEncoder().encode('Test message');

      // Writable client should work
      const signature = await pushClientEVM.universal.signMessage(testMessage);
      expect(typeof signature).toBe('string');
      expect(signature.length).toBeGreaterThan(0);

      // Read-only client should throw error
      await expect(
        readOnlyPushClientEVM.universal.signMessage(testMessage)
      ).rejects.toThrow('Read only mode cannot call signMessage function');
    });
  });

  describe('Type checking', () => {
    it('should correctly identify UniversalAccount vs UniversalSigner during initialization', async () => {
      // Test with UniversalSigner - should not be read-only
      const writableClient = pushClientEVM;

      const testMessage = new TextEncoder().encode('Test');
      const signature = await writableClient.universal.signMessage(testMessage);
      expect(typeof signature).toBe('string');

      // Test with UniversalAccount - should be read-only
      const readOnlyAccount: UniversalAccount = {
        address: writableClient.universal.origin.address,
        chain: writableClient.universal.origin.chain,
      };

      const readOnlyClient = await PushChain.initialize(readOnlyAccount, {
        network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
      });

      await expect(
        readOnlyClient.universal.signMessage(testMessage)
      ).rejects.toThrow('Read only mode cannot call signMessage function');
    });
  });
});

import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { UniversalSigner } from '../universal/universal.types';
import { PushChain } from './push-chain';
import { createWalletClient, defineChain, http } from 'viem';
import { sepolia } from 'viem/chains';
import dotenv from 'dotenv';
import path from 'path';
import { CHAIN } from '../constants/enums';
import { CHAIN_INFO } from '../constants/chain';

dotenv.config({ path: path.resolve(process.cwd(), 'packages/core/.env') }) ||
  dotenv.config({ path: path.resolve(__dirname, '../../.env') });
const EVM_RPC =
  process.env['EVM_RPC'] || CHAIN_INFO[CHAIN.ETHEREUM_SEPOLIA].defaultRPC[0];

describe('Reinitialize Method', () => {
  let pushClientEVM: PushChain;
  let universalSignerEVM: UniversalSigner;
  let universalSignerEVM2: UniversalSigner;
  let universalSignerPush: UniversalSigner;

  beforeAll(async () => {
    // Create first EVM signer
    const account1 = privateKeyToAccount(generatePrivateKey());
    const walletClient1 = createWalletClient({
      account: account1,
      chain: sepolia,
      transport: http(EVM_RPC),
    });
    universalSignerEVM = await PushChain.utils.signer.toUniversalFromKeypair(
      walletClient1,
      {
        chain: PushChain.CONSTANTS.CHAIN.ETHEREUM_SEPOLIA,
        library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
      }
    );

    // Create second EVM signer for testing signer change
    const account2 = privateKeyToAccount(generatePrivateKey());
    const walletClient2 = createWalletClient({
      account: account2,
      chain: sepolia,
      transport: http(EVM_RPC),
    });
    universalSignerEVM2 = await PushChain.utils.signer.toUniversalFromKeypair(
      walletClient2,
      {
        chain: PushChain.CONSTANTS.CHAIN.ETHEREUM_SEPOLIA,
        library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
      }
    );

    // Create Push signer
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
    const accountPush = privateKeyToAccount(generatePrivateKey());
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

    // Initialize first client
    pushClientEVM = await PushChain.initialize(universalSignerEVM, {
      network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
    });
  });

  describe('Basic functionality', () => {
    it('should reinitialize with same signer and return new instance', async () => {
      const newClient = await pushClientEVM.reinitialize(universalSignerEVM, {
        network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
      });

      // Should be different instances
      expect(newClient).not.toBe(pushClientEVM);

      // But should have same addresses since same signer
      expect(newClient.universal.origin.address).toBe(
        pushClientEVM.universal.origin.address
      );
      expect(newClient.universal.account).toBe(pushClientEVM.universal.account);
    });

    it('should reinitialize with different signer', async () => {
      const newClient = await pushClientEVM.reinitialize(universalSignerEVM2, {
        network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
      });

      // Should be different instances
      expect(newClient).not.toBe(pushClientEVM);

      // Should have different addresses since different signer
      expect(newClient.universal.origin.address).not.toBe(
        pushClientEVM.universal.origin.address
      );
      expect(newClient.universal.account).not.toBe(
        pushClientEVM.universal.account
      );

      // New client should have the new signer's address
      expect(newClient.universal.origin.address).toBe(
        universalSignerEVM2.account.address
      );
    });

    it('should reinitialize with different chain signer', async () => {
      const newClient = await pushClientEVM.reinitialize(universalSignerPush, {
        network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
      });

      // Should be different instances
      expect(newClient).not.toBe(pushClientEVM);

      // Should have different chain and addresses
      expect(newClient.universal.origin.chain).toBe(
        PushChain.CONSTANTS.CHAIN.PUSH_TESTNET_DONUT
      );
      expect(newClient.universal.origin.chain).not.toBe(
        pushClientEVM.universal.origin.chain
      );
    });
  });

  describe('With different options', () => {
    it('should reinitialize with custom RPC URLs', async () => {
      const customRpcUrls = {
        [CHAIN.ETHEREUM_SEPOLIA]: ['https://custom-sepolia.rpc.com'],
      };

      const newClient = await pushClientEVM.reinitialize(universalSignerEVM, {
        network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
        rpcUrls: customRpcUrls,
      });

      expect(newClient).not.toBe(pushClientEVM);
      expect(newClient).toBeDefined();
    });

    it('should reinitialize with custom block explorers', async () => {
      const customBlockExplorers = {
        [CHAIN.PUSH_TESTNET_DONUT]: [
          'https://custom-explorer1.push.network',
          'https://custom-explorer2.push.network',
        ],
      };

      const newClient = await pushClientEVM.reinitialize(universalSignerEVM, {
        network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
        blockExplorers: customBlockExplorers,
      });

      expect(newClient).not.toBe(pushClientEVM);

      const { urls } = newClient.explorer.listUrls();
      expect(urls).toEqual([
        'https://custom-explorer1.push.network',
        'https://custom-explorer2.push.network',
      ]);
    });

    it('should reinitialize with printTraces enabled', async () => {
      const newClient = await pushClientEVM.reinitialize(universalSignerEVM, {
        network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
        printTraces: true,
      });

      expect(newClient).not.toBe(pushClientEVM);
      expect(newClient).toBeDefined();
    });

    it('should reinitialize with progress hook', async () => {
      const progressEvents: any[] = [];
      const progressHook = (progress: any) => {
        progressEvents.push(progress);
      };

      const newClient = await pushClientEVM.reinitialize(universalSignerEVM, {
        network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
        progressHook,
      });

      expect(newClient).not.toBe(pushClientEVM);
      expect(newClient).toBeDefined();
    });
  });
});

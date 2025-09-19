import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import bs58 from 'bs58';
import {
  UniversalSigner,
  UniversalAccount,
} from '../universal/universal.types';
import { PushChain } from './push-chain';
import {
  createWalletClient,
  createPublicClient,
  defineChain,
  http,
  isAddress,
  verifyMessage,
} from 'viem';
import { sepolia } from 'viem/chains';
import { keccak256, toBytes } from 'viem';
import { MulticallCall } from '../orchestrator/orchestrator.types';
import { CHAIN_INFO } from '../constants/chain';
import { CHAIN } from '../constants/enums';
import { Keypair, PublicKey } from '@solana/web3.js';
import dotenv from 'dotenv';
import path from 'path';

// Load env from the core package root
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
describe('PushChain', () => {
  describe('Universal Namesapce', () => {
    let pushClientEVM: PushChain;
    let pushChainPush: PushChain;
    let pushChainSVM: PushChain;
    let universalSignerEVM: UniversalSigner;
    let universalSignerPush: UniversalSigner;
    let universalSignerSVM: UniversalSigner;

    beforeAll(async () => {
      const evmPrivateKey = process.env['EVM_PRIVATE_KEY'];
      if (!evmPrivateKey)
        throw new Error('EVM_PRIVATE_KEY not set in core/.env');
      const account = privateKeyToAccount(evmPrivateKey as `0x${string}`);
      const walletClient = createWalletClient({
        account,
        chain: sepolia,
        transport: http(),
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
      });
    });

    describe('signMessage', () => {
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

    describe('Multicall', () => {
      const COUNTER_ADDRESS =
        '0x5FbDB2315678afecb367f032d93F642f64180aa3' as `0x${string}`;

      const CounterABI = [
        {
          inputs: [],
          name: 'increment',
          outputs: [],
          stateMutability: 'nonpayable',
          type: 'function',
        },
        {
          inputs: [],
          name: 'countPC',
          outputs: [
            {
              internalType: 'uint256',
              name: '',
              type: 'uint256',
            },
          ],
          stateMutability: 'view',
          type: 'function',
        },
      ] as const;

      it('should throw if multicall used with invalid to', async () => {
        const incrementData = PushChain.utils.helpers.encodeTxData({
          abi: CounterABI as unknown as any[],
          functionName: 'increment',
        });

        const calls: MulticallCall[] = [
          {
            to: COUNTER_ADDRESS,
            value: BigInt(0),
            data: incrementData as `0x${string}`,
          },
        ];

        await expect(
          pushClientEVM.universal.sendTransaction({
            // Force wrong type to trigger runtime validation
            to: 'invalid-address' as unknown as `0x${string}`,
            value: BigInt(0),
            data: calls,
          })
        ).rejects.toThrow(
          'When using multicall, "to" must be a 0x-prefixed address'
        );
      });

      it('should build and send multicall payload from Sepolia', async () => {
        const incrementData = PushChain.utils.helpers.encodeTxData({
          abi: CounterABI as unknown as any[],
          functionName: 'increment',
        }) as `0x${string}`;

        const calls: MulticallCall[] = [
          { to: COUNTER_ADDRESS, value: BigInt(0), data: incrementData },
          { to: COUNTER_ADDRESS, value: BigInt(0), data: incrementData },
        ];

        const publicClientPush = createPublicClient({
          transport: http('https://evm.rpc-testnet-donut-node1.push.org/'),
        });

        const before = (await publicClientPush.readContract({
          address: COUNTER_ADDRESS,
          abi: CounterABI as unknown as any[],
          functionName: 'countPC',
          args: [],
        })) as unknown as bigint;

        const tx = await pushClientEVM.universal.sendTransaction({
          to: '0x',
          value: BigInt(0),
          data: calls,
        });

        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

        // Multicall payload must be prefixed with bytes4(keccak256("UEA_MULTICALL"))
        const selector = keccak256(toBytes('UEA_MULTICALL')).slice(0, 10);
        expect(tx.data.slice(0, 10)).toBe(selector);

        await tx.wait();

        const after = (await publicClientPush.readContract({
          address: COUNTER_ADDRESS,
          abi: CounterABI as unknown as any[],
          functionName: 'countPC',
          args: [],
        })) as unknown as bigint;

        expect(after).toBe(before + BigInt(2));
      }, 300000);

      it('should throw if multicall used with invalid to (SVM)', async () => {
        const incrementData = PushChain.utils.helpers.encodeTxData({
          abi: CounterABI as unknown as any[],
          functionName: 'increment',
        });

        const calls: MulticallCall[] = [
          {
            to: COUNTER_ADDRESS,
            value: BigInt(0),
            data: incrementData as `0x${string}`,
          },
        ];

        await expect(
          pushChainSVM.universal.sendTransaction({
            to: 'invalid-address' as unknown as `0x${string}`,
            value: BigInt(0),
            data: calls,
          })
        ).rejects.toThrow(
          'When using multicall, "to" must be a 0x-prefixed address'
        );
      });

      it('should build and send multicall payload from Solana Devnet', async () => {
        const incrementData = PushChain.utils.helpers.encodeTxData({
          abi: CounterABI as unknown as any[],
          functionName: 'increment',
        }) as `0x${string}`;

        const calls: MulticallCall[] = [
          { to: COUNTER_ADDRESS, value: BigInt(0), data: incrementData },
          { to: COUNTER_ADDRESS, value: BigInt(0), data: incrementData },
        ];

        const publicClientPush = createPublicClient({
          transport: http('https://evm.rpc-testnet-donut-node1.push.org/'),
        });

        const before = (await publicClientPush.readContract({
          address: COUNTER_ADDRESS,
          abi: CounterABI as unknown as any[],
          functionName: 'countPC',
          args: [],
        })) as unknown as bigint;

        const tx = await pushChainSVM.universal.sendTransaction({
          to: '0x',
          value: BigInt(0),
          data: calls,
        });

        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

        const selector = keccak256(toBytes('UEA_MULTICALL')).slice(0, 10);
        expect(tx.data.slice(0, 10)).toBe(selector);

        await tx.wait();

        const after = (await publicClientPush.readContract({
          address: COUNTER_ADDRESS,
          abi: CounterABI as unknown as any[],
          functionName: 'countPC',
          args: [],
        })) as unknown as bigint;

        expect(after).toBe(before + BigInt(2));
      }, 300000);

      it('should perform normal single-call from Sepolia, Solana Devnet, and Push Testnet', async () => {
        const incrementData = PushChain.utils.helpers.encodeTxData({
          abi: CounterABI as unknown as any[],
          functionName: 'increment',
        }) as `0x${string}`;

        const publicClientPush = createPublicClient({
          transport: http('https://evm.rpc-testnet-donut-node1.push.org/'),
        });

        const before = (await publicClientPush.readContract({
          address: COUNTER_ADDRESS,
          abi: CounterABI as unknown as any[],
          functionName: 'countPC',
          args: [],
        })) as unknown as bigint;

        // 1) From Ethereum Sepolia origin
        const txEvm = await pushClientEVM.universal.sendTransaction({
          to: COUNTER_ADDRESS,
          value: BigInt(0),
          data: incrementData,
        });
        expect(txEvm.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        await txEvm.wait();

        // 2) From Solana Devnet origin
        const txSvm = await pushChainSVM.universal.sendTransaction({
          to: COUNTER_ADDRESS,
          value: BigInt(0),
          data: incrementData,
        });
        expect(txSvm.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        await txSvm.wait();

        // 3) From Push Testnet origin
        const txPush = await pushChainPush.universal.sendTransaction({
          to: COUNTER_ADDRESS,
          value: BigInt(0),
          data: incrementData,
        });
        expect(txPush.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        await txPush.wait();

        const after = (await publicClientPush.readContract({
          address: COUNTER_ADDRESS,
          abi: CounterABI as unknown as any[],
          functionName: 'countPC',
          args: [],
        })) as unknown as bigint;

        expect(after).toBe(before + BigInt(3));
      }, 300000);
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

    describe('Read Only Mode', () => {
      let readOnlyAccountEVM: UniversalAccount;
      let readOnlyAccountPush: UniversalAccount;
      let readOnlyAccountSVM: UniversalAccount;
      let readOnlyPushClientEVM: PushChain;
      let readOnlyPushClientPush: PushChain;
      let readOnlyPushClientSVM: PushChain;

      beforeAll(async () => {
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

        readOnlyPushClientPush = await PushChain.initialize(
          readOnlyAccountPush,
          {
            network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
          }
        );

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
          const txUrl =
            readOnlyPushClientEVM.explorer.getTransactionUrl('0x123');
          expect(typeof txUrl).toBe('string');
          expect(txUrl).toContain('0x123');

          const urls = readOnlyPushClientEVM.explorer.listUrls();
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
          const signature = await pushClientEVM.universal.signMessage(
            testMessage
          );
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
          const signature = await writableClient.universal.signMessage(
            testMessage
          );
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
  });

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
        transport: http(),
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
        transport: http(),
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
        expect(newClient.universal.account).toBe(
          pushClientEVM.universal.account
        );
      });

      it('should reinitialize with different signer', async () => {
        const newClient = await pushClientEVM.reinitialize(
          universalSignerEVM2,
          {
            network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
          }
        );

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
        const newClient = await pushClientEVM.reinitialize(
          universalSignerPush,
          {
            network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
          }
        );

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

        const urls = newClient.explorer.listUrls();
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

  describe('Explorer Namespace', () => {
    it('should get transaction url', async () => {
      const account = privateKeyToAccount(generatePrivateKey());
      const walletClient = createWalletClient({
        account,
        transport: http(
          CHAIN_INFO[PushChain.CONSTANTS.CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]
        ),
      });
      const signer = await PushChain.utils.signer.toUniversalFromKeypair(
        walletClient,
        {
          chain: PushChain.CONSTANTS.CHAIN.PUSH_TESTNET_DONUT,
          library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
        }
      );
      const pushChainClient = await PushChain.initialize(signer, {
        network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
      });

      const txHash = '0x123';
      const url = pushChainClient.explorer.getTransactionUrl(txHash);
      expect(url).toBe(`https://donut.push.network/tx/${txHash}`);
    });

    it('should list default block explorer URLs', async () => {
      const account = privateKeyToAccount(generatePrivateKey());
      const walletClient = createWalletClient({
        account,
        transport: http(
          CHAIN_INFO[PushChain.CONSTANTS.CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]
        ),
      });
      const signer = await PushChain.utils.signer.toUniversalFromKeypair(
        walletClient,
        {
          chain: PushChain.CONSTANTS.CHAIN.PUSH_TESTNET_DONUT,
          library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
        }
      );
      const pushChainClient = await PushChain.initialize(signer, {
        network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
      });

      const urls = pushChainClient.explorer.listUrls();
      expect(Array.isArray(urls)).toBe(true);
      expect(urls).toContain('https://donut.push.network');
      expect(urls.length).toBeGreaterThan(0);
    });

    it('should list custom block explorer URLs when provided', async () => {
      const account = privateKeyToAccount(generatePrivateKey());
      const walletClient = createWalletClient({
        account,
        transport: http(
          CHAIN_INFO[PushChain.CONSTANTS.CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]
        ),
      });
      const signer = await PushChain.utils.signer.toUniversalFromKeypair(
        walletClient,
        {
          chain: PushChain.CONSTANTS.CHAIN.PUSH_TESTNET_DONUT,
          library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
        }
      );

      const customBlockExplorers = {
        [CHAIN.PUSH_TESTNET_DONUT]: [
          'https://custom-explorer1.push.network',
          'https://custom-explorer2.push.network',
        ],
      };

      const pushChainClient = await PushChain.initialize(signer, {
        network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
        blockExplorers: customBlockExplorers,
      });

      const urls = pushChainClient.explorer.listUrls();
      expect(Array.isArray(urls)).toBe(true);
      expect(urls).toEqual([
        'https://custom-explorer1.push.network',
        'https://custom-explorer2.push.network',
      ]);
      expect(urls.length).toBe(2);
    });

    it('should handle multiple chains with different block explorer configurations', async () => {
      const account = privateKeyToAccount(generatePrivateKey());
      const walletClient = createWalletClient({
        account,
        transport: http(
          CHAIN_INFO[PushChain.CONSTANTS.CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]
        ),
      });
      const signer = await PushChain.utils.signer.toUniversalFromKeypair(
        walletClient,
        {
          chain: PushChain.CONSTANTS.CHAIN.PUSH_TESTNET_DONUT,
          library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
        }
      );

      const multiChainBlockExplorers = {
        [CHAIN.PUSH_TESTNET_DONUT]: ['https://donut-explorer.push.network'],
        [CHAIN.ETHEREUM_SEPOLIA]: ['https://sepolia.etherscan.io'],
        [CHAIN.SOLANA_DEVNET]: ['https://explorer.solana.com'],
      };

      const pushChainClient = await PushChain.initialize(signer, {
        network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
        blockExplorers: multiChainBlockExplorers,
      });

      const urls = pushChainClient.explorer.listUrls();
      expect(Array.isArray(urls)).toBe(true);
      expect(urls).toEqual(['https://donut-explorer.push.network']);
      expect(urls.length).toBe(1);
    });
  });

  describe('Helpers Utils Namespace', () => {
    describe('getChainName', () => {
      it('should get chain name', () => {
        // Test Push chains
        expect(PushChain.utils.helpers.getChainName(CHAIN.PUSH_MAINNET)).toBe(
          'PUSH_MAINNET'
        );
        expect(PushChain.utils.helpers.getChainName(CHAIN.PUSH_TESTNET)).toBe(
          'PUSH_TESTNET_DONUT'
        );
        expect(
          PushChain.utils.helpers.getChainName(CHAIN.PUSH_TESTNET_DONUT)
        ).toBe('PUSH_TESTNET_DONUT');
        expect(PushChain.utils.helpers.getChainName(CHAIN.PUSH_LOCALNET)).toBe(
          'PUSH_LOCALNET'
        );
        // Test Ethereum chains
        expect(
          PushChain.utils.helpers.getChainName(CHAIN.ETHEREUM_MAINNET)
        ).toBe('ETHEREUM_MAINNET');
        expect(
          PushChain.utils.helpers.getChainName(CHAIN.ETHEREUM_SEPOLIA)
        ).toBe('ETHEREUM_SEPOLIA');
        // Test Solana chains
        expect(PushChain.utils.helpers.getChainName(CHAIN.SOLANA_MAINNET)).toBe(
          'SOLANA_MAINNET'
        );
        expect(PushChain.utils.helpers.getChainName(CHAIN.SOLANA_TESTNET)).toBe(
          'SOLANA_TESTNET'
        );
        expect(PushChain.utils.helpers.getChainName(CHAIN.SOLANA_DEVNET)).toBe(
          'SOLANA_DEVNET'
        );
      });

      it('should handle chain values directly', () => {
        // Test with raw chain values
        expect(PushChain.utils.helpers.getChainName('eip155:9')).toBe(
          'PUSH_MAINNET'
        );
        expect(PushChain.utils.helpers.getChainName('eip155:42101')).toBe(
          'PUSH_TESTNET_DONUT'
        );
        expect(PushChain.utils.helpers.getChainName('eip155:9001')).toBe(
          'PUSH_LOCALNET'
        );
        expect(PushChain.utils.helpers.getChainName('eip155:1')).toBe(
          'ETHEREUM_MAINNET'
        );
        expect(PushChain.utils.helpers.getChainName('eip155:11155111')).toBe(
          'ETHEREUM_SEPOLIA'
        );
        expect(
          PushChain.utils.helpers.getChainName(
            'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'
          )
        ).toBe('SOLANA_MAINNET');
        expect(
          PushChain.utils.helpers.getChainName(
            'solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z'
          )
        ).toBe('SOLANA_TESTNET');
        expect(
          PushChain.utils.helpers.getChainName(
            'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'
          )
        ).toBe('SOLANA_DEVNET');
      });

      it('should throw error for invalid chain values', () => {
        // Test with invalid chain values
        expect(() =>
          PushChain.utils.helpers.getChainName('invalid-chain')
        ).toThrow("Chain value 'invalid-chain' not found in CHAIN enum");
        expect(() =>
          PushChain.utils.helpers.getChainName('eip155:999999')
        ).toThrow("Chain value 'eip155:999999' not found in CHAIN enum");
        expect(() =>
          PushChain.utils.helpers.getChainName('solana:invalid')
        ).toThrow("Chain value 'solana:invalid' not found in CHAIN enum");
        expect(() => PushChain.utils.helpers.getChainName('')).toThrow(
          "Chain value '' not found in CHAIN enum"
        );
      });

      it('should handle case sensitivity correctly', () => {
        // Test that the function is case sensitive
        expect(() => PushChain.utils.helpers.getChainName('EIP155:1')).toThrow(
          "Chain value 'EIP155:1' not found in CHAIN enum"
        );
        expect(() =>
          PushChain.utils.helpers.getChainName(
            'SOLANA:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'
          )
        ).toThrow(
          "Chain value 'SOLANA:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' not found in CHAIN enum"
        );
      });

      it('should handle whitespace correctly', () => {
        // Test that whitespace is not ignored
        expect(() => PushChain.utils.helpers.getChainName(' eip155:1')).toThrow(
          "Chain value ' eip155:1' not found in CHAIN enum"
        );
        expect(() => PushChain.utils.helpers.getChainName('eip155:1 ')).toThrow(
          "Chain value 'eip155:1 ' not found in CHAIN enum"
        );
      });
    });

    describe('encodeTxData', () => {
      const testAbi = [
        {
          inputs: [],
          stateMutability: 'nonpayable',
          type: 'constructor',
        },
        {
          anonymous: false,
          inputs: [
            {
              indexed: false,
              internalType: 'uint256',
              name: 'newCount',
              type: 'uint256',
            },
            {
              indexed: true,
              internalType: 'address',
              name: 'caller',
              type: 'address',
            },
            {
              indexed: false,
              internalType: 'string',
              name: 'chainNamespace',
              type: 'string',
            },
            {
              indexed: false,
              internalType: 'string',
              name: 'chainId',
              type: 'string',
            },
          ],
          name: 'CountIncremented',
          type: 'event',
        },
        {
          inputs: [],
          name: 'increment',
          outputs: [],
          stateMutability: 'nonpayable',
          type: 'function',
        },
        {
          inputs: [],
          name: 'reset',
          outputs: [],
          stateMutability: 'nonpayable',
          type: 'function',
        },
        {
          inputs: [],
          name: 'countEth',
          outputs: [
            {
              internalType: 'uint256',
              name: '',
              type: 'uint256',
            },
          ],
          stateMutability: 'view',
          type: 'function',
        },
        {
          inputs: [],
          name: 'countPC',
          outputs: [
            {
              internalType: 'uint256',
              name: '',
              type: 'uint256',
            },
          ],
          stateMutability: 'view',
          type: 'function',
        },
        {
          inputs: [],
          name: 'countSol',
          outputs: [
            {
              internalType: 'uint256',
              name: '',
              type: 'uint256',
            },
          ],
          stateMutability: 'view',
          type: 'function',
        },
        {
          inputs: [],
          name: 'getCount',
          outputs: [
            {
              internalType: 'uint256',
              name: '',
              type: 'uint256',
            },
          ],
          stateMutability: 'view',
          type: 'function',
        },
      ];

      it('should encode function data correctly', () => {
        const result = PushChain.utils.helpers.encodeTxData({
          abi: testAbi,
          functionName: 'increment',
        });
        expect(result).toBe('0xd09de08a');
      });

      it('should encode function data with arguments', () => {
        // Test with a function that has no arguments (reset)
        const result = PushChain.utils.helpers.encodeTxData({
          abi: testAbi,
          functionName: 'reset',
        });
        expect(result).toMatch(/^0x[a-fA-F0-9]+$/);
        expect(typeof result).toBe('string');
      });

      it('should throw error for invalid ABI', () => {
        expect(() =>
          PushChain.utils.helpers.encodeTxData({
            abi: 'invalid' as any,
            functionName: 'increment',
          })
        ).toThrow('ABI must be an array');
        expect(() =>
          PushChain.utils.helpers.encodeTxData({
            abi: null as any,
            functionName: 'increment',
          })
        ).toThrow('ABI must be an array');
      });

      it('should throw error for invalid arguments', () => {
        expect(() =>
          PushChain.utils.helpers.encodeTxData({
            abi: testAbi,
            functionName: 'increment',
            args: 'invalid' as any,
          })
        ).toThrow('Arguments must be an array');
      });

      it('should throw error for non-existent function', () => {
        expect(() =>
          PushChain.utils.helpers.encodeTxData({
            abi: testAbi,
            functionName: 'nonExistentFunction',
          })
        ).toThrow("Function 'nonExistentFunction' not found in ABI");
      });

      it('should handle empty args array', () => {
        const result = PushChain.utils.helpers.encodeTxData({
          abi: testAbi,
          functionName: 'increment',
          args: [],
        });
        expect(result).toBe('0xd09de08a');
      });
    });

    describe('parseUnits', () => {
      it('should parse integer values correctly', () => {
        // Test basic integer parsing like the viem example
        const result = PushChain.utils.helpers.parseUnits('420', 9);
        expect(result).toBe(BigInt('420000000000'));
      });

      it('should parse decimal values correctly', () => {
        // Test ETH to wei conversion (18 decimals)
        const result1 = PushChain.utils.helpers.parseUnits('1.5', 18);
        expect(result1).toBe(BigInt('1500000000000000000'));

        // Test smaller decimal values
        const result2 = PushChain.utils.helpers.parseUnits('0.1', 6);
        expect(result2).toBe(BigInt('100000'));

        // Test fractional values with fewer decimals than exponent
        const result3 = PushChain.utils.helpers.parseUnits('1.23', 6);
        expect(result3).toBe(BigInt('1230000'));
      });

      it('should handle zero values', () => {
        const result1 = PushChain.utils.helpers.parseUnits('0', 18);
        expect(result1).toBe(BigInt('0'));

        const result2 = PushChain.utils.helpers.parseUnits('0.0', 6);
        expect(result2).toBe(BigInt('0'));

        const result3 = PushChain.utils.helpers.parseUnits('0.000', 18);
        expect(result3).toBe(BigInt('0'));
      });

      it('should handle negative values', () => {
        const result1 = PushChain.utils.helpers.parseUnits('-1', 18);
        expect(result1).toBe(BigInt('-1000000000000000000'));

        const result2 = PushChain.utils.helpers.parseUnits('-0.5', 6);
        expect(result2).toBe(BigInt('-500000'));
      });

      it('should handle values without decimals', () => {
        const result1 = PushChain.utils.helpers.parseUnits('100', 0);
        expect(result1).toBe(BigInt('100'));

        const result2 = PushChain.utils.helpers.parseUnits('1000', 3);
        expect(result2).toBe(BigInt('1000000'));
      });

      it('should handle values with leading/trailing whitespace', () => {
        const result1 = PushChain.utils.helpers.parseUnits(' 1.5 ', 18);
        expect(result1).toBe(BigInt('1500000000000000000'));

        const result2 = PushChain.utils.helpers.parseUnits('\t420\n', 9);
        expect(result2).toBe(BigInt('420000000000'));
      });

      it('should handle values starting with decimal point', () => {
        const result1 = PushChain.utils.helpers.parseUnits('.5', 18);
        expect(result1).toBe(BigInt('500000000000000000'));

        const result2 = PushChain.utils.helpers.parseUnits('.123', 6);
        expect(result2).toBe(BigInt('123000'));
      });

      it('should handle exact decimal place matches', () => {
        // When decimal places exactly match the exponent
        const result = PushChain.utils.helpers.parseUnits('1.123456', 6);
        expect(result).toBe(BigInt('1123456'));
      });

      it('should throw error for invalid value types', () => {
        expect(() =>
          PushChain.utils.helpers.parseUnits(123 as any, 18)
        ).toThrow('Value must be a string');

        expect(() =>
          PushChain.utils.helpers.parseUnits(null as any, 18)
        ).toThrow('Value must be a string');

        expect(() =>
          PushChain.utils.helpers.parseUnits(undefined as any, 18)
        ).toThrow('Value must be a string');
      });

      it('should throw error for invalid exponent types', () => {
        expect(() =>
          PushChain.utils.helpers.parseUnits('1', '18' as any)
        ).toThrow('Exponent must be a non-negative integer');

        expect(() =>
          PushChain.utils.helpers.parseUnits('1', null as any)
        ).toThrow('Exponent must be a non-negative integer');

        expect(() => PushChain.utils.helpers.parseUnits('1', 1.5)).toThrow(
          'Exponent must be a non-negative integer'
        );

        expect(() => PushChain.utils.helpers.parseUnits('1', -1)).toThrow(
          'Exponent must be a non-negative integer'
        );
      });

      it('should throw error for empty or invalid value strings', () => {
        expect(() => PushChain.utils.helpers.parseUnits('', 18)).toThrow(
          'Value cannot be empty'
        );

        expect(() => PushChain.utils.helpers.parseUnits('   ', 18)).toThrow(
          'Value cannot be empty'
        );

        expect(() => PushChain.utils.helpers.parseUnits('.', 18)).toThrow(
          'Value must be a valid number string'
        );

        expect(() => PushChain.utils.helpers.parseUnits('-.', 18)).toThrow(
          'Value must be a valid number string'
        );

        expect(() => PushChain.utils.helpers.parseUnits('abc', 18)).toThrow(
          'Value must be a valid number string'
        );

        expect(() => PushChain.utils.helpers.parseUnits('1.2.3', 18)).toThrow(
          'Value must be a valid number string'
        );

        expect(() => PushChain.utils.helpers.parseUnits('1e5', 18)).toThrow(
          'Value must be a valid number string'
        );
      });

      it('should throw error when decimal places exceed exponent', () => {
        expect(() =>
          PushChain.utils.helpers.parseUnits('1.123456789', 6)
        ).toThrow('Value has more decimal places (9) than exponent allows (6)');

        expect(() =>
          PushChain.utils.helpers.parseUnits('0.12345678901234567890', 18)
        ).toThrow(
          'Value has more decimal places (20) than exponent allows (18)'
        );
      });

      it('should handle large numbers', () => {
        const result1 = PushChain.utils.helpers.parseUnits(
          '999999999999999999',
          18
        );
        expect(result1).toBe(BigInt('999999999999999999000000000000000000'));

        const result2 = PushChain.utils.helpers.parseUnits('1000000', 0);
        expect(result2).toBe(BigInt('1000000'));
      });

      it('should handle common token decimal scenarios', () => {
        // ETH (18 decimals)
        const ethResult = PushChain.utils.helpers.parseUnits('1', 18);
        expect(ethResult).toBe(BigInt('1000000000000000000'));

        // USDC (6 decimals)
        const usdcResult = PushChain.utils.helpers.parseUnits('100', 6);
        expect(usdcResult).toBe(BigInt('100000000'));

        // BTC (8 decimals)
        const btcResult = PushChain.utils.helpers.parseUnits('0.00000001', 8);
        expect(btcResult).toBe(BigInt('1'));

        // Push token (18 decimals) - example amount
        const pushResult = PushChain.utils.helpers.parseUnits('1000.5', 18);
        expect(pushResult).toBe(BigInt('1000500000000000000000'));
      });
    });
  });
});

import { createUniversalSigner } from './signer';
import * as viem from 'viem';
import { PushChain } from '../../pushChain';
import {
  createWalletClient,
  http,
  hexToBytes,
  type Hex,
  serializeTransaction,
  type TransactionSerializableEIP1559,
} from 'viem';
import { UniversalSigner, UniversalAccount } from '../universal.types';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { Keypair } from '@solana/web3.js';
import { ethers } from 'ethers';

describe('Universal Account Utilities', () => {
  describe('createUniversalSigner', () => {
    it('creates a valid UniversalSigner with chain info', () => {
      const dummySigner: UniversalSigner = {
        account: {
          chain: PushChain.CONSTANTS.CHAIN.ETHEREUM_SEPOLIA,
          address: '0xeCba9a32A9823f1cb00cdD8344Bf2D1d87a8dd97',
        },
        signMessage: async (data: Uint8Array) => new Uint8Array([...data, 1]),
        signTransaction: async (tx: Uint8Array) => new Uint8Array([...tx, 2]),
      };

      const signer = createUniversalSigner(dummySigner);

      expect(signer.account.chain).toBe(
        PushChain.CONSTANTS.CHAIN.ETHEREUM_SEPOLIA
      );
      expect(signer.account.address).toBe(
        '0xeCba9a32A9823f1cb00cdD8344Bf2D1d87a8dd97'
      );
      expect(typeof signer.signMessage).toBe('function');
      expect(typeof signer.signTransaction).toBe('function');
    });
  });

  describe('toUniversalFromKeyPair (viem)', () => {
    const pk = generatePrivateKey();
    const account = privateKeyToAccount(pk);
    const client: viem.WalletClient = createWalletClient({
      account,
      chain: sepolia,
      transport: http('https://sepolia.gateway.tenderly.co'),
    });

    it('wraps a viem WalletClient into a UniversalSigner', async () => {
      const signer = await PushChain.utils.signer.toUniversalFromKeyPair(
        client,
        {
          chain: PushChain.CONSTANTS.CHAIN.ETHEREUM_SEPOLIA,
          library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
        }
      );

      expect(signer.account.chain).toBe(
        PushChain.CONSTANTS.CHAIN.ETHEREUM_SEPOLIA
      );
      expect(signer.account.address).toBe(account.address);

      // Test signMessage
      const msg = new TextEncoder().encode('gm wagmi');
      const sig = await signer.signMessage(msg);
      expect(typeof sig).toBe('object'); // Uint8Array
      expect(sig).toBeInstanceOf(Uint8Array);
      expect(sig.length).toBeGreaterThan(0);

      // Test signTransaction
      const tx: TransactionSerializableEIP1559 = {
        to: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as `0x${string}`,
        value: BigInt('1000000000000000000'),
        data: '0x' as Hex,
        chainId: sepolia.id,
        maxFeePerGas: BigInt('1000000000'),
        maxPriorityFeePerGas: BigInt('1000000000'),
        nonce: 0,
      };
      const serializedTx = serializeTransaction(tx);
      const txSig = await signer.signTransaction(hexToBytes(serializedTx));
      expect(txSig).toBeInstanceOf(Uint8Array);
      expect(txSig.length).toBeGreaterThan(0);
    });

    it('wraps a viem Account into a UniversalSigner', async () => {
      const signer = await PushChain.utils.signer.toUniversalFromKeyPair(
        account,
        {
          chain: PushChain.CONSTANTS.CHAIN.ETHEREUM_SEPOLIA,
          library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
        }
      );

      expect(signer.account.chain).toBe(
        PushChain.CONSTANTS.CHAIN.ETHEREUM_SEPOLIA
      );
      expect(signer.account.address).toBe(account.address);

      // Test signMessage
      const msg = new TextEncoder().encode('test message');
      const sig = await signer.signMessage(msg);
      expect(sig).toBeInstanceOf(Uint8Array);
      expect(sig.length).toBeGreaterThan(0);

      // Test signTransaction
      const tx: TransactionSerializableEIP1559 = {
        to: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as `0x${string}`,
        value: BigInt('1000000000000000000'),
        data: '0x' as Hex,
        chainId: sepolia.id,
        maxFeePerGas: BigInt('1000000000'),
        maxPriorityFeePerGas: BigInt('1000000000'),
        nonce: 0,
      };
      const serializedTx = serializeTransaction(tx);
      const txSig = await signer.signTransaction(hexToBytes(serializedTx));
      expect(txSig).toBeInstanceOf(Uint8Array);
      expect(txSig.length).toBeGreaterThan(0);
    });

    it('throws error for invalid Account instance', async () => {
      const invalidAccount = {
        address: account.address,
        // Missing signMessage and signTransaction
      };

      await expect(
        PushChain.utils.signer.toUniversalFromKeyPair(invalidAccount as any, {
          chain: PushChain.CONSTANTS.CHAIN.ETHEREUM_SEPOLIA,
          library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
        })
      ).rejects.toThrow(
        'Invalid Account instance: missing required properties'
      );
    });
  });

  describe('toUniversalFromKeyPair (ethers)', () => {
    // Create a mock provider for ethers that returns the correct chain ID
    const mockProvider = {
      getNetwork: jest.fn().mockResolvedValue({
        chainId: BigInt(11155111), // Sepolia chain ID
      }),
    };

    const pk = generatePrivateKey();
    const wallet = new ethers.Wallet(pk, mockProvider as any);

    it('wraps an ethers.Wallet into a UniversalSigner', async () => {
      const signer = await PushChain.utils.signer.toUniversalFromKeyPair(
        wallet,
        {
          chain: PushChain.CONSTANTS.CHAIN.ETHEREUM_SEPOLIA,
          library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_ETHERSV6,
        }
      );

      expect(signer.account.chain).toBe(
        PushChain.CONSTANTS.CHAIN.ETHEREUM_SEPOLIA
      );
      expect(signer.account.address).toBe(await wallet.getAddress());

      // Test signMessage
      const msg = new TextEncoder().encode('test message');
      const sig = await signer.signMessage(msg);
      expect(sig).toBeInstanceOf(Uint8Array);
      expect(sig.length).toBeGreaterThan(0);

      // Test signTransaction
      const tx = {
        type: 2,
        to: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
        value: ethers.parseEther('1'),
        data: '0x',
        gasLimit: 21000,
        maxFeePerGas: ethers.parseUnits('10', 'gwei'),
        maxPriorityFeePerGas: ethers.parseUnits('2', 'gwei'),
        nonce: 0,
        chainId: 11155111,
      };
      // Create a proper unsigned transaction
      const unsignedTx = ethers.Transaction.from(tx);
      const txBytes = ethers.getBytes(unsignedTx.unsignedSerialized);
      const txSig = await signer.signTransaction(txBytes);
      expect(txSig).toBeInstanceOf(Uint8Array);
      expect(txSig.length).toBeGreaterThan(0);

      // Test signTypedData
      if (signer.signTypedData) {
        const typedDataArgs = {
          domain: { name: 'Test', version: '1', chainId: 11155111 },
          types: { Test: [{ name: 'data', type: 'string' }] },
          primaryType: 'Test',
          message: { data: 'test' },
        };
        const typedDataSig = await signer.signTypedData(typedDataArgs);
        expect(typedDataSig).toBeInstanceOf(Uint8Array);
        expect(typedDataSig.length).toBeGreaterThan(0);
      }
    });

    it('wraps an ethers.HDNodeWallet into a UniversalSigner', async () => {
      const hdNodeWallet = ethers.Wallet.createRandom(mockProvider as any);
      const signer = await PushChain.utils.signer.toUniversalFromKeyPair(
        hdNodeWallet,
        {
          chain: PushChain.CONSTANTS.CHAIN.ETHEREUM_SEPOLIA,
          library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_ETHERSV6,
        }
      );

      expect(signer.account.chain).toBe(
        PushChain.CONSTANTS.CHAIN.ETHEREUM_SEPOLIA
      );
      expect(signer.account.address).toBe(await hdNodeWallet.getAddress());

      // Test signMessage
      const msg = new TextEncoder().encode('test message');
      const sig = await signer.signMessage(msg);
      expect(sig).toBeInstanceOf(Uint8Array);
      expect(sig.length).toBeGreaterThan(0);

      // Test signTransaction
      const tx = {
        type: 2,
        to: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
        value: ethers.parseEther('1'),
        data: '0x',
        gasLimit: 21000,
        maxFeePerGas: ethers.parseUnits('10', 'gwei'),
        maxPriorityFeePerGas: ethers.parseUnits('2', 'gwei'),
        nonce: 0,
        chainId: 11155111,
      };
      // Create a proper unsigned transaction
      const unsignedTx = ethers.Transaction.from(tx);
      const txBytes = ethers.getBytes(unsignedTx.unsignedSerialized);
      const txSig = await signer.signTransaction(txBytes);
      expect(txSig).toBeInstanceOf(Uint8Array);
      expect(txSig.length).toBeGreaterThan(0);

      // Test signTypedData
      if (signer.signTypedData) {
        const typedDataArgs = {
          domain: { name: 'Test', version: '1', chainId: 11155111 },
          types: { Test: [{ name: 'data', type: 'string' }] },
          primaryType: 'Test',
          message: { data: 'test' },
        };
        const typedDataSig = await signer.signTypedData(typedDataArgs);
        expect(typedDataSig).toBeInstanceOf(Uint8Array);
        expect(typedDataSig.length).toBeGreaterThan(0);
      }
    });

    it('throws error for ethers.Wallet without provider', async () => {
      const walletWithoutProvider = new ethers.Wallet(pk);

      await expect(
        PushChain.utils.signer.toUniversalFromKeyPair(walletWithoutProvider, {
          chain: PushChain.CONSTANTS.CHAIN.ETHEREUM_SEPOLIA,
          library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_ETHERSV6,
        })
      ).rejects.toThrow('ethers.Wallet must have a provider attached');
    });

    it('throws error for chain mismatch', async () => {
      const wrongChainProvider = {
        getNetwork: jest.fn().mockResolvedValue({
          chainId: BigInt(1), // Mainnet instead of Sepolia
        }),
      };
      const walletWrongChain = new ethers.Wallet(pk, wrongChainProvider as any);

      await expect(
        PushChain.utils.signer.toUniversalFromKeyPair(walletWrongChain, {
          chain: PushChain.CONSTANTS.CHAIN.ETHEREUM_SEPOLIA,
          library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_ETHERSV6,
        })
      ).rejects.toThrow(/Chain mismatch/);
    });

    it('throws error for non-ethers.Wallet instance', async () => {
      const fakeWallet = {
        address: '0x123',
        // Missing required ethers.Wallet methods
      };

      await expect(
        PushChain.utils.signer.toUniversalFromKeyPair(fakeWallet as any, {
          chain: PushChain.CONSTANTS.CHAIN.ETHEREUM_SEPOLIA,
          library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_ETHERSV6,
        })
      ).rejects.toThrow(
        'Expected ethers.Wallet or ethers.HDNodeWallet for ETHEREUM_ETHERSV6 library'
      );
    });
  });

  describe('toUniversalFromKeyPair (solana)', () => {
    const keypair: Keypair = Keypair.generate();

    it('creates a valid UniversalSigner for Solana', async () => {
      const signer = await PushChain.utils.signer.toUniversalFromKeyPair(
        keypair,
        {
          chain: PushChain.CONSTANTS.CHAIN.SOLANA_TESTNET,
          library: PushChain.CONSTANTS.LIBRARY.SOLANA_WEB3JS,
        }
      );

      expect(signer.account.chain).toBe(
        PushChain.CONSTANTS.CHAIN.SOLANA_TESTNET
      );
      expect(signer.account.address).toBe(keypair.publicKey.toBase58());
      expect(typeof signer.signMessage).toBe('function');
      expect(typeof signer.signTransaction).toBe('function');
    });

    it('throws error for non-Solana chain', async () => {
      await expect(
        PushChain.utils.signer.toUniversalFromKeyPair(keypair, {
          chain: PushChain.CONSTANTS.CHAIN.ETHEREUM_SEPOLIA,
          library: PushChain.CONSTANTS.LIBRARY.SOLANA_WEB3JS,
        })
      ).rejects.toThrow('Invalid chain for Solana Keypair');
    });

    it('signs messages correctly', async () => {
      const signer = await PushChain.utils.signer.toUniversalFromKeyPair(
        keypair,
        {
          chain: PushChain.CONSTANTS.CHAIN.SOLANA_MAINNET,
          library: PushChain.CONSTANTS.LIBRARY.SOLANA_WEB3JS,
        }
      );

      const msg = new TextEncoder().encode('test message');
      const sig = await signer.signMessage(msg);
      expect(sig).toBeInstanceOf(Uint8Array);
      expect(sig.length).toBeGreaterThan(0);
    });

    it('signs transactions correctly', async () => {
      const signer = await PushChain.utils.signer.toUniversalFromKeyPair(
        keypair,
        {
          chain: PushChain.CONSTANTS.CHAIN.SOLANA_MAINNET,
          library: PushChain.CONSTANTS.LIBRARY.SOLANA_WEB3JS,
        }
      );

      const tx = new TextEncoder().encode('test transaction');
      const sig = await signer.signTransaction(tx);
      expect(sig).toBeInstanceOf(Uint8Array);
      expect(sig.length).toBeGreaterThan(0);
    });
  });

  describe('construct and toUniversal', () => {
    it('creates a UniversalSignerSkeleton with construct and converts it to UniversalSigner with toUniversal', async () => {
      // Mock account
      const mockAccount: UniversalAccount = {
        chain: PushChain.CONSTANTS.CHAIN.ETHEREUM_SEPOLIA,
        address: '0xeCba9a32A9823f1cb00cdD8344Bf2D1d87a8dd97',
      };

      // Mock signing functions
      const mockSignMessage = jest
        .fn()
        .mockResolvedValue(new Uint8Array([1, 2, 3]));
      const mockSignTransaction = jest
        .fn()
        .mockResolvedValue(new Uint8Array([4, 5, 6]));
      const mockSignTypedData = jest
        .fn()
        .mockResolvedValue(new Uint8Array([7, 8, 9]));

      // Step 1: Call construct function
      const skeleton = PushChain.utils.signer.construct(mockAccount, {
        signMessage: mockSignMessage,
        signTransaction: mockSignTransaction,
        signTypedData: mockSignTypedData,
      });

      // Verify the skeleton is correctly created
      expect(skeleton.signerId).toBe('CustomGeneratedSigner');
      expect(skeleton.account).toEqual(mockAccount);
      expect(skeleton.signMessage).toBe(mockSignMessage);
      expect(skeleton.signTransaction).toBe(mockSignTransaction);
      expect(skeleton.signTypedData).toBe(mockSignTypedData);

      // Step 2: Call toUniversal function
      const universalSigner = await PushChain.utils.signer.toUniversal(
        skeleton
      );

      // Verify the universal signer is correctly created
      expect(universalSigner.account).toEqual(mockAccount);
      expect(universalSigner.signMessage).toBe(mockSignMessage);
      expect(universalSigner.signTransaction).toBe(mockSignTransaction);
      expect(universalSigner.signTypedData).toBe(mockSignTypedData);

      // Test that the signing functions work correctly
      const testData = new Uint8Array([10, 11, 12]);
      const messageSignature = await universalSigner.signMessage(testData);
      expect(messageSignature).toEqual(new Uint8Array([1, 2, 3]));
      expect(mockSignMessage).toHaveBeenCalledWith(testData);

      const txSignature = await universalSigner.signTransaction(testData);
      expect(txSignature).toEqual(new Uint8Array([4, 5, 6]));
      expect(mockSignTransaction).toHaveBeenCalledWith(testData);

      // Test signTypedData if it exists
      if (universalSigner.signTypedData) {
        const typedDataArgs = {
          domain: { name: 'Test', version: '1' },
          types: { Test: [{ name: 'data', type: 'string' }] },
          primaryType: 'Test',
          message: { data: 'test' },
        };
        const typedDataSignature = await universalSigner.signTypedData(
          typedDataArgs
        );
        expect(typedDataSignature).toEqual(new Uint8Array([7, 8, 9]));
        expect(mockSignTypedData).toHaveBeenCalledWith(typedDataArgs);
      }
    });

    it('creates a UniversalSignerSkeleton without signTypedData (for Solana)', async () => {
      // Mock Solana account
      const mockAccount: UniversalAccount = {
        chain: PushChain.CONSTANTS.CHAIN.SOLANA_TESTNET,
        address: 'FvwEAhmxKfeiG8SnEvq42hc6whRyY3EFYAvebMqDNDGCgxN5Z',
      };

      // Mock signing functions (no signTypedData for Solana)
      const mockSignMessage = jest
        .fn()
        .mockResolvedValue(new Uint8Array([1, 2, 3]));
      const mockSignTransaction = jest
        .fn()
        .mockResolvedValue(new Uint8Array([4, 5, 6]));

      // Step 1: Call construct function without signTypedData
      const skeleton = PushChain.utils.signer.construct(mockAccount, {
        signMessage: mockSignMessage,
        signTransaction: mockSignTransaction,
      });

      // Verify the skeleton is correctly created
      expect(skeleton.signerId).toBe('CustomGeneratedSigner');
      expect(skeleton.account).toEqual(mockAccount);
      expect(skeleton.signMessage).toBe(mockSignMessage);
      expect(skeleton.signTransaction).toBe(mockSignTransaction);
      expect(skeleton.signTypedData).toBeUndefined();

      // Step 2: Call toUniversal function
      const universalSigner = await PushChain.utils.signer.toUniversal(
        skeleton
      );

      // Verify the universal signer is correctly created
      expect(universalSigner.account).toEqual(mockAccount);
      expect(universalSigner.signMessage).toBe(mockSignMessage);
      expect(universalSigner.signTransaction).toBe(mockSignTransaction);
      expect(universalSigner.signTypedData).toBeUndefined();

      // Test that the signing functions work correctly
      const testData = new Uint8Array([10, 11, 12]);
      const messageSignature = await universalSigner.signMessage(testData);
      expect(messageSignature).toEqual(new Uint8Array([1, 2, 3]));
      expect(mockSignMessage).toHaveBeenCalledWith(testData);

      const txSignature = await universalSigner.signTransaction(testData);
      expect(txSignature).toEqual(new Uint8Array([4, 5, 6]));
      expect(mockSignTransaction).toHaveBeenCalledWith(testData);
    });

    it('maintains the same reference for signing functions through the conversion flow', async () => {
      const mockAccount: UniversalAccount = {
        chain: PushChain.CONSTANTS.CHAIN.ETHEREUM_SEPOLIA,
        address: '0xeCba9a32A9823f1cb00cdD8344Bf2D1d87a8dd97',
      };

      const mockSignMessage = jest.fn().mockResolvedValue(new Uint8Array([1]));
      const mockSignTransaction = jest
        .fn()
        .mockResolvedValue(new Uint8Array([2]));
      const mockSignTypedData = jest
        .fn()
        .mockResolvedValue(new Uint8Array([3]));

      // Create skeleton
      const skeleton = PushChain.utils.signer.construct(mockAccount, {
        signMessage: mockSignMessage,
        signTransaction: mockSignTransaction,
        signTypedData: mockSignTypedData,
      });

      // Convert to universal signer
      const universalSigner = await PushChain.utils.signer.toUniversal(
        skeleton
      );

      // Verify that the same function references are maintained
      expect(universalSigner.signMessage).toBe(mockSignMessage);
      expect(universalSigner.signTransaction).toBe(mockSignTransaction);
      expect(universalSigner.signTypedData).toBe(mockSignTypedData);
    });
  });

  describe('toUniversal with ethers', () => {
    it('converts an ethers.Wallet directly to UniversalSigner via toUniversal', async () => {
      // Create a mock provider for ethers
      const mockProvider = {
        getNetwork: jest.fn().mockResolvedValue({
          chainId: BigInt(11155111), // Sepolia chain ID
        }),
      };

      const pk = generatePrivateKey();
      const wallet = new ethers.Wallet(pk, mockProvider as any);

      // Convert ethers.Wallet to UniversalSigner using toUniversal
      const universalSigner = await PushChain.utils.signer.toUniversal(wallet);

      // Verify the conversion worked correctly
      expect(universalSigner.account.chain).toBe(
        PushChain.CONSTANTS.CHAIN.ETHEREUM_SEPOLIA
      );
      expect(universalSigner.account.address).toBe(await wallet.getAddress());
      expect(typeof universalSigner.signMessage).toBe('function');
      expect(typeof universalSigner.signTransaction).toBe('function');
      expect(typeof universalSigner.signTypedData).toBe('function');

      // Test signing functionality
      const msg = new TextEncoder().encode('test message');
      const sig = await universalSigner.signMessage(msg);
      expect(sig).toBeInstanceOf(Uint8Array);
      expect(sig.length).toBeGreaterThan(0);

      // Test signTransaction functionality
      const tx = {
        type: 2,
        to: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
        value: ethers.parseEther('1'),
        data: '0x',
        gasLimit: 21000,
        maxFeePerGas: ethers.parseUnits('10', 'gwei'),
        maxPriorityFeePerGas: ethers.parseUnits('2', 'gwei'),
        nonce: 0,
        chainId: 11155111,
      };
      // Create a proper unsigned transaction
      const unsignedTx = ethers.Transaction.from(tx);
      const txBytes = ethers.getBytes(unsignedTx.unsignedSerialized);
      const txSig = await universalSigner.signTransaction(txBytes);
      expect(txSig).toBeInstanceOf(Uint8Array);
      expect(txSig.length).toBeGreaterThan(0);
    });

    it('maps different chain IDs correctly for ethers.Wallet', async () => {
      const pk = generatePrivateKey();

      // Test Ethereum Mainnet
      const mainnetProvider = {
        getNetwork: jest.fn().mockResolvedValue({
          chainId: BigInt(1),
        }),
      };
      const mainnetWallet = new ethers.Wallet(pk, mainnetProvider as any);
      const mainnetSigner = await PushChain.utils.signer.toUniversal(
        mainnetWallet
      );
      expect(mainnetSigner.account.chain).toBe(
        PushChain.CONSTANTS.CHAIN.ETHEREUM_MAINNET
      );

      // Test Push Testnet
      const pushTestnetProvider = {
        getNetwork: jest.fn().mockResolvedValue({
          chainId: BigInt(42101),
        }),
      };
      const pushTestnetWallet = new ethers.Wallet(
        pk,
        pushTestnetProvider as any
      );
      const pushTestnetSigner = await PushChain.utils.signer.toUniversal(
        pushTestnetWallet
      );
      expect(pushTestnetSigner.account.chain).toBe(
        PushChain.CONSTANTS.CHAIN.PUSH_TESTNET
      );
    });

    it('throws error for unsupported chain ID in ethers.Wallet', async () => {
      const mockProvider = {
        getNetwork: jest.fn().mockResolvedValue({
          chainId: BigInt(999999), // Unsupported chain ID
        }),
      };

      const pk = generatePrivateKey();
      const wallet = new ethers.Wallet(pk, mockProvider as any);

      await expect(PushChain.utils.signer.toUniversal(wallet)).rejects.toThrow(
        'Unsupported chainId: 999999'
      );
    });

    it('throws error for ethers.Wallet without provider', async () => {
      const pk = generatePrivateKey();
      const walletWithoutProvider = new ethers.Wallet(pk);

      await expect(
        PushChain.utils.signer.toUniversal(walletWithoutProvider)
      ).rejects.toThrow(
        'ethers.Wallet must have a provider attached to determine chain'
      );
    });

    it('throws error for unsupported signer type', async () => {
      const invalidSigner = {
        someProperty: 'value',
        // Missing signerId property and not an ethers.Wallet
      };

      await expect(
        PushChain.utils.signer.toUniversal(invalidSigner as any)
      ).rejects.toThrow(
        'ethers.Wallet must have a provider attached to determine chain'
      );
    });
  });

  describe('toUniversal with viem', () => {
    it('converts a viem-compatible signer directly to UniversalSigner via toUniversal', async () => {
      const pk = generatePrivateKey();
      const account = privateKeyToAccount(pk);

      // Create a mock viem signer that matches ViemSignerType interface
      const mockViemSigner = {
        account: {
          address: account.address,
          signTransaction: jest.fn().mockImplementation(async () => {
            return '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1b';
          }),
        },
        getChainId: jest.fn().mockResolvedValue(11155111), // Sepolia
        signMessage: jest.fn().mockImplementation(async ({ message }) => {
          // Mock implementation that returns a hex signature
          return '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1b';
        }),
        signTypedData: jest.fn().mockImplementation(async () => {
          // Mock implementation that returns a hex signature
          return '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1b';
        }),
      };

      // Convert mock viem signer to UniversalSigner using toUniversal
      const universalSigner = await PushChain.utils.signer.toUniversal(
        mockViemSigner
      );

      // Verify the conversion worked correctly
      expect(universalSigner.account.chain).toBe(
        PushChain.CONSTANTS.CHAIN.ETHEREUM_SEPOLIA
      );
      expect(universalSigner.account.address).toBe(account.address);
      expect(typeof universalSigner.signMessage).toBe('function');
      expect(typeof universalSigner.signTransaction).toBe('function');
      expect(typeof universalSigner.signTypedData).toBe('function');

      // Test signing functionality
      const msg = new TextEncoder().encode('test message');
      const sig = await universalSigner.signMessage(msg);
      expect(sig).toBeInstanceOf(Uint8Array);
      expect(sig.length).toBeGreaterThan(0);
      expect(mockViemSigner.signMessage).toHaveBeenCalled();

      // Test signTransaction functionality
      const tx: TransactionSerializableEIP1559 = {
        to: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as `0x${string}`,
        value: BigInt('1000000000000000000'),
        data: '0x' as Hex,
        chainId: sepolia.id,
        maxFeePerGas: BigInt('1000000000'),
        maxPriorityFeePerGas: BigInt('1000000000'),
        nonce: 0,
      };
      const serializedTx = serializeTransaction(tx);
      const txSig = await universalSigner.signTransaction(
        hexToBytes(serializedTx)
      );
      expect(txSig).toBeInstanceOf(Uint8Array);
      expect(txSig.length).toBeGreaterThan(0);
      expect(mockViemSigner.account.signTransaction).toHaveBeenCalled();

      // Test signTypedData functionality
      if (universalSigner.signTypedData) {
        const typedDataArgs = {
          domain: { name: 'Test', version: '1', chainId: sepolia.id },
          types: { Test: [{ name: 'data', type: 'string' }] },
          primaryType: 'Test',
          message: { data: 'test' },
        };
        const typedDataSig = await universalSigner.signTypedData(typedDataArgs);
        expect(typedDataSig).toBeInstanceOf(Uint8Array);
        expect(typedDataSig.length).toBeGreaterThan(0);
        expect(mockViemSigner.signTypedData).toHaveBeenCalled();
      }
    });

    it('viem wallet client to UniversalSigner', async () => {
      const pk = generatePrivateKey();
      const account = privateKeyToAccount(pk);
      account.signMessage;
      const client = createWalletClient({
        account,
        transport: http('https://sepolia.gateway.tenderly.co'),
        chain: sepolia,
      });
      const universalSigner = await PushChain.utils.signer.toUniversal(client);
      expect(universalSigner.account.chain).toBe(
        PushChain.CONSTANTS.CHAIN.ETHEREUM_SEPOLIA
      );
      expect(universalSigner.account.address).toBe(account.address);
      expect(typeof universalSigner.signMessage).toBe('function');
      expect(typeof universalSigner.signTransaction).toBe('function');
      expect(typeof universalSigner.signTypedData).toBe('function');
      const tx: TransactionSerializableEIP1559 = {
        to: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as `0x${string}`,
        value: BigInt('1000000000000000000'),
        data: '0x' as Hex,
        chainId: sepolia.id,
        maxFeePerGas: BigInt('1000000000'),
        maxPriorityFeePerGas: BigInt('1000000000'),
        nonce: 0,
      };
      const serializedTx = serializeTransaction(tx);
      const txSig = await universalSigner.signTransaction(
        hexToBytes(serializedTx)
      );
      expect(txSig).toBeInstanceOf(Uint8Array);
      expect(txSig.length).toBeGreaterThan(0);
    });

    it('maps different chain IDs correctly for viem signers', async () => {
      const pk = generatePrivateKey();
      const account = privateKeyToAccount(pk);

      // Test Ethereum Mainnet
      const mainnetSigner = {
        account: {
          address: account.address,
          signTransaction: jest.fn().mockResolvedValue('0x123'),
        },
        getChainId: jest.fn().mockResolvedValue(1),
        signMessage: jest.fn().mockResolvedValue('0x123'),
        signTypedData: jest.fn().mockResolvedValue('0x123'),
      };
      const mainnetUniversalSigner = await PushChain.utils.signer.toUniversal(
        mainnetSigner
      );
      expect(mainnetUniversalSigner.account.chain).toBe(
        PushChain.CONSTANTS.CHAIN.ETHEREUM_MAINNET
      );

      // Test Push Testnet
      const pushTestnetSigner = {
        account: {
          address: account.address,
          signTransaction: jest.fn().mockResolvedValue('0x123'),
        },
        getChainId: jest.fn().mockResolvedValue(42101),
        signMessage: jest.fn().mockResolvedValue('0x123'),
        signTypedData: jest.fn().mockResolvedValue('0x123'),
      };
      const pushTestnetUniversalSigner =
        await PushChain.utils.signer.toUniversal(pushTestnetSigner);
      expect(pushTestnetUniversalSigner.account.chain).toBe(
        PushChain.CONSTANTS.CHAIN.PUSH_TESTNET
      );

      // Test Push Localnet
      const pushLocalnetSigner = {
        account: {
          address: account.address,
          signTransaction: jest.fn().mockResolvedValue('0x123'),
        },
        getChainId: jest.fn().mockResolvedValue(9001),
        signMessage: jest.fn().mockResolvedValue('0x123'),
        signTypedData: jest.fn().mockResolvedValue('0x123'),
      };
      const pushLocalnetUniversalSigner =
        await PushChain.utils.signer.toUniversal(pushLocalnetSigner);
      expect(pushLocalnetUniversalSigner.account.chain).toBe(
        PushChain.CONSTANTS.CHAIN.PUSH_LOCALNET
      );
    });

    it('throws error for unsupported chain ID in viem signers', async () => {
      const pk = generatePrivateKey();
      const account = privateKeyToAccount(pk);

      const signerWithUnsupportedChain = {
        account: {
          address: account.address,
          signTransaction: jest.fn(),
        },
        getChainId: jest.fn().mockResolvedValue(999999), // Unsupported chain ID
        signMessage: jest.fn().mockResolvedValue('0x123'),
        signTypedData: jest.fn().mockResolvedValue('0x123'),
      };

      await expect(
        PushChain.utils.signer.toUniversal(signerWithUnsupportedChain)
      ).rejects.toThrow('Unsupported chainId: 999999');
    });

    it('throws error for viem signer without account', async () => {
      // Create a signer without an account - need to cast as any since TypeScript won't allow null account
      const signerWithoutAccount = {
        account: {} as any, // Empty object to satisfy type but will fail the account check
        getChainId: jest.fn().mockResolvedValue(11155111),
        signMessage: jest.fn().mockResolvedValue('0x123'),
        signTypedData: jest.fn().mockResolvedValue('0x123'),
      };

      // Remove the account property to simulate missing account
      delete (signerWithoutAccount as any).account;

      await expect(
        PushChain.utils.signer.toUniversal(signerWithoutAccount as any)
      ).rejects.toThrow('Signer account is not set');
    });

    it('throws error for viem signer account without signTransaction method', async () => {
      const pk = generatePrivateKey();
      const account = privateKeyToAccount(pk);

      // Create a signer with account that lacks signTransaction method
      const signerWithIncompleteAccount = {
        account: { address: account.address }, // Missing signTransaction
        getChainId: jest.fn().mockResolvedValue(11155111),
        signMessage: jest.fn().mockResolvedValue('0x123'),
        signTypedData: jest.fn().mockResolvedValue('0x123'),
      };

      const universalSigner = await PushChain.utils.signer.toUniversal(
        signerWithIncompleteAccount
      );

      // The signTransaction should throw an error when called
      const tx: TransactionSerializableEIP1559 = {
        to: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as `0x${string}`,
        value: BigInt('1000000000000000000'),
        data: '0x' as Hex,
        chainId: sepolia.id,
        maxFeePerGas: BigInt('1000000000'),
        maxPriorityFeePerGas: BigInt('1000000000'),
        nonce: 0,
      };
      const serializedTx = serializeTransaction(tx);

      await expect(
        universalSigner.signTransaction(hexToBytes(serializedTx))
      ).rejects.toThrow(
        'Transaction signing not supported for this viem signer type'
      );
    });
  });
});

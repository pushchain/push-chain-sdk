import { createUniversalSigner } from './signer';
import { PushChain } from '../../pushChain';
import { CHAIN, LIBRARY } from '../../constants/enums';
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

describe('Universal Account Utilities', () => {
  describe('createUniversalSigner', () => {
    it('creates a valid UniversalSigner with chain info', () => {
      const dummySigner: UniversalSigner = {
        account: {
          chain: CHAIN.ETHEREUM_SEPOLIA,
          address: '0xeCba9a32A9823f1cb00cdD8344Bf2D1d87a8dd97',
        },
        signMessage: async (data: Uint8Array) => new Uint8Array([...data, 1]),
        signTransaction: async (tx: Uint8Array) => new Uint8Array([...tx, 2]),
      };

      const signer = createUniversalSigner(dummySigner);

      expect(signer.account.chain).toBe(CHAIN.ETHEREUM_SEPOLIA);
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
    const client = createWalletClient({
      account,
      chain: sepolia,
      transport: http(),
    });

    it('wraps a viem WalletClient into a UniversalSigner', async () => {
      const signer = await PushChain.utils.signer.toUniversalFromKeyPair(
        client,
        {
          chain: CHAIN.ETHEREUM_SEPOLIA,
          library: LIBRARY.ETHEREUM_VIEM,
        }
      );

      expect(signer.account.chain).toBe(CHAIN.ETHEREUM_SEPOLIA);
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
          chain: CHAIN.ETHEREUM_SEPOLIA,
          library: LIBRARY.ETHEREUM_VIEM,
        }
      );

      expect(signer.account.chain).toBe(CHAIN.ETHEREUM_SEPOLIA);
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
          chain: CHAIN.ETHEREUM_SEPOLIA,
          library: LIBRARY.ETHEREUM_VIEM,
        })
      ).rejects.toThrow(
        'Invalid Account instance: missing required properties'
      );
    });
  });

  describe('toUniversalFromKeyPair (solana)', () => {
    const keypair = Keypair.generate();

    it('creates a valid UniversalSigner for Solana', async () => {
      const signer = await PushChain.utils.signer.toUniversalFromKeyPair(
        keypair,
        {
          chain: CHAIN.SOLANA_TESTNET,
          library: LIBRARY.SOLANA_WEB3,
        }
      );

      expect(signer.account.chain).toBe(CHAIN.SOLANA_TESTNET);
      expect(signer.account.address).toBe(keypair.publicKey.toBase58());
      expect(typeof signer.signMessage).toBe('function');
      expect(typeof signer.signTransaction).toBe('function');
    });

    it('throws error for non-Solana chain', async () => {
      await expect(
        PushChain.utils.signer.toUniversalFromKeyPair(keypair, {
          chain: CHAIN.ETHEREUM_SEPOLIA,
          library: LIBRARY.SOLANA_WEB3,
        })
      ).rejects.toThrow('Invalid chain for Solana Keypair');
    });

    it('signs messages correctly', async () => {
      const signer = await PushChain.utils.signer.toUniversalFromKeyPair(
        keypair,
        {
          chain: CHAIN.SOLANA_MAINNET,
          library: LIBRARY.SOLANA_WEB3,
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
          chain: CHAIN.SOLANA_MAINNET,
          library: LIBRARY.SOLANA_WEB3,
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
        chain: CHAIN.ETHEREUM_SEPOLIA,
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
      const skeleton = PushChain.utils.signer.construct({
        signMessage: mockSignMessage,
        signTransaction: mockSignTransaction,
        signTypedData: mockSignTypedData,
        account: mockAccount,
        signerId: 'CustomGeneratedSigner',
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
        chain: CHAIN.SOLANA_TESTNET,
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
      const skeleton = PushChain.utils.signer.construct({
        signMessage: mockSignMessage,
        signTransaction: mockSignTransaction,
        account: mockAccount,
        signerId: 'CustomGeneratedSigner',
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
        chain: CHAIN.ETHEREUM_SEPOLIA,
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
      const skeleton = PushChain.utils.signer.construct({
        signMessage: mockSignMessage,
        signTransaction: mockSignTransaction,
        signTypedData: mockSignTypedData,
        account: mockAccount,
        signerId: 'CustomGeneratedSigner',
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
});

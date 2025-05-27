import {
  createUniversalSigner,
  createUniversalSignerFromViem,
  createUniversalSignerFromSolanaKeypair,
} from './signer';
import { CHAIN } from '../../constants/enums';
import {
  createWalletClient,
  http,
  hexToBytes,
  type Hex,
  serializeTransaction,
  type TransactionSerializableEIP1559,
} from 'viem';
import { UniversalSigner } from '../universal.types';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { Keypair } from '@solana/web3.js';

describe('Universal Account Utilities', () => {
  describe('createUniversalSigner', () => {
    it('creates a valid UniversalSigner with chain info', () => {
      const dummySigner: UniversalSigner = {
        chain: CHAIN.ETHEREUM_SEPOLIA,
        address: '0xeCba9a32A9823f1cb00cdD8344Bf2D1d87a8dd97',
        signMessage: async (data: Uint8Array) => new Uint8Array([...data, 1]),
        signTransaction: async (tx: Uint8Array) => new Uint8Array([...tx, 2]),
      };

      const signer = createUniversalSigner(dummySigner);

      expect(signer.chain).toBe(CHAIN.ETHEREUM_SEPOLIA);
      expect(signer.address).toBe('0xeCba9a32A9823f1cb00cdD8344Bf2D1d87a8dd97');
      expect(typeof signer.signMessage).toBe('function');
      expect(typeof signer.signTransaction).toBe('function');
    });
  });

  describe('createUniversalSignerFromViem', () => {
    const pk = generatePrivateKey();
    const account = privateKeyToAccount(pk);
    const client = createWalletClient({
      account,
      chain: sepolia,
      transport: http(),
    });

    it('wraps a viem WalletClient into a UniversalSigner', async () => {
      const signer = await createUniversalSignerFromViem(
        client,
        CHAIN.ETHEREUM_SEPOLIA
      );

      expect(signer.chain).toBe(CHAIN.ETHEREUM_SEPOLIA);
      expect(signer.address).toBe(account.address);

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
      const signer = await createUniversalSignerFromViem(
        account,
        CHAIN.ETHEREUM_SEPOLIA
      );

      expect(signer.chain).toBe(CHAIN.ETHEREUM_SEPOLIA);
      expect(signer.address).toBe(account.address);

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
        createUniversalSignerFromViem(
          invalidAccount as any,
          CHAIN.ETHEREUM_SEPOLIA
        )
      ).rejects.toThrow(
        'Invalid Account instance: missing required properties'
      );
    });
  });

  describe('createUniversalSignerFromSolanaKeypair', () => {
    const keypair = Keypair.generate();

    it('creates a valid UniversalSigner for Solana', () => {
      const signer = createUniversalSignerFromSolanaKeypair(
        keypair,
        CHAIN.SOLANA_TESTNET
      );

      expect(signer.chain).toBe(CHAIN.SOLANA_TESTNET);
      expect(signer.address).toBe(keypair.publicKey.toBase58());
      expect(typeof signer.signMessage).toBe('function');
      expect(typeof signer.signTransaction).toBe('function');
    });

    it('throws error for non-Solana chain', () => {
      expect(() =>
        createUniversalSignerFromSolanaKeypair(keypair, CHAIN.ETHEREUM_SEPOLIA)
      ).toThrow('Invalid chain for Solana Keypair');
    });

    it('signs messages correctly', async () => {
      const signer = createUniversalSignerFromSolanaKeypair(
        keypair,
        CHAIN.SOLANA_MAINNET
      );

      const msg = new TextEncoder().encode('test message');
      const sig = await signer.signMessage(msg);
      expect(sig).toBeInstanceOf(Uint8Array);
      expect(sig.length).toBeGreaterThan(0);
    });

    it('signs transactions correctly', async () => {
      const signer = createUniversalSignerFromSolanaKeypair(
        keypair,
        CHAIN.SOLANA_MAINNET
      );

      const tx = new TextEncoder().encode('test transaction');
      const sig = await signer.signTransaction(tx);
      expect(sig).toBeInstanceOf(Uint8Array);
      expect(sig.length).toBeGreaterThan(0);
    });
  });
});

import {
  createUniversalSigner,
  toUniversalFromKeyPair,
  toUniversal,
} from './signer';
import {
  WalletClient,
  hexToBytes,
  serializeTransaction,
  TransactionSerializableEIP1559,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { Keypair } from '@solana/web3.js';
import { ethers } from 'ethers';
import { CHAIN, LIBRARY } from '../../constants/enums';

describe('UniversalSigner utilities', () => {
  describe('createUniversalSigner', () => {
    it('should return a signer with provided methods and account', () => {
      const dummy = {
        account: { chain: CHAIN.ETHEREUM_SEPOLIA, address: '0xabc' },
        signMessage: async (d: Uint8Array) => d,
        signAndSendTransaction: async (d: Uint8Array) => d,
        signTypedData: async () => new Uint8Array([1]),
      };
      const signer = createUniversalSigner(dummy);
      expect(signer.account).toEqual(dummy.account);
      expect(typeof signer.signMessage).toBe('function');
      expect(typeof signer.signAndSendTransaction).toBe('function');
      expect(typeof signer.signTypedData).toBe('function');
    });
  });

  describe('toUniversalFromKeyPair - viem', () => {
    let mockClient: WalletClient;
    let account: any;

    beforeAll(() => {
      const pk = generatePrivateKey();
      account = privateKeyToAccount(pk);
      mockClient = {
        account,
        getAddresses: jest.fn().mockResolvedValue([account.address]),
        signMessage: jest.fn().mockResolvedValue('0xabcdef'),
        sendTransaction: jest.fn().mockResolvedValue('0x123456'),
        signTypedData: jest.fn().mockResolvedValue('0x789abc'),
      } as unknown as WalletClient;
    });

    it('wraps WalletClient correctly', async () => {
      const signer = await toUniversalFromKeyPair(mockClient, {
        chain: CHAIN.ETHEREUM_SEPOLIA,
        library: LIBRARY.ETHEREUM_VIEM,
      });
      expect(signer.account.chain).toBe(CHAIN.ETHEREUM_SEPOLIA);
      expect(signer.account.address).toBe(account.address);

      const msg = new TextEncoder().encode('hello');
      const sig = await signer.signMessage(msg);
      expect(sig).toBeInstanceOf(Uint8Array);
      expect(sig).toEqual(hexToBytes('0xabcdef'));

      const tx: TransactionSerializableEIP1559 = {
        to: account.address as `0x${string}`,
        value: BigInt(0),
        data: '0x' as any,
        chainId: sepolia.id,
        maxFeePerGas: BigInt(1),
        maxPriorityFeePerGas: BigInt(1),
        nonce: 0,
      };
      const raw = hexToBytes(serializeTransaction(tx));
      const hash = await signer.signAndSendTransaction(raw);
      expect(hash).toBeInstanceOf(Uint8Array);
      expect(hash).toEqual(hexToBytes('0x123456'));
    });

    it('rejects invalid account', async () => {
      await expect(
        toUniversalFromKeyPair({} as any, {
          chain: CHAIN.ETHEREUM_SEPOLIA,
          library: LIBRARY.ETHEREUM_VIEM,
        })
      ).rejects.toThrow();
    });
  });

  describe('toUniversalFromKeyPair - ethers v6', () => {
    const pk = generatePrivateKey();
    const mockProvider = {
      getNetwork: jest.fn().mockResolvedValue({ chainId: BigInt(11155111) }),
    } as any;
    const wallet = new ethers.Wallet(pk, mockProvider);

    it('wraps ethers.Wallet correctly', async () => {
      const signer = await toUniversalFromKeyPair(wallet, {
        chain: CHAIN.ETHEREUM_SEPOLIA,
        library: LIBRARY.ETHEREUM_ETHERSV6,
      });
      expect(signer.account.chain).toBe(CHAIN.ETHEREUM_SEPOLIA);
      expect(signer.account.address).toBe(await wallet.getAddress());

      const msg = new TextEncoder().encode('world');
      const sig = await signer.signMessage(msg);
      expect(sig).toBeInstanceOf(Uint8Array);
      expect(sig.length).toBeGreaterThan(0);
    });

    it('throws if no provider', async () => {
      const w = new ethers.Wallet(pk);
      await expect(
        toUniversalFromKeyPair(w, {
          chain: CHAIN.ETHEREUM_SEPOLIA,
          library: LIBRARY.ETHEREUM_ETHERSV6,
        })
      ).rejects.toThrow('provider');
    });
  });

  describe('toUniversalFromKeyPair - solana', () => {
    const keypair = Keypair.generate();

    it('wraps Solana Keypair correctly', async () => {
      const signer = await toUniversalFromKeyPair(keypair, {
        chain: CHAIN.SOLANA_DEVNET,
        library: LIBRARY.SOLANA_WEB3JS,
      });
      expect(signer.account.chain).toBe(CHAIN.SOLANA_DEVNET);
      expect(signer.account.address).toBe(keypair.publicKey.toBase58());

      const msg = new TextEncoder().encode('sol');
      const sig = await signer.signMessage(msg);
      expect(sig).toBeInstanceOf(Uint8Array);
      expect(sig.length).toBe(64);
    });

    it('throws on wrong chain', async () => {
      await expect(
        toUniversalFromKeyPair(keypair, {
          chain: CHAIN.ETHEREUM_MAINNET,
          library: LIBRARY.SOLANA_WEB3JS,
        })
      ).rejects.toThrow('Invalid chain');
    });
  });

  describe('toUniversal', () => {
    it('preserves skeleton methods', async () => {
      const skeleton = {
        signerId: 's',
        account: { chain: CHAIN.ETHEREUM_SEPOLIA, address: '0x1' },
        signMessage: async (d: Uint8Array) => d,
        signAndSendTransaction: async (d: Uint8Array) => d,
        signTypedData: async () => new Uint8Array([1]),
      };
      const uni = await toUniversal(skeleton as any);
      expect(uni.signMessage).toBe(skeleton.signMessage);
      expect(uni.signAndSendTransaction).toBe(skeleton.signAndSendTransaction);
      expect(uni.signTypedData).toBe(skeleton.signTypedData);
    });
  });
});

import {
  createUniversalSigner,
  toUniversalFromKeypair,
  toUniversal,
  construct,
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

  describe('toUniversalFromKeypair - viem', () => {
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
      const signer = await toUniversalFromKeypair(mockClient, {
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
        toUniversalFromKeypair({} as any, {
          chain: CHAIN.ETHEREUM_SEPOLIA,
          library: LIBRARY.ETHEREUM_VIEM,
        })
      ).rejects.toThrow();
    });
  });

  describe('toUniversalFromKeypair - EIP-7702 capability gating (viem)', () => {
    // viem exposes the `signAuthorization` action on EVERY WalletClient, so the
    // capability must be gated on the *account* (only local accounts can sign
    // an authorization offline), not on the client method.
    it('exposes signAuthorization for a local account', async () => {
      const account = privateKeyToAccount(generatePrivateKey());
      const client = {
        account, // local account → has account.signAuthorization
        getAddresses: jest.fn().mockResolvedValue([account.address]),
        signMessage: jest.fn().mockResolvedValue('0xabc'),
        sendTransaction: jest.fn(),
        signTypedData: jest.fn(),
        signAuthorization: jest.fn(),
      } as unknown as WalletClient;
      const signer = await toUniversalFromKeypair(client, {
        chain: CHAIN.ETHEREUM_SEPOLIA,
        library: LIBRARY.ETHEREUM_VIEM,
      });
      expect(typeof signer.signAuthorization).toBe('function');
    });

    it('omits signAuthorization for a JSON-RPC account', async () => {
      const jsonRpcAccount = {
        address: '0x1111111111111111111111111111111111111111',
        type: 'json-rpc',
      };
      const client = {
        account: jsonRpcAccount, // no account.signAuthorization → cannot sign offline
        getAddresses: jest.fn().mockResolvedValue([jsonRpcAccount.address]),
        signMessage: jest.fn().mockResolvedValue('0xabc'),
        sendTransaction: jest.fn(),
        signTypedData: jest.fn(),
        signAuthorization: jest.fn(), // present on the client, must NOT be trusted
      } as unknown as WalletClient;
      const signer = await toUniversalFromKeypair(client, {
        chain: CHAIN.ETHEREUM_SEPOLIA,
        library: LIBRARY.ETHEREUM_VIEM,
      });
      expect(signer.signAuthorization).toBeUndefined();
    });
  });

  describe('toUniversalFromKeypair - ethers v6', () => {
    const pk = generatePrivateKey();
    const mockProvider = {
      getNetwork: jest.fn().mockResolvedValue({ chainId: BigInt(11155111) }),
    } as any;
    const wallet = new ethers.Wallet(pk, mockProvider);

    it('wraps ethers.Wallet correctly', async () => {
      const signer = await toUniversalFromKeypair(wallet, {
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
        toUniversalFromKeypair(w, {
          chain: CHAIN.ETHEREUM_SEPOLIA,
          library: LIBRARY.ETHEREUM_ETHERSV6,
        })
      ).rejects.toThrow('provider');
    });
  });

  describe('toUniversalFromKeypair - solana', () => {
    const keypair = Keypair.generate();

    it('wraps Solana Keypair correctly', async () => {
      const signer = await toUniversalFromKeypair(keypair, {
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
        toUniversalFromKeypair(keypair, {
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

  describe('construct', () => {
    const mockAccount = {
      chain: CHAIN.ETHEREUM_SEPOLIA,
      address: '0x123',
    };

    const mockOptions = {
      signMessage: async (data: Uint8Array) => data,
      signAndSendTransaction: async (data: Uint8Array) => data,
    };

    it('should create a UniversalSignerSkeleton with required parameters', () => {
      const signer = construct(mockAccount, mockOptions);

      expect(signer.signerId).toBe('CustomGeneratedSigner');
      expect(signer.account).toEqual(mockAccount);
      expect(signer.signMessage).toBe(mockOptions.signMessage);
      expect(signer.signAndSendTransaction).toBe(
        mockOptions.signAndSendTransaction
      );
      expect(signer.signTypedData).toBeUndefined();
      expect(signer.signAuthorization).toBeUndefined();
    });

    it('should include signTypedData when provided', () => {
      const mockSignTypedData = async () => new Uint8Array([1]);
      const signer = construct(mockAccount, {
        ...mockOptions,
        signTypedData: mockSignTypedData,
      });

      expect(signer.signTypedData).toBe(mockSignTypedData);
    });

    it('should include signAuthorization when provided', async () => {
      const signedAuthorization = {
        address: '0x1111111111111111111111111111111111111111' as const,
        chainId: 11155111,
        nonce: 7,
        r: `0x${'11'.repeat(32)}` as `0x${string}`,
        s: `0x${'22'.repeat(32)}` as `0x${string}`,
        yParity: 1,
      };
      const mockSignAuthorization = jest
        .fn()
        .mockResolvedValue(signedAuthorization);
      const signer = construct(mockAccount, {
        ...mockOptions,
        signAuthorization: mockSignAuthorization,
      });
      const params = {
        contractAddress: '0x2222222222222222222222222222222222222222' as const,
        chainId: 11155111,
        nonce: 7,
      };

      expect(signer.signAuthorization).toBe(mockSignAuthorization);
      await expect(signer.signAuthorization?.(params)).resolves.toEqual(
        signedAuthorization
      );
      expect(mockSignAuthorization).toHaveBeenCalledWith(params);
    });

    it('should throw error when signTypedData is provided for Solana chain', () => {
      const solanaAccount = {
        chain: CHAIN.SOLANA_MAINNET,
        address: 'solana-address',
      };

      const mockSignTypedData = async () => new Uint8Array([1]);

      expect(() =>
        construct(solanaAccount, {
          ...mockOptions,
          signTypedData: mockSignTypedData,
        })
      ).toThrow('Typed data signing is not supported for Solana');
    });

    it('should work with Solana chain when signTypedData is not provided', () => {
      const solanaAccount = {
        chain: CHAIN.SOLANA_MAINNET,
        address: 'solana-address',
      };

      const signer = construct(solanaAccount, mockOptions);

      expect(signer.signerId).toBe('CustomGeneratedSigner');
      expect(signer.account).toEqual(solanaAccount);
      expect(signer.signMessage).toBe(mockOptions.signMessage);
      expect(signer.signAndSendTransaction).toBe(
        mockOptions.signAndSendTransaction
      );
      expect(signer.signTypedData).toBeUndefined();
    });

    it('should throw when signAuthorization is provided for a Solana chain', () => {
      const solanaAccount = {
        chain: CHAIN.SOLANA_MAINNET,
        address: 'solana-address',
      };

      expect(() =>
        construct(solanaAccount, {
          ...mockOptions,
          signAuthorization: jest.fn(),
        })
      ).toThrow('EIP-7702 authorization is not supported for Solana');
    });
  });

  describe('construct + toUniversal two-step process', () => {
    const mockAccount = {
      chain: CHAIN.ETHEREUM_SEPOLIA,
      address: '0x123',
    };

    // Raw functions that will be used to create the signer
    const rawSignMessage = async (data: Uint8Array) => {
      return new Uint8Array([...data, 1, 2, 3]); // Append some bytes to simulate signing
    };

    const rawSignAndSendTransaction = async (data: Uint8Array) => {
      return new Uint8Array([...data, 4, 5, 6]); // Append some bytes to simulate tx hash
    };

    const rawSignTypedData = async ({
      domain,
      types,
      primaryType,
      message,
    }: {
      domain: any;
      types: any;
      primaryType: string;
      message: any;
    }) => {
      return new Uint8Array([7, 8, 9]); // Return some bytes to simulate typed data signature
    };

    const rawSignAuthorization = jest.fn().mockResolvedValue({
      address: '0x1111111111111111111111111111111111111111' as const,
      chainId: 11155111,
      nonce: 4,
      r: `0x${'11'.repeat(32)}` as `0x${string}`,
      s: `0x${'22'.repeat(32)}` as `0x${string}`,
      yParity: 0,
    });

    it('should create a UniversalSigner through construct + toUniversal', async () => {
      // Step 1: Create a UniversalSignerSkeleton using construct
      const skeleton = construct(mockAccount, {
        signMessage: rawSignMessage,
        signAndSendTransaction: rawSignAndSendTransaction,
        signTypedData: rawSignTypedData,
        signAuthorization: rawSignAuthorization,
      });

      // Verify the skeleton structure
      expect(skeleton.signerId).toBe('CustomGeneratedSigner');
      expect(skeleton.account).toEqual(mockAccount);
      expect(skeleton.signMessage).toBe(rawSignMessage);
      expect(skeleton.signAndSendTransaction).toBe(rawSignAndSendTransaction);
      expect(skeleton.signTypedData).toBe(rawSignTypedData);
      expect(skeleton.signAuthorization).toBe(rawSignAuthorization);

      // Step 2: Convert the skeleton to a UniversalSigner using toUniversal
      const universalSigner = await toUniversal(skeleton);

      // Verify the universal signer structure
      expect(universalSigner.account).toEqual(mockAccount);
      expect(universalSigner.signMessage).toBe(rawSignMessage);
      expect(universalSigner.signAndSendTransaction).toBe(
        rawSignAndSendTransaction
      );
      expect(universalSigner.signTypedData).toBe(rawSignTypedData);
      expect(universalSigner.signAuthorization).toBe(rawSignAuthorization);

      // Test the actual functionality
      const testMessage = new Uint8Array([1, 2, 3]);
      const signedMessage = await universalSigner.signMessage(testMessage);
      expect(signedMessage).toEqual(new Uint8Array([1, 2, 3, 1, 2, 3]));

      const testTx = new Uint8Array([4, 5, 6]);
      const txHash = await universalSigner.signAndSendTransaction(testTx);
      expect(txHash).toEqual(new Uint8Array([4, 5, 6, 4, 5, 6]));

      if (universalSigner.signTypedData) {
        const typedDataSignature = await universalSigner.signTypedData({
          domain: {},
          types: {},
          primaryType: 'Test',
          message: {},
        });
        expect(typedDataSignature).toEqual(new Uint8Array([7, 8, 9]));
      }

      const authorizationParams = {
        contractAddress: '0x2222222222222222222222222222222222222222' as const,
        chainId: 11155111,
        nonce: 4,
      };
      await expect(
        universalSigner.signAuthorization?.(authorizationParams)
      ).resolves.toEqual(
        expect.objectContaining({
          address: '0x1111111111111111111111111111111111111111',
          nonce: 4,
        })
      );
      expect(rawSignAuthorization).toHaveBeenCalledWith(authorizationParams);
    });

    it('should work without signTypedData for Solana chain', async () => {
      const solanaAccount = {
        chain: CHAIN.SOLANA_MAINNET,
        address: 'solana-address',
      };

      // Step 1: Create skeleton without signTypedData
      const skeleton = construct(solanaAccount, {
        signMessage: rawSignMessage,
        signAndSendTransaction: rawSignAndSendTransaction,
      });

      // Step 2: Convert to UniversalSigner
      const universalSigner = await toUniversal(skeleton);

      // Verify structure
      expect(universalSigner.account).toEqual(solanaAccount);
      expect(universalSigner.signMessage).toBe(rawSignMessage);
      expect(universalSigner.signAndSendTransaction).toBe(
        rawSignAndSendTransaction
      );
      expect(universalSigner.signTypedData).toBeUndefined();

      // Test functionality
      const testMessage = new Uint8Array([1, 2, 3]);
      const signedMessage = await universalSigner.signMessage(testMessage);
      expect(signedMessage).toEqual(new Uint8Array([1, 2, 3, 1, 2, 3]));
    });
  });
});

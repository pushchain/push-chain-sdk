import { Orchestrator } from './orchestrator';
import { CHAIN, LIBRARY, PUSH_NETWORK } from '../constants/enums';
import { UniversalSigner } from '../universal/universal.types';
import { createWalletClient, Hex, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { Keypair } from '@solana/web3.js';
import { toUniversalFromKeypair } from '../universal/signer/signer';
import { SvmClient } from '../vm-client/svm-client';
import { CHAIN_INFO } from '../constants/chain';
import { SignatureType } from '../generated/v1/tx';

describe('Orchestrator', () => {
  const mockSigner: UniversalSigner = {
    account: {
      address: '0x35B84d6848D16415177c64D64504663b998A6ab4',
      chain: CHAIN.ETHEREUM_SEPOLIA,
    },
    signMessage: async (data: Uint8Array) => {
      return data;
    },
    signAndSendTransaction: async (unsignedTx: Uint8Array) => {
      return unsignedTx;
    },
  };

  describe('lockFee', () => {
    it('eth sepolia', async () => {
      // Create orchestrator for eth_sepolia signer

      const chain = CHAIN.ETHEREUM_SEPOLIA;
      const PRIVATE_KEY = process.env['EVM_PRIVATE_KEY'] as Hex | undefined;

      if (!PRIVATE_KEY) {
        throw new Error('SEPOLIA_PRIVATE_KEY environment variable is not set');
      }

      const account = privateKeyToAccount(PRIVATE_KEY);
      const walletClient = createWalletClient({
        account: account,
        transport: http(CHAIN_INFO[chain].defaultRPC[0]),
      });

      const ethSepoliaSigner: UniversalSigner = await toUniversalFromKeypair(
        walletClient,
        {
          chain,
          library: LIBRARY.ETHEREUM_VIEM,
        }
      );

      const orchestrator = new Orchestrator(
        ethSepoliaSigner,
        PUSH_NETWORK.TESTNET_DONUT
      );
      const txHash = await orchestrator['lockFee'](BigInt(1)); // 0.00000001 USDC
      console.log('lockFee txHash:', txHash);
      expect(txHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
    });

    it('solana devnet', async () => {
      const chain = CHAIN.SOLANA_DEVNET;
      const privateKeyHex = process.env['SOLANA_PRIVATE_KEY'];
      if (!privateKeyHex) {
        throw new Error('SOLANA_PRIVATE_KEY environment variable is not set');
      }
      const privateKey = Uint8Array.from(Buffer.from(privateKeyHex, 'hex'));

      // Generate a keypair from the private key in .env
      const testAccount = Keypair.fromSecretKey(privateKey);

      const solanaDevnetSigner = await toUniversalFromKeypair(testAccount, {
        chain,
        library: LIBRARY.SOLANA_WEB3JS,
      });

      const svmClient = new SvmClient({
        rpcUrls: ['https://api.devnet.solana.com'],
      });

      const balance = await svmClient.getBalance(
        solanaDevnetSigner.account.address
      );
      console.log(
        'balance:',
        balance,
        'address: ',
        solanaDevnetSigner.account.address
      );

      const orchestrator = new Orchestrator(
        solanaDevnetSigner,
        PUSH_NETWORK.TESTNET_DONUT
      );

      const amount = BigInt(100); // 0.000001 USDC
      const dummyTxHash =
        '25ytBco5ZxMaaatzKwcw28emNHD42JzCVe5wUy78mTA8ophwLCZN6dXKkXaRfxhgCdWdqSKpvGNuKvbqJQjzLKwy';

      const txHash = await orchestrator['lockFee'](amount, dummyTxHash);
      console.log('lockFee txHash:', txHash);
      expect(txHash).toMatch(/^[1-9A-HJ-NP-Za-km-z]{87,88}$/);
    });
  });

  describe('computeExecutionHash', () => {
    const orc = new Orchestrator(mockSigner, PUSH_NETWORK.TESTNET_DONUT);
    const expectedHash =
      '0x67f36f7e406c900444bc9daba0c70d9b565011e6cab09cabb2b0b805864e07e9';
    it('should return the expected Hash', () => {
      const value = {
        to: '0x527F3692F5C53CfA83F7689885995606F93b6164' as `0x{string}`,
        value: '0',
        data: '0x2ba2ed980000000000000000000000000000000000000000000000000000000000000312' as `0x{string}`,
        gasLimit: '21000000',
        maxFeePerGas: '10000000000000000',
        maxPriorityFeePerGas: '2',
        nonce: '1',
        deadline: '9999999999',
        sigType: SignatureType.signedVerification,
      };

      const hash = orc['computeExecutionHash']({
        chainId: 9000,
        payload: value,
        verifyingContract: '0x48445e02796af0b076f96fc013536f1c879e282c',
      });
      expect(hash === expectedHash).toBe(true);
    });

    it('should return different hash on changing params', () => {
      const value = {
        to: '0x527F3692F5C53CfA83F7689885995606F93b6164' as `0x{string}`,
        value: '0',
        data: '0x2ba2ed980000000000000000000000000000000000000000000000000000000000000312' as `0x{string}`,
        gasLimit: '21000000',
        maxFeePerGas: '10000000000000000',
        maxPriorityFeePerGas: '2',
        nonce: '1',
        deadline: '9999999998',
        sigType: SignatureType.signedVerification,
      };

      const hash = orc['computeExecutionHash']({
        chainId: 9000,
        payload: value,
        verifyingContract: '0x48445e02796af0b076f96fc013536f1c879e282c',
      });
      expect(hash === expectedHash).toBe(false);
    });
  });

  describe('calculateUEAOffchain', () => {
    describe('EVM signers', () => {
      it('should calculate consistent UEA address for Ethereum Sepolia signer', async () => {
        const ethSepoliaSigner: UniversalSigner = {
          account: {
            address: '0x35B84d6848D16415177c64D64504663b998A6ab4',
            chain: CHAIN.ETHEREUM_SEPOLIA,
          },
          signMessage: async (data: Uint8Array) => {
            return data;
          },
          signAndSendTransaction: async (unsignedTx: Uint8Array) => {
            return unsignedTx;
          },
        };

        const orchestrator = new Orchestrator(
          ethSepoliaSigner,
          PUSH_NETWORK.TESTNET_DONUT
        );

        const ueaAddress = await orchestrator.computeUEAOffchain();

        // Should return a valid Ethereum address
        expect(ueaAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);

        // Should be consistent across multiple calls
        const ueaAddress2 = await orchestrator.computeUEAOffchain();
        expect(ueaAddress).toBe(ueaAddress2);
      });

      it('should calculate different UEA addresses for different EVM addresses', async () => {
        const signer1: UniversalSigner = {
          account: {
            address: '0x35B84d6848D16415177c64D64504663b998A6ab4',
            chain: CHAIN.ETHEREUM_SEPOLIA,
          },
          signMessage: async (data: Uint8Array) => data,
          signAndSendTransaction: async (unsignedTx: Uint8Array) => unsignedTx,
        };

        const signer2: UniversalSigner = {
          account: {
            address: '0x1234567890123456789012345678901234567890',
            chain: CHAIN.ETHEREUM_SEPOLIA,
          },
          signMessage: async (data: Uint8Array) => data,
          signAndSendTransaction: async (unsignedTx: Uint8Array) => unsignedTx,
        };

        const orchestrator1 = new Orchestrator(
          signer1,
          PUSH_NETWORK.TESTNET_DONUT
        );
        const orchestrator2 = new Orchestrator(
          signer2,
          PUSH_NETWORK.TESTNET_DONUT
        );

        const ueaAddress1 = await orchestrator1.computeUEAOffchain();
        const ueaAddress2 = await orchestrator2.computeUEAOffchain();

        expect(ueaAddress1).not.toBe(ueaAddress2);
      });
    });

    describe('SVM signers', () => {
      it('should calculate consistent UEA address for Solana Devnet signer', async () => {
        // Create a test Solana keypair
        const testKeypair = Keypair.generate();

        const solanaSigner: UniversalSigner = {
          account: {
            address: testKeypair.publicKey.toString(),
            chain: CHAIN.SOLANA_DEVNET,
          },
          signMessage: async (data: Uint8Array) => {
            return data;
          },
          signAndSendTransaction: async (unsignedTx: Uint8Array) => {
            return unsignedTx;
          },
        };

        const orchestrator = new Orchestrator(
          solanaSigner,
          PUSH_NETWORK.TESTNET_DONUT
        );

        const ueaAddress = await orchestrator.computeUEAOffchain();

        // Should return a valid Ethereum address
        expect(ueaAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);

        // Should be consistent across multiple calls
        const ueaAddress2 = await orchestrator.computeUEAOffchain();
        expect(ueaAddress).toBe(ueaAddress2);
      });

      it('should calculate different UEA addresses for different Solana addresses', async () => {
        const keypair1 = Keypair.generate();
        const keypair2 = Keypair.generate();

        const signer1: UniversalSigner = {
          account: {
            address: keypair1.publicKey.toString(),
            chain: CHAIN.SOLANA_DEVNET,
          },
          signMessage: async (data: Uint8Array) => data,
          signAndSendTransaction: async (unsignedTx: Uint8Array) => unsignedTx,
        };

        const signer2: UniversalSigner = {
          account: {
            address: keypair2.publicKey.toString(),
            chain: CHAIN.SOLANA_DEVNET,
          },
          signMessage: async (data: Uint8Array) => data,
          signAndSendTransaction: async (unsignedTx: Uint8Array) => unsignedTx,
        };

        const orchestrator1 = new Orchestrator(
          signer1,
          PUSH_NETWORK.TESTNET_DONUT
        );
        const orchestrator2 = new Orchestrator(
          signer2,
          PUSH_NETWORK.TESTNET_DONUT
        );

        const ueaAddress1 = await orchestrator1.computeUEAOffchain();
        const ueaAddress2 = await orchestrator2.computeUEAOffchain();

        expect(ueaAddress1).not.toBe(ueaAddress2);
      });
    });

    describe('different Push networks', () => {
      it('should produce different UEA addresses for different Push networks', async () => {
        const signer: UniversalSigner = {
          account: {
            address: '0x35B84d6848D16415177c64D64504663b998A6ab4',
            chain: CHAIN.ETHEREUM_SEPOLIA,
          },
          signMessage: async (data: Uint8Array) => data,
          signAndSendTransaction: async (unsignedTx: Uint8Array) => unsignedTx,
        };

        const testnetOrchestrator = new Orchestrator(
          signer,
          PUSH_NETWORK.TESTNET_DONUT
        );
        const localnetOrchestrator = new Orchestrator(
          signer,
          PUSH_NETWORK.LOCALNET
        );

        const testnetUeaAddress =
          await testnetOrchestrator.computeUEAOffchain();
        const localnetUeaAddress =
          await localnetOrchestrator.computeUEAOffchain();

        expect(testnetUeaAddress).not.toBe(localnetUeaAddress);
      });
    });

    describe('address consistency', () => {
      it('should return the same address as UEA for EVM signer', async () => {
        const ethSepoliaSigner: UniversalSigner = {
          account: {
            address: '0x35B84d6848D16415177c64D64504663b998A6ab4',
            chain: CHAIN.ETHEREUM_SEPOLIA,
          },
          signMessage: async (data: Uint8Array) => {
            return data;
          },
          signAndSendTransaction: async (unsignedTx: Uint8Array) => {
            return unsignedTx;
          },
        };

        const orchestrator = new Orchestrator(
          ethSepoliaSigner,
          PUSH_NETWORK.TESTNET_DONUT
        );

        const offchainAddress = await orchestrator.computeUEAOffchain();
        const UEAResult = await orchestrator.computeUEA();

        expect(offchainAddress).toBe(UEAResult.address);
      });

      it('should return the same address as UEA for SVM signer', async () => {
        const testKeypair = Keypair.generate();

        const solanaSigner: UniversalSigner = {
          account: {
            address: testKeypair.publicKey.toString(),
            chain: CHAIN.SOLANA_DEVNET,
          },
          signMessage: async (data: Uint8Array) => {
            return data;
          },
          signAndSendTransaction: async (unsignedTx: Uint8Array) => {
            return unsignedTx;
          },
        };

        const orchestrator = new Orchestrator(
          solanaSigner,
          PUSH_NETWORK.TESTNET_DONUT
        );

        const offchainAddress = await orchestrator.computeUEAOffchain();
        const UEAResult = await orchestrator.computeUEA();

        expect(offchainAddress).toBe(UEAResult.address);
      });
    });
  });
});

import { Orchestrator } from './orchestrator';
import { CHAIN, NETWORK } from '../constants/enums';
import { UniversalSigner } from '../universal/universal.types';
import {
  bytesToHex,
  Hex,
  hexToBytes,
  parseEther,
  parseTransaction,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { Keypair } from '@solana/web3.js';
import nacl from 'tweetnacl';

describe('Orchestrator', () => {
  const mockSigner: UniversalSigner = {
    address: '0x35B84d6848D16415177c64D64504663b998A6ab4',
    chain: CHAIN.ETHEREUM_SEPOLIA,
    signMessage: async (data: Uint8Array) => {
      return data;
    },
    signTransaction: async (unsignedTx: Uint8Array) => {
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

      const ethSepoliaSigner: UniversalSigner = {
        address: account.address,
        chain,
        signMessage: async (data: Uint8Array) => {
          const hexSig = await account.signMessage({
            message: { raw: data },
          });
          return hexToBytes(hexSig);
        },
        signTransaction: async (unsignedTx: Uint8Array) => {
          const tx = parseTransaction(bytesToHex(unsignedTx));
          const txHash = await account.signTransaction(tx as never);
          return hexToBytes(txHash);
        },
      };

      const orchestrator = new Orchestrator(ethSepoliaSigner, NETWORK.TESTNET);
      const txHash = await orchestrator['lockFee'](parseEther('0.0001'));
      console.log('lockFee txHash:', txHash);
      expect(txHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
    });

    it('solana devnet', async () => {
      // Create orchestrator for eth_sepolia signer

      const chain = CHAIN.SOLANA_DEVNET;
      const privateKeyHex = process.env['SOLANA_PRIVATE_KEY'];
      if (!privateKeyHex) {
        throw new Error('SOLANA_PRIVATE_KEY environment variable is not set');
      }
      const privateKey = Uint8Array.from(Buffer.from(privateKeyHex, 'hex'));

      // Generate a keypair from the private key in .env
      const testAccount = Keypair.fromSecretKey(privateKey);

      // Create the object first with any required properties
      const solanaDevnetSigner = {
        address: testAccount.publicKey.toBase58(),
        chain,
        signMessage: async (data: Uint8Array) => {
          return nacl.sign.detached(data, testAccount.secretKey);
        },
        signTransaction: async function (unsignedTx: Uint8Array) {
          return nacl.sign.detached(unsignedTx, testAccount.secretKey);
        },
      };

      const orchestrator = new Orchestrator(
        solanaDevnetSigner,
        NETWORK.TESTNET
      );
      const txHash = await orchestrator['lockFee'](parseEther('0.0001'));
      console.log('lockFee txHash:', txHash);
      expect(txHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
    });
  });

  describe('sendCrossChainPushTx', () => {
    //
  });

  describe('sha256HashOfJson', () => {
    const orc = new Orchestrator(mockSigner, NETWORK.TESTNET);
    it('returns the same hash for identical objects with different key order', () => {
      const objA = { foo: 1, bar: 2 };
      const objB = { bar: 2, foo: 1 };

      const hashA = orc['sha256HashOfJson'](objA);
      const hashB = orc['sha256HashOfJson'](objB);

      expect(hashA).toBe(hashB);
      expect(hashA).toMatch(/^0x[a-fA-F0-9]{64}$/);
    });

    it('produces different hashes for different content', () => {
      const obj1 = { foo: 1 };
      const obj2 = { foo: 2 };
      const hash1 = orc['sha256HashOfJson'](obj1);
      const hash2 = orc['sha256HashOfJson'](obj2);

      expect(hash1).not.toBe(hash2);
    });
  });
});

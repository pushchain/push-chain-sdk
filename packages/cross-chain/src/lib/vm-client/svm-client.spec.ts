import { SvmClient } from './svm-client';
import {
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { UniversalSigner } from '../universal/universal.types';
import { CHAIN } from '../constants/enums';
// @ts-expect-error @ts-ignore
import BN from 'bn.js';

// Add type declaration for bn.js
declare module 'bn.js';

const PROGRAM_ID = '5RiJQzUP7zHmSGdSn3PiDmgj6zv9vsx8KXy9foimCARn';
const chain = CHAIN.SOLANA_DEVNET;

// Example IDL for a simple program
const IDL = {
  version: '0.1.0',
  name: 'simple_counter',
  address: '5RiJQzUP7zHmSGdSn3PiDmgj6zv9vsx8KXy9foimCARn',
  instructions: [
    {
      name: 'initialize',
      discriminator: [0, 0, 0, 0, 0, 0, 0, 0],
      accounts: [
        {
          name: 'counter',
          isMut: true,
          isSigner: true,
        },
        {
          name: 'user',
          isMut: true,
          isSigner: true,
        },
        {
          name: 'systemProgram',
          isMut: false,
          isSigner: false,
        },
      ],
      args: [],
    },
    {
      name: 'increment',
      discriminator: [1, 0, 0, 0, 0, 0, 0, 0],
      accounts: [
        {
          name: 'counter',
          isMut: true,
          isSigner: false,
        },
      ],
      args: [],
    },
  ],
  accounts: [
    {
      name: 'Counter',
      discriminator: [0, 0, 0, 0, 0, 0, 0, 0],
      type: {
        kind: 'struct',
        fields: [
          {
            name: 'value',
            type: 'u64',
          },
        ],
      },
    },
  ],
  metadata: {
    name: 'simple_counter',
    version: '0.1.0',
    spec: '0.1.0',
  },
};

describe('SvmClient', () => {
  let svmClient: SvmClient;
  let universalSigner: UniversalSigner;
  let connection: Connection;
  let testAccount: Keypair;

  beforeAll(async () => {
    connection = new Connection(RPC_URL, 'confirmed');
    svmClient = new SvmClient({ rpcUrl: RPC_URL });

    // Generate a random keypair instead of reading from .env
    testAccount = Keypair.generate();
    universalSigner = {
      address: testAccount.publicKey.toBase58(),
      chain,
      signMessage: async (data: Uint8Array) => {
        return testAccount.secretKey.slice(0, 32); // Simplified for testing
      },
      signTransaction: async (unsignedTx: Uint8Array) => {
        // Implement signing logic if needed
        return unsignedTx;
      },
    };
  });

  describe('getBalance', () => {
    it('gets balance', async () => {
      const balance = await svmClient.getBalance(universalSigner.address);
      expect(typeof balance).toBe('bigint');
    });

    it('handles invalid address', async () => {
      await expect(svmClient.getBalance('invalidAddress')).rejects.toThrow();
    });

    it('returns zero balance for new address', async () => {
      const newKeypair = Keypair.generate();
      const balance = await svmClient.getBalance(
        newKeypair.publicKey.toBase58()
      );
      expect(balance).toBe(BigInt(0));
    });
  });

  describe('readContract', () => {
    it('reads contract value', async () => {
      // Assuming a deployed program and account
      const accountAddress = 'YourAccountAddressHere'; // Replace with actual account address
      const result = await svmClient.readContract({
        abi: IDL,
        address: accountAddress,
        functionName: 'ExampleAccount',
      });
      expect(result).toBeDefined();
    });

    it('throws error for invalid program address', async () => {
      await expect(
        svmClient.readContract({
          abi: IDL,
          address: 'invalidAddress',
          functionName: 'ExampleAccount',
        })
      ).rejects.toThrow();
    });

    it('throws error for non-existent account type', async () => {
      await expect(
        svmClient.readContract({
          abi: IDL,
          address: PROGRAM_ID,
          functionName: 'NonExistentAccount',
        })
      ).rejects.toThrow();
    });
  });

  describe('writeContract', () => {
    it.skip('writes contract value', async () => {
      const balance = await svmClient.getBalance(universalSigner.address);
      if (balance < BigInt(LAMPORTS_PER_SOL)) {
        console.warn('Skipping Test - Account has insufficient balance');
        return;
      }

      const txSignature = await svmClient.writeContract({
        abi: IDL,
        address: PROGRAM_ID,
        functionName: 'initialize',
        args: [new BN(42)],
        signer: universalSigner,
      });
      expect(txSignature).toMatch(/^[A-Za-z0-9]+$/);
    });

    it('throws error for invalid program address', async () => {
      await expect(
        svmClient.writeContract({
          abi: IDL,
          address: 'invalidAddress',
          functionName: 'initialize',
          args: [new BN(42)],
          signer: universalSigner,
        })
      ).rejects.toThrow();
    });

    it('throws error for missing signer.signTransaction', async () => {
      const invalidSigner = { ...universalSigner, signTransaction: undefined };
      await expect(
        svmClient.writeContract({
          abi: IDL,
          address: PROGRAM_ID,
          functionName: 'initialize',
          args: [new BN(42)],
          signer: invalidSigner as unknown as UniversalSigner,
        })
      ).rejects.toThrow('signer.signTransaction is undefined');
    });
  });

  describe('sendTransaction', () => {
    it.skip('sends a raw transaction', async () => {
      const balance = await svmClient.getBalance(universalSigner.address);
      if (balance < BigInt(LAMPORTS_PER_SOL)) {
        console.warn('Skipping Test - Account has insufficient balance');
        return;
      }

      const instruction = SystemProgram.transfer({
        fromPubkey: new PublicKey(universalSigner.address),
        toPubkey: new PublicKey(universalSigner.address),
        lamports: 1000,
      });

      const txSignature = await svmClient.sendTransaction({
        instructions: [instruction],
        signer: universalSigner,
      });
      expect(txSignature).toMatch(/^[A-Za-z0-9]+$/);
    });

    it('throws error for invalid recipient address', async () => {
      const invalidInstruction = new TransactionInstruction({
        keys: [
          {
            pubkey: new PublicKey(universalSigner.address),
            isSigner: true,
            isWritable: true,
          },
          {
            pubkey: new PublicKey('invalidAddress'),
            isSigner: false,
            isWritable: true,
          },
        ],
        programId: SystemProgram.programId,
        data: Buffer.alloc(0),
      });

      await expect(
        svmClient.sendTransaction({
          instructions: [invalidInstruction],
          signer: universalSigner,
        })
      ).rejects.toThrow();
    });

    it('throws error for missing signer.signTransaction', async () => {
      const invalidSigner = { ...universalSigner, signTransaction: undefined };
      const instruction = SystemProgram.transfer({
        fromPubkey: new PublicKey(universalSigner.address),
        toPubkey: new PublicKey(universalSigner.address),
        lamports: 1000,
      });

      await expect(
        svmClient.sendTransaction({
          instructions: [instruction],
          signer: invalidSigner as unknown as UniversalSigner,
        })
      ).rejects.toThrow('signer.signTransaction is undefined');
    });
  });
});

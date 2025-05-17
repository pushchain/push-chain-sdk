import { SvmClient } from './svm-client';
import { Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { UniversalSigner } from '../universal/universal.types';
import { CHAIN } from '../constants/enums';
import * as nacl from 'tweetnacl';

// Add type declaration for bn.js
declare module 'bn.js';

const PROGRAM_ID = 'ETGtqwDKEm1Z9gq6FdvYUfyDuUZr7g4UdPSmyNLVGriX';
const chain = CHAIN.SOLANA_DEVNET;
const RPC_URL =
  'https://devnet.helius-rpc.com/?api-key=6d172aff-5191-4b4a-bc10-e33f97a50131';

// Example IDL for a simple program
const IDL = {
  version: '0.1.0',
  name: 'counter_program',
  instructions: [
    {
      name: 'initialize',
      docs: [
        'Create the counter account (with 8 byte discriminator + 8 byte u64)',
      ],
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
      docs: ['Increment the counter by 1'],
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
      docs: ['The on‐chain data structure'],
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
};

describe('SvmClient', () => {
  let svmClient: SvmClient;
  let universalSigner: UniversalSigner;
  let testAccount: Keypair;

  beforeAll(async () => {
    svmClient = new SvmClient({ rpcUrl: RPC_URL });

    const privateKeyHex =
      'b15d0bfff786e50fea7bdc00433d7f2132eaa4abf2a0371230cc62c10a10157de40dd88e010b9e3f6c1e968d203d0f2ba0546cc21474b0a062fcbf2f91d52a7d';
    const privateKey = Uint8Array.from(Buffer.from(privateKeyHex, 'hex'));

    // Generate a random keypair instead of reading from .env
    testAccount = Keypair.fromSecretKey(privateKey);

    // Create the object first with any required properties
    universalSigner = {
      address: testAccount.publicKey.toBase58(),
      chain,
      signMessage: async (data: Uint8Array) => {
        return nacl.sign.detached(data, testAccount.secretKey);
      },
      signTransaction: async function (unsignedTx: Uint8Array) {
        return nacl.sign.detached(unsignedTx, testAccount.secretKey);
      },
    };
  });

  describe('getBalance', () => {
    it('gets balance', async () => {
      const balance = await svmClient.getBalance(universalSigner.address);
      expect(typeof balance).toBe('bigint');
    });

    it('returns non-zero balance for address that has SOL', async () => {
      const solanaAddressThatHasSOLOnDevnet =
        '8e7ekBeWmMdU6sJqnCwhm3P2bHBpNwZZ6RNiWJyrMyYz';
      const balance = await svmClient.getBalance(
        solanaAddressThatHasSOLOnDevnet
      );
      expect(balance).toBeGreaterThan(BigInt(0));
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
      const result = await svmClient.readContract({
        abi: IDL,
        address: PROGRAM_ID,
        functionName: 'counter',
        args: ['G3MUQYPgvn28KcaXKDTwHsTx89eA1fz4K1g8MjLiym1Q'],
      });
      expect(result).toBeDefined();
    });

    it('throws error for invalid program address', async () => {
      await expect(
        svmClient.readContract({
          abi: IDL,
          address: 'invalidAddress',
          functionName: 'counter',
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

  describe.only('writeContract', () => {
    it('writes contract value', async () => {
      const balance = await svmClient.getBalance(universalSigner.address);
      if (balance === BigInt(0)) {
        console.warn('Skipping Test - Account has insufficient balance');
        throw new Error('Not enough balance');
      }

      // Create a new keypair for the counter account
      const counterAccount = Keypair.generate();

      const txSignature = await svmClient.writeContract({
        abi: IDL,
        address: PROGRAM_ID,
        functionName: 'initialize',
        signer: universalSigner,
        // Pass dynamic accounts
        accounts: {
          counter: counterAccount.publicKey,
          user: new PublicKey(universalSigner.address),
          systemProgram: SystemProgram.programId,
        },
        // Pass keypairs that need to sign
        signers: [counterAccount],
      });
      console.log('Transaction Signature: ', txSignature);

      // Wait for the transaction to be confirmed
      await svmClient.confirmTransaction(txSignature);
      console.log('Transaction confirmed');

      expect(txSignature).toMatch(/^[A-Za-z0-9]+$/);
    });

    it('increments counter and verifies value increased', async () => {
      const balance = await svmClient.getBalance(universalSigner.address);
      if (balance === BigInt(0)) {
        console.warn('Skipping Test - Account has insufficient balance');
        throw new Error('Not enough balance');
      }

      // Create a new keypair for the counter account
      const counterAccount = Keypair.generate();

      // 1. Initialize the counter first
      const initTxSignature = await svmClient.writeContract({
        abi: IDL,
        address: PROGRAM_ID,
        functionName: 'initialize',
        signer: universalSigner,
        accounts: {
          counter: counterAccount.publicKey,
          user: new PublicKey(universalSigner.address),
          systemProgram: SystemProgram.programId,
        },
        signers: [counterAccount],
      });

      console.log('Initialize Transaction:', initTxSignature);

      // Wait for the initialization transaction to be confirmed
      await svmClient.confirmTransaction(initTxSignature);
      console.log('Initialize transaction confirmed');

      // 2. Read the initial value
      const initialCounter = await svmClient.readContract<{ value: number }>({
        abi: IDL,
        address: PROGRAM_ID,
        functionName: 'counter',
        args: [counterAccount.publicKey.toBase58()],
      });
      console.log('Initial value:', initialCounter.value);

      // 3. Call increment
      const incrementTxSignature = await svmClient.writeContract({
        abi: IDL,
        address: PROGRAM_ID,
        functionName: 'increment',
        signer: universalSigner,
        accounts: {
          counter: counterAccount.publicKey,
        },
        signers: [],
      });

      console.log('Increment Transaction:', incrementTxSignature);

      // Wait for the increment transaction to be confirmed
      await svmClient.confirmTransaction(incrementTxSignature);
      console.log('Increment transaction confirmed');

      // 4. Read the value again and verify it increased
      const updatedCounter = await svmClient.readContract<{ value: bigint }>({
        abi: IDL,
        address: PROGRAM_ID,
        functionName: 'counter',
        args: [counterAccount.publicKey.toBase58()],
      });

      expect(updatedCounter.value.toString()).toBe('1');
      console.log('Updated value:', updatedCounter.value);
    });

    // it('throws error for invalid program address', async () => {
    //   await expect(
    //     svmClient.writeContract({
    //       abi: IDL,
    //       address: 'invalidAddress',
    //       functionName: 'initialize',
    //       args: [new BN(42)],
    //       signer: universalSigner,
    //     })
    //   ).rejects.toThrow();
    // });

    // it('throws error for missing signer.signTransaction', async () => {
    //   const invalidSigner = { ...universalSigner, signTransaction: undefined };
    //   await expect(
    //     svmClient.writeContract({
    //       abi: IDL,
    //       address: PROGRAM_ID,
    //       functionName: 'initialize',
    //       args: [new BN(42)],
    //       signer: invalidSigner as unknown as UniversalSigner,
    //     })
    //   ).rejects.toThrow('signer.signTransaction is undefined');
    // });
  });

  describe('estimateGas', () => {
    it('estimates fee for a simple transfer', async () => {
      const instruction = SystemProgram.transfer({
        fromPubkey: new PublicKey(universalSigner.address),
        toPubkey: new PublicKey(universalSigner.address),
        lamports: 1,
      });
      const gas = await svmClient.estimateGas({
        instructions: [instruction],
        signer: universalSigner,
      });
      expect(typeof gas).toBe('bigint');
      expect(gas).toBeGreaterThan(BigInt(0));
    });

    it('handles empty instructions array', async () => {
      const gas = await svmClient.estimateGas({
        instructions: [],
        signer: universalSigner,
      });
      expect(typeof gas).toBe('bigint');
      // even with no instructions, fee is non-negative
      expect(gas).toBeGreaterThanOrEqual(BigInt(0));
    });
  });
});

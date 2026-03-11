import { SvmClient } from './svm-client';
import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { UniversalSigner } from '../universal/universal.types';
import { CHAIN, LIBRARY } from '../constants/enums';
import * as dotenv from 'dotenv';
import { PushChain } from '../push-chain/push-chain';

// Load environment variables
dotenv.config();

// Add type declaration for bn.js
declare module 'bn.js';

const PROGRAM_ID = '8yNqjrMnFiFbVTVQcKij8tNWWTMdFkrDf9abCGgc2sgx';
const chain = CHAIN.SOLANA_DEVNET;
const RPC_URL = process.env['SOLANA_RPC_URL'];

if (!RPC_URL) {
  throw new Error('SOLANA_RPC_URL environment variable is not set');
}

// Derive counter PDA (singleton per program, seeds: ["counter"])
const [counterPDA] = PublicKey.findProgramAddressSync(
  [Buffer.from('counter')],
  new PublicKey(PROGRAM_ID)
);

// Solana IDL for the test_counter program deployed on devnet
const IDL = {
  address: PROGRAM_ID,
  metadata: {
    name: 'test_counter',
    version: '0.1.0',
    spec: '0.1.0',
    description: 'Simple counter program for testing execute functions',
  },
  instructions: [
    {
      name: 'batch_operation',
      docs: [
        'Heavy batch operation - simulates complex DeFi operation with many accounts and large data',
        'This function is designed to test transaction size limits',
        'Takes many accounts (10-15) and large instruction data (200-400 bytes)',
        'Does minimal computation (just increments counter) to focus on size testing',
      ],
      discriminator: [15, 225, 16, 46, 54, 53, 8, 191],
      accounts: [
        {
          name: 'counter',
          writable: true,
          pda: {
            seeds: [
              {
                kind: 'const',
                value: [99, 111, 117, 110, 116, 101, 114],
              },
            ],
          },
        },
        {
          name: 'authority',
        },
      ],
      args: [
        {
          name: 'operation_id',
          type: 'u64',
        },
        {
          name: 'data',
          type: 'bytes',
        },
      ],
    },
    {
      name: 'decrement',
      docs: ['Decrement counter (can be called via CPI from gateway)'],
      discriminator: [106, 227, 168, 59, 248, 27, 150, 101],
      accounts: [
        {
          name: 'counter',
          writable: true,
          pda: {
            seeds: [
              {
                kind: 'const',
                value: [99, 111, 117, 110, 116, 101, 114],
              },
            ],
          },
        },
        {
          name: 'authority',
          relations: ['counter'],
        },
      ],
      args: [
        {
          name: 'amount',
          type: 'u64',
        },
      ],
    },
    {
      name: 'increment',
      docs: ['Increment counter (can be called via CPI from gateway)'],
      discriminator: [11, 18, 104, 9, 104, 174, 59, 33],
      accounts: [
        {
          name: 'counter',
          writable: true,
          pda: {
            seeds: [
              {
                kind: 'const',
                value: [99, 111, 117, 110, 116, 101, 114],
              },
            ],
          },
        },
        {
          name: 'authority',
          relations: ['counter'],
        },
      ],
      args: [
        {
          name: 'amount',
          type: 'u64',
        },
      ],
    },
    {
      name: 'initialize',
      docs: ['Initialize a counter account'],
      discriminator: [175, 175, 109, 31, 13, 152, 155, 237],
      accounts: [
        {
          name: 'counter',
          writable: true,
          pda: {
            seeds: [
              {
                kind: 'const',
                value: [99, 111, 117, 110, 116, 101, 114],
              },
            ],
          },
        },
        {
          name: 'authority',
          writable: true,
          signer: true,
        },
        {
          name: 'system_program',
          address: '11111111111111111111111111111111',
        },
      ],
      args: [
        {
          name: 'initial_value',
          type: 'u64',
        },
      ],
    },
    {
      name: 'receive_sol',
      docs: ['Receive SOL and increment counter (for non-CEA tests)'],
      discriminator: [121, 244, 250, 3, 8, 229, 225, 1],
      accounts: [
        {
          name: 'counter',
          writable: true,
          pda: {
            seeds: [
              {
                kind: 'const',
                value: [99, 111, 117, 110, 116, 101, 114],
              },
            ],
          },
        },
        {
          name: 'recipient',
          writable: true,
        },
        {
          name: 'cea_authority',
          writable: true,
        },
        {
          name: 'system_program',
          address: '11111111111111111111111111111111',
        },
      ],
      args: [
        {
          name: 'amount',
          type: 'u64',
        },
      ],
    },
    {
      name: 'receive_spl',
      docs: ['Receive SPL tokens and increment counter (for non-CEA tests)'],
      discriminator: [182, 84, 250, 46, 138, 164, 73, 196],
      accounts: [
        {
          name: 'counter',
          writable: true,
          pda: {
            seeds: [
              {
                kind: 'const',
                value: [99, 111, 117, 110, 116, 101, 114],
              },
            ],
          },
        },
        {
          name: 'cea_ata',
          writable: true,
        },
        {
          name: 'recipient_ata',
          writable: true,
        },
        {
          name: 'cea_authority',
          signer: true,
        },
        {
          name: 'token_program',
          address: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
        },
      ],
      args: [
        {
          name: 'amount',
          type: 'u64',
        },
      ],
    },
    {
      name: 'stake_sol',
      docs: [
        'Stake SOL - transfers SOL from authority (CEA) to stake_vault PDA',
        'This tests CEA identity preservation (same authority = same stake PDA)',
        'CEA is signed by gateway via invoke_signed with cea_seeds',
      ],
      discriminator: [200, 38, 157, 155, 245, 57, 236, 168],
      accounts: [
        {
          name: 'counter',
          writable: true,
          pda: {
            seeds: [
              {
                kind: 'const',
                value: [99, 111, 117, 110, 116, 101, 114],
              },
            ],
          },
        },
        {
          name: 'authority',
          writable: true,
          signer: true,
        },
        {
          name: 'stake',
          writable: true,
          pda: {
            seeds: [
              {
                kind: 'const',
                value: [115, 116, 97, 107, 101],
              },
              {
                kind: 'account',
                path: 'authority',
              },
            ],
          },
        },
        {
          name: 'stake_vault',
          docs: [
            'Stake vault PDA - holds staked SOL (SystemAccount, no data)',
            'Initialized manually if needed (SystemAccount with space=0 can\'t use init_if_needed)',
          ],
          writable: true,
          pda: {
            seeds: [
              {
                kind: 'const',
                value: [115, 116, 97, 107, 101, 95, 118, 97, 117, 108, 116],
              },
              {
                kind: 'account',
                path: 'authority',
              },
            ],
          },
        },
        {
          name: 'system_program',
          address: '11111111111111111111111111111111',
        },
      ],
      args: [
        {
          name: 'amount',
          type: 'u64',
        },
      ],
    },
    {
      name: 'stake_spl',
      docs: [
        'Stake SPL tokens - transfers tokens from authority ATA to stake ATA',
        'CEA is signed by gateway via invoke_signed with cea_seeds',
      ],
      discriminator: [185, 201, 132, 39, 66, 146, 241, 232],
      accounts: [
        {
          name: 'counter',
          writable: true,
          pda: {
            seeds: [
              {
                kind: 'const',
                value: [99, 111, 117, 110, 116, 101, 114],
              },
            ],
          },
        },
        {
          name: 'authority',
          writable: true,
          signer: true,
        },
        {
          name: 'stake',
          writable: true,
          pda: {
            seeds: [
              {
                kind: 'const',
                value: [115, 116, 97, 107, 101],
              },
              {
                kind: 'account',
                path: 'authority',
              },
            ],
          },
        },
        {
          name: 'mint',
        },
        {
          name: 'authority_ata',
          writable: true,
        },
        {
          name: 'stake_ata',
          writable: true,
          pda: {
            seeds: [
              {
                kind: 'account',
                path: 'stake',
              },
              {
                kind: 'const',
                value: [
                  6, 221, 246, 225, 215, 101, 161, 147, 217, 203, 225, 70,
                  206, 235, 121, 172, 28, 180, 133, 237, 95, 91, 55, 145, 58,
                  140, 245, 133, 126, 255, 0, 169,
                ],
              },
              {
                kind: 'account',
                path: 'mint',
              },
            ],
            program: {
              kind: 'const',
              value: [
                140, 151, 37, 143, 78, 36, 137, 241, 187, 61, 16, 41, 20,
                142, 13, 131, 11, 90, 19, 153, 218, 255, 16, 132, 4, 142,
                123, 216, 219, 233, 248, 89,
              ],
            },
          },
        },
        {
          name: 'token_program',
          address: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
        },
        {
          name: 'system_program',
          address: '11111111111111111111111111111111',
        },
        {
          name: 'associated_token_program',
          address: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
        },
      ],
      args: [
        {
          name: 'amount',
          type: 'u64',
        },
      ],
    },
    {
      name: 'unstake_sol',
      docs: [
        'Unstake SOL - transfers SOL from stake_vault PDA back to authority (CEA)',
      ],
      discriminator: [70, 150, 140, 208, 166, 13, 252, 150],
      accounts: [
        {
          name: 'counter',
          writable: true,
          pda: {
            seeds: [
              {
                kind: 'const',
                value: [99, 111, 117, 110, 116, 101, 114],
              },
            ],
          },
        },
        {
          name: 'authority',
          writable: true,
          signer: true,
          relations: ['stake'],
        },
        {
          name: 'stake',
          writable: true,
          pda: {
            seeds: [
              {
                kind: 'const',
                value: [115, 116, 97, 107, 101],
              },
              {
                kind: 'account',
                path: 'authority',
              },
            ],
          },
        },
        {
          name: 'stake_vault',
          docs: [
            'Stake vault PDA - holds staked SOL (SystemAccount, no data)',
            'Initialized manually if needed (SystemAccount with space=0 can\'t use init_if_needed)',
          ],
          writable: true,
          pda: {
            seeds: [
              {
                kind: 'const',
                value: [115, 116, 97, 107, 101, 95, 118, 97, 117, 108, 116],
              },
              {
                kind: 'account',
                path: 'authority',
              },
            ],
          },
        },
        {
          name: 'system_program',
          address: '11111111111111111111111111111111',
        },
      ],
      args: [
        {
          name: 'amount',
          type: 'u64',
        },
      ],
    },
    {
      name: 'unstake_spl',
      docs: [
        'Unstake SPL tokens - transfers tokens from stake ATA back to authority ATA',
      ],
      discriminator: [47, 102, 202, 245, 122, 89, 96, 24],
      accounts: [
        {
          name: 'counter',
          writable: true,
          pda: {
            seeds: [
              {
                kind: 'const',
                value: [99, 111, 117, 110, 116, 101, 114],
              },
            ],
          },
        },
        {
          name: 'authority',
          relations: ['stake'],
        },
        {
          name: 'stake',
          writable: true,
          pda: {
            seeds: [
              {
                kind: 'const',
                value: [115, 116, 97, 107, 101],
              },
              {
                kind: 'account',
                path: 'authority',
              },
            ],
          },
        },
        {
          name: 'mint',
        },
        {
          name: 'authority_ata',
          writable: true,
        },
        {
          name: 'stake_ata',
          writable: true,
        },
        {
          name: 'token_program',
          address: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
        },
        {
          name: 'system_program',
          address: '11111111111111111111111111111111',
        },
      ],
      args: [
        {
          name: 'amount',
          type: 'u64',
        },
      ],
    },
  ],
  accounts: [
    {
      name: 'Counter',
      discriminator: [255, 176, 4, 245, 188, 253, 124, 25],
    },
    {
      name: 'Stake',
      discriminator: [150, 197, 176, 29, 55, 132, 112, 149],
    },
  ],
  events: [
    {
      name: 'CounterUpdated',
      discriminator: [56, 210, 136, 13, 88, 67, 151, 167],
    },
  ],
  errors: [
    {
      code: 6000,
      name: 'Overflow',
      msg: 'Counter overflow',
    },
    {
      code: 6001,
      name: 'Underflow',
      msg: 'Counter underflow',
    },
    {
      code: 6002,
      name: 'Unauthorized',
      msg: 'Unauthorized',
    },
    {
      code: 6003,
      name: 'InsufficientStake',
      msg: 'Insufficient stake',
    },
    {
      code: 6004,
      name: 'InvalidDataSize',
      msg: 'Invalid data size',
    },
  ],
  types: [
    {
      name: 'Counter',
      type: {
        kind: 'struct',
        fields: [
          {
            name: 'value',
            type: 'u64',
          },
          {
            name: 'authority',
            type: 'pubkey',
          },
        ],
      },
    },
    {
      name: 'CounterUpdated',
      type: {
        kind: 'struct',
        fields: [
          {
            name: 'counter',
            type: 'pubkey',
          },
          {
            name: 'old_value',
            type: 'u64',
          },
          {
            name: 'new_value',
            type: 'u64',
          },
          {
            name: 'operation',
            type: 'string',
          },
        ],
      },
    },
    {
      name: 'Stake',
      type: {
        kind: 'struct',
        fields: [
          {
            name: 'authority',
            type: 'pubkey',
          },
          {
            name: 'amount',
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
    svmClient = new SvmClient({ rpcUrls: [RPC_URL] });

    const privateKeyHex = process.env['SOLANA_PRIVATE_KEY'];
    if (!privateKeyHex) {
      throw new Error('SOLANA_PRIVATE_KEY environment variable is not set');
    }
    const privateKey = Uint8Array.from(Buffer.from(privateKeyHex, 'hex'));

    // Generate a keypair from the private key in .env
    testAccount = Keypair.fromSecretKey(privateKey);

    // Create the object first with any required properties
    universalSigner = await PushChain.utils.signer.toUniversalFromKeypair(
      testAccount,
      { chain: chain, library: LIBRARY.SOLANA_WEB3JS }
    );
  });

  describe('getBalance', () => {
    it('gets balance', async () => {
      const balance = await svmClient.getBalance(
        universalSigner.account.address
      );
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
      // Read counter PDA account data
      const result = await svmClient.readContract({
        abi: IDL,
        address: PROGRAM_ID,
        functionName: 'counter',
        args: [counterPDA.toBase58()],
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

  describe('writeContract', () => {
    it('writes contract value', async () => {
      const balance = await svmClient.getBalance(
        universalSigner.account.address
      );
      if (balance === BigInt(0)) {
        console.warn('Skipping Test - Account has insufficient balance');
        throw new Error('Not enough balance');
      }

      // Counter is a PDA — initialize may fail if already initialized
      try {
        const txSignature = await svmClient.writeContract({
          abi: IDL,
          address: PROGRAM_ID,
          functionName: 'initialize',
          args: [BigInt(0)],
          signer: universalSigner,
          accounts: {
            counter: counterPDA,
            authority: new PublicKey(universalSigner.account.address),
            systemProgram: SystemProgram.programId,
          },
        });
        console.log('Transaction Signature: ', txSignature);

        // Wait for the transaction to be confirmed
        await svmClient.confirmTransaction(txSignature);
        console.log('Transaction confirmed');

        expect(txSignature).toMatch(/^[A-Za-z0-9]+$/);
      } catch (err) {
        // Counter PDA may already be initialized from a previous run
        console.log(
          'Initialize may have already been called:',
          (err as Error).message
        );
      }
    });

    it('increments counter and verifies value increased', async () => {
      const balance = await svmClient.getBalance(
        universalSigner.account.address
      );
      if (balance === BigInt(0)) {
        console.warn('Skipping Test - Account has insufficient balance');
        throw new Error('Not enough balance');
      }

      // Ensure counter is initialized (may already be from previous test)
      try {
        const initTxSignature = await svmClient.writeContract({
          abi: IDL,
          address: PROGRAM_ID,
          functionName: 'initialize',
          args: [BigInt(0)],
          signer: universalSigner,
          accounts: {
            counter: counterPDA,
            authority: new PublicKey(universalSigner.account.address),
            systemProgram: SystemProgram.programId,
          },
        });
        await svmClient.confirmTransaction(initTxSignature);
        console.log('Initialize transaction confirmed');
      } catch {
        console.log('Counter already initialized, continuing...');
      }

      // 1. Read the current value
      const initialCounter = await svmClient.readContract<{
        value: number;
        authority: PublicKey;
      }>({
        abi: IDL,
        address: PROGRAM_ID,
        functionName: 'counter',
        args: [counterPDA.toBase58()],
      });
      console.log('Initial value:', initialCounter.value);

      // 2. Call increment with amount
      const incrementTxSignature = await svmClient.writeContract({
        abi: IDL,
        address: PROGRAM_ID,
        functionName: 'increment',
        args: [BigInt(1)],
        signer: universalSigner,
        accounts: {
          counter: counterPDA,
          authority: new PublicKey(universalSigner.account.address),
        },
      });

      console.log('Increment Transaction:', incrementTxSignature);

      // Wait for the increment transaction to be confirmed
      await svmClient.confirmTransaction(incrementTxSignature);
      console.log('Increment transaction confirmed');

      // 3. Read the value again and verify it increased
      const updatedCounter = await svmClient.readContract<{
        value: bigint;
        authority: PublicKey;
      }>({
        abi: IDL,
        address: PROGRAM_ID,
        functionName: 'counter',
        args: [counterPDA.toBase58()],
      });

      expect(
        BigInt(updatedCounter.value.toString()) >
          BigInt(initialCounter.value.toString())
      ).toBe(true);
      console.log('Updated value:', updatedCounter.value);
    });

    it('throws error for invalid program address', async () => {
      await expect(
        svmClient.writeContract({
          abi: IDL,
          address: 'invalidAddress',
          functionName: 'initialize',
          args: [BigInt(0)],
          signer: universalSigner,
        })
      ).rejects.toThrow();
    });

    it('throws error for missing signer.signTransaction', async () => {
      const invalidSigner = {
        ...universalSigner,
        signAndSendTransaction: undefined,
      };
      await expect(
        svmClient.writeContract({
          abi: IDL,
          address: PROGRAM_ID,
          functionName: 'initialize',
          args: [BigInt(0)],
          signer: invalidSigner as unknown as UniversalSigner,
        })
      ).rejects.toThrow('signer.signTransaction is undefined');
    });

    it('throws error for invalid account configuration', async () => {
      await expect(
        svmClient.writeContract({
          abi: IDL,
          address: PROGRAM_ID,
          functionName: 'initialize',
          args: [BigInt(0)],
          signer: universalSigner,
          accounts: {
            // Missing required 'authority' account
            counter: counterPDA,
            systemProgram: SystemProgram.programId,
          },
        })
      ).rejects.toThrow();
    });

    it('throws error for unauthorized authority', async () => {
      // Use a different keypair as authority — should fail with Unauthorized
      // since the counter's authority is set to universalSigner
      const randomKeypair = Keypair.generate();
      const randomSigner =
        await PushChain.utils.signer.toUniversalFromKeypair(randomKeypair, {
          chain: chain,
          library: LIBRARY.SOLANA_WEB3JS,
        });

      await expect(
        svmClient.writeContract({
          abi: IDL,
          address: PROGRAM_ID,
          functionName: 'increment',
          args: [BigInt(1)],
          signer: randomSigner,
          accounts: {
            counter: counterPDA,
            authority: randomKeypair.publicKey,
          },
        })
      ).rejects.toThrow();
    });

    it('handles multiple instructions in sequence', async () => {
      const balance = await svmClient.getBalance(
        universalSigner.account.address
      );
      if (balance === BigInt(0)) {
        console.warn('Skipping Test - Account has insufficient balance');
        throw new Error('Not enough balance');
      }

      // Read current value (counter should already be initialized)
      const beforeCounter = await svmClient.readContract<{
        value: bigint;
        authority: PublicKey;
      }>({
        abi: IDL,
        address: PROGRAM_ID,
        functionName: 'counter',
        args: [counterPDA.toBase58()],
      });
      const beforeValue = BigInt(beforeCounter.value.toString());
      console.log('Value before increments:', beforeValue);

      // Increment counter twice
      for (let i = 0; i < 2; i++) {
        const incrementTxSignature = await svmClient.writeContract({
          abi: IDL,
          address: PROGRAM_ID,
          functionName: 'increment',
          args: [BigInt(1)],
          signer: universalSigner,
          accounts: {
            counter: counterPDA,
            authority: new PublicKey(universalSigner.account.address),
          },
        });
        await svmClient.confirmTransaction(incrementTxSignature);
      }

      // Verify final value increased by 2
      const finalCounter = await svmClient.readContract<{
        value: bigint;
        authority: PublicKey;
      }>({
        abi: IDL,
        address: PROGRAM_ID,
        functionName: 'counter',
        args: [counterPDA.toBase58()],
      });

      const finalValue = BigInt(finalCounter.value.toString());
      expect(finalValue).toBe(beforeValue + BigInt(2));
    });
  });

  describe('estimateGas', () => {
    it('estimates fee for a simple transfer', async () => {
      const instruction = SystemProgram.transfer({
        fromPubkey: new PublicKey(universalSigner.account.address),
        toPubkey: new PublicKey(universalSigner.account.address),
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

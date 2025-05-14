import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  BlockheightBasedTransactionConfirmationStrategy,
} from '@solana/web3.js';
import {
  ClientOptions,
  ReadContractParams,
  WriteContractParams,
} from './vm-client.types';
import { AnchorProvider, Program, Wallet } from '@coral-xyz/anchor';
import { UniversalSigner } from '../universal/universal.types';

/**
 * Solana-compatible VM client for reading and writing SVM-based chains.
 */
export class SvmClient {
  private readonly connection: Connection;

  constructor({ rpcUrl }: ClientOptions) {
    this.connection = new Connection(rpcUrl, 'confirmed');
  }

  /**
   * Returns the balance (in lamports) of a Solana address.
   */
  async getBalance(address: string): Promise<bigint> {
    const pubkey = new PublicKey(address);
    const lamports = await this.connection.getBalance(pubkey);
    return BigInt(lamports);
  }

  /**
   * Reads a full program account using Anchor IDL.
   * `functionName` must match the account layout name in the IDL.
   */
  async readContract<T = unknown>({
    abi,
    address,
    functionName,
    args = [],
  }: ReadContractParams): Promise<T> {
    const provider = new AnchorProvider(
      this.connection,
      new Wallet(new Keypair()),
      {
        preflightCommitment: 'confirmed',
      }
    );
    const program = new Program(abi, new PublicKey(address), provider);
    const pubkey = new PublicKey(args[0]);
    const account = await program.account[functionName].fetch(pubkey);
    return account as T;
  }

  /**
   * Sends a Solana transaction using a smart contract instruction.
   * Your `abi`, `functionName`, and `args` need to be compiled into instruction manually.
   */
  async writeContract({
    abi,
    address,
    signer,
    functionName,
    args = [],
  }: WriteContractParams & { solanaKeyPair: Keypair }): Promise<string> {
    const provider = new AnchorProvider(
      this.connection,
      new Wallet(new Keypair()),
      {
        preflightCommitment: 'confirmed',
      }
    );
    const program = new Program(abi, new PublicKey(address), provider);

    let instruction: TransactionInstruction;
    if (args.length > 0) {
      instruction = await program.methods[functionName](...args)
        .accounts({
          newAccount: new Keypair().publicKey,
          signer: new PublicKey(signer.address),
          systemProgram: SystemProgram.programId,
        })
        .instruction();
    } else {
      instruction = await program.methods[functionName]()
        .accounts({
          newAccount: new Keypair().publicKey,
          signer: new PublicKey(signer.address),
          systemProgram: SystemProgram.programId,
        })
        .instruction();
    }

    // (4) Send transaction via UniversalSigner
    return this.sendTransaction({
      instructions: [instruction],
      signer,
    });
  }

  /**
   * Sends a Solana transaction using a UniversalSigner.
   * TODO: Remove deprecated functions
   */
  async sendTransaction({
    instructions,
    signer,
  }: {
    instructions: TransactionInstruction[];
    signer: UniversalSigner;
  }): Promise<string> {
    const feePayer = new PublicKey(signer.address);
    const { blockhash, lastValidBlockHeight } =
      await this.connection.getLatestBlockhash();

    const tx = new Transaction({
      recentBlockhash: blockhash,
      feePayer,
    }).add(...instructions);

    const serialized = tx.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    });
    const signature = await this.connection.sendRawTransaction(serialized);

    const confirmStrategy: BlockheightBasedTransactionConfirmationStrategy = {
      blockhash: blockhash,
      lastValidBlockHeight: lastValidBlockHeight,
      signature: signature,
    };
    const result = await this.connection.confirmTransaction(confirmStrategy);
    return '';

    // const signed = await signer.signMessage(serialized);
    // const txHash = await sendAndConfirmRawTransaction(
    //   this.connection,
    //   Buffer.from(signed),
    //   { commitment: 'confirmed' }
    // );
    // return txHash;
  }

  /**
   * Estimates the fee (in lamports) to send a transaction with the given instructions.
   */
  async estimateGas({
    instructions,
    signer,
  }: {
    instructions: TransactionInstruction[];
    signer: UniversalSigner;
  }): Promise<bigint> {
    const feePayer = new PublicKey(signer.address);
    const { blockhash, lastValidBlockHeight } =
      await this.connection.getLatestBlockhash();
    const tx = new Transaction({ blockhash, lastValidBlockHeight, feePayer });
    if (instructions.length > 0) {
      tx.add(...instructions);
    }
    const message = tx.compileMessage();
    const feeResp = await this.connection.getFeeForMessage(message);
    if (!feeResp || feeResp.value == null) {
      throw new Error('Failed to estimate fee');
    }
    return BigInt(feeResp.value);
  }
}

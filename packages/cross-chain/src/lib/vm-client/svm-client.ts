import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmRawTransaction,
} from '@solana/web3.js';
import {
  ClientOptions,
  ReadContractParams,
  WriteContractParams,
} from './vm-client.types';
import { BN, Idl, Program } from '@coral-xyz/anchor';
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
  }: ReadContractParams): Promise<T> {
    const idl = abi as Idl;

    const program = new Program(idl, {
      connection: this.connection,
    });

    const pubkey = new PublicKey(address);

    // @ts-expect-error anchor doesn't have dynamic key typings for account layout access
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
  }: WriteContractParams): Promise<string> {
    const idl = abi as Idl;
    const programId = new PublicKey(idl.address);

    const program = new Program(idl, {
      connection: this.connection,
    });

    // (1) Derive PDA for newAccount (replace seeds with your actual derivation logic)
    const [newAccountPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('user'), new PublicKey(signer.address).toBuffer()],
      programId
    );

    // (2) Hardcoded input value (like u64: 42)
    const data = new BN(42);

    // (3) Build instruction
    const instruction = await program.methods['initialize'](data)
      .accounts({
        newAccount: newAccountPda,
        signer: new PublicKey(signer.address),
        systemProgram: SystemProgram.programId,
      })
      .instruction();

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
    const { blockhash } = await this.connection.getLatestBlockhash();

    const tx = new Transaction({
      recentBlockhash: blockhash,
      feePayer,
    }).add(...instructions);

    const serialized = tx.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    });

    const signed = await signer.signMessage(serialized);

    return sendAndConfirmRawTransaction(this.connection, Buffer.from(signed));
  }
}

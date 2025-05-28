import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import {
  ClientOptions,
  ReadContractParams,
  WriteContractParams,
} from './vm-client.types';
import { AnchorProvider, Program, Wallet, BN } from '@coral-xyz/anchor';
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
    functionName,
    args = [],
  }: ReadContractParams): Promise<T> {
    const provider = new AnchorProvider(
      this.connection,
      new Wallet(new Keypair()),
      { preflightCommitment: 'confirmed' }
    );

    // Anchor v0.31 constructor no longer takes programId
    // Use the IDL's embedded metadata.address instead
    const program = new Program<typeof abi>(abi, provider);

    const pubkey = new PublicKey(args[0]);
    // Cast account namespace to any to allow dynamic string
    const accountNamespace = program.account as any;
    const account = await accountNamespace[functionName].fetch(pubkey);
    return account as T;
  }

  /**
   * Sends a Solana transaction using a smart contract instruction.
   */
  async writeContract({
    abi,
    signer,
    functionName,
    args = [],
    accounts = {},
    extraSigners = [],
  }: WriteContractParams): Promise<string> {
    const provider = new AnchorProvider(
      this.connection,
      new Wallet(new Keypair()),
      { preflightCommitment: 'confirmed' }
    );

    // NEW: Drop explicit programId. Anchor v0.31 infers it from IDL.metadata.address
    const program = new Program<typeof abi>(abi, provider);

    // Convert BigInt arguments to BN instances for Anchor compatibility. Anchor program expects BN for BigInts
    const convertedArgs = args.map((arg) => {
      if (typeof arg === 'bigint') {
        return new BN(arg.toString());
      }
      return arg;
    });

    // Build the method context
    const methodContext =
      convertedArgs.length > 0
        ? program.methods[functionName](...convertedArgs)
        : program.methods[functionName]();

    let instructionBuilder = methodContext as any;

    if (Object.keys(accounts).length > 0) {
      instructionBuilder = instructionBuilder.accounts(accounts);
    }

    const instruction = await instructionBuilder.instruction();

    return this.sendTransaction({
      instruction,
      signer,
      extraSigners,
    });
  }

  /**
   * Sends a set of instructions as a manually-signed Solana transaction.
   */
  async sendTransaction({
    instruction,
    signer,
    extraSigners = [],
  }: {
    instruction: TransactionInstruction;
    signer: UniversalSigner;
    extraSigners?: Keypair[];
  }): Promise<string> {
    const feePayerPubkey = new PublicKey(signer.address);
    const { blockhash, lastValidBlockHeight } =
      await this.connection.getLatestBlockhash('finalized');

    const tx = new Transaction({
      feePayer: feePayerPubkey,
      blockhash,
      lastValidBlockHeight,
    }).add(instruction);

    // Sign with all provided keypairs
    if (extraSigners.length > 0) {
      tx.partialSign(...extraSigners);
    }

    const messageBytes = tx.serializeMessage();
    const signature = await signer.signTransaction(messageBytes);
    tx.addSignature(feePayerPubkey, Buffer.from(signature));

    const rawTx = tx.serialize();
    return await this.connection.sendRawTransaction(rawTx);
  }

  /**
   * Waits for a transaction to be confirmed on the blockchain.
   */
  async confirmTransaction(signature: string, timeout = 30000): Promise<void> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      const status = await this.connection.getSignatureStatus(signature);
      if (status?.value) {
        if (status.value.err) {
          throw new Error(
            `Transaction failed: ${JSON.stringify(status.value.err)}`
          );
        }
        if (
          status.value.confirmationStatus === 'confirmed' ||
          status.value.confirmationStatus === 'finalized'
        ) {
          return;
        }
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`Transaction confirmation timeout after ${timeout}ms`);
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
    if (instructions.length) tx.add(...instructions);
    const message = tx.compileMessage();
    const feeResp = await this.connection.getFeeForMessage(message);
    if (!feeResp?.value) throw new Error('Failed to estimate fee');
    return BigInt(feeResp.value);
  }
}

import { UniversalSigner } from '../universal/universal.types';
import { Abi, Transaction, TransactionReceipt } from 'viem';
import { Keypair, PublicKey } from '@solana/web3.js';

/**
 * Common options used by all VM clients (EVM, SVM, etc.)
 */
export interface ClientOptions {
  rpcUrls: string[];
}

/**
 * Parameters for reading from a smart contract (read-only call).
 */
export interface ReadContractParams {
  /**
   * EVM contract address
   * SVM program id
   */
  address: string;
  /**
   * EVM abi
   * SVM idl
   */
  abi: Abi | any;
  /**
   * EVM contract fn name
   * SVM PDA var name
   */
  functionName: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  /**
   * EVM fn vars
   * SVM - undefined
   */
  args?: any[];
}

/**
 * Parameters for writing to a smart contract (requires signature).
 */
export interface WriteContractParams extends ReadContractParams {
  value?: bigint; // value in ether
  signer: UniversalSigner;
  /**
   * **For Solana only** Dynamic accounts to pass to the solana program instruction
   */
  accounts?: Record<string, PublicKey>;
  /**
   * **For Solana only** Keypairs that should sign the transaction
   */
  extraSigners?: Keypair[];
}

/**
 * Signature class modeled after ethers.js v6 Signature interface
 */
export class Signature {
  readonly r: string;
  readonly s: string;
  readonly v: number;
  readonly yParity: number;

  constructor(signature: {
    r: string;
    s: string;
    v: number;
    yParity?: number;
  }) {
    this.r = signature.r;
    this.s = signature.s;
    this.v = signature.v;
    this.yParity = signature.yParity ?? (signature.v === 27 ? 0 : 1);
  }

  /**
   * Create a Signature from a raw signature string (65 bytes / 130 hex chars)
   */
  static from(signature: string): Signature {
    if (!signature.startsWith('0x') || signature.length !== 132) {
      throw new Error('Invalid signature format');
    }

    const r = signature.slice(0, 66); // 0x + 32 bytes
    const s = '0x' + signature.slice(66, 130); // 32 bytes
    const v = parseInt(signature.slice(130, 132), 16); // 1 byte

    return new Signature({ r, s, v });
  }
}

export type TxResponse = Transaction & {
  wait: (confirmations?: number) => Promise<TransactionReceipt>;
};

/**
 * New Universal Transaction Receipt interface with prioritized field ordering
 */
export interface UniversalTxResponse {
  // 1. Identity
  hash: string; // tx hash
  origin: string; // origin, e.g. "eip155:1:0xabc"

  // 2. Block Info
  blockNumber: bigint; // 803963n
  blockHash: string; // block hash
  transactionIndex: number; // index in block
  chainId: number; // 42101

  // 3. Execution Context
  from: string; // UEA (executor) address
  to: string; // the "to" the UEA executed
  nonce: number; // derived (UEA) nonce

  // 4. Payload
  data: string; // perceived calldata (was input)
  value: bigint; // perceived value

  // 5. Gas
  gasLimit: bigint; // 21000n (was gas)
  gasPrice?: bigint; // for legacy txs
  maxFeePerGas?: bigint; // for EIP-1559
  maxPriorityFeePerGas?: bigint;
  accessList: any[]; // AccessList type

  // 6. Utilities
  wait: () => Promise<UniversalTxReceipt>;

  // 7. Metadata
  type: string; // "99" (was typeHex), now string
  typeVerbose: string; // "universal" (was type), human readable
  signature: Signature; // ethers Signature instance

  // 8. Raw Universal Fields (if you ever need them)
  raw?: {
    from: string; // what went on chain
    to: string; // what went on chain
    nonce: number; // the actual raw nonce
    data: string; // the actual raw data (was input)
    value: bigint; // the actual derived value
  };
}

/**
 * New Universal Transaction Receipt interface for transaction receipts
 */
export interface UniversalTxReceipt {
  // 1. Identity
  hash: string; // changed from transactionHash

  // 2. Block Info
  blockNumber: bigint;
  blockHash: string;
  transactionIndex: number;

  // 3. Execution Context
  from: string; // should be the executor account of push chain
  to: string; // should be the actual intended address of the tx
  contractAddress: string | null;

  // 4. Gas & Usage
  gasPrice: bigint; // gasPrice should be gasPrice
  gasUsed: bigint; // was cumulativeGasUsed
  cumulativeGasUsed: bigint; // was gasUsed

  // 5. Logs
  logs: any[]; // Log[] type
  logsBloom: string;

  // 6. Outcome
  status: 0 | 1; // 1 is success, 0 is failure - modeled after ethers

  // 7. Raw
  raw: {
    from: string; // what happened on chain
    to: string; // what happened on chain
  };
}

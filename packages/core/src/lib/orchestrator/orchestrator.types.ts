export type ExecuteParams = {
  /**
   * The target contract or account on Push Chain.
   */
  to: `0x${string}`;

  /**
   * Amount of native token (in wei) to send alongside the call.
   */
  value?: bigint;

  /**
   * Hex-encoded calldata or transfer payload.
   * @reason Encodes the function selector + arguments (or plain transfer).
   */
  data?: `0x${string}`;

  /**
   * Optional hard cap on gas to use for this transaction.
   * @reason Prevents runaway gas consumption and lets users enforce limits.
   */
  gasLimit?: bigint;

  /**
   * Optional override for the EIP-1559 max fee per gas (in wei).
   * @reason Gives callers direct control over total gas price to speed up or save cost.
   */
  maxFeePerGas?: bigint;

  /**
   * Optional override for the EIP-1559 max priority fee per gas (in wei).
   * TODO: This will be removed
   * @reason Allows customizing the miner tip separately from the base fee.
   */
  maxPriorityFeePerGas?: bigint;

  /**
   * Optional to bypass fee locking in case funds are already locked by user
   */
  feeLockTxHash?: string;

  /**
   * Optional explicit nonce for the transaction.
   * @reason Ensures correct ordering and avoids “replacement underpriced” when sending in parallel.
   */
  nonce?: bigint;

  /**
   * Optional for signature expiry
   */
  deadline?: bigint;

  /**
   * For funding gas fees. If undefined (default), gas fees will be paid in the native token.
   * If specified, the user can select which token to pay gas fees from.
   */
  fundGas?: { chainToken: `0x${string}` };
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
  chainId: string; // 42101 or solana

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

/**
 * Signature interface modeled after ethers.js v6 Signature interface
 */
export interface Signature {
  r: string;
  s: string;
  v: number;
  yParity?: number;
}

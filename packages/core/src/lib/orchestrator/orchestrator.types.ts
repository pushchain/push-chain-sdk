export type ExecuteParams = {
  /**
   * The target contract or account on Push Chain.
   */
  target: `0x${string}`;

  /**
   * Amount of native token (in wei) to send alongside the call.
   */
  value: bigint;

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
};

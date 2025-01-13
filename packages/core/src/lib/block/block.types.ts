import { TxResponse, CompleteTxResponse } from '../tx/tx.types';

/**
 * Represents the response containing multiple complete blocks and pagination metadata.
 */
export type CompleteBlockResponse = {
  /**
   * An array of blocks, each with basic transaction information and metadata.
   */
  blocks: CompleteBlockType[];

  /**
   * The timestamp of the last block in the response, used for pagination.
   * @example 1736778739716
   */
  lastTimestamp: number;

  /**
   * The total number of pages available for querying blocks.
   * @example 5
   */
  totalPages: number;
};

/**
 * Represents a **complete** block type with detailed information about its transactions and metadata.
 */
export type CompleteBlockType = {
  /**
   * The unique hash of the block.
   * @example "6065d38d353b6d70a2632c4ec17565b87920b154a4d9a2bbc8923a2c28989ee9"
   */
  blockHash: string;

  /**
   * The timestamp of when the block was created, expressed in seconds since the Unix epoch.
   * @example 1736779814502
   */
  timestamp: number;

  /**
   * An array of transactions included in the block, with basic transaction details.
   */
  transactions: CompleteTxResponse[];

  /**
   * The total number of transactions in the block, providing a quick summary of its contents.
   * @example 15
   */
  totalNumberOfTxns: number;
};

/**
 * Represents the response containing multiple blocks and pagination metadata.
 */
export type BlockResponse = {
  /**
   * An array of blocks, each with basic transaction information and metadata.
   */
  blocks: BlockType[];

  /**
   * The timestamp of the last block in the response, used for pagination.
   * @example 1736778739716
   */
  lastTimestamp: number;

  /**
   * The total number of pages available for querying blocks.
   * @example 5
   */
  totalPages: number;
};

/**
 * Represents a block with **basic** transaction details and metadata.
 */
export type BlockType = {
  /**
   * The unique hash of the block.
   * @example "6065d38d353b6d70a2632c4ec17565b87920b154a4d9a2bbc8923a2c28989ee9"
   */
  blockHash: string;

  /**
   * The timestamp of when the block was created, expressed in seconds since the Unix epoch.
   * @example 1736779814502
   */
  timestamp: number;

  /**
   * An array of transactions included in the block, with basic transaction details.
   */
  transactions: TxResponse[];

  /**
   * The total number of transactions in the block, providing a quick summary of its contents.
   * @example 15
   */
  totalNumberOfTxns: number;
};

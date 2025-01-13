// TxCategory supported for Serialization / Deserialization by core
export enum TxCategory {
  INIT_DID = 'INIT_DID',
  INIT_SESSION_KEY = 'INIT_SESSION_KEY',
}

export type CompleteTxResponse = {
  /**
   * The unique hash of the transaction.
   * @example "565d529a6d2e969f4b19e7438b69a0c72a14b7cc60f1d164fc8f9981c55b285d"
   */
  hash: string;

  /**
   * Transaction Fee.
   * @example "0"
   */
  fee: string;

  salt: string;

  apiToken: string;

  /**
   * The timestamp of when the transaction was created, expressed in seconds since the Unix epoch.
   * @example 1736779814502
   */
  timestamp: number;

  /**
   * The category of the transaction, representing its type or purpose.
   * Categories help identify specific transaction types, such as emails, blogs, notifications, etc.
   * @example "CUSTOM:SAMPLE_TX"
   */
  category: string;

  /**
   * The sender's address, representing the originator of the transaction.
   * @example "push:devnet:pushconsumer1v5uvnuazddpdnvuflcrxysngx05cyg60mllvu7"
   */
  from: string;

  /**
   * An array of recipient addresses for the transaction.
   * Transactions on Push Chain can have multiple recipients across chains.
   * @example ["0xA1234C39BBFd4033c0d3289C4515275102423681", "0xB5678C39BBFd4033c0d3289C4515275102423681"]
   */
  recipients: string[];

  /**
   * The encoded payload data of the transaction, containing its core message or information.
   * This field can hold diverse types of data, such as notifications or other consumer-centric payloads.
   * @example "Hello World"
   */
  data: string;

  /**
   * The digital signature of the sender, ensuring the authenticity and integrity of the transaction.
   * @example "UveExa2/e2fsNnjW/OW7oXwnaqOUIklewgTkg+a5B6HojOBjcuOdP2UJ9IOJIamEisgQDHQMp2Uso2Av8ZZNCQ=="
   */
  signature: string;
};

/**
 * Represents a transaction within a block on the Push Chain network.
 */
export type TxResponse = {
  /**
   * The unique hash of the transaction.
   * @example "565d529a6d2e969f4b19e7438b69a0c72a14b7cc60f1d164fc8f9981c55b285d"
   */
  hash: string;

  /**
   * Transaction Fee.
   * @example "0"
   */
  fee: string;

  /**
   * The timestamp of when the transaction was created, expressed in seconds since the Unix epoch.
   * @example 1736779814502
   */
  timestamp: number;

  /**
   * The category of the transaction, representing its type or purpose.
   * Categories help identify specific transaction types, such as emails, blogs, notifications, etc.
   * @example "CUSTOM:SAMPLE_TX"
   */
  category: string;

  /**
   * The sender's address, representing the originator of the transaction.
   * @example "push:devnet:pushconsumer1v5uvnuazddpdnvuflcrxysngx05cyg60mllvu7"
   */
  from: string;

  /**
   * An array of recipient addresses for the transaction.
   * Transactions on Push Chain can have multiple recipients across chains.
   * @example ["0xA1234C39BBFd4033c0d3289C4515275102423681", "0xB5678C39BBFd4033c0d3289C4515275102423681"]
   */
  recipients: string[];

  /**
   * The encoded payload data of the transaction, containing its core message or information.
   * This field can hold diverse types of data, such as notifications or other consumer-centric payloads.
   * @example "Hello World"
   */
  data: string;

  /**
   * The digital signature of the sender, ensuring the authenticity and integrity of the transaction.
   * @example "UveExa2/e2fsNnjW/OW7oXwnaqOUIklewgTkg+a5B6HojOBjcuOdP2UJ9IOJIamEisgQDHQMp2Uso2Av8ZZNCQ=="
   */
  signature: string;
};

export class ReplyGrouped {
  items: TxInfo[] = [];
  summary: ResultMeta = new ResultMeta();
}

export class ResultMeta {
  quorumResult!: QuorumResult;
  itemCount!: number;
  lastTs!: string;
  keysWithoutQuorumCount!: number;
  keysWithoutQuorum!: string[];
}

export enum QuorumResult {
  QUORUM_OK = 'QUORUM_OK',
  QUORUM_OK_PARTIAL = 'QUORUM_OK_PARTIAL',
  QUORUM_FAILED_NODE_REPLIES = 'QUORUM_FAILED_NODE_REPLIES',
  QUORUM_FAILED_BY_MIN_ITEMS = 'QUORUM_FAILED_BY_MIN_ITEMS',
}

export type TxInfo = {
  type: number;
  category: string;
  sender: string;
  recipientsList: string[];
  data: string;
  ts: string;
  salt: string;
};

import { v4 as uuidv4, parse } from 'uuid';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import { TxCategory } from './tx.types';
import { Transaction } from '../generated/tx';
import { InitDid } from '../generated/txData/init_did';
import { InitSessionKey } from '../generated/txData/init_session_key';
import { ENV } from '../constants';
import { Validator } from '../validator/validator';
import { TokenReply } from '../validator/validator.types';
import { BlockResponse } from '../block/block.types';
import { sha256 } from '@noble/hashes/sha256';
import { toHex } from 'viem';
export class Tx {
  private constructor(private validator: Validator, private env: ENV) {}

  static initialize = async (env: ENV) => {
    const validator = await Validator.initalize({ env });
    return new Tx(validator, env);
  };

  static serialize = (tx: Transaction): Uint8Array => {
    const transaction = Transaction.create(tx);
    return Transaction.encode(transaction).finish();
  };

  static deserialize = (tx: Uint8Array): Transaction => {
    return Transaction.decode(tx);
  };

  static serializeData = (
    txData: InitDid | InitSessionKey,
    category: TxCategory
  ): Uint8Array => {
    switch (category) {
      case TxCategory.INIT_DID: {
        const data = txData as InitDid;
        const initTxData = InitDid.create(data);
        return InitDid.encode(initTxData).finish();
      }
      case TxCategory.INIT_SESSION_KEY: {
        const data = txData as InitSessionKey;
        const initTxData = InitSessionKey.create(data);
        return InitSessionKey.encode(initTxData).finish();
      }
      default: {
        throw new Error('Serialization Not Supported for given TxCateory');
      }
    }
  };

  static deserializeData = (
    txData: Uint8Array,
    category: TxCategory
  ): InitDid | InitSessionKey => {
    switch (category) {
      case TxCategory.INIT_DID: {
        return InitDid.decode(txData);
      }
      case TxCategory.INIT_SESSION_KEY: {
        return InitSessionKey.decode(txData);
      }
      default: {
        throw new Error('Deserialization Not Supported for given TxCateory');
      }
    }
  };

  /**
   * Create an Unsigned Tx
   * @dev Unsigned Tx has empty sender & signature
   * @param category Tx category
   * @param recipients Tx recipients
   * @param data Tx payload data in serialized form
   * @returns Unsigned Tx
   */
  createUnsigned = (
    category: string,
    recipients: string[],
    data: Uint8Array
  ): Transaction => {
    return Transaction.create({
      type: 0, // Phase 0 only has non-value transfers
      category,
      recipients,
      data,
      salt: parse(uuidv4()),
      fee: '0', // Fee is 0 as of now
    });
  };

  /**
   * Get Transactions
   */
  get = async (
    startTime: number = Math.floor(Date.now()), // Current Local Time
    direction: 'ASC' | 'DESC' = 'DESC',
    pageSize = 30,
    page = 1,
    // caip10 address
    userAddress?: string,
    category?: string
  ) => {
    return userAddress === undefined
      ? await this.validator.call<BlockResponse>('push_getTransactions', [
          startTime,
          direction,
          pageSize,
          page,
          category,
        ])
      : await this.validator.call<BlockResponse>('push_getTransactionsByUser', [
          userAddress,
          startTime,
          direction,
          pageSize,
          page,
          category,
        ]);
  };

  /**
   * Get Transactions by Sender
   */
  getBySender = async (
    // caip10 address
    senderAddress: string,
    startTime: number = Math.floor(Date.now() / 1000), // Current Local Time
    direction: 'ASC' | 'DESC' = 'ASC',
    pageSize = 30,
    page = 1,
    category?: string
  ) => {
    return await this.validator.call<BlockResponse>(
      'push_getTransactionsBySender',
      [senderAddress, startTime, direction, pageSize, page, category]
    );
  };

  /**
   * Get Transactions by Recipient
   */
  getByRecipient = async (
    // caip10 address
    recipientAddress: string,
    startTime: number = Math.floor(Date.now() / 1000), // Current Local Time
    direction: 'ASC' | 'DESC' = 'ASC',
    pageSize = 30,
    page = 1,
    category?: string
  ) => {
    return await this.validator.call<BlockResponse>(
      'push_getTransactionsByRecipient',
      [recipientAddress, startTime, direction, pageSize, page, category]
    );
  };

  /**
   * Search Transaction with a given hash
   * @param txHash
   */
  search = async (txHash: string) => {
    return await this.validator.call<BlockResponse>(
      'push_getTransactionByHash',
      [txHash]
    );
  };

  /**
   * Send Tx to Push Network
   * @param tx Unsigned Push Tx
   * @param signer Signer obj to sign the Tx
   * @returns Tx Hash
   */
  send = async (
    unsignedTx: Transaction,
    signer: {
      account: string;
      signMessage: (dataToBeSigned: Uint8Array) => Promise<Uint8Array>;
    }
  ): Promise<string> => {
    const token = await this.validator.call<TokenReply>('push_getApiToken');
    const serializedUnsignedTx = Tx.serialize({
      ...unsignedTx,
      sender: signer.account,
      signature: new Uint8Array(0),
      apiToken: utf8ToBytes(token.apiToken),
    });

    // Convert 32 byte data to 64 byte data ( UTF-8 encoded )
    const dataToBeSigned = new TextEncoder().encode(
      toHex(sha256(serializedUnsignedTx))
    );
    const signature = await signer.signMessage(dataToBeSigned);
    const serializedSignedTx = Tx.serialize({
      ...Tx.deserialize(serializedUnsignedTx),
      signature,
    });
    return await this.validator.call<string>(
      'push_sendTransaction',
      [bytesToHex(serializedSignedTx)],
      token.apiUrl
    );
  };
}

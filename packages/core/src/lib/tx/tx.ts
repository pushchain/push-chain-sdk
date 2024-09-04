import { v4 as uuidv4, parse } from 'uuid';
import { utf8ToBytes } from '@noble/hashes/utils';
import { TxCategory, TxWithBlockHash } from './tx.types';
import { Transaction } from '../generated/tx';
import { InitDid } from '../generated/txData/init_did';
import { InitSessionKey } from '../generated/txData/init_session_key';
import { ENV } from '../constants';
import { Validator } from '../validator/validator';
import { TokenReply } from '../validator/validator.types';
import { bytesToString } from 'viem';

export class Tx {
  private constructor(private validator: Validator) {}

  static initialize = async (env: ENV) => {
    const validator = await Validator.initalize({ env });
    return new Tx(validator);
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
  createUnsigned = async (
    category: string,
    recipients: string[],
    data: Uint8Array
  ): Promise<Transaction> => {
    // TODO: Finalize token encoding
    const token = await this.validator.call<TokenReply>('push_getApiToken');
    return Transaction.create({
      type: 0, // Phase 0 only has non-value transfers
      category,
      recipients,
      data,
      salt: parse(uuidv4()),
      apiToken: utf8ToBytes(JSON.stringify(token)),
      fee: '0', // Fee is 0 as of now
    });
  };

  /**
   * Get Transactions
   */
  get = async (
    startTime: number = Math.floor(Date.now() / 1000), // Current Local Time
    direction: 'ASC' | 'DESC' = 'ASC',
    pageSize = 30,
    page = 1,
    category?: string
  ) => {
    return await this.validator.call<TxWithBlockHash[]>(
      'push_getTransactions',
      [startTime, direction, pageSize, page, category]
    );
  };

  /**
   * Search Transaction with a given hash
   * @param txHash
   */
  search = async (txHash: string) => {
    return await this.validator.call<TxWithBlockHash>(
      'push_getTransactionByHash',
      [txHash]
    );
  };

  /**
   * Send Tx to Push Network
   * @param tx Unsigned Push Tx
   * @dev In case sessionPrivKey is not passed, fn tries to connect with Push Wallet for signature requests
   * @returns Tx Hash
   */
  send = async (
    unsignedTx: Transaction,
    session?: {
      sender: string;
      privKey: string;
    }
  ): Promise<string> => {
    let signedTx: Transaction;
    const validatorUrl: string = (
      JSON.parse(bytesToString(unsignedTx.apiToken)) as TokenReply
    ).validatorUrl;
    if (session) {
      // TODO: sign the tx with sessionPrivKey
      const tx = Transaction.create({
        ...unsignedTx,
        sender: session.sender,
      });
      signedTx = unsignedTx;
    } else {
      // TODO: connect with push Wallet and sign the tx
      signedTx = unsignedTx;
    }
    return await this.validator.call<string>(
      'push_sendTransaction',
      [Tx.serialize(signedTx)],
      validatorUrl
    );
  };
}

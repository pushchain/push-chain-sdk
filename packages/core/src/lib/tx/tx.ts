import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import { parse, v4 as uuidv4 } from 'uuid';
import { toHex } from 'viem';
import { BlockResponse, CompleteBlockResponse } from '../block/block.types';
import { ValidatorCompleteBlockResponse } from '../block/validatorBlock.types';
import { Order, ENV } from '../constants';
import { Transaction } from '../generated/tx';
import { PushChain } from '../pushChain';
import { UniversalAccount, UniversalSigner } from '../signer/signer.types';
import { toSDKResponse, toSimplifiedBlockResponse } from '../utils';
import { Validator } from '../validator/validator';
import { TokenReply } from '../validator/validator.types';
import { ReplyGrouped, TxCategory } from './tx.types';

/**
 * Tx is a class that provides methods to interact with the Push Network.
 *
 * **Note: ** It is not recommended to use this class directly.
 * Users should use the Tx class under `PushChain.tx` instead.
 */
export class Tx {
  private tokenCache: TokenCache;

  private constructor(
    private validator: Validator,
    private signer: UniversalSigner | null
  ) {
    this.tokenCache = new TokenCache(validator);
    // get a token async
    void this.tokenCache.getCachedApiToken();
  }

  /**
   * Initializes the Tx class.
   *
   * **Note: ** It is not recommended to use this class directly.
   * Users should use the Tx class under `PushChain.tx` instead.
   *
   *  The `PushChain` can be initialized with or without a signer:
   * - **Without a signer**: This is suitable for read-only operations, such as fetching transactions.
   * - **With a signer**: Required for write operations, such as sending transactions, as it allows the transactions to be signed.
   * @param env - The environment configuration.
   * @param universalSigner - Optional signer for transactions. Only required for sending transactions.
   * @returns An instance of the Tx class.
   *
   * @example
   * // Initialize for read-only operations
   * const pushChain = await PushChain.initialize(env);
   *
   * // Initialize for write operations with a signer
   * const pushChainWithSigner = await PushChain.initialize(env, signer);
   */
  static initialize = async (
    env: ENV,
    universalSigner: UniversalSigner | null = null
  ) => {
    const validator = await Validator.initalize({ env });
    return new Tx(validator, universalSigner);
  };

  /**
   * Get transactions from the Push Chain.
   *
   * - If `reference = '*'`, fetches all transactions.
   * - If `reference` is a string (tx hash), fetch that specific transaction.
   * - Otherwise, `reference` is treated as a UniversalAccount.
   *   In that case, `filterMode` determines the type of query:
   *   - 'both': fetches all transactions from and to the given address
   *   - 'sender': fetches all transactions sent by the given address
   *   - 'recipient': fetches all transactions received by the given address
   *
   * @param {UniversalAccount | string | '*'} [reference='*'] - The reference for the query.
   * Can be `'*'` (all), a transaction hash, or a UniversalAccount.
   * @param {Object} [options] - Optional parameters to refine the query.
   * @param {boolean} [options.raw=false] - If true, returns the raw SDK response.
   * @param {string} [options.category] - The category of transactions to filter by.
   * @param {number} [options.startTime=Math.floor(Date.now())] - The start time for fetching transactions.
   * @param {Order} [options.order=Order.DESC] - The order in which to fetch transactions (ascending or descending).
   * @param {number} [options.page=1] - The page number for pagination.
   * @param {number} [options.limit=30] - The number of transactions to fetch per page.
   * @param {'both' | 'sender' | 'recipient'} [options.filterMode='both'] - The mode to filter transactions by:
   *   - 'both': fetches all transactions from and to the given address
   *   - 'sender': fetches all transactions sent by the given address
   *   - 'recipient': fetches all transactions received by the given address
   * @returns {Promise<BlockResponse | CompleteBlockResponse>} A promise that resolves to the transaction data.
   *
   * @example
   * // Fetch all transactions using PushChain.tx
   * const allTransactions = await pushChain.tx.get();
   *
   * // Fetch a specific transaction by hash using PushChain.tx
   * const specificTransaction = await pushChain.tx.get('0x123abc...');
   *
   * // Fetch transactions for a specific account, filtering by sender using PushChain.tx
   * const accountTransactions = await pushChain.tx.get(universalAccount, {
   *   filterMode: 'sender',
   *   order: Order.ASC,
   *   limit: 10,
   * });
   */
  get = async (
    reference: UniversalAccount | string | '*' = '*',
    {
      raw = false,
      category = undefined,
      startTime = Math.floor(Date.now()),
      order = Order.DESC,
      page = 1,
      limit = 30,
      filterMode = 'both' as 'both' | 'sender' | 'recipient',
    }: {
      raw?: boolean;
      category?: string;
      startTime?: number;
      order?: Order;
      page?: number;
      limit?: number;
      filterMode?: 'both' | 'sender' | 'recipient';
    } = {}
  ): Promise<BlockResponse | CompleteBlockResponse> => {
    let response: ValidatorCompleteBlockResponse;

    if (typeof reference === 'string' && reference !== '*') {
      response = await this.validator.call<ValidatorCompleteBlockResponse>(
        'push_getTransactionByHash',
        [reference]
      );
    } else if (typeof reference === 'string' && reference === '*') {
      response = await this.validator.call<ValidatorCompleteBlockResponse>(
        'push_getTransactions',
        [startTime, order, limit, page, category]
      );
    } else {
      const userAddress = PushChain.utils.account.toChainAgnostic(reference);
      response = await this.fetchByFilterMode(userAddress, {
        category,
        startTime,
        order,
        limit,
        page,
        filterMode,
      });
    }

    const sdkResponse = toSDKResponse(response);
    if (raw) return sdkResponse;
    else return toSimplifiedBlockResponse(sdkResponse);
  };

  /**
   * Helper function to call the appropriate RPC method based on filterMode.
   */
  private async fetchByFilterMode(
    userAddress: string,
    {
      category,
      startTime,
      order,
      limit,
      page,
      filterMode,
    }: {
      category?: string;
      startTime: number;
      order: Order;
      limit: number;
      page: number;
      filterMode: 'both' | 'sender' | 'recipient';
    }
  ): Promise<ValidatorCompleteBlockResponse> {
    if (filterMode === 'sender') {
      return await this.validator.call<ValidatorCompleteBlockResponse>(
        'push_getTransactionsBySender',
        [userAddress, startTime, order, limit, page, category]
      );
    } else if (filterMode === 'recipient') {
      return await this.validator.call<ValidatorCompleteBlockResponse>(
        'push_getTransactionsByRecipient',
        [userAddress, startTime, order, limit, page, category]
      );
    } else {
      // Default: both (transactions to and from address)
      return await this.validator.call<ValidatorCompleteBlockResponse>(
        'push_getTransactionsByUser',
        [userAddress, startTime, order, limit, page, category]
      );
    }
  }

  /**
   * Get Transactions
   */
  private async getFromVNode(
    accountInCaip: string,
    category: string,
    ts: string = '' + Math.floor(Date.now() / 1000),
    direction: 'ASC' | 'DESC' = 'DESC'
  ) {
    return await this.validator.callVNode<ReplyGrouped>(
      'push_getTransactions',
      [accountInCaip, category, ts, direction]
    );
  }

  /**
   * Sends a transaction to the Push Network.
   *
   * This method allows you to send a transaction to specified recipients with a given category and data.
   * The transaction is signed using the provided signer.
   *
   * @param recipients An array of UniversalAccount objects representing the recipients of the transaction.
   * @param options An object containing the transaction options:
   *   - `category`: A string representing the category of the transaction.
   *   - `data`: A string containing the data to be sent with the transaction.
   * @returns A promise that resolves to an object containing the transaction hash.
   *
   * @example
   * // Initialize PushChain with a signer
   * const signer: UniversalSigner = {
   *   chain: CONSTANTS.CHAIN.ETHEREUM,
   *   chainId: CONSTANTS.CHAIN_ID.ETHEREUM.SEPOLIA,
   *   address: '0xYourAddress',
   *   signMessage: async (data: Uint8Array) => {
   *     // Implement your signing logic here
   *     return yourSigningFunction(data);
   *   },
   * };
   * const pushChain = await PushChain.initialize(signer);
   *
   * // Define recipients
   * const recipients: UniversalAccount[] = [
   *   {
   *     chain: CONSTANTS.CHAIN.ETHEREUM,
   *     chainId: CONSTANTS.CHAIN_ID.ETHEREUM.SEPOLIA,
   *     address: '0xRecipientAddress1',
   *   },
   *   {
   *     chain: CONSTANTS.CHAIN.ETHEREUM,
   *     chainId: CONSTANTS.CHAIN_ID.ETHEREUM.SEPOLIA,
   *     address: '0xRecipientAddress2',
   *   },
   * ];
   *
   * // Send a transaction
   * const result = await pushChain.tx.send(recipients, {
   *   category: 'CUSTOM:CORE_SDK',
   *   data: JSON.stringify({ message: 'Hello, Push Network!' }),
   * });
   *
   * console.log('Transaction Hash:', result.txHash);
   */
  send = async (
    recipients: UniversalAccount[],
    options: {
      category: string;
      data: string;
    }
  ): Promise<{ txHash: string }> => {
    if (!this.signer) throw new Error('Signer not defined');

    Tx.checkCategoryOrFail(options.category);

    let dataBytes: Uint8Array;
    if (options.category === TxCategory.INIT_DID) {
      dataBytes = new Uint8Array(Buffer.from(options.data, 'base64'));
    } else {
      dataBytes = new TextEncoder().encode(options.data);
    }
    const recipientsCAIP10Address: string[] = recipients.map(
      (value: UniversalAccount) =>
        PushChain.utils.account.toChainAgnostic(value)
    );

    const tx = Transaction.create({
      type: 0, // Phase 0 only has non-value transfers
      category: options.category,
      recipients: recipientsCAIP10Address,
      data: dataBytes,
      salt: parse(uuidv4()),
      fee: '0', // Fee is 0 as of now
    });

    const token = await this.tokenCache.getCachedApiToken();
    if (token == null) {
      throw new Error('failed to obtain token for push network');
    }
    const serializedUnsignedTx = PushChain.utils.tx.serialize({
      ...tx,
      sender: PushChain.utils.account.toChainAgnostic(this.signer),
      signature: new Uint8Array(0),
      apiToken: utf8ToBytes(token.apiToken),
    });

    // Convert 32 byte data to 64 byte data (UTF-8 encoded)
    const dataToBeSigned = new TextEncoder().encode(
      toHex(sha256(serializedUnsignedTx))
    );
    const signature = await this.signer.signMessage(dataToBeSigned);
    const serializedSignedTx = PushChain.utils.tx.serialize({
      ...PushChain.utils.tx.deserialize(serializedUnsignedTx),
      signature,
    });
    const txHash = await this.validator.call<string>(
      'push_sendTransaction',
      [bytesToHex(serializedSignedTx)],
      token.apiUrl
    );
    return { txHash };
  };

  /**
   * Get Transactions
   */
  private async getTransactionsFromVNode(
    accountInCaip: string,
    category: string,
    ts: string = '' + Math.floor(Date.now() / 1000),
    direction: 'ASC' | 'DESC' = 'DESC'
  ): Promise<ReplyGrouped> {
    Tx.checkCategoryOrFail(category);
    const result = await this.validator.callVNode<ReplyGrouped>(
      'push_getTransactions',
      [Tx.normalizeCaip(accountInCaip), category, ts, direction]
    );
    result.items.forEach((item) => {
      if (item.data) {
        item.data = new TextDecoder().decode(
          new Uint8Array(Buffer.from(item.data, 'hex'))
        );
      }
    });
    return result;
  }

  private static normalizeCaip(accountInCaip: string) {
    if (accountInCaip.startsWith('eip155')) {
      return accountInCaip.toLowerCase();
    }
    return accountInCaip;
  }

  private static checkCategoryOrFail(category: string) {
    if (category == null || category == '' || category.length > 20) {
      throw new Error('Invalid category, max size is 20 ascii chars');
    }
  }
}

// todo ? add online checks between token renewals (if vnode goes offline in-between)
class TokenCache {
  private readonly TOKEN_EXPIRE_SECONDS = 60;
  private cachedToken: TokenReply | null = null;
  private cachedTokenTs = 0;

  constructor(
    private validator: Validator,
    private readonly printTraces?: boolean
  ) {
    this.printTraces = printTraces || false;
  }

  async getCachedApiToken(): Promise<TokenReply | null> {
    if (TokenCache.isExpired(this.cachedTokenTs, this.TOKEN_EXPIRE_SECONDS)) {
      if (this.printTraces) {
        console.log('token refresh started');
      }
      this.cachedToken = await this.validator.call<TokenReply>(
        'push_getApiToken'
      );
      this.cachedTokenTs = new Date().getTime();
      if (this.printTraces) {
        console.log('token refresh finished');
      }
    } else {
      if (this.printTraces) {
        console.log('returning cached token');
      }
    }
    return this.cachedToken;
  }

  private static isExpired(ts: number, maxDelayInSec: number) {
    return (
      ts == 0 || Math.abs(new Date().getTime() - ts) > maxDelayInSec * 1000
    );
  }
}

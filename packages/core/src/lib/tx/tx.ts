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

  static initialize = async (
    env: ENV,
    universalSigner: UniversalSigner | null = null
  ) => {
    const validator = await Validator.initalize({ env });
    return new Tx(validator, universalSigner);
  };

  /**
   * Get transactions from the Push Network.
   *
   * - If `reference = '*'`, fetches all transactions.
   * - If `reference` is a string (tx hash), fetch that specific transaction.
   * - Otherwise, `reference` is treated as a UniversalAccount.
   *   In that case, `filterMode` determines the type of query:
   *   - 'both': fetches all transactions from and to the given address
   *   - 'sender': fetches all transactions sent by the given address
   *   - 'recipient': fetches all transactions received by the given address
   *
   * @param reference The reference for the query.
   * Can be `'*'` (all), a transaction hash, or a UniversalAccount.
   * @param options Optional parameters to refine the query.
   * @returns A BlockResponse or SimplifiedBlockResponse
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
   * Send Tx to Push Network
   * @param recipients
   * @param options
   * @returns Tx Hash
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
    ts: string = '' + Math.floor(Date.now()),
    direction: 'ASC' | 'DESC' = 'DESC'
  ) {
    Tx.checkCategoryOrFail(category);
    return await this.validator.callVNode<ReplyGrouped>(
      'push_getTransactions',
      [Tx.normalizeCaip(accountInCaip), category, ts, direction]
    );
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

  constructor(private validator: Validator) {}

  async getCachedApiToken(): Promise<TokenReply | null> {
    if (TokenCache.isExpired(this.cachedTokenTs, this.TOKEN_EXPIRE_SECONDS)) {
      console.log('token refresh started');
      this.cachedToken = await this.validator.call<TokenReply>(
        'push_getApiToken'
      );
      this.cachedTokenTs = new Date().getTime();
      console.log('token refresh finished');
    } else {
      console.log('returning cached token');
    }
    return this.cachedToken;
  }

  private static isExpired(ts: number, maxDelayInSec: number) {
    return (
      ts == 0 || Math.abs(new Date().getTime() - ts) > maxDelayInSec * 1000
    );
  }
}

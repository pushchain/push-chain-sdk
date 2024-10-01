import { v4 as uuidv4, parse } from 'uuid';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import { ACTION, TxCategory } from './tx.types';
import { Transaction } from '../generated/tx';
import { InitDid } from '../generated/txData/init_did';
import { InitSessionKey } from '../generated/txData/init_session_key';
import { ENV } from '../constants';
import { Validator } from '../validator/validator';
import { TokenReply } from '../validator/validator.types';
import { hexToBytes } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { BlockResponse } from '../block/block.types';
import config from '../config';

export class Tx {
  private walletWindow: Window | null = null;

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
    startTime: number = Math.floor(Date.now() / 1000), // Current Local Time
    direction: 'ASC' | 'DESC' = 'ASC',
    pageSize = 30,
    page = 1,
    category?: string
  ) => {
    return await this.validator.call<BlockResponse>('push_getTransactions', [
      startTime,
      direction,
      pageSize,
      page,
      category,
    ]);
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
   * @param sesion Session key and sender details
   * @dev In case session is not passed, fn tries to connect with Push Wallet for signature requests
   * @returns Tx Hash
   */
  send = async (
    unsignedTx: Transaction,
    session?: {
      sender: string;
      privKey: `0x${string}`;
    }
  ): Promise<string> => {
    const token = await this.validator.call<TokenReply>('push_getApiToken');
    let txSender: string;
    let signature: `0x${string}`;

    if (session) {
      txSender = session.sender;
      const serializedUnsignedTx = Tx.serialize({
        ...unsignedTx,
        sender: txSender,
        signature: new Uint8Array(0),
        apiToken: new Uint8Array(Buffer.from(token.apiToken, 'base64')),
      });
      const account = privateKeyToAccount(session.privKey);
      signature = await account.signMessage({
        message: { raw: serializedUnsignedTx },
      });
    } else {
      await this.openWalletWindow();
      txSender = await this.requestWalletAddress();
      const serializedUnsignedTx = Tx.serialize({
        ...unsignedTx,
        sender: txSender,
        signature: new Uint8Array(0),
        apiToken: new Uint8Array(Buffer.from(token.apiToken, 'base64')),
      });
      signature = (await this.requestWalletSignature(
        this.walletWindow as Window,
        serializedUnsignedTx
      )) as `0x${string}`;
    }
    const serializedSignedTx = Tx.serialize({
      ...unsignedTx,
      sender: txSender,
      signature: hexToBytes(signature),
      apiToken: utf8ToBytes(
        Buffer.from(token.apiToken, 'base64').toString('utf-8')
      ),
    });
    return await this.validator.call<string>(
      'push_sendTransaction',
      [bytesToHex(serializedSignedTx)],
      token.apiUrl
    );
  };

  private openWalletWindow = async () => {
    // Check if the wallet window is already open
    if (!this.walletWindow || this.walletWindow.closed) {
      this.walletWindow = window.open(config.WALLET_URL[this.env], '_blank');
      if (!this.walletWindow) {
        throw new Error('Failed to open wallet window');
      }
      // Time Given for tab to Load
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  };

  /**
   * Request Logged In Address from Push Wallet
   */
  private requestWalletAddress = (): Promise<string> => {
    return new Promise((resolve, reject) => {
      // Listen for wallet response
      window.addEventListener('message', function listener(event) {
        if (event.data.action === ACTION.WALLET_DETAILS) {
          window.removeEventListener('message', listener);
          resolve(event.data.address); // Wallet address returned
        } else if (event.data.action === ACTION.ERROR) {
          window.removeEventListener('message', listener);
          reject(event.data.error); // Handle error
        }
      });
      this.walletWindow?.postMessage(
        { action: ACTION.REQ_WALLET_DETAILS },
        config.WALLET_URL[this.env]
      );
    });
  };

  /**
   * Request connection to Push Wallet
   */
  private requestAppConnectionStatus = (): Promise<{
    isConnected: boolean;
    isPending: boolean;
  }> => {
    return new Promise((resolve, reject) => {
      // Listen for wallet response
      window.addEventListener('message', function listener(event) {
        if (event.data.action === ACTION.CONNECTION_STATUS) {
          window.removeEventListener('message', listener);
          resolve(event.data);
        } else if (event.data.action === ACTION.ERROR) {
          window.removeEventListener('message', listener);
          reject(event.data.error); // Handle error
        }
      });

      // Request wallet to sign data
      this.walletWindow?.postMessage(
        {
          action: ACTION.IS_CONNECTED,
        },
        config.WALLET_URL[this.env]
      );
    });
  };

  /**
   * Request connection to Push Wallet
   */
  private requestWalletConnection = (): Promise<{
    isConnected: boolean;
    isPending: boolean;
  }> => {
    return new Promise((resolve, reject) => {
      // Listen for wallet response
      window.addEventListener('message', function listener(event) {
        if (event.data.action === ACTION.CONNECTION_STATUS) {
          window.removeEventListener('message', listener);
          resolve(event.data);
        } else if (event.data.action === ACTION.ERROR) {
          window.removeEventListener('message', listener);
          reject(event.data.error); // Handle error
        }
      });
      this.walletWindow?.postMessage(
        {
          action: ACTION.REQ_TO_CONNECT,
        },
        config.WALLET_URL[this.env]
      );
    });
  };

  /**
   * Request Signature from Push Wallet
   */
  private requestWalletSignature = async (
    walletWindow: Window,
    serializedUnsignedTx: Uint8Array
  ): Promise<string> => {
    const { isPending, isConnected } = await this.requestAppConnectionStatus();

    if (!isConnected) {
      if (isPending) {
        throw Error(
          'App Connection Request is Pending. Accept App Connection Request in Push Wallet to enable signing !!!'
        );
      } else {
        await this.requestWalletConnection();
        throw Error(
          'App not Connected. Accept App Connection Request in Push Wallet to enable signing !!!'
        );
      }
    }

    return new Promise((resolve, reject) => {
      // Listen for wallet response
      window.addEventListener('message', function listener(event) {
        if (event.data.action === ACTION.SIGNATURE) {
          window.removeEventListener('message', listener);
          resolve(event.data.signature); // Signature returned
        } else if (event.data.action === ACTION.ERROR) {
          window.removeEventListener('message', listener);
          reject(event.data.error); // Handle error
        }
      });

      // Request wallet to sign data
      walletWindow.postMessage(
        {
          action: ACTION.REQ_TO_SIGN,
          data: serializedUnsignedTx,
        },
        config.WALLET_URL[this.env]
      );
    });
  };
}

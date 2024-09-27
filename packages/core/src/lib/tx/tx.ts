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
    let serializedSignedTx: Uint8Array;

    if (session) {
      // Session available, proceed with normal flow
      const serializedUnsignedTx = Tx.serialize({
        ...unsignedTx,
        sender: session.sender,
        signature: new Uint8Array(0),
        apiToken: new Uint8Array(Buffer.from(token.apiToken, 'base64')),
      });
      const account = privateKeyToAccount(session.privKey);
      const signature = await account.signMessage({
        message: { raw: serializedUnsignedTx },
      });
      serializedSignedTx = Tx.serialize({
        ...unsignedTx,
        sender: session.sender,
        signature: hexToBytes(signature),
        apiToken: utf8ToBytes(
          Buffer.from(token.apiToken, 'base64').toString('utf-8')
        ),
      });
    } else {
      this.openWalletWindow();
      if (!this.walletWindow) {
        throw new Error('Wallet Window Not Found');
      }
      // Request the wallet to provide the connected address
      const loggedInAddress = await this.requestWalletAddress(
        this.walletWindow
      );
      console.log('Got here too');
      return '';
      const serializedUnsignedTx = Tx.serialize({
        ...unsignedTx,
        sender: loggedInAddress,
        signature: new Uint8Array(0),
        apiToken: new Uint8Array(Buffer.from(token.apiToken, 'base64')),
      });

      // Request the wallet to sign the transaction
      const signature = await this.requestWalletSignature(
        this.walletWindow,
        serializedUnsignedTx
      );

      // Build the signed transaction
      serializedSignedTx = Tx.serialize({
        ...unsignedTx,
        sender: loggedInAddress,
        signature: hexToBytes(signature as `0x${string}`),
        apiToken: utf8ToBytes(
          Buffer.from(token.apiToken, 'base64').toString('utf-8')
        ),
      });
    }
    // Send the signed transaction
    return await this.validator.call<string>(
      'push_sendTransaction',
      [bytesToHex(serializedSignedTx)],
      token.apiUrl
    );
  };

  private openWalletWindow = () => {
    // Check if the wallet window is already open
    if (!this.walletWindow || this.walletWindow.closed) {
      this.walletWindow = window.open(config.WALLET_URL[this.env], '_blank');
      if (!this.walletWindow) {
        throw new Error('Failed to open wallet window');
      }
    }
  };

  // Function to request wallet address
  private requestWalletAddress = (walletWindow: Window): Promise<string> => {
    const env = this.env;
    return new Promise((resolve, reject) => {
      // Listen for wallet response
      window.addEventListener('message', function listener(event) {
        console.log(event);
        if (event.origin !== (config.WALLET_URL[env] as string)) {
          console.log(event);
          return; // Only accept messages from wallet domain
        }

        if (event.data.action === ACTION.WALLET_DETAILS) {
          window.removeEventListener('message', listener);
          resolve(event.data.address); // Wallet address returned
        } else if (event.data.action === ACTION.ERROR) {
          window.removeEventListener('message', listener);
          reject(event.data.error); // Handle error
        }
      });

      // Request wallet details
      walletWindow.postMessage({ action: ACTION.REQ_WALLET_DETAILS }, '*');
    });
  };

  // Function to request wallet signature
  private requestWalletSignature = (
    walletWindow: Window,
    serializedUnsignedTx: Uint8Array
  ): Promise<string> => {
    return new Promise((resolve, reject) => {
      // Listen for wallet response
      window.addEventListener('message', function listener(event) {
        if (event.origin !== '<WALLET_DOMAIN>') {
          return; // Only accept messages from wallet domain
        }

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
        '*'
      );
    });
  };
}

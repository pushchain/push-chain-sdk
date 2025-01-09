import config from '../config';
import { ENV } from '../constants';
import { ACTION, AppConnection } from './wallet.types';

export class Wallet {
  private walletWindow: Window | null = null;
  private walletUrl: string;

  constructor(private env: ENV) {
    this.walletUrl = config.WALLET_URL[this.env];
  }

  /**
   * @returns The connected CAIP wallet address
   * @dev - Errors out if user is not logged in
   */
  connect = async () => {
    await this.openWalletWindow();
    return await this.appConnectionStatus();
  };

  /**
   * Request Signature from Push Wallet
   */
  sign = async (data: Uint8Array): Promise<Uint8Array> => {
    await this.openWalletWindow();

    const { appConnectionStatus } = await this.appConnectionStatus();

    if (appConnectionStatus !== 'connected') {
      await this.requestAppConnection();
      throw Error(
        'App not Connected. Accept App Connection Request in Push Wallet to enable signing !!!'
      );
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
      (this.walletWindow as Window).postMessage(
        {
          action: ACTION.REQ_TO_SIGN,
          data,
        },
        this.walletUrl
      );
    });
  };

  /**
   * Get Dapp connection status to Push Wallet
   */
  // TODO: CHECK IF RETURN TYPE HERE IS CORRECT!
  // TODO: It says it returns this JSON but in reality is returning a string
  private appConnectionStatus = (): Promise<{
    authStatus: AppConnection['authStatus'];
    appConnectionStatus: AppConnection['appConnectionStatus'];
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
        this.walletUrl
      );
    });
  };

  /**
   * Request connection to Push Wallet
   */
  private requestAppConnection = async (): Promise<{
    isConnected: boolean;
    isPending: boolean;
  }> => {
    // await this.openWalletWindow();

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
        this.walletUrl
      );
    });
  };

  private openWalletWindow = async () => {
    const width = 600;
    const height = 800;
    const left = screen.width - width - 100;
    const top = 150;

    // Check if the wallet window is already open
    if (!this.walletWindow || this.walletWindow.closed) {
      this.walletWindow = window.open(
        this.walletUrl,
        '_blank',
        `width=${width},height=${height},left=${left},top=${top}`
      );
      if (!this.walletWindow) {
        throw new Error('Failed to open wallet window');
      }
      // Time Given for tab to Load
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  };

  /**
   * Request Logged In Address from Push Wallet
   */
  requestWalletAddress = (): Promise<string> => {
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
        this.walletUrl
      );
    });
  };
}

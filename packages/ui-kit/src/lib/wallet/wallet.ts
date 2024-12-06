import config from '../config';
import { ENV } from '../constants';
import { ACTION, AppConnection } from './wallet.types';

export class Wallet {
  private walletWindow: Window | null = null;
  private walletUrl: string;

  constructor(private env: ENV) {
    console.log('Env', env);

    this.walletUrl = config.WALLET_URL[this.env];
  }

  /**
   * @returns The connected CAIP wallet address
   * @dev - Errors out if user is not logged in
   */
  connect = async (walletURL: string = this.walletUrl) => {
    this.walletUrl = walletURL;
    await this.openWalletWindow();
    const connectionStatus = await this.appConnectionStatus();
    return connectionStatus;
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
  appConnectionStatus = (): Promise<{
    authStatus: AppConnection['authStatus'];
    appConnectionStatus: AppConnection['appConnectionStatus'];
  }> => {
    console.log('App Connection status is called from 1');

    return new Promise((resolve, reject) => {
      console.log('after app connection status', window);

      // Listen for wallet response
      window.addEventListener('message', function listener(event) {
        console.log('New Listener added', event);

        if (event.data.action === ACTION.CONNECTION_STATUS) {
          // window.removeEventListener('message', listener);
          console.log('Connection statys response', event);
          resolve(event.data);
        } else if (event.data.action === ACTION.ERROR) {
          console.log('Listener removing');

          window.removeEventListener('message', listener);
          console.log('Connection statys error', event);

          reject(event.data.error); // Handle error
        }
      });

      console.log('Message posted');

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
  requestAppConnection = async (): Promise<{
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

  checkAuthStatus = async () => {
    console.log('Checking auth status');

    await this.openWalletWindow();

    return new Promise((resolve, reject) => {
      // Listen for wallet response
      window.addEventListener('message', function listener(event) {
        if (event.data.action === ACTION.AUTH_STATUS) {
          window.removeEventListener('message', listener);
          console.log('Auth Status >>>', event);
          resolve(event.data.address); // Wallet address returned
        } else if (event.data.action === ACTION.ERROR) {
          window.removeEventListener('message', listener);
          console.log('Got Error >>>', event);
          reject(event.data.error); // Handle error
        }
      });
      this.walletWindow?.postMessage(
        { action: ACTION.AUTH_STATUS },
        this.walletUrl
      );
    });
  };
}

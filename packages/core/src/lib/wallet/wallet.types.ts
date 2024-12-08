export enum ACTION {
  IS_CONNECTED = 'isConnected',
  REQ_TO_CONNECT = 'reqToConnect',
  REQ_TO_SIGN = 'reqToSign',
  REQ_WALLET_DETAILS = 'reqWalletDetails',

  ERROR = 'error',
  CONNECTION_STATUS = 'connectionStatus',
  WALLET_DETAILS = 'walletDetails',
  SIGNATURE = 'signature',
}

export enum NEW_ACTION {
  IS_LOGGED_IN_TO_WALLT = 'isloggedInToWallet',
  IS_LOGGING_IN = 'isloggingIn',
  REQ_TO_ENABLE_SIGNING = 'reqToEnableSigning',
  REQ_TO_SIGN = 'reqToSign',
  GET_WALLET_DETAILS = 'getWalletDetails',
}

export type AppConnection = {
  origin: string;
  authStatus?: 'loggedIn' | 'notLoggedIn';
  appConnectionStatus: 'rejected' | 'notReceived' | 'connected' | 'pending';
};

/**
 * Process:
 * 1. Connect Wallet -> Will open a new window
 * 2. Connecting -> it will check if this.pushWallet is present or not
 * 3. Sign or Connect to DApp -> it will send a request to connect request to the wallet
 * 4. Connected -> successfully connected and fetched the signerAccount
 */

/**
 * Actions:
 * 1. Is_wallet_connected = if this.pushWallet is present emit true otherwise false (this will constantly be polled for fetching wallet)
 * 2.
 * 3. req_to_sign -> sends an appConnection request -> REQ_TO_CONNECT
 */

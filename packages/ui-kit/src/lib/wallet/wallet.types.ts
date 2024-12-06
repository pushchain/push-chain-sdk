import { ENV } from '../constants';
import { Wallet as PushWallet } from './wallet';

export enum ACTION {
  IS_CONNECTED = 'isConnected',
  REQ_TO_CONNECT = 'reqToConnect',
  REQ_TO_SIGN = 'reqToSign',
  REQ_WALLET_DETAILS = 'reqWalletDetails',

  AUTH_STATUS = 'authStatus',

  ERROR = 'error',
  CONNECTION_STATUS = 'connectionStatus',
  WALLET_DETAILS = 'walletDetails',
  SIGNATURE = 'signature',
}

export type AppConnection = {
  origin: string;
  authStatus?: 'loggedIn' | 'notLoggedIn';
  appConnectionStatus: 'rejected' | 'notReceived' | 'connected' | 'pending';
};

export type IConnectPushWalletProps = {
  setAccount: (account: string) => void;
  pushWallet: PushWallet;
  env?: ENV;
};
export type ButtonStatus =
  | 'Connect'
  | 'Connecting'
  | 'Retry'
  | 'Authenticating'
  | 'Connected';

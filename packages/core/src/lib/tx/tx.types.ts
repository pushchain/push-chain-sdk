// TxCategory supported for Serealization / Deserealization by core
export enum TxCategory {
  INIT_DID = 'INIT_DID',
  INIT_SESSION_KEY = 'INIT_SESSION_KEY',
}

export type TxResponse = {
  txnHash: string;
  ts: number;
  /**@dev - Null In case of rejected Tx */
  blockHash: string | null;
  category: string;
  sender: string;
  status: 'SUCCESS' | 'REJECTED';
  recipients: string[];
  txnData: string;
  sig: string;
};

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

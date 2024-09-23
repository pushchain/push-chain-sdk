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

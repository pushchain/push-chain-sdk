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


export class ReplyGrouped {
  items: TxInfo[] = [];
  summary: ResultMeta = new ResultMeta();
}

export class ResultMeta {
  quorumResult!: QuorumResult;
  itemCount!: number;
  lastTs!: string;
  keysWithoutQuorumCount!: number;
  keysWithoutQuorum!: string[];
}

export enum QuorumResult {
  QUORUM_OK = 'QUORUM_OK',
  QUORUM_OK_PARTIAL = 'QUORUM_OK_PARTIAL',
  QUORUM_FAILED_NODE_REPLIES = 'QUORUM_FAILED_NODE_REPLIES',
  QUORUM_FAILED_BY_MIN_ITEMS = 'QUORUM_FAILED_BY_MIN_ITEMS',
}

export type TxInfo = {
  type: number;
  category: string;
  sender: string;
  recipientsList: string[];
  data: string;
  ts: string;
  salt: string;
};
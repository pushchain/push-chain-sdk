import { Transaction } from '../generated/tx';

// TxCategory supported for Serealization / Deserealization by core
export enum TxCategory {
  INIT_DID = 'INIT_DID',
  INIT_SESSION_KEY = 'INIT_SESSION_KEY',
}

export type TxWithBlockHash = Transaction & {
  // can be undefined in case of rejected / failed Tx
  blockHash?: string;
};

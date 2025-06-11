import { PushChain } from '@pushchain/core';
import { CHAIN } from '@pushchain/core/src/lib/constants/enums';
import { TypedData, TypedDataDomain } from 'viem';

export enum ChainType {
  ETHEREUM = 'mainnet',
  SOLANA = 'solana',
  BINANCE = 'bsc',
  ARBITRUM = 'arbitrum',
  AVALANCHE = 'avalanche',
}
export interface WalletInfo {
  address: string;
  chainType: ChainType;
  providerName: string;
}

export interface ITypedData {
  domain: TypedDataDomain;
  types: TypedData;
  primaryType: string;
  message: Record<string, unknown>;
}

export interface IWalletProvider {
  name: string;
  icon: string;
  supportedChains: ChainType[];
  connect(chainType?: ChainType): Promise<{ caipAddress: string }>;
  signMessage(message: Uint8Array): Promise<Uint8Array>;
  signTransaction(txn: Uint8Array): Promise<Uint8Array>;
  signTypedData(typedData: ITypedData): Promise<Uint8Array>;
  disconnect(): Promise<void>;
  getChainId(): Promise<unknown>;
  switchNetwork?(chainName: ChainType): Promise<void>;
}

export type UniversalAccount = {
  chain: CHAIN;
  address: string;
};

export type ConnectionStatus =
  | 'notConnected'
  | 'connecting'
  | 'authenticating'
  | 'connected'
  | 'retry';

export type WalletEventRespoonse = {
  signature?: Uint8Array;
  account?: string;
};

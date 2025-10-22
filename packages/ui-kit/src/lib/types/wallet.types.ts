import { CHAIN } from '@pushchain/core/src/lib/constants/enums';
import { TypedData, TypedDataDomain } from 'viem';

export enum ChainType {
  ETHEREUM = 'sepolia',
  SOLANA = 'solana',
  BINANCE = 'bsc',
  ARBITRUM = 'arbitrum',
  BASE = "baseSepolia",
  AVALANCHE = 'avalanche',
  WALLET_CONNECT = 'walletConnect',
  PUSH_WALLET = 'pushWalletDonut',
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
  signAndSendTransaction(txn: Uint8Array): Promise<Uint8Array>;
  signTypedData(typedData: ITypedData): Promise<Uint8Array>;
  disconnect(): Promise<void>;
  getChainId(): Promise<unknown>;
  switchNetwork?(chainName: ChainType): Promise<void>;
}

export type UniversalAccount = {
  chain: CHAIN;
  address: string;
};

export enum ConnectionStatus {
  NOT_CONNECTED = 'notConnected',
  CONNECTING = 'connecting',
  AUTHENTICATING = 'authenticating',
  CONNECTED = 'connected',
  RETRY = 'retry',
}

export type WalletEventRespoonse = {
  signature?: Uint8Array;
  account?: UniversalAccount;
};

import { PushChain } from '@pushchain/core';
import {
  ArbitrumMonotone,
  AvalancheMonotone,
  BnbMonotone,
  EthereumMonotone,
  OptimismMonotone,
  PolygonMonotone,
  PushMonotone,
  SolanaMonotone,
} from '../components/common';
import { ConnectionStatus } from '../types';
import BaseMonotone from '../components/common/icons/BaseMonotone';

export const PushUI = {
  CONSTANTS: {
    PUSH_NETWORK: PushChain.CONSTANTS.PUSH_NETWORK,
    CHAIN: { ETHEREUM: 'ethereum', SOLANA: 'solana' },
    THEME: { LIGHT: 'light', DARK: 'dark' },
    LOGIN: { LAYOUT: { SPLIT: 'split', SIMPLE: 'simple' } },
    CONNECTED: {
      LAYOUT: { FULL: 'full', HOVER: 'hover' },
      INTERACTION: { INTERACTIVE: 'interactive', BLUR: 'blur' },
    },
    CONNECTION: { STATUS: ConnectionStatus },
    CHAIN_CONFIG: PushChain.CONSTANTS.CHAIN,
  },
};

// events send by wallet to the dapp
export enum WALLET_TO_APP_ACTION {
  CONNECT_EXTERNAL_WALLET = 'connectWallet',

  APP_CONNECTION_SUCCESS = 'appConnectionSuccess',
  APP_CONNECTION_REJECTED = 'appConnectionRejected',
  APP_CONNECTION_CANCELLED = 'appConnectionCancelled',

  IS_LOGGED_IN = 'isLoggedIn',
  IS_LOGGED_OUT = 'loggedOut',

  SIGN_MESSAGE = 'signatureMessage',
  SIGN_TRANSACTION = 'signatureTransaction',
  SIGN_TYPED_DATA = 'signatureTypedData',
  ERROR = 'error',

  PUSH_SEND_TRANSACTION = 'pushSendTransaction',

  CLOSE_IFRAME = 'closeIFrame',
}

// events send by dapp to the wallet
export enum APP_TO_WALLET_ACTION {
  NEW_CONNECTION_REQUEST = 'newConnectionRequest',
  SIGN_MESSAGE = 'signMessage',
  SIGN_TRANSACTION = 'signTransaction',
  SIGN_TYPED_DATA = 'signTypedData',
  LOG_OUT = 'logOut',

  CONNECTION_STATUS = 'connectionStatus',
  WALLET_CONFIG = 'walletConfig',

  PUSH_SEND_TRANSACTION_RESPONSE = 'pushSendTransactionResponse',
  READ_ONLY_CONNECTION_STATUS = 'readOnlyConnectionStatus',
  RECONNECT_WALLET = 'ReconnectWallet',
}

export const CHAIN_LOGO: Record<string, React.FC | React.ComponentType> = {
  1: EthereumMonotone,
  11155111: EthereumMonotone,
  137: PolygonMonotone,
  80002: PolygonMonotone,
  97: BnbMonotone,
  56: BnbMonotone,
  42161: ArbitrumMonotone,
  421614: ArbitrumMonotone,
  84532: BaseMonotone,
  11155420: OptimismMonotone,
  10: OptimismMonotone,
  2442: PolygonMonotone,
  1101: PolygonMonotone,
  43114: AvalancheMonotone,
  43113: AvalancheMonotone,
  '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp': SolanaMonotone, // mainnet
  '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z': SolanaMonotone, // testnet
  EtWTRABZaYq6iMfeYKouRu166VU2xqa1: SolanaMonotone, // devnet
  9: PushMonotone,
  9000: PushMonotone,
  devnet: PushMonotone,
};

export * from './environment';

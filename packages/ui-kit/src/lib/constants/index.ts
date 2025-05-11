import { ENV } from "./environment";
export * from "./environment";

export const CONSTANTS = {
    ENV: ENV,
    CHAIN: { EVM: 'evm', SOLANA: 'solana' },
    THEME: { LIGHT: 'light', DARK: 'dark' },
    LOGIN: { SPLIT: 'split', SIMPLE: 'simple' }
}

// events send by wallet to the dapp
export enum WALLET_TO_APP_ACTION {
    CONNECT_EXTERNAL_WALLET = 'connectWallet',

    APP_CONNECTION_SUCCESS = 'appConnectionSuccess',
    APP_CONNECTION_REJECTED = 'appConnectionRejected',

    IS_LOGGED_IN = 'isLoggedIn',
    IS_LOGGED_OUT = 'loggedOut',

    SIGNATURE = 'signature',
    ERROR = 'error',
}

// events send by dapp to the wallet
export enum APP_TO_WALLET_ACTION {
    NEW_CONNECTION_REQUEST = 'newConnectionRequest',
    SIGN_MESSAGE = 'signMessage',
    LOG_OUT = 'logOut',

    CONNECTION_STATUS = 'connectionStatus',
}
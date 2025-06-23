import { PushChain } from '@pushchain/core';

export type ConfigType = {
  WALLET_URL: {
    [PushChain.CONSTANTS.PUSH_NETWORK.MAINNET]: string;
    [PushChain.CONSTANTS.PUSH_NETWORK.TESTNET]: string;
    [PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT]: string;
    [PushChain.CONSTANTS.PUSH_NETWORK.LOCALNET]: string;
  };
};

export const WALLET_CONFIG_URL = {
  [PushChain.CONSTANTS.PUSH_NETWORK.MAINNET]: 'https://wallet.push.org',
  [PushChain.CONSTANTS.PUSH_NETWORK.TESTNET]: 'https://wallet-alpha.push.org',
  [PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT]:
    'https://wallet-alpha.push.org',
  [PushChain.CONSTANTS.PUSH_NETWORK.LOCALNET]: 'http://localhost:5173',
};

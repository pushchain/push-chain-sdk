import { PUSH_NETWORK } from '@pushchain/core/src/lib/constants/enums';

export type ConfigType = {
  WALLET_URL: {
    [PUSH_NETWORK.MAINNET]: string;
    [PUSH_NETWORK.TESTNET]: string;
    [PUSH_NETWORK.TESTNET_DONUT]: string;
    [PUSH_NETWORK.LOCALNET]: string;
  };
};

export const WALLET_CONFIG_URL = {
  [PUSH_NETWORK.MAINNET]: 'https://wallet.push.org',
  [PUSH_NETWORK.TESTNET]: 'https://wallet.push.org',
  [PUSH_NETWORK.TESTNET_DONUT]: 'https://wallet.push.org',
  [PUSH_NETWORK.LOCALNET]: 'http://localhost:5173',
};

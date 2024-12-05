import { ENV } from '../constants';
import { Config } from './config.types';

const config: Config = {
  WALLET_URL: {
    [ENV.PROD]: 'https://wallet.push.org',
    [ENV.STAGING]: 'https://wallet.push.org',
    [ENV.DEV]: 'https://push-protocol.github.io/push-wallet',
    [ENV.LOCAL]: 'http://localhost:5173/',
  },
};

export default config;

import { ENV } from '../constants';

export interface Config {
  WALLET_URL: {
    [ENV.PROD]: string;
    [ENV.STAGING]: string;
    [ENV.DEV]: string;
    [ENV.LOCAL]: string;
  };
}

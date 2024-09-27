import type { Chain } from 'viem';
import { ENV } from '../constants';
import { validatorABI } from './abis/validator';

interface NetworkConfig {
  NETWORK: Chain;
  VALIDATOR_CONTRACT: string;
}

export interface Config {
  ABIS: {
    VALIDATOR: typeof validatorABI;
  };
  VALIDATOR: {
    [ENV.PROD]: NetworkConfig;
    [ENV.STAGING]: NetworkConfig;
    [ENV.DEV]: NetworkConfig;
    [ENV.LOCAL]: NetworkConfig;
  };
  WALLET_URL: {
    [ENV.PROD]: string;
    [ENV.STAGING]: string;
    [ENV.DEV]: string;
    [ENV.LOCAL]: string;
  };
}

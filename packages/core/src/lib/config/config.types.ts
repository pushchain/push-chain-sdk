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
    [ENV.MAINNET]: NetworkConfig;
    [ENV.DEVNET]: NetworkConfig;
    [ENV.TESTNET]: NetworkConfig;
    [ENV.LOCAL]: NetworkConfig;
  };
  WALLET_URL: {
    [ENV.MAINNET]: string;
    [ENV.DEVNET]: string;
    [ENV.TESTNET]: string;
    [ENV.LOCAL]: string;
  };
}

import type { Chain } from 'viem';
import { PushChainEnvironment } from '../constants';
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
    [PushChainEnvironment.mainnet]: NetworkConfig;
    [PushChainEnvironment.devnet]: NetworkConfig;
    [PushChainEnvironment.testnet]: NetworkConfig;
    [PushChainEnvironment.local]: NetworkConfig;
  };
  WALLET_URL: {
    [PushChainEnvironment.mainnet]: string;
    [PushChainEnvironment.devnet]: string;
    [PushChainEnvironment.testnet]: string;
    [PushChainEnvironment.local]: string;
  };
}

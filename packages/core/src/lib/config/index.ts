import { ENV } from '../constants';
import { mainnet, localhost, sepolia } from 'viem/chains';
import { validatorABI } from './abis/validator';
import { Config } from './config.types';
import * as process from 'node:process';

// ENV CONFIGS
const config: Config = {
  ABIS: {
    VALIDATOR: validatorABI,
  },
  VALIDATOR: {
    [ENV.PROD]: {
      NETWORK: mainnet,
      VALIDATOR_CONTRACT: 'TODO',
    },
    [ENV.STAGING]: {
      NETWORK: sepolia,
      VALIDATOR_CONTRACT: 'TODO',
    },
    [ENV.DEV]: {
      NETWORK: sepolia,
      VALIDATOR_CONTRACT: '0x98dBfb001cB2623cF7BfE2A17755592E151f0779',
    },
    [ENV.LOCAL]: {
      NETWORK: localhost,
      VALIDATOR_CONTRACT: '0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9',
    },
  },
  WALLET_URL: {
    [ENV.PROD]: 'TODO',
    [ENV.STAGING]: 'TODO',
    [ENV.DEV]: 'https://wallet.push.org',
    [ENV.LOCAL]: 'http://localhost:5174/',
  },
};

export default config;

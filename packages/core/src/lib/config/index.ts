import { ENV } from '../constants';
import { mainnet, localhost, sepolia } from 'viem/chains';
import { validatorABI } from './abis/validator';
import { Config } from './config.types';

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
      VALIDATOR_CONTRACT: '0x963E4dd4EB2bd6dD72728b781695798886244Ad2',
    },
    [ENV.LOCAL]: {
      NETWORK: localhost,
      VALIDATOR_CONTRACT: '0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9',
    },
  },
};

export default config;

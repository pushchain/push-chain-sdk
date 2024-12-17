import { mainnet, localhost, sepolia } from 'viem/chains';
import { PushChainEnvironment } from '../constants';
import { validatorABI } from './abis/validator';
import { Config } from './config.types';

// ENV CONFIGS
const config: Config = {
  ABIS: {
    VALIDATOR: validatorABI,
  },
  VALIDATOR: {
    [PushChainEnvironment.mainnet]: {
      NETWORK: mainnet,
      VALIDATOR_CONTRACT: 'TODO',
    },
    [PushChainEnvironment.testnet]: {
      NETWORK: sepolia,
      VALIDATOR_CONTRACT: 'TODO',
    },
    [PushChainEnvironment.devnet]: {
      NETWORK: sepolia,
      VALIDATOR_CONTRACT: '0x98dBfb001cB2623cF7BfE2A17755592E151f0779',
    },
    [PushChainEnvironment.local]: {
      NETWORK: localhost,
      VALIDATOR_CONTRACT: '0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9',
    },
  },
  WALLET_URL: {
    [PushChainEnvironment.mainnet]: 'TODO',
    [PushChainEnvironment.testnet]: 'TODO',
    [PushChainEnvironment.devnet]: 'https://wallet.push.org',
    [PushChainEnvironment.local]: 'http://localhost:5173/',
  },
};

export default config;

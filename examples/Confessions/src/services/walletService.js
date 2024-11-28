// src/services/walletService.js
import { init } from '@web3-onboard/react';
import injectedModule from '@web3-onboard/injected-wallets';

// Initialize injected wallet module (e.g., MetaMask)
const injected = injectedModule();

// HIDE INFURA KEY BEFORE SHARING
const web3Onboard = init({
  wallets: [injected],
  chains: [
    {
      id: '0x1', // Ethereum Mainnet
      token: 'ETH',
      label: 'Ethereum Mainnet',
      rpcUrl: `https://mainnet.infura.io/v3/${import.meta.env.VITE_INFURA_KEY}`,
    },
    {
      id: '0xaa36a7', // Sepolia Testnet
      token: 'ETH',
      label: 'Sepolia Testnet',
      rpcUrl: `https://sepolia.infura.io/v3/${import.meta.env.VITE_INFURA_KEY}`,
    },
    {
      id: '0x5', // Goerli Testnet
      token: 'ETH',
      label: 'Goerli Testnet',
      rpcUrl: `https://goerli.infura.io/v3/${import.meta.env.VITE_INFURA_KEY}`,
    },
  ],
  appMetadata: {
    name: 'Confessions dApp',
    icon: '<svg>Your App Icon</svg>',
    description: 'Anonymous, private, blockchain-verified confessions.',
  },
});

export default web3Onboard;

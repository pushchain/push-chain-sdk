import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import PrivyWalletProvider from './providers/privy-wallet-provider.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PrivyWalletProvider>
      <App />
    </PrivyWalletProvider>
  </StrictMode>
);

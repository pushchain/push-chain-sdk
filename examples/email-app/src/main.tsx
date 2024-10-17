import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { AppProvider } from './providers/app-provider.tsx';
import PrivyWalletProvider from './providers/privy-wallet-provider.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PrivyWalletProvider>
      <AppProvider>
        <App />
      </AppProvider>
    </PrivyWalletProvider>
  </StrictMode>
);

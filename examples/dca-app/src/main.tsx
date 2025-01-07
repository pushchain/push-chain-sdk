import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import PrivyWalletProvider from './providers/privy-wallet-provider.tsx';
import { AppProvider } from './providers/app-provider.tsx';
import {
  ENV,
  PushWalletProvider,
  PushWalletIFrame,
} from '@pushprotocol/pushchain-ui-kit';


createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PushWalletProvider env={ENV.DEV}>
    <PrivyWalletProvider>
      <AppProvider>
      <PushWalletIFrame />
        <App />
      </AppProvider>
    </PrivyWalletProvider>
  </PushWalletProvider>
  </StrictMode>
);

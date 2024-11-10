import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { PrivyWalletProvider } from './providers/privy-wallet-provider.tsx';
import { AppProvider } from './providers/app-provider.tsx';
import { PokerGameProvider } from './providers/poker-game-provider.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PrivyWalletProvider>
      <AppProvider>
        <PokerGameProvider>
          <App />
        </PokerGameProvider>
      </AppProvider>
    </PrivyWalletProvider>
  </StrictMode>
);

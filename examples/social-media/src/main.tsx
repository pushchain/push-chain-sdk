import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { PrivyWalletProvider } from './providers/privy-wallet-provider.tsx';
import { PushProvider } from './providers/push-provider.tsx';
import { SocialProvider } from './providers/social-provider.tsx';
import 'react-toastify/dist/ReactToastify.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PrivyWalletProvider>
      <PushProvider>
        <SocialProvider>
          <App/>
        </SocialProvider>
      </PushProvider>
    </PrivyWalletProvider>
  </StrictMode>
);

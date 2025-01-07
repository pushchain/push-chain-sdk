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
import { getBlocksCSSVariables, themeConfig } from 'shared-components';
import { createGlobalStyle, ThemeProvider } from 'styled-components';

const GlobalStyle = createGlobalStyle`
  :root{
    /* Font Family */
      --font-family: 'FK Grotesk Neu';

    /* New blocks theme css variables*/
    
    ${(props) => getBlocksCSSVariables(props.theme.blocksTheme)}
  }
`;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider theme={themeConfig.light}>
      <GlobalStyle />
      <PushWalletProvider env={ENV.PROD}>
        <PrivyWalletProvider>
          <AppProvider>
            <PushWalletIFrame />
            <App />
          </AppProvider>
        </PrivyWalletProvider>
      </PushWalletProvider>
    </ThemeProvider>
  </StrictMode>
);

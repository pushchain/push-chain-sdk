import React from 'react';
import { BrowserRouter as Router } from 'react-router-dom';
import { createGlobalStyle, ThemeProvider } from 'styled-components';
import { getBlocksCSSVariables, themeConfig } from 'shared-components';
import { useDarkMode } from './common/hooks';
import { RouterContainer } from './common/components';
import {
  AppMetadata,
  PushUI,
  PushUniversalWalletProvider,
  ProviderConfigProps,
} from '../../../../packages/ui-kit';
import Navbar from './components/Navbar';

const GlobalStyle = createGlobalStyle`
  :root{
    /* Font Family */
      --font-family: 'FK Grotesk Neu';

    /* New blocks theme css variables*/
  
    ${(props) => {
      // @ts-expect-error
      return getBlocksCSSVariables(props.theme.blocksTheme);
    }}
  }
`;

const env = {
  production: PushUI.CONSTANTS.PUSH_NETWORK.MAINNET,
  alpha: PushUI.CONSTANTS.PUSH_NETWORK.TESTNET,
} as const;

type EnvKeys = keyof typeof env;

const deploymentEnv: EnvKeys =
  import.meta.env.VITE_DEPLOYMENT_MODE || 'production';

const App: React.FC = () => {
  const { isDarkMode } = useDarkMode();

  const walletConfig: ProviderConfigProps = {
    network: PushUI.CONSTANTS.PUSH_NETWORK.LOCALNET,
    login: {
      email: true,
      google: true,
      wallet: {
        enabled: true,
      },
      appPreview: true,
    },
    modal: {
      loginLayout: PushUI.CONSTANTS.LOGIN.SPLIT,
      connectedLayout: PushUI.CONSTANTS.CONNECTED.HOVER,
      appPreview: true,
    },
  };

  const appMetadata: AppMetadata = {
    logoUrl:
      'https://plus.unsplash.com/premium_photo-1746731481770-08b2f71661d0?q=80&w=2671&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D',
    title: 'Simulate',
    description:
      'Push Chain is a shared state L1 blockchain that allows all chains to unify, enabling apps of any chain to be accessed by users of any chain.',
  };

  return (
    <ThemeProvider theme={isDarkMode ? themeConfig.dark : themeConfig.light}>
      <GlobalStyle />
      <PushUniversalWalletProvider
        config={walletConfig}
        app={appMetadata}
        themeMode={PushUI.CONSTANTS.THEME.LIGHT}
      >
        <Router>
          <Navbar />
          <RouterContainer />
        </Router>
      </PushUniversalWalletProvider>
    </ThemeProvider>
  );
};

export default App;

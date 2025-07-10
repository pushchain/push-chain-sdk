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
} from '@pushchain/ui-kit';
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

const App: React.FC = () => {
  const { isDarkMode } = useDarkMode();

  const walletConfig: ProviderConfigProps = {
    network: PushUI.CONSTANTS.PUSH_NETWORK.TESTNET,
    login: {
      email: true,
      google: true,
      wallet: {
        enabled: true,
      },
      appPreview: true,
    },
    modal: {
      loginLayout: PushUI.CONSTANTS.LOGIN.LAYOUT.SPLIT,
      connectedLayout: PushUI.CONSTANTS.CONNECTED.LAYOUT.HOVER,
      appPreview: true,
      connectedInteraction: PushUI.CONSTANTS.CONNECTED.INTERACTION.BLUR,
    },
    chainConfig: {
      rpcUrls: {
        'eip155:11155111': ['https://sepolia.gateway.tenderly.co/'],
      },
    },
  };

  const appMetadata: AppMetadata = {
    logoUrl: 'https://avatars.githubusercontent.com/u/64157541?v=4',
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
        themeOverrides={{
          '--pw-core-font-family': 'FK Grotesk Neu',
        }}
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

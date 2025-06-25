import React, { FC } from 'react';
import { ProviderConfigProps, PushWalletProviderProps } from '../types/index';
import { WalletContextProvider } from '../context/WalletContext';
import { PushUI } from '../constants';
import {
  createGlobalStyle,
  DefaultTheme,
  ThemeProvider,
} from 'styled-components';
import {
  themeDefault,
  lightThemeDefault,
  darkThemeDefault,
  ThemeOverrides,
} from '../styles/token';
import { mapCoreToInt } from '../utils/theme';
import { Buffer } from 'buffer';

const loginDefaultConfig = {
  email: true,
  google: true,
  wallet: {
    enabled: true,
  },
};

const PushWalletConfigDefault: ProviderConfigProps = {
  uid: 'default',
  login: loginDefaultConfig,
  network: PushUI.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
  modal: {
    loginLayout: PushUI.CONSTANTS.LOGIN.SIMPLE,
    appPreview: false,
  },
};

export interface CustomTheme extends DefaultTheme {
  themeMode: string;
  themeOverrides: ThemeOverrides;
}

export const PushUniversalWalletProvider: FC<PushWalletProviderProps> = ({
  config,
  app,
  themeMode = PushUI.CONSTANTS.THEME.DARK,
  themeOverrides = {},
  children,
}) => {
  const GlobalStyle = createGlobalStyle`
    :root{
      #w3m-modal {
        z-index: 9999 !important;
        position: fixed !important;
      }

      ${(props) => {
        const { themeMode, themeOverrides } = props.theme as CustomTheme;
        const isLightMode = themeMode === 'light';
        const { dark, light, ...globalOverrides } = themeOverrides;
        const newOverrides = {
          ...{
            ...themeDefault,
            ...(isLightMode ? lightThemeDefault : darkThemeDefault),
          },
          ...mapCoreToInt(globalOverrides),
          ...mapCoreToInt((isLightMode ? light : dark) ?? {}),
        };
        return Object.entries(newOverrides)
          .map(([key, value]) => `${key}: ${value};`)
          .join('\n');
      }}
    }
  `;

  const mergedConfig: ProviderConfigProps = {
    ...PushWalletConfigDefault,
    ...config,
    login: {
      ...loginDefaultConfig,
      ...(config?.login || {}),
      wallet: {
        ...loginDefaultConfig.wallet,
        ...(config?.login?.wallet || {}),
      },
    },
    modal: {
      ...PushWalletConfigDefault.modal,
      ...config.modal,
    },
  };

  if (typeof window !== 'undefined' && !window.Buffer) {
    window.Buffer = Buffer;
  }

  return (
    <ThemeProvider theme={{ themeMode, themeOverrides }}>
      <GlobalStyle />
      <WalletContextProvider
        config={mergedConfig}
        app={app}
        themeMode={themeMode}
        themeOverrides={themeOverrides}
      >
        {children}
      </WalletContextProvider>
    </ThemeProvider>
  );
};

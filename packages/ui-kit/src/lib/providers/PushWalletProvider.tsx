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
  buttonThemeDefault,
} from '../styles/token';
import { mapCoreToInt } from '../utils/theme';

interface CustomTheme extends DefaultTheme {
  themeMode: string;
  themeOverrides: ThemeOverrides;
}

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
    loginLayout: PushUI.CONSTANTS.LOGIN.LAYOUT.SIMPLE,
    appPreview: false,
    connectedInteraction: PushUI.CONSTANTS.CONNECTED.INTERACTION.INTERACTIVE,
  },
};

export const PushUniversalWalletProvider: FC<PushWalletProviderProps> = ({
  config,
  app,
  themeMode = PushUI.CONSTANTS.THEME.LIGHT,
  themeOverrides = {},
  children,
}) => {
  const GlobalStyle = createGlobalStyle<{ uid: string }>`
    [data-pw-wrapper='${(props) => props.uid}']{
      #w3m-modal {
        z-index: 9999 !important;
        position: fixed !important;
      }

      ${(props) => {
        const { themeMode, themeOverrides } = props.theme as CustomTheme;
        const isLightMode = themeMode === PushUI.CONSTANTS.THEME.LIGHT;
        const { dark, light, ...globalOverrides } = themeOverrides;
        const newOverrides = {
          ...{
            ...themeDefault,
            ...buttonThemeDefault,
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

  return (
    <ThemeProvider theme={{ themeMode, themeOverrides }}>
      <GlobalStyle uid={mergedConfig.uid!} />
      <div data-pw-wrapper={mergedConfig.uid}>
        <WalletContextProvider
          config={mergedConfig}
          app={app}
          themeMode={themeMode}
          themeOverrides={themeOverrides}
        >
          {children}
        </WalletContextProvider>
      </div>
    </ThemeProvider>
  );
};

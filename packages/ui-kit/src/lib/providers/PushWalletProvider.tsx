import React, { FC } from 'react';
import { ProviderConfigProps, PushWalletProviderProps } from '../types/index';
import { WalletContextProvider } from '../context/WalletContext';
import { CONSTANTS } from '../constants';
import { createGlobalStyle, ThemeProvider } from 'styled-components';
import {
  themeDefault,
  lightThemeDefault,
  darkThemeDefault,
} from '../constants/themes';
import { mapCoreToInt } from '../utils/theme';

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
  env: CONSTANTS.ENV.DEVNET,
  modal: {
    loginLayout: CONSTANTS.LOGIN.SIMPLE,
    appPreview: false,
  },
};

export const PushWalletProvider: FC<PushWalletProviderProps> = ({
  config,
  app,
  themeMode = CONSTANTS.THEME.DARK,
  themeOverrides = {},
  children,
}) => {
  const GlobalStyle = createGlobalStyle`
    :root{
      ${(props) => {
        const { themeMode, themeOverrides } = props.theme;
        console.log(themeOverrides);
        const isLightMode = themeMode === 'light';
        const { dark, light, ...globalOverrides } = themeOverrides;
        console.log(mapCoreToInt(globalOverrides));
        const newOverrides = {
          ...{
            ...themeDefault,
            ...(isLightMode ? lightThemeDefault : darkThemeDefault),
          },
          ...mapCoreToInt(globalOverrides),
          ...mapCoreToInt(isLightMode ? light : dark),
        };
        console.log(newOverrides);
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

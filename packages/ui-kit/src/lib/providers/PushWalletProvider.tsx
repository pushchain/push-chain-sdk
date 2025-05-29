import React, { FC } from 'react';
import { ProviderConfigProps, PushWalletProviderProps } from '../types/index';
import { WalletContextProvider } from '../context/WalletContext';
import { CONSTANTS } from '../constants';
import { createGlobalStyle, ThemeProvider } from 'styled-components';

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
  modalDefaults: {
    loginLayout: CONSTANTS.LOGIN.SIMPLE,
    showModalAppPreview: false,
  },
};

export const PushWalletProvider: FC<PushWalletProviderProps> = ({
  config,
  app,
  themeMode = CONSTANTS.THEME.DARK,
  themeOverrides,
  children,
}) => {
  const GlobalStyle = createGlobalStyle`
    :root{
      ${(props) => {
        const { themeMode, themeOverrides } = props.theme;
        const isLightMode = themeMode === 'light';
        const bgPrimaryColor = themeOverrides?.['--pw-core-bg-primary-color'];
        const textPrimaryColor =
          themeOverrides?.['--pw-core-text-primary-color'];
        const textSecondaryColor =
          themeOverrides?.['--pw-core-text-secondary-color'];
        return `
          --pw-int-bg-primary-color: ${
            isLightMode
              ? bgPrimaryColor || '#F5F6F8'
              : bgPrimaryColor
              ? `color-mix(in srgb, ${bgPrimaryColor}, #000000 93%)`
              : '#17181B'
          };
          --pw-int-text-primary-color: ${
            isLightMode
              ? textPrimaryColor || '#17181B'
              : textPrimaryColor
              ? `color-mix(in srgb, ${textPrimaryColor}, #ffffff 95%)`
              : '#F5F6F8'
          };
          --pw-int-text-secondary-color: ${
            isLightMode
              ? textSecondaryColor || '#313338'
              : textSecondaryColor
              ? `color-mix(in srgb, ${textSecondaryColor}, #ffffff 70%)`
              : '#C4CBD5'
          };
          --pw-int-text-heading-xsmall-size: ${
            themeOverrides?.['--pw-int-text-heading-xsmall-size'] || '18px'
          };
          --pw-int-text-body-large-size: ${
            themeOverrides?.['--pw-int-text-body-large-size'] || '16px'
          };
        `;
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
    modalDefaults: {
      ...PushWalletConfigDefault.modalDefaults,
      ...config.modalDefaults,
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

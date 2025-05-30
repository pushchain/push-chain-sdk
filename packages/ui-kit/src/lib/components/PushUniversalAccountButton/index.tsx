import React, { FC, useEffect, useMemo } from 'react';
import { usePushWalletContext } from '../../hooks/usePushWallet';
import { ConnectWalletButton } from './ConnectWalletButton';
import { TogglePushWalletButton } from './TogglePushWalletButton';
import { createGlobalStyle, ThemeProvider } from 'styled-components';
import { ButtonThemeOverrides } from '../../styles/token';
import { buttonThemeDefault } from '../../styles/token';
import { mapButtonCoreToInt } from '../../utils/theme';
import { AppMetadata } from '../../types';

type PushUniversalAccountButtonProps = {
  uid?: string;
  connectButtonText?: string;
  loadingComponent?: React.ReactNode;
  modalAppOverride?: AppMetadata;
  loginAppOverride?: AppMetadata;
  themeOverrides?: ButtonThemeOverrides;
};

const PushUniversalAccountButton: FC<PushUniversalAccountButtonProps> = ({
  uid = 'default',
  connectButtonText = 'Connect Push Wallet',
  loadingComponent,
  modalAppOverride,
  loginAppOverride,
  themeOverrides: ButtonThemeOverrides,
}) => {
  const {
    universalAddress,
    themeOverrides,
    themeMode,
    updateModalAppData,
    updateWalletAppData,
  } = usePushWalletContext(uid);

  const GlobalStyle = createGlobalStyle`
    :root{
      ${(props) => {
        const { themeOverrides, themeMode } = props.theme;
        const isLightMode = themeMode === 'light';
        const { dark, light, ...globalOverrides } = themeOverrides;
        const newTokens = {
          ...buttonThemeDefault,
          ...mapButtonCoreToInt(globalOverrides),
          ...mapButtonCoreToInt(isLightMode ? light : dark),
        };
        return Object.entries(newTokens)
          .map(([key, value]) => `${key}: ${value};`)
          .join('\n');
      }}
    }
  `;

  useEffect(() => {
    if (modalAppOverride) updateModalAppData(modalAppOverride);
    if (loginAppOverride) updateWalletAppData(loginAppOverride);
  }, []);

  const Component = () => {
    if (universalAddress) {
      // Merge props with buttonDefaults, giving priority to direct props
      const toggleButtonProps = {
        uid: uid,
        universalAddress: universalAddress,
      };

      return <TogglePushWalletButton {...toggleButtonProps} />;
    } else {
      // Merge props with buttonDefaults, giving priority to direct props
      const connectButtonProps = {
        uid: uid,
        connectButtonText,
        loadingComponent,
      };

      return <ConnectWalletButton {...connectButtonProps} />;
    }
  };

  return (
    <ThemeProvider
      theme={{
        themeMode,
        themeOverrides: { ...themeOverrides, ...ButtonThemeOverrides },
      }}
    >
      <GlobalStyle />
      <Component />
    </ThemeProvider>
  );
};

export { PushUniversalAccountButton };

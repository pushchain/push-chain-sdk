/* eslint-disable @typescript-eslint/ban-ts-comment */
import React, { FC, useEffect, useMemo } from 'react';
import { usePushWalletContext } from '../../hooks/usePushWallet';
import { ConnectWalletButton } from './ConnectWalletButton';
import { TogglePushWalletButton } from './TogglePushWalletButton';
import {
  createGlobalStyle,
  DefaultTheme,
  ThemeProvider,
} from 'styled-components';
import { ButtonThemeOverrides, ThemeOverrides } from '../../styles/token';
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

interface CustomTheme extends DefaultTheme {
  themeOverrides: ThemeOverrides;
  themeMode: string;
}

const GlobalStyle = createGlobalStyle<{ uid: string }>`
  [data-pw-wrapper='${(props) => props.uid}']{
    ${(props) => {
      const { themeOverrides, themeMode } = props.theme as CustomTheme;
      const isLightMode = themeMode === 'light';
      const { dark, light, ...globalOverrides } = themeOverrides;
      const newTokens = {
        ...mapButtonCoreToInt(globalOverrides),
        ...mapButtonCoreToInt((isLightMode ? light : dark) ?? {}),
      };
      return Object.entries(newTokens)
        .map(([key, value]) => `${key}: ${value};`)
        .join('\n');
    }}
  }
`;

const PushUniversalAccountButton: FC<PushUniversalAccountButtonProps> = ({
  uid = 'default',
  connectButtonText = 'Connect Account',
  loadingComponent,
  modalAppOverride,
  loginAppOverride,
  themeOverrides: ButtonThemeOverrides,
}) => {
  const {
    universalAccount,
    themeOverrides,
    themeMode,
    updateModalAppData,
    updateWalletAppData,
  } = usePushWalletContext(uid);

  useEffect(() => {
    if (modalAppOverride) updateModalAppData(modalAppOverride);
    if (loginAppOverride) updateWalletAppData(loginAppOverride);
  }, []);

  const Component = () => {
    if (universalAccount) {
      // Merge props with buttonDefaults, giving priority to direct props
      const toggleButtonProps = {
        uid: uid,
        universalAccount: universalAccount,
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
      <GlobalStyle uid={uid} />
      <Component />
    </ThemeProvider>
  );
};

export { PushUniversalAccountButton };

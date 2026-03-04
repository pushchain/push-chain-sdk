/* eslint-disable @typescript-eslint/ban-ts-comment */
import React, { FC, useEffect, useMemo } from 'react';
import { usePushWalletContext } from '../../hooks/usePushWallet';
import { ConnectPushWalletButtonProps, ConnectWalletButton } from './ConnectWalletButton';
import { TogglePushWalletButton, TogglePushWalletButtonProps } from './TogglePushWalletButton';
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
  customConnectComponent?: React.ReactNode;
  customConnectedComponent?: React.ReactNode;
  connectButtonClassName?: string;
  connectedButtonClassName?: string;
};

interface CustomTheme extends DefaultTheme {
  themeOverrides: ThemeOverrides;
  themeMode: string;
}

const buildButtonCssVars = (themeMode: string, themeOverrides: ThemeOverrides) => {
  const isLightMode = themeMode === 'light';
  const { dark, light, ...globalOverrides } = themeOverrides;

  const newTokens = {
    ...mapButtonCoreToInt(globalOverrides),
    ...mapButtonCoreToInt((isLightMode ? light : dark) ?? {}),
  };

  const cssVars: Record<string, string> = {};
  for (const [key, value] of Object.entries(newTokens)) {
    if (value !== undefined && value !== null && value !== '') {
      cssVars[key] = String(value);
    }
  }

  return cssVars;
};

const PushUniversalAccountButton: FC<PushUniversalAccountButtonProps> = ({
  uid = 'default',
  connectButtonText = 'Connect Account',
  loadingComponent,
  modalAppOverride,
  loginAppOverride,
  themeOverrides: ButtonThemeOverrides,
  connectButtonClassName,
  connectedButtonClassName,
  customConnectComponent,
  customConnectedComponent,
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

  const mergedButtonOverrides = useMemo(
    () => ({ ...themeOverrides, ...ButtonThemeOverrides }),
    [themeOverrides, ButtonThemeOverrides]
  );

  const wrapperStyle = useMemo(
    () => buildButtonCssVars(themeMode, mergedButtonOverrides as unknown as ThemeOverrides),
    [themeMode, mergedButtonOverrides]
  );

  const Component = () => {
    if (universalAccount) {
      // Merge props with buttonDefaults, giving priority to direct props
      const toggleButtonProps: TogglePushWalletButtonProps = {
        uid: uid,
        universalAccount: universalAccount,
        style: wrapperStyle,
        className: connectedButtonClassName,
        customComponent: customConnectedComponent,
      };

      return <TogglePushWalletButton {...toggleButtonProps} />;
    } else {
      // Merge props with buttonDefaults, giving priority to direct props
      const connectButtonProps: ConnectPushWalletButtonProps = {
        uid: uid,
        connectButtonText,
        loadingComponent,
        style: wrapperStyle,
        className: connectButtonClassName,
        customComponent: customConnectComponent,
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
      <Component />
    </ThemeProvider>
  );
};

export { PushUniversalAccountButton };

import React, { FC, useEffect, useMemo } from 'react';
import { usePushWalletContext } from '../../hooks/usePushWallet';
import { ConnectWalletButton } from './ConnectWalletButton';
import { TogglePushWalletButton } from './TogglePushWalletButton';
import {
  loginAppOverrides,
  modalAppOverrides,
} from '../../types/UniversalWallet.types';
import { createGlobalStyle, ThemeProvider } from 'styled-components';
import { ButtonThemeOverrides } from '../../styles/token';

type PushUniversalAccountButtonProps = {
  uid?: string;

  connectButtonText?: string;
  connectButtonStyle?: React.CSSProperties;
  connectButtonCustom?: React.ReactNode;

  loadingComponent?: React.ReactNode;

  connectedButtonStyle?: React.CSSProperties;
  connectedButtonCustom?: React.ReactNode;

  modalAppOverride?: modalAppOverrides;

  loginAppOverride?: loginAppOverrides;

  themeOverrides?: ButtonThemeOverrides;
};

const PushUniversalAccountButton: FC<PushUniversalAccountButtonProps> = ({
  uid = 'default',
  connectButtonText = 'Connect Push Wallet',
  connectButtonStyle,
  connectButtonCustom,
  loadingComponent,
  connectedButtonStyle,
  connectedButtonCustom,
  modalAppOverride,
  loginAppOverride,
  themeOverrides: ButtonThemeOverrides,
}) => {
  const {
    universalAddress,
    config,
    themeOverrides,
    updateModalAppData,
    updateWalletAppData,
  } = usePushWalletContext(uid);

  const { buttonDefaults } = config;

  const GlobalStyle = createGlobalStyle`
    :root{
      ${(props) => {
        const { themeOverrides } = props.theme;
        return `
          --pwauth-btn-connect-text-color: ${
            themeOverrides['--pwauth-btn-connect-text-color'] || '#FFF'
          };
          --pwauth-btn-connect-bg-color: ${
            themeOverrides['--pwauth-btn-connect-text-color'] || '#D548EC'
          };
          --pwauth-btn-connected-text-color: ${
            themeOverrides['--pwauth-btn-connect-text-color'] || '#FFF'
          };
          --pwauth-btn-connected-bg-color: ${
            themeOverrides['--pwauth-btn-connect-text-color'] || '#000'
          };
          --pwauth-btn-connect-border-radius: ${
            themeOverrides['--pwauth-btn-connect-text-color'] || '12px'
          };
        `;
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
        connectedButtonStyle:
          connectedButtonStyle || buttonDefaults?.connectedButtonStyle,
        connectedButtonCustom,
      };

      return <TogglePushWalletButton {...toggleButtonProps} />;
    } else {
      // Merge props with buttonDefaults, giving priority to direct props
      const connectButtonProps = {
        uid: uid,
        connectButtonText:
          connectButtonText || buttonDefaults?.connectButtonText,
        connectButtonStyle:
          connectButtonStyle || buttonDefaults?.connectButtonStyle,
        connectButtonCustom,
        loadingComponent,
      };

      return <ConnectWalletButton {...connectButtonProps} />;
    }
  };

  return (
    <ThemeProvider
      theme={{ themeOverrides: { ...themeOverrides, ...ButtonThemeOverrides } }}
    >
      <GlobalStyle />
      <Component />
    </ThemeProvider>
  );
};

export { PushUniversalAccountButton };

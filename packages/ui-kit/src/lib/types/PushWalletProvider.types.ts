import { CONSTANTS } from '../constants';
import { ThemeOverrides } from '../styles/token';

export type LoginMethodConfig = {
  email?: boolean;
  google?: boolean;
  wallet?: {
    enabled?: boolean;
    chains?: (typeof CONSTANTS.CHAIN)[keyof typeof CONSTANTS.CHAIN][];
  };
  appPreview?: boolean;
};

export type ProviderConfigProps = {
  uid?: string;
  env: (typeof CONSTANTS.ENV)[keyof typeof CONSTANTS.ENV];
  rpcURL?: string;
  login?: LoginMethodConfig;
  buttonDefaults?: ButtonDefaultsProps;
  modalDefaults?: ModalDefaultsProps;
};

export type AppMetadata = {
  title: string;
  logoUrl?: string;
  description?: string;
};

export type ButtonDefaultsProps = {
  /** “Connect” button text when disconnected */
  connectButtonText?: string;
  /** inline style overrides for the “Connect” button */
  connectButtonStyle?: React.CSSProperties;
  /** custom node to show while connecting */
  loadingComponent?: React.ReactNode;
  /** inline style overrides for the connected‐state button */
  connectedButtonStyle?: React.CSSProperties;
  /** when connected, how the account menu appears */
  accountMenuVariant?: 'full' | 'hover';
};

export type ModalDefaultsProps = {
  /**
   * “split” shows the preview pane side-by-side with the iframe
   * “simple” shows only the iframe (no preview)
   */
  loginLayout?: typeof CONSTANTS.LOGIN.SPLIT | typeof CONSTANTS.LOGIN.SIMPLE;
  /** if true (and `app` is provided), show the preview pane in the wrapper */
  showModalAppPreview?: boolean;
  /** CSS background-image for wrapper or preview pane */
  bgImage?: string;
};

export type PushWalletProviderProps = {
  children: React.ReactNode;
  config: ProviderConfigProps;
  app?: AppMetadata;
  themeMode?: typeof CONSTANTS.THEME.LIGHT | typeof CONSTANTS.THEME.DARK;
  themeOverrides?: ThemeOverrides;
};

// Dapp details that display in the preview pane
export type ModalAppDetails = {
  logoURL?: string;
  title?: string;
  description?: string;
};

// Dapp details that goes to the wallet
export type WalletAppDetails = {
  logoURL?: string;
  title?: string;
  description?: string;
};

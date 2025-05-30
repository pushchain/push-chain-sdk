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
  modal?: ModalProps;
};

export type AppMetadata = {
  title?: string;
  logoUrl?: string;
  description?: string;
};

export type ModalProps = {
  /**
   * “split” shows the preview pane side-by-side with the iframe
   * “simple” shows only the iframe (no preview)
   */
  loginLayout?: typeof CONSTANTS.LOGIN.SPLIT | typeof CONSTANTS.LOGIN.SIMPLE;
  /** if true (and `app` is provided), show the preview pane in the wrapper */
  appPreview?: boolean;
  /** CSS background-image for wrapper or preview pane */
  bgImage?: string;
  /** when connected, how the account menu appears */
  connectedLayout?:
    | typeof CONSTANTS.CONNECTED.FULL
    | typeof CONSTANTS.CONNECTED.HOVER;
};

export type ThemeMode =
  | typeof CONSTANTS.THEME.LIGHT
  | typeof CONSTANTS.THEME.DARK;

export type PushWalletProviderProps = {
  children: React.ReactNode;
  config: ProviderConfigProps;
  app?: AppMetadata;
  themeMode?: ThemeMode;
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

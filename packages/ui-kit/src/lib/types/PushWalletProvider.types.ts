import { CHAIN, PUSH_NETWORK } from '@pushchain/core/src/lib/constants/enums';
import { PushUI } from '../constants';
import { ThemeOverrides } from '../styles/token';

export type LoginMethodConfig = {
  email?: boolean;
  google?: boolean;
  wallet?: {
    enabled?: boolean;
    chains?: (typeof PushUI.CONSTANTS.CHAIN)[keyof typeof PushUI.CONSTANTS.CHAIN][];
  };
  appPreview?: boolean;
};

export type ChainConfig = {
  rpcUrls?: Partial<Record<CHAIN, string[]>>;
  blockExplorers?: Partial<Record<CHAIN, string[]>>;
  printTraces?: boolean;
};

export type ProviderConfigProps = {
  uid?: string;
  network: PUSH_NETWORK;
  rpcUrl?: string;
  login?: LoginMethodConfig;
  modal?: ModalProps;
  chainConfig?: ChainConfig;
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
  loginLayout?:
    | typeof PushUI.CONSTANTS.LOGIN.LAYOUT.SPLIT
    | typeof PushUI.CONSTANTS.LOGIN.LAYOUT.SIMPLE;
  /** if true (and `app` is provided), show the preview pane in the wrapper */
  appPreview?: boolean;
  /** CSS background-image for wrapper or preview pane */
  bgImage?: string;
  /** when connected, how the account menu appears */
  connectedLayout?:
    | typeof PushUI.CONSTANTS.CONNECTED.LAYOUT.FULL
    | typeof PushUI.CONSTANTS.CONNECTED.LAYOUT.HOVER;
  connectedInteraction?:
    | typeof PushUI.CONSTANTS.CONNECTED.INTERACTION.INTERACTIVE
    | typeof PushUI.CONSTANTS.CONNECTED.INTERACTION.BLUR;
};

export type ThemeMode =
  | typeof PushUI.CONSTANTS.THEME.LIGHT
  | typeof PushUI.CONSTANTS.THEME.DARK;

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

type ColorThemeTokens = {
  // Brand Colors
  '--pw-core-brand-primary-color': string;

  // Text Colors
  '--pw-core-text-primary-color': string;
  '--pw-core-text-secondary-color': string;
  '--pw-core-text-tertiary-color': string;
  '--pw-core-text-link-color': string;
  '--pw-core-text-disabled-color': string;

  // Background Colors & Filter
  '--pw-core-bg-primary-color': string;
  '--pw-core-bg-secondary-color': string;
  '--pw-core-bg-tertiary-color': string;
  '--pw-core-bg-disabled-color': string;

  // State Colors
  '--pw-core-success-primary-color': string;
  '--pw-core-error-primary-color': string;

  // Button
  '--pw-core-btn-primary-bg-color': string;
  '--pw-core-btn-primary-text-color': string;

  // Push Universal Account Button
  '--pwauth-btn-connect-text-color': string;
  '--pwauth-btn-connect-bg-color': string;
  '--pwauth-btn-connected-text-color': string;
  '--pwauth-btn-connected-bg-color': string;
  '--pwauth-btn-connect-border-radius': string;
};

type ThemeTokens = ColorThemeTokens & {
  // Typography
  '--pw-core-font-family': string;
  '--pw-core-text-size': string;

  // Sizing & Spacing
  '--pw-core-modal-border': string;
  '--pw-core-modal-border-radius': string;
  '--pw-core-modal-width': string;
  '--pw-core-modal-padding': string;
  '--pw-core-list-spacing': string;
  '--pw-core-btn-border-radius': string;

  // Push Universal Account Button
  '--pwauth-btn-connect-border-radius': string;
};

type ButtonColorTokens = {
  // Push Universal Account Button
  '--pwauth-btn-connect-text-color': string;
  '--pwauth-btn-connect-bg-color': string;
  '--pwauth-btn-connected-text-color': string;
  '--pwauth-btn-connected-bg-color': string;
};

type ButtonThemeTokens = ButtonColorTokens & {
  // Push Universal Account Button
  '--pwauth-btn-connect-border-radius': string;
};

export type ThemeOverrides = Partial<ThemeTokens> & {
  light?: Partial<ColorThemeTokens>;
  dark?: Partial<ColorThemeTokens>;
};

export type ButtonThemeOverrides = Partial<ButtonThemeTokens> & {
  light?: Partial<ButtonColorTokens>;
  dark?: Partial<ButtonColorTokens>;
};

export const themeDefault = {
  '--pw-int-text-heading-xsmall-size': '18px',
  '--pw-int-text-body-large-size': '16px',
  '--pw-int-font-family': '"Inter", sans-serif',
};

export const lightThemeDefault = {
  '--pw-int-bg-primary-color': '#F5F6F8',
  '--pw-int-text-primary-color': '#17181B',
  '--pw-int-text-secondary-color': '#313338',
  '--pw-int-brand-primary-color': '#CF59E2',
};

export const darkThemeDefault = {
  '--pw-int-bg-primary-color': '#17181B',
  '--pw-int-text-primary-color': '#F5F6F8',
  '--pw-int-text-secondary-color': '#C4CBD5',
  '--pw-int-brand-primary-color': '#D548EC',
};

export const buttonThemeDefault = {
  '--pwauth-btn-connect-text-color': '#FFF',
  '--pwauth-btn-connect-bg-color': '#D548EC',
  '--pwauth-btn-connected-text-color': '#FFF',
  '--pwauth-btn-connected-bg-color': '#000',
  '--pwauth-btn-connect-border-radius': '12px',
  '--pw-int-font-family': '"Inter", sans-serif',
};

export const defaultThemeKeys = Object.keys({
  ...themeDefault,
  ...lightThemeDefault,
});

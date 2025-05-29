// design tokens: light/dark palettes

export const themeTokens = {
  // Typography
  '--pw-core-font-family': 'inherit, Arial, sans-serif',
  '--pw-core-text-size': '1.625rem',

  // Brand Colors
  '--pw-core-brand-primary-color': '#D548EC',

  // Text Colors
  '--pw-core-text-primary-color': '#17181B',
  '--pw-core-text-secondary-color': '#313338',
  '--pw-core-text-tertiary-color': '#8C93A0',
  '--pw-core-text-link-color': '#C742DD',
  '--pw-core-text-disabled-color': '#B0B3B9',

  // Background Colors & Filter
  '--pw-core-bg-primary-color': '#FFFFFF',
  '--pw-core-bg-secondary-color': '#F5F6F8',
  '--pw-core-bg-tertiary-color': '#EAEBF2',
  '--pw-core-bg-disabled-color': '#EAEBF2',

  // State Colors
  '--pw-core-success-primary-color': '#00A47F',
  '--pw-core-error-primary-color': '#F11F1F',

  // Button
  '--pw-core-btn-primary-bg-color': '#D548EC',
  '--pw-core-btn-primary-text-color': '#FFFFFF',

  // Sizing & Spacing
  '--pw-core-modal-border': '2px',
  '--pw-core-modal-border-radius': '24px',
  '--pw-core-modal-width': '376px',
  '--pw-core-modal-padding': '24px',
  '--pw-core-list-spacing': '12px',
  '--pw-core-btn-border-radius': '12px',

  // Push Universal Account Button
  '--pwauth-btn-connect-text-color': '#FFF',
  '--pwauth-btn-connect-bg-color': '#D548EC',
  '--pwauth-btn-connected-text-color': '#FFF',
  '--pwauth-btn-connected-bg-color': '#000',
  '--pwauth-btn-connect-border-radius': '12px',
};

export const buttonThemeTokens = {
  // Push Universal Account Button
  '--pwauth-btn-connect-text-color': '#FFF',
  '--pwauth-btn-connect-bg-color': '#D548EC',
  '--pwauth-btn-connected-text-color': '#FFF',
  '--pwauth-btn-connected-bg-color': '#000',
  '--pwauth-btn-connect-border-radius': '12px',
};

type ThemeTokenKey = keyof typeof themeTokens;
type ButtonThemeTokenKey = keyof typeof buttonThemeTokens;

export type ThemeOverrides = {
  [K in ThemeTokenKey]?: string;
};

export type ButtonThemeOverrides = {
  [K in ButtonThemeTokenKey]?: string;
};

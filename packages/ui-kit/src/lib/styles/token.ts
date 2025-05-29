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

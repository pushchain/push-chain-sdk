export const themeDefault = {
  '--pw-int-text-heading-xsmall-size': '18px',
  '--pw-int-text-body-large-size': '16px',
};

export const lightThemeDefault = {
  '--pw-int-bg-primary-color': '#F5F6F8',
  '--pw-int-text-primary-color': '#17181B',
  '--pw-int-text-secondary-color': '#313338',
};

export const darkThemeDefault = {
  '--pw-int-bg-primary-color': '#17181B',
  '--pw-int-text-primary-color': '#F5F6F8',
  '--pw-int-text-secondary-color': '#C4CBD5',
};

export const buttonThemeDefault = {
  '--pwauth-btn-connect-text-color': '#FFF',
  '--pwauth-btn-connect-bg-color': '#D548EC',
  '--pwauth-btn-connected-text-color': '#FFF',
  '--pwauth-btn-connected-bg-color': '#000',
  '--pwauth-btn-connect-border-radius': '12px',
};

export const defaultThemeKeys = Object.keys({
  ...themeDefault,
  ...lightThemeDefault,
});

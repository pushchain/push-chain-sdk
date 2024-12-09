import { createTheme } from './Theme.utils';

const blocksTheme = {
  light: createTheme('light'),
  dark: createTheme('dark'),
};

const themeConfig = {
  dark: {
    blocksTheme: blocksTheme.dark,
    scheme: 'dark',
  },
  light: { blocksTheme: blocksTheme.light, scheme: 'light' },
};

export { blocksTheme, themeConfig };

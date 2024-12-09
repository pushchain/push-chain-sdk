import { themeDark, themeLight } from '../config/Themization';
import { useTheme } from 'styled-components';
import { ThemeMode } from './Blocks.types';
import { Theme } from './theme/Theme.types';

// TODO: Remove this when we remove dependency from this hook

type ThemeData = {
  blocksTheme: {
    light: Theme;
    dark: Theme;
  };
  scheme: 'dark' | 'light';
};

export const useBlocksTheme = () => {
  const { scheme } = useTheme() as ThemeData;

  return { mode: scheme as ThemeMode };
};

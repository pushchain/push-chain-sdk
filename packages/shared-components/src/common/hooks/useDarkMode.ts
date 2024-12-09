import { FC } from 'react';
import { useLocalStorage } from 'usehooks-ts';

export const useDarkMode = () => {
  const [isDarkMode, setMode] = useLocalStorage('pushWalletThemeMode', true);

  return {
    isDarkMode,
    enable: () => {
      document.documentElement.setAttribute('theme', 'dark');
      setMode(true);
    },
    disable: () => {
      document.documentElement.setAttribute('theme', 'light');
      setMode(false);
    },
  };
};

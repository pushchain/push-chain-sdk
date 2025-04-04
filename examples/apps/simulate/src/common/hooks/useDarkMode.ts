import { useLocalStorage } from 'usehooks-ts';

export const useDarkMode = () => {
  const [isDarkMode, setMode] = useLocalStorage('pushWalletThemeMode', false);

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

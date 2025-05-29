import { buttonThemeDefault, defaultThemeKeys } from '../styles/token';

export const mapCoreToInt = (
  obj: Record<string, string | undefined>
): Record<string, string> => {
  const result: Record<string, string> = {};

  for (const key in obj) {
    if (key === '--pw-core-text-size') {
      const size = parseInt(obj[key] || '', 10);
      const px = (val: number) => `${Math.round(val)}px`;
      if (!isNaN(size)) {
        result['--pw-int-text-heading-xsmall-size'] = px(size * 0.7);
        result['--pw-int-text-body-large-size'] = px(size * 0.6);
      }
      continue;
    }
    const intKey = key.replace('core', 'int');
    console.log(intKey, defaultThemeKeys);
    if (defaultThemeKeys.includes(intKey)) {
      result[intKey] = obj[key] as string;
    }
  }

  return result;
};

export const mapButtonCoreToInt = (
  obj: Record<string, string | undefined>
): Record<string, string> => {
  const result: Record<string, string> = {};

  for (const key in obj) {
    if (Object.keys(buttonThemeDefault).includes(key)) {
      result[key] = obj[key] as string;
    }
  }

  return result;
};

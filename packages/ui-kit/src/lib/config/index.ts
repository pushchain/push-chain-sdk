/**
 * SUPPORTED ENVIRONEMENTS
 */
export enum ENV {
  PROD = 'prod',
  STAGING = 'staging',
  DEV = 'dev',
  LOCAL = 'local',
}

export type ConfigType = {
  WALLET_URL: {
    [ENV.PROD]: string;
    [ENV.STAGING]: string;
    [ENV.DEV]: string;
    [ENV.LOCAL]: string;
  };
};

const config: ConfigType = {
  WALLET_URL: {
    [ENV.PROD]: 'https://wallet.push.org',
    [ENV.STAGING]: 'https://wallet-alpha.push.org',
    [ENV.DEV]: 'https://wallet-alpha.push.org',
    [ENV.LOCAL]: 'http://localhost:5173',
  },
};
export default config;

import { initWaaP } from '@human.tech/waap-sdk';
import { waapInitConfig } from './waap.config';
import { LoginMethodConfig } from '../../../lib/types';

let waapInitialized = false;

export const ensureWaapInit = (isDarkMode: boolean, loginConfig: LoginMethodConfig) => {
  if (typeof window === 'undefined') return;
  if (waapInitialized) return;
  

  initWaaP(waapInitConfig(isDarkMode, loginConfig));
  waapInitialized = true;
};
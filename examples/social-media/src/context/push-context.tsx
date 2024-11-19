import { createContext } from 'react';
import { Social } from '../services/social.ts';

interface PushContextType {
  /**
   * This will have value of PUSH address if user connects with Push Wallet, else, it will have
   * user's address in partial CAIP10 format
   */
  connectedAddress: string | null;
  pushWalletLoginHandler: () => Promise<void>;
  socialSDK: Social | null;
}

export const PushContext = createContext<PushContextType | undefined>(
  undefined
);

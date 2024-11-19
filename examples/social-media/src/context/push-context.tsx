import PushNetwork from '@pushprotocol/node-core';
import { createContext } from 'react';

interface PushContextType {
  pushNetwork: PushNetwork | null;
  /**
   * This is the PUSH Address. If user connects with any wallet such as metamask, this will be `null`
   * Only set when user connects with Push Wallet.
   */
  pushAccount: string | null;
  pushWalletLoginHandler: () => Promise<void>;
}

export const PushContext = createContext<PushContextType | undefined>(
  undefined
);

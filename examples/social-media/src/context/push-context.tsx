import PushNetwork from '@pushprotocol/node-core';
import React, {createContext} from 'react';

interface PushContextType {
    pushNetwork: PushNetwork | null;
    setPushNetwork: React.Dispatch<React.SetStateAction<PushNetwork | null>>;
    /**
     * This is the PUSH Address. If user connects with any wallet such as metamask, this will be `null`
     * Only set when user connects with Push Wallet.
     */
    pushAccount: string | null;
    setPushAccount: React.Dispatch<React.SetStateAction<string | null>>;
}

export const PushContext = createContext<PushContextType | undefined>(undefined);

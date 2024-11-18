import PushNetwork from '@pushprotocol/node-core';
import {ENV} from '@pushprotocol/node-core/src/lib/constants';
import {PushContext} from "../context/push-context.tsx";
import {ReactNode, useEffect, useState} from 'react';

export function PushProvider({children}: { children: ReactNode }) {
    const [pushNetwork, setPushNetwork] = useState<PushNetwork | null>(null);
    const [pushAccount, setPushAccount] = useState<string | null>(null);

    useEffect(() => {
        (async () => {
            try {
                const pushNetworkInstance = await PushNetwork.initialize(ENV.DEV);
                setPushNetwork(pushNetworkInstance);
            } catch (error) {
                console.error('Error initializing Push Network:', error);
            }
        })();
    }, []);

    return (
        <PushContext.Provider
            value={{
                pushNetwork,
                setPushNetwork,
                pushAccount,
                setPushAccount,
            }}
        >
            {children}
        </PushContext.Provider>
    );
}

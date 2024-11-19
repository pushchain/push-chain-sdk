import PushNetwork from '@pushprotocol/node-core';
import {ENV} from '@pushprotocol/node-core/src/lib/constants';
import {PushContext} from "../context/push-context.tsx";
import {ReactNode, useEffect, useState} from 'react';
import {toBytes} from "viem";

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

    async function pushWalletLoginHandler(): Promise<void> {
        try {
            if (pushNetwork) {
                const acc = await pushNetwork.wallet.connect();
                // Allow Connection only when DApp is whitelisted
                await pushNetwork.wallet.sign(
                    toBytes('Accept Connection Request From DApp')
                );
                console.log('Connected account: ', acc);
                setPushAccount(acc);
            }
        } catch (err) {
            alert(err);
        }
    }

    return (
        <PushContext.Provider
            value={{
                pushNetwork,
                pushAccount,
                pushWalletLoginHandler
            }}
        >
            {children}
        </PushContext.Provider>
    );
}

import React, { FC } from 'react';
import { PushWalletProviderProps } from "../types/index"
import { WalletContextProvider } from "../context/WalletContext"

export const PushWalletProvider: FC<PushWalletProviderProps> = ({
    config,
    app,
    themeMode,
    themeOverrides,
    buttonDefaults,
    modalDefaults,
    children
}) => {
    return (
        <WalletContextProvider
            config={config}
            app={app}
            buttonDefaults={buttonDefaults}
            modalDefaults={modalDefaults}
            themeMode={themeMode}
            themeOverrides={themeOverrides}
        >
            {children}
        </WalletContextProvider>
    );
};
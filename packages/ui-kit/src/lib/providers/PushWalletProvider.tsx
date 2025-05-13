import React, { FC } from 'react';
import { PushWalletProviderConfig, PushWalletProviderProps } from "../types/index"
import { WalletContextProvider } from "../context/WalletContext"
import { CONSTANTS } from '../constants';

const loginDefaultConfig = {
    email: true,
    google: true,
    wallet: {
        enabled: true,
    }
};

const PushWalletConfigDefault: PushWalletProviderConfig = {
    login: loginDefaultConfig,
    env: CONSTANTS.ENV.DEVNET,
};

export const PushWalletProvider: FC<PushWalletProviderProps> = ({
    config,
    app,
    themeMode = CONSTANTS.THEME.DARK,
    themeOverrides,
    buttonDefaults,
    modalDefaults,
    children
}) => {
    const mergedConfig: PushWalletProviderConfig = {
        ...PushWalletConfigDefault,
        ...config,
        login: {
            ...loginDefaultConfig,
            ...(config?.login || {}),
            wallet: {
                ...loginDefaultConfig.wallet,
                ...(config?.login?.wallet || {})
            }
        }
    };

    return (
        <WalletContextProvider
            config={mergedConfig}
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
import React, { FC } from 'react';
import { usePushWalletContext } from "../../hooks/usePushWallet";
import { ConnectWalletButton } from "./ConnectWalletButton";
import { TogglePushWalletButton } from "./TogglePushWalletButton"
import { loginAppOverrides, modalAppOverrides } from '../../types/UniversalWallet.types';

type PushUniversalAccountButtonProps = {
    uid?: string;

    connectButtonText?: string;
    connectBgColor?: string;
    connectButtonTextColor?: string;
    connectButtonStyle?: React.CSSProperties;

    connectButtonCustom?: React.ReactNode

    loadingComponent?: React.ReactNode

    connectedButtonBgColor?: string
    connectedButtonTextColor?: string
    connectedButtonStyle?: React.CSSProperties;

    connectedButtonCustom?: React.ReactNode

    modalAppOverride?: modalAppOverrides
    loginAppOverride?: loginAppOverrides
}

const PushUniversalAccountButton: FC<PushUniversalAccountButtonProps> = ({
    uid,
    connectButtonText = 'Connect Push Wallet',
    connectBgColor,
    connectButtonTextColor,
    connectButtonStyle,
    connectButtonCustom,
    loadingComponent,
    connectedButtonBgColor,
    connectedButtonTextColor,
    connectedButtonStyle,
    connectedButtonCustom,
    modalAppOverride,
    loginAppOverride
}) => {
    const { universalAddress, buttonDefaults } = usePushWalletContext();

    if (universalAddress) {
        // Merge props with buttonDefaults, giving priority to direct props
        const toggleButtonProps = {
            universalAddress: universalAddress,
            connectedButtonBgColor: connectedButtonBgColor || buttonDefaults?.connectedButtonBgColor,
            connectedButtonTextColor: connectedButtonTextColor || buttonDefaults?.connectedButtonTextColor,
            connectedButtonStyle: connectedButtonStyle || buttonDefaults?.connectedButtonStyle,
            connectedButtonCustom,
        };

        return <TogglePushWalletButton {...toggleButtonProps} />;
    } else {
        // Merge props with buttonDefaults, giving priority to direct props
        const connectButtonProps = {
            connectButtonText: connectButtonText || buttonDefaults?.connectButtonText,
            connectBgColor: connectBgColor || buttonDefaults?.connectButtonBgColor,
            connectButtonTextColor: connectButtonTextColor || buttonDefaults?.connectButtonTextColor,
            connectButtonStyle: connectButtonStyle || buttonDefaults?.connectButtonStyle,
            connectButtonCustom,
            loadingComponent
        };

        return <ConnectWalletButton {...connectButtonProps} />;
    }
};

export { PushUniversalAccountButton };
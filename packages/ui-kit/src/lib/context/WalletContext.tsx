import React, { createContext, FC, useEffect, useRef, useState } from 'react';
import { ConnectionStatus, PushWalletProviderProps, UniversalAddress } from '../types';
import { WALLET_TO_APP_ACTION } from '../constants';
import { PushWalletIFrame } from "../components/PushWalletIframe"

export type WalletContextType = {
    universalAddress: UniversalAddress | null;
    connectionStatus: ConnectionStatus;
    iframeRef: React.MutableRefObject<HTMLIFrameElement | null>;
    isWalletVisible: boolean;
    isWalletMinimised: boolean;
    isIframeLoading: boolean;
    setIframeLoading: (isIframeLoading: boolean) => void;
    setMinimiseWallet: (isWalletMinimised: boolean) => void;
    handleConnectToPushWallet: () => void;
    handleUserLogOutEvent: () => void;
    config: PushWalletProviderProps['config'];
    app?: PushWalletProviderProps['app'];
    buttonDefaults?: PushWalletProviderProps['buttonDefaults'];
    modalDefaults?: PushWalletProviderProps['modalDefaults'];
}

export const WalletContext = createContext<WalletContextType | null>(null);

export const WalletContextProvider: FC<PushWalletProviderProps> = ({
    children,
    config,
    app,
    buttonDefaults,
    modalDefaults
}) => {

    const [universalAddress, setUniversalAddress] =
        useState<WalletContextType['universalAddress']>(null);

    const iframeRef = useRef<HTMLIFrameElement | null>(null);
    const [isWalletVisible, setWalletVisibility] = useState(false); // to display the iframe as connect button is clicked

    const [isWalletMinimised, setMinimiseWallet] = useState(false); // to display/hide minimized wallet modal

    const [isIframeLoading, setIframeLoading] = useState(true);

    const [connectionStatus, setConnectionStatus] =
        useState<WalletContextType['connectionStatus']>('notConnected');

    const handleConnectToPushWallet = () => {
        setWalletVisibility(true);
        setConnectionStatus('connecting');
    };

    const handleUserLogOutEvent = () => {
        setConnectionStatus('notConnected');
        setUniversalAddress(null);
        setMinimiseWallet(false);
        setWalletVisibility(false);
    };


    useEffect(() => {
        const messageHandler = (event: MessageEvent) => {
            switch (event.data.type) {
                case WALLET_TO_APP_ACTION.CONNECT_EXTERNAL_WALLET:
                    //   handleExternalWalletConnection(event.data.data);
                    break;
                case WALLET_TO_APP_ACTION.IS_LOGGED_IN:
                    console.log("wallet connected successfully", event.data);
                    //   handleIsLoggedInAction();
                    break;
                case WALLET_TO_APP_ACTION.APP_CONNECTION_SUCCESS:
                    //   handleAppConnectionSuccess(event.data.data);
                    break;
                case WALLET_TO_APP_ACTION.APP_CONNECTION_REJECTED:
                    //   handleAppConnectionRejection();
                    break;
                case WALLET_TO_APP_ACTION.SIGNATURE:
                    //   if (signatureResolverRef.current) {
                    // signatureResolverRef?.current?.success?.(event.data.data);
                    //   }
                    break;
                case WALLET_TO_APP_ACTION.IS_LOGGED_OUT:
                    //   handleUserLogOutEvent();
                    break;
                case WALLET_TO_APP_ACTION.ERROR:
                    //   signatureResolverRef?.current?.error?.(event.data.data);
                    break;
                default:
                    console.warn('Unknown message type:', event.data.type);
            }
        };

        window.addEventListener('message', messageHandler);

        return () => window.removeEventListener('message', messageHandler);
    }, []);

    return (
        <WalletContext.Provider value={{
            app,
            config,
            iframeRef,
            connectionStatus,
            universalAddress,
            isWalletVisible,
            isWalletMinimised,
            buttonDefaults,
            modalDefaults,
            isIframeLoading,
            setIframeLoading,
            setMinimiseWallet,
            handleConnectToPushWallet,
            handleUserLogOutEvent,
        }}>
            <PushWalletIFrame />
            {children}
        </WalletContext.Provider>
    )
}
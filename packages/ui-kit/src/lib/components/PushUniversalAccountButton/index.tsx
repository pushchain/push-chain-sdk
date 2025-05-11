import React, { FC } from 'react';
import { usePushWalletContext } from "../../hooks/usePushWallet";
import Button from '../common/Button';
import styled from 'styled-components';
import { Spinner } from '../common';

type PushUniversalAccountButtonProps = {
    title?: string;
}

const PushUniversalAccountButton: FC<PushUniversalAccountButtonProps> = ({
    title = 'Connect Push Wallet'
}) => {

    const {
        connectionStatus,
        handleConnectToPushWallet,
    } = usePushWalletContext();

    const isConnectButtonDisbaled =
        connectionStatus === 'connected' ||
        connectionStatus === 'authenticating' ||
        connectionStatus === 'connecting';

    const isLoading =
        connectionStatus === 'connecting' || connectionStatus === 'authenticating';

    const handleConnectWalletButton = () => handleConnectToPushWallet();

    return (
        <>
            <Button
                onClick={handleConnectWalletButton}
                disabled={isConnectButtonDisbaled || isLoading}
            >
                {connectionStatus === 'notConnected' ? title : connectionStatus}
                {isLoading && (<SpinnerContainer><Spinner /></SpinnerContainer>)}
            </Button>
        </>
    );
};

export { PushUniversalAccountButton };

const SpinnerContainer = styled.div`
  padding: 4px;
`;

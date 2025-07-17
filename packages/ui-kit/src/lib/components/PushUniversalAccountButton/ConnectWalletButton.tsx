import React, { FC } from 'react';
import styled from 'styled-components';
import { usePushWalletContext } from '../../hooks/usePushWallet';
import { Button, Spinner } from '../common';
import { PushUI } from '../../constants';

export type ConnectPushWalletButtonProps = {
  uid?: string;
  connectButtonText?: string;
  loadingComponent?: React.ReactNode;
};

const ConnectWalletButton: FC<ConnectPushWalletButtonProps> = ({
  uid,
  connectButtonText,
  loadingComponent,
}) => {
  const { connectionStatus, handleConnectToPushWallet } =
    usePushWalletContext(uid);

  const isConnectButtonDisbaled =
    connectionStatus === PushUI.CONSTANTS.CONNECTION.STATUS.CONNECTED ||
    connectionStatus === PushUI.CONSTANTS.CONNECTION.STATUS.AUTHENTICATING ||
    connectionStatus === PushUI.CONSTANTS.CONNECTION.STATUS.CONNECTING;

  const isLoading =
    connectionStatus === PushUI.CONSTANTS.CONNECTION.STATUS.CONNECTING ||
    connectionStatus === PushUI.CONSTANTS.CONNECTION.STATUS.AUTHENTICATING;

  const capitalize = (word: string): string => {
    if (!word) return '';
    return word.charAt(0).toUpperCase() + word.slice(1);
  }

  const handleConnectWalletButton = () => handleConnectToPushWallet();

  return (
    <Button
      bgColor="var(--pwauth-btn-connect-bg-color)"
      textColor="var(--pwauth-btn-connect-text-color)"
      borderRadius="var(--pwauth-btn-connect-border-radius)"
      onClick={handleConnectWalletButton}
      disabled={isConnectButtonDisbaled || isLoading}
    >
      {connectionStatus === PushUI.CONSTANTS.CONNECTION.STATUS.NOT_CONNECTED
        ? connectButtonText
        : isLoading
          ? loadingComponent
            ? loadingComponent
            : <>
                {capitalize(connectionStatus)}
                <SpinnerContainer>
                  <Spinner />
                </SpinnerContainer>
              </>
          : capitalize(connectionStatus)}
    </Button>
  );
};

export { ConnectWalletButton };

const SpinnerContainer = styled.div`
  padding: 0px 4px;
`;

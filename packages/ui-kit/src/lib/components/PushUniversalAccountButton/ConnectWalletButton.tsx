import React, { FC } from 'react';
import styled from 'styled-components';
import { usePushWalletContext } from '../../hooks/usePushWallet';
import { Button, Spinner } from '../common';

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
    connectionStatus === 'connected' ||
    connectionStatus === 'authenticating' ||
    connectionStatus === 'connecting';

  let status = 'connecting';

  const isLoading =
    status === 'connecting' || status === 'authenticating';

  console.log(isLoading);

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
      // onClick={handleConnectWalletButton}
      disabled={isConnectButtonDisbaled || isLoading}
    >
      {status === 'notConnected'
        ? connectButtonText
        : isLoading
          ? loadingComponent
            ? loadingComponent
            : <>
                {capitalize(status)}
                <SpinnerContainer>
                  <Spinner />
                </SpinnerContainer>
              </>
          : capitalize(status)}
    </Button>
  );
};

export { ConnectWalletButton };

const SpinnerContainer = styled.div`
  padding: 0px 4px;
`;

import { FC } from 'react';
import { usePushWalletContext } from './PushWalletProvider';
import { walletConnectionButtonStatusMapper } from '../wallet.constants';
import styled from 'styled-components'
import { Spinner } from '../../common';

export type ConnectPushWalletButtonProps = {
  showLogOutButton?: boolean;
};

const ConnectPushWalletButton: FC<ConnectPushWalletButtonProps> = () => {
  const {
    connectionStatus,
    handleConnectToPushWallet,
    handleNewConnectionRequest,
  } = usePushWalletContext();

  const isConnectButtonDisbaled =
    connectionStatus === 'connected' ||
    connectionStatus === 'authenticating' ||
    connectionStatus === 'connecting';

  const isLoading =
    connectionStatus === 'connecting' || connectionStatus === 'authenticating';

  const handleConnectWalletButton = () => {
    connectionStatus === 'retry'
      ? handleNewConnectionRequest()
      : handleConnectToPushWallet();
  };

  return (
    <>
      <ConnectButton
        onClick={handleConnectWalletButton}
        disabled={isConnectButtonDisbaled || isLoading}
      >
        {walletConnectionButtonStatusMapper[connectionStatus]}
        {isLoading && (<SpinnerContainer><Spinner /></SpinnerContainer>)}
      </ConnectButton>
    </>
  );
};

export { ConnectPushWalletButton };

const ConnectButton = styled.button`
    align-items: center;
    cursor: pointer;
    display: flex;
    justify-content: center;
    white-space: nowrap;
    flex-shrink: 0;
    border: none;
    background-color: #D548EC;
    color: rgba(255,255,255,1);
    border-radius: 12px;
    gap: 4px;
    height: 48px;
    padding: 16px 24px;
    min-width: 100px;
    leading-trim: both;
    text-edge: cap;
    font-family:FK Grotesk Neu;
    font-size: 16px;
    font-style: normal;
    font-weight: 500;
    line-height: 16px;
    width:inherit;

`
const SpinnerContainer = styled.div`
  padding:5px;
`
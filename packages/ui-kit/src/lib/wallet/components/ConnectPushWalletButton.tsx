import { FC } from 'react';
import { usePushWalletContext } from './WalletProvider';
import { walletConnectionButtonStatusMapper } from '../wallet.constants';
import { Button } from 'shared-components';

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
    <Button
      block
      onClick={handleConnectWalletButton}
      disabled={isConnectButtonDisbaled}
      loading={isLoading}
    >
      {walletConnectionButtonStatusMapper[connectionStatus]}
    </Button>
  );
};

export { ConnectPushWalletButton };

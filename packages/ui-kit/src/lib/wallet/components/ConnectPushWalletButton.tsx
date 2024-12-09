import { FC } from 'react';
import { usePushWalletContext } from './WalletProvider';
import { walletConnectionButtonStatusMapper } from '../wallet.constants';

export type ConnectPushWalletButtonProps = {
  showLogOutButton?: boolean;
};

const ConnectPushWalletButton: FC<ConnectPushWalletButtonProps> = () => {
  const { connectionStatus, handleConnectToPushWallet, handleNewConnectionRequest } =
    usePushWalletContext();

  const isConnectButtonDisbaled =
    connectionStatus === 'connected' ||
    connectionStatus === 'authenticating' ||
    connectionStatus === 'connecting';

  const isLoading =
    connectionStatus === 'connecting' || connectionStatus === 'authenticating';

  const handleConnectWalletButton = () => {
    connectionStatus === 'retry' ? handleNewConnectionRequest() : handleConnectToPushWallet()
  }

  return (
    <div>
      <button
        className="send-button"
        onClick={handleConnectWalletButton}
        disabled={isConnectButtonDisbaled}
        style={{
          backgroundColor: '#d548ec',
          color: '#fff',
          border: 'none',
          borderRadius: '5px',
          padding: '10px 20px',
          cursor: 'pointer',
          fontSize: '1rem',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            gap: '4px',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {isLoading && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <div
                style={{
                  border: '4px solid #e0e0e0',
                  borderTop: '4px solid #d548ec',
                  borderRadius: '50%',
                  width: '16px',
                  height: '16px',
                  animation: 'spin 1s linear infinite',
                }}
              ></div>
            </div>
          )}
          {walletConnectionButtonStatusMapper[connectionStatus]}{' '}
        </div>
      </button>
    </div>
  );
};

export { ConnectPushWalletButton };

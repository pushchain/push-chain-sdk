import React from 'react';
import { ENV } from '../../constants';
import {
  WALLET_TO_APP_ACTION,
  APP_TO_WALLET_ACTION,
  ButtonStatus,
  IConnectPushWalletProps,
} from '../wallet.types';

const ConnectPushWallet = () => {
  const [buttonStatus, setButtonStatus] =
    React.useState<ButtonStatus>('Connect');

  const [newTab, setNewTab] = React.useState<Window | null>(null);

  const openNewWindowTab = () => {
    const width = 600;
    const height = 800;
    const left = screen.width - width - 100;
    const top = 150;
    const walletUrl = 'http://localhost:5173';
    const newTab = window.open(
      walletUrl,
      '_blank',
      `width=${width},height=${height},left=${left},top=${top}`
    );
    if (newTab) {
      setNewTab(newTab);
      return newTab;
    }
    return null;
  };

  console.log('newTab', newTab);

  const handleConnectWallet = async () => {
    console.log('New Tab', newTab);
    let openedNewTab = newTab;
    if (!newTab) {
      openedNewTab = openNewWindowTab();
    }

    const walletUrl = 'http://localhost:5173';
    if (openedNewTab) {
      setButtonStatus('Connecting');
      const handleMessage = (event: MessageEvent) => {
        if (event.origin === walletUrl) {
          // Handle the message received from the wallet tab
          console.log('Message from child Tab: ', event.data);
          // You can perform actions based on the received message here
          // For example, you can call different functions based on the message type
          switch (event.data.type) {
            case WALLET_TO_APP_ACTION.AUTH_STATUS:
              console.log('Connection status case', event.data);
              break;
            case WALLET_TO_APP_ACTION.IS_LOGGED_IN:
              console.log('User has logged In', event.data);
              handleIsLoggedInAction(openedNewTab);
              break;
            case WALLET_TO_APP_ACTION.APP_CONNECTION_REJECTED:
              console.log('App Connection Rejected', event.data);
              setButtonStatus('Retry');
              break;
            case WALLET_TO_APP_ACTION.APP_CONNECTION_SUCCESS:
              console.log('App Connection Success', event.data);
              setButtonStatus('Connected');
              break;
            case WALLET_TO_APP_ACTION.IS_LOGGED_OUT:
              console.log('User loggged out', event.data);
              break;
            case WALLET_TO_APP_ACTION.TAB_CLOSED:
              console.log('User closed the tab', event.data);
              setButtonStatus('Connect');
              break;
            case WALLET_TO_APP_ACTION.SIGNATURE:
              console.log('Signature received', event.data);
              break;
            default:
              console.warn('Unknown message type:', event.data.type);
          }
        }
      };

      window.addEventListener('message', handleMessage);
    }
  };

  const handleIsLoggedInAction = (openedNewTab: Window) => {
    setButtonStatus('Authenticating');
    handleSendNewConnectionReq(openedNewTab);
  };

  const handleSendNewConnectionReq = (openedNewTab: Window) => {
    console.log('requesting StatusFromWallet', openedNewTab);

    if (openedNewTab) {
      console.log('posting message');
      openedNewTab.postMessage(
        {
          type: APP_TO_WALLET_ACTION.NEW_CONNECTION_REQUEST,
        },
        'http://localhost:5173'
      );
    }
  };

  const handleSignRequestFromPushWallet = () => {
    console.log('requesting sign FromWallet', newTab);

    if (newTab) {
      console.log('posting message');

      newTab.postMessage(
        {
          type: APP_TO_WALLET_ACTION.SIGN_MESSAGE,
          data: 'Hello world',
        },
        'http://localhost:5173'
      );
    }
  };

  return (
    <div>
      <button onClick={handleSignRequestFromPushWallet}>
        Request Signature
      </button>
      <button
        className="send-button"
        onClick={handleConnectWallet}
        disabled={
          buttonStatus === 'Connected' ||
          buttonStatus === 'Authenticating' ||
          buttonStatus === 'Connecting'
        }
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
          {(buttonStatus === 'Connecting' ||
            buttonStatus === 'Authenticating') && (
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
          {buttonStatus}{' '}
          {(buttonStatus === 'Connect' || buttonStatus === 'Connected') &&
            'Push Wallet'}
        </div>
      </button>
    </div>
  );
};

export { ConnectPushWallet };

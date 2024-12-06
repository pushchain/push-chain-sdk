import * as React from 'react';
import { ENV } from '../constants';
import config from '../config';
import { ButtonStatus, IConnectPushWalletProps } from './wallet.types';

/**
 * ConnectPushWallet component handles the connection to a Push Wallet.
 * It manages the connection status and wallet address retrieval.
 *
 * @param {Object} props - Component properties.
 * @param {Function} props.setAccount - Function to set the connected account address.
 * @param {PushNetwork} props.pushNetwork - Instance of the PushNetwork to interact with the wallet.
 */

export const ConnectPushWallet: React.FC<IConnectPushWalletProps> = ({
  setAccount,
  pushWallet,
  env = ENV.PROD,
}) => {
  const [buttonStatus, setButtonStatus] =
    React.useState<ButtonStatus>('Connect');

  React.useEffect(() => {
    const messageListener = (event: MessageEvent) => {
      // Validate the origin of the message to ensure security
      if (event.origin !== config.WALLET_URL[env]) {
        console.warn('Message from untrusted origin:', event.origin);
        return;
      }

      // Handle the message
      if (event.data === 'walletClosed' || event.data === 'walletLoggedOut') {
        console.log('wallet tab was closed or logged Out!');
        setButtonStatus('Connect');
      }
    };

    // Add the event listener
    window.addEventListener('message', messageListener);

    return () => {
      // Cleanup: remove the event listener when the component is unmounted
      window.removeEventListener('message', messageListener);
    };
  }, []);
  /**
   * Polls the app connection status at regular intervals.
   * Updates the button status based on the connection status.
   */
  const pollAppConnectionStatus = () => {
    if (pushWallet) {
      const intervalId = setInterval(async () => {
        try {
          const status = await pushWallet.appConnectionStatus();

          if (status.appConnectionStatus === 'rejected') {
            clearInterval(intervalId);
            setButtonStatus('Retry');
          }

          if (status.appConnectionStatus === 'connected') {
            clearInterval(intervalId);
            await getWalletAddress();
          }
        } catch (error) {
          console.error('Error fetching app connection status:', error);
          setButtonStatus('Connect');
        }
      }, 1500);
    }
  };

  /**
   * Retrieves the wallet address from the Push Network.
   * Updates the account state with the retrieved address.
   */
  const getWalletAddress = async () => {
    if (pushWallet) {
      try {
        setButtonStatus('Connected');
        const address = await pushWallet.requestWalletAddress();
        setAccount(address);
      } catch (error) {
        console.debug('Error fetching wallet address:', error);
        setButtonStatus('Connect');
      }
    }
  };

  /**
   * Connects to the Push Wallet.
   * Retries the connection if not successful, up to a maximum number of attempts.
   *
   * @param {number} tryCount - The current attempt count for connecting.
   */
  const connectWallet = async (tryCount = 1) => {
    if (pushWallet) {
      console.log('Fetching Push Wallet: ', tryCount);
      try {
        setButtonStatus('Connecting');
        const appConnectionOrigin = window.location.origin;
        const connectionStatus = await pushWallet.connect(
          `${config.WALLET_URL[env]}/wallet?app=${encodeURIComponent(
            appConnectionOrigin
          )}`
        );

        if (
          connectionStatus.appConnectionStatus === 'notReceived' ||
          connectionStatus.appConnectionStatus === 'rejected'
        ) {
          handleSendNewConnectionReq();
        }

        if (connectionStatus.appConnectionStatus === 'pending') {
          setButtonStatus('Authenticating');
          pollAppConnectionStatus();
        }

        if (connectionStatus.appConnectionStatus === 'connected') {
          await getWalletAddress();
        }
      } catch (err) {
        console.debug('Error in connecting Push Wallet: ', err);

        if (tryCount < 120 && err === 'PushWallet Not Logged In') {
          setTimeout(() => {
            connectWallet(tryCount + 1);
          }, 1000);
        } else {
          alert(err);
          console.debug('Could not fetch wallet: ', err);
          setButtonStatus('Connect');
        }
      }
    }
  };

  /**
   * Sends a new connection request to the Push Wallet.
   * Updates the button status and starts polling for connection status.
   */
  const handleSendNewConnectionReq = async () => {
    try {
      setButtonStatus('Authenticating');
      await pushWallet.requestAppConnection();
      pollAppConnectionStatus();
    } catch (error) {
      console.debug('Error in Sending new conenction req', error);
      alert(error);
    }
  };

  const appConnectionStatus = async () => {
    console.log('Asking for app connection');

    try {
      const status = await pushWallet.checkAuthStatus();

      console.log('Status', status);

      // if (status.appConnectionStatus === 'rejected') {
      //   setButtonStatus('Retry');
      // }

      // if (status.appConnectionStatus === 'connected') {
      //   await getWalletAddress();
      // }
    } catch (error) {
      console.error('Error fetching app connection status:', error);
      // setButtonStatus('Connect');
    }
  };

  /**
   * Opens a new tab for the Push Wallet and sets up an event listener for communication.
   */
  // ... existing code ...

  /**
   * Opens a new tab for the Push Wallet and sets up an event listener for communication.
   */

  const [newTab, setNewTab] = React.useState<Window>();
  const openWalletTab = () => {
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
      // Set up a single event listener to receive messages from the new tab
      const handleMessage = (event) => {
        if (event.origin === walletUrl) {
          // Handle the message received from the wallet tab
          console.log('Message from wallet tab:', event.data);
          // You can perform actions based on the received message here
          // For example, you can call different functions based on the message type
          switch (event.data.type) {
            case 'connectionStatus':
              console.log('Connection status case', event.data);
              break;
            case 'walletAddress':
              console.log('walletAddress status case', event.data);
              break;
            case 'someAction':
              console.log('Action received:', event.data.action);
              // Handle the action received from the wallet tab
              break;
            case 'statusResponse':
              console.log('Status Response:', event.data.status);
              // Handle the status response here
              break;
            default:
              console.warn('Unknown message type:', event.data.type);
          }
        }
      };

      window.addEventListener('message', handleMessage);

      // Example function to send data to the new tab
      const sendDataToNewTab = (data) => {
        if (newTab) {
          newTab.postMessage(data, walletUrl);
        }
      };

      sendDataToNewTab({ type: 'requestData', payload: 'Some data' });
    } else {
      console.error(
        'Failed to open new tab. Please allow popups for this site.'
      );
    }
  };

  const requestStatusFromWallet = () => {
    console.log('requesting StatusFromWallet', newTab);

    if (newTab) {
      console.log('posting message');

      newTab.postMessage({ type: 'requestStatus' }, 'http://localhost:5173');
    }
  };

  /**
   * Actions:
   * -> IS_LOGGED_IN : user logged in h ya nhi
   * -> Send Connection Request: sends a new connection request
   * ->
   *
   */

  return (
    <div>
      <button onClick={appConnectionStatus}>Connection Status</button>
      <button onClick={openWalletTab}>Open Wallet Tab</button>{' '}
      <button onClick={requestStatusFromWallet}>
        request Status FromWallet
      </button>{' '}
      {/* New button to open wallet tab */}
      <button
        className="send-button"
        onClick={() => connectWallet(1)}
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

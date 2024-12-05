import * as React from 'react';
import { Wallet as PushWallet } from './wallet';
import { ENV } from '../constants';
import config from '../config';
import { ButtonStatus, IConnectPushWalletProps } from './wallet.types';
import '../style.css';

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
}: {
  setAccount: (account: string) => void;
  pushWallet: PushWallet;
}) => {
  const [buttonStatus, setButtonStatus] =
    React.useState<ButtonStatus>('Connect');

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
          `${config.WALLET_URL[ENV.LOCAL]}wallet?app=${encodeURIComponent(
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

  return (
    <div>
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
            <div className="loader-container">
              <div className="loader"></div>
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

import React, {
  createContext,
  useContext,
  useState,
  ReactNode,
  useEffect,
  useRef,
} from 'react';
import {
  APP_TO_WALLET_ACTION,
  ConnectionStatus,
  WALLET_TO_APP_ACTION,
  WalletEventRespoonse,
} from '../wallet.types';
import { ENV } from '../../constants';
import config from '../../config';

// Define the context shape
export type WalletContextType = {
  account: string | null;
  connectionStatus: ConnectionStatus;
  handleConnectToPushWallet: () => void;
  handleNewConnectionRequest: () => void;
  handleSendSignRequestToPushWallet: (data: Uint8Array) => Promise<Uint8Array>;
};

export type WalletProviderProps = { children: ReactNode; env: ENV };

// Create the WalletContext
const WalletContext = createContext<WalletContextType | undefined>(undefined);

// WalletProvider component
export const WalletProvider: React.FC<WalletProviderProps> = ({
  children,
  env,
}) => {
  const [account, setAccount] = useState<WalletContextType['account']>(null);

  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>('notConnected');

  const tabRef = useRef<Window | null>(null);

  const signatureResolverRef = useRef<((data: any) => void) | null>(null);

  const handleConnectToPushWallet = () => {
    setConnectionStatus('connecting');

    if (!tabRef.current) {
      const width = 600;
      const height = 800;
      const left = screen.width - width - 100;
      const top = 150;

      const newTab = window.open(
        `${config.WALLET_URL[env]}/wallet?app=${window.location.origin}`,
        '_blank',
        `width=${width},height=${height},left=${left},top=${top}`
      );

      tabRef.current = newTab;
    }
  };

  const sendMessageToPushWallet = (message: any) => {
    if (tabRef.current) {
      try {
        tabRef.current.postMessage(message, config.WALLET_URL[env]);
      } catch (error) {
        console.error('Error sending message to push wallet tab:', error);
      }
    }
  };

  const handleNewConnectionRequest = () => {
    setConnectionStatus('authenticating');
    sendMessageToPushWallet({
      type: APP_TO_WALLET_ACTION.NEW_CONNECTION_REQUEST,
    });
  };

  const handleIsLoggedInAction = (response: WalletEventRespoonse) => {
    if (response?.account) {
      setConnectionStatus('connected');
      setAccount(response.account);
    } else {
      handleNewConnectionRequest();
    }
  };

  const handleAppConnectionSuccess = (response: WalletEventRespoonse) => {
    setConnectionStatus('connected');
    setAccount(response.account!);
  };

  const handleAppConnectionRejection = () => {
    setConnectionStatus('retry');
    setAccount(null);
  };

  const handleUserLogOutEvent = () => {
    setConnectionStatus('notConnected');
    setAccount(null);
  };

  const handleWalletTabClosed = () => {
    // TODO: Fix this case
    setConnectionStatus('notConnected');
    setAccount(null);
    tabRef.current = null;
  };

  const handleSendSignRequestToPushWallet = (
    data: Uint8Array
  ): Promise<Uint8Array> => {
    return new Promise((resolve, reject) => {
      if (signatureResolverRef.current) {
        reject(new Error('Another sign request is already in progress'));
        return;
      }

      // Set the resolver to be used when a message is received
      signatureResolverRef.current = resolve;

      // Timeout for safety (optional)
      const timeout = setTimeout(() => {
        signatureResolverRef.current = null; // Clean up
        reject(new Error('Signature request timed out'));
      }, 10000);

      // Send the sign request to the wallet tab
      sendMessageToPushWallet({
        type: APP_TO_WALLET_ACTION.SIGN_MESSAGE,
        data,
      });

      // Clear timeout when resolved
      signatureResolverRef.current = (response: WalletEventRespoonse) => {
        clearTimeout(timeout);
        resolve(response.signature!);
        signatureResolverRef.current = null; // Clean up
      };
    });
  };

  useEffect(() => {
    const messageHandler = (event: MessageEvent) => {
      if (event.origin === config.WALLET_URL[env]) {
        console.log('Message from child Tab: ', event.data);

        switch (event.data.type) {
          case WALLET_TO_APP_ACTION.IS_LOGGED_IN:
            console.log('User has logged In', event.data.data);
            handleIsLoggedInAction(event.data.data);
            break;
          case WALLET_TO_APP_ACTION.APP_CONNECTION_SUCCESS:
            console.log('App Connection Success', event.data.data);
            handleAppConnectionSuccess(event.data.data);
            break;
          case WALLET_TO_APP_ACTION.APP_CONNECTION_REJECTED:
            console.log('App Connection Rejected', event.data.data);
            handleAppConnectionRejection();
            break;
          case WALLET_TO_APP_ACTION.SIGNATURE:
            console.log('Signature received', event.data.data);
            if (signatureResolverRef.current) {
              signatureResolverRef.current(event.data.data); // Resolve the promise with the data
            }
            break;
          case WALLET_TO_APP_ACTION.IS_LOGGED_OUT:
            console.log('User loggged out', event.data.data);
            handleUserLogOutEvent();
            break;
          case WALLET_TO_APP_ACTION.TAB_CLOSED:
            console.log('User closed the tab', event.data.data);
            handleWalletTabClosed();
            break;
          case WALLET_TO_APP_ACTION.ERROR:
            console.log('Error from the child tab', event.data);
            // handleWalletTabClosed();
            break;

          default:
            console.warn('Unknown message type:', event.data.type);
        }
      }
    };

    window.addEventListener('message', messageHandler);

    return () => window.removeEventListener('message', messageHandler);
  }, []);

  return (
    <WalletContext.Provider
      value={{
        account,
        connectionStatus,
        handleConnectToPushWallet,
        handleSendSignRequestToPushWallet,
        handleNewConnectionRequest,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
};

// Custom hook to use WalletContext
export const usePushWalletContext = (): WalletContextType => {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return context;
};

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
  env: ENV;
  iframeRef: React.MutableRefObject<HTMLIFrameElement | null>;
  isWalletVisible: boolean;
  isWalletMinimised: boolean;
  setWalletVisibility: (isWalletVisible: boolean) => void;
  handleConnectToPushWallet: () => void;
  handleNewConnectionRequest: () => void;
  handleSendSignRequestToPushWallet: (data: Uint8Array) => Promise<Uint8Array>;
  setMinimiseWallet: React.Dispatch<React.SetStateAction<boolean>>;
  handleUserLogOutEvent: () => void;
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

  const [isWalletVisible, setWalletVisibility] = useState(false);

  const [isWalletMinimised, setMinimiseWallet] = useState(false);

  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>('notConnected');

  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const signatureResolverRef = useRef<{
    success?: (data: WalletEventRespoonse) => void;
    error?: (data: WalletEventRespoonse) => void;
  } | null>(null);

  const handleConnectToPushWallet = () => {
    setWalletVisibility(true);
    setConnectionStatus('connecting');
  };

  const sendMessageToPushWallet = (message: any) => {
    console.log('sendMessageToPushWallet', iframeRef?.current?.contentWindow);

    if (iframeRef?.current?.contentWindow) {
      try {
        iframeRef.current.contentWindow.postMessage(
          message,
          config.WALLET_URL[env]
        );
      } catch (error) {
        console.error('Error sending message to push wallet tab:', error);
      }
    }
  };

  const handleNewConnectionRequest = () => {
    setMinimiseWallet(false);
    setConnectionStatus('authenticating');
    sendMessageToPushWallet({
      type: APP_TO_WALLET_ACTION.NEW_CONNECTION_REQUEST,
    });
  };

  const handleIsLoggedInAction = (response: WalletEventRespoonse) => {
    if (response?.account) {
      setConnectionStatus('connected');
      setMinimiseWallet(true);
      setAccount(response.account);
    } else {
      handleNewConnectionRequest();
    }
  };

  const handleAppConnectionSuccess = (response: WalletEventRespoonse) => {
    setConnectionStatus('connected');
    setMinimiseWallet(true);
    setAccount(response.account!);
  };

  const handleAppConnectionRejection = () => {
    setConnectionStatus('retry');
    setAccount(null);
  };

  const handleAppConnectionRetry = () => {
    setMinimiseWallet(true);
  };

  const handleUserLogOutEvent = () => {
    setConnectionStatus('notConnected');
    setAccount(null);
    setMinimiseWallet(false);
    setWalletVisibility(false);
  };

  const handleSendSignRequestToPushWallet = (
    data: Uint8Array
  ): Promise<Uint8Array> => {
    return new Promise((resolve, reject) => {
      if (signatureResolverRef.current) {
        reject(new Error('Another sign request is already in progress'));
        return;
      }

      signatureResolverRef.current = {
        success: (response: WalletEventRespoonse) => {
          resolve(response.signature!);
          signatureResolverRef.current = null; // Clean up
        },
        error: (response: WalletEventRespoonse) => {
          signatureResolverRef.current = null; // Clean up
          reject(new Error('Signature request failed'));
        },
      };

      setMinimiseWallet(false);

      // Send the sign request to the wallet tab
      sendMessageToPushWallet({
        type: APP_TO_WALLET_ACTION.SIGN_MESSAGE,
        data,
      });
    });
  };

  useEffect(() => {
    const messageHandler = (event: MessageEvent) => {
      console.log('Message from child Tab: ', event.data);
      // if (event.origin === config.WALLET_URL[env]) {
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
        case WALLET_TO_APP_ACTION.APP_CONNECTION_RETRY:
          console.log('App Connection Retry', event.data.data);
          handleAppConnectionRetry();
          break;
        case WALLET_TO_APP_ACTION.SIGNATURE:
          console.log('Signature received', event.data.data);
          if (signatureResolverRef.current) {
            signatureResolverRef?.current?.success?.(event.data.data);
          }
          break;
        case WALLET_TO_APP_ACTION.IS_LOGGED_OUT:
          console.log('User loggged out', event.data.data);
          handleUserLogOutEvent();
          break;
        case WALLET_TO_APP_ACTION.ERROR:
          console.log('Error from the child tab', event.data);
          signatureResolverRef?.current?.error?.(event.data.data);
          break;
        default:
          console.warn('Unknown message type:', event.data.type);
      }
      // }
    };

    window.addEventListener('message', messageHandler);

    return () => window.removeEventListener('message', messageHandler);
  }, []);

  console.log('This is running in wallet provider');

  return (
    <WalletContext.Provider
      value={{
        account,
        connectionStatus,
        env,
        iframeRef,
        isWalletMinimised,
        isWalletVisible,
        setWalletVisibility,
        handleConnectToPushWallet,
        handleNewConnectionRequest,
        handleSendSignRequestToPushWallet,
        setMinimiseWallet,
        handleUserLogOutEvent,
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

import React, {
  createContext,
  useContext,
  useState,
  ReactNode,
  useEffect,
} from 'react';
import { ButtonStatus } from './wallet.types';

// Define the context shape
interface WalletContextType {
  isConnected: boolean;
  address: string | null;
  connectWallet: () => void;
  disconnectWallet: () => void;
}

// Create the WalletContext
const WalletContext = createContext<WalletContextType | undefined>(undefined);

// Custom hook to use WalletContext
export const useWallet = (): WalletContextType => {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return context;
};

// WalletProvider component
export const WalletProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const [isConnected, setIsConnected] = useState(false);
  const [address, setAddress] = useState<string | null>(null);

  const connectWallet = () => {
    // Mock connection logic
    setIsConnected(true);
    setAddress('0x1234...abcd'); // Replace with wallet connection logic
  };

  const disconnectWallet = () => {
    setIsConnected(false);
    setAddress(null);
  };

  const [buttonStatus, setButtonStatus] =
    React.useState<ButtonStatus>('Connect');

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

  return (
    <WalletContext.Provider
      value={{ isConnected, address, connectWallet, disconnectWallet }}
    >
      {children}
    </WalletContext.Provider>
  );
};

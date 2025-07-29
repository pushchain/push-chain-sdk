import React, { createContext, FC, useCallback, useEffect, useRef, useState } from 'react';
import { PushChain } from '@pushchain/core';
import { PROGRESS_HOOK, ProgressEvent } from '@pushchain/core/src/lib/progress-hook/progress-hook.types';
import {
  ChainType,
  ConnectionStatus,
  IWalletProvider,
  ModalAppDetails,
  PushWalletProviderProps,
  UniversalAccount,
  WalletEventRespoonse,
  WalletInfo,
  WalletAppDetails,
  ThemeMode,
  ITypedData,
} from '../types';
import {
  APP_TO_WALLET_ACTION,
  PushUI,
  WALLET_CONFIG_URL,
  WALLET_TO_APP_ACTION,
} from '../constants';
import { walletRegistry } from '../providers/walletProviders/WalletProviderRegistry';
import { PushWalletToast } from '../components/PushWalletToast';
import { LoginModal } from '../components/LoginModal';
import { getWalletContext } from './WalletContextMap';
import { ThemeOverrides } from '../styles/token';

export type WalletContextType = {
  universalAccount: UniversalAccount | null;
  connectionStatus: ConnectionStatus;

  isWalletMinimised: boolean;
  setMinimiseWallet: (isWalletMinimised: boolean) => void;

  handleConnectToPushWallet: () => void;
  handleUserLogOutEvent: () => void;
  handleSignMessage: (data: Uint8Array) => Promise<Uint8Array>;
  handleSignAndSendTransaction: (data: Uint8Array) => Promise<Uint8Array>;
  handleSignTypedData: (data: ITypedData) => Promise<Uint8Array>;

  config: PushWalletProviderProps['config'];
  app?: PushWalletProviderProps['app'];

  modalAppData: ModalAppDetails | undefined;
  updateModalAppData: (newData: Partial<ModalAppDetails>) => void;

  walletAppData: WalletAppDetails | undefined;
  updateWalletAppData: (newData: Partial<WalletAppDetails>) => void;

  themeMode: ThemeMode;
  themeOverrides: ThemeOverrides;

  toggleButtonRef: React.RefObject<HTMLButtonElement>;
  setProgress: React.Dispatch<React.SetStateAction<ProgressEvent | null>>;
};

export const WalletContext = createContext<WalletContextType | null>(null);

export const WalletContextProvider: FC<PushWalletProviderProps> = ({
  children,
  config,
  app,
  themeMode = PushUI.CONSTANTS.THEME.DARK,
  themeOverrides,
}) => {
  const [universalAccount, setUniversalAccount] =
    useState<WalletContextType['universalAccount']>(null);

  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [isWalletVisible, setWalletVisibility] = useState(false); // to display the iframe as connect button is clicked

  const [isWalletMinimised, setMinimiseWallet] = useState(false); // to display/hide minimized wallet modal

  const [isIframeLoading, setIframeLoading] = useState(true);

  const [connectionStatus, setConnectionStatus] = useState<
    WalletContextType['connectionStatus']
  >(ConnectionStatus.NOT_CONNECTED);

  const [externalWallet, setExternalWallet] = useState<WalletInfo | null>(null); // to connect with external wallet

  const [progress, setProgress] = useState<ProgressEvent | null>(null);

  const signatureResolverRef = useRef<{
    success?: (data: WalletEventRespoonse) => void;
    error?: (data: WalletEventRespoonse) => void;
  } | null>(null);

  const [modalAppData, setModalAppData] = useState<ModalAppDetails | undefined>(
    app
      ? {
          title: app?.title,
          logoURL: app?.logoUrl,
          description: app?.description,
        }
      : undefined
  );

  const [walletAppData, setWalletAppData] = useState<
    WalletAppDetails | undefined
  >(
    app
      ? {
          title: app?.title,
          logoURL: app?.logoUrl,
          description: app?.description,
        }
      : undefined
  );

  const toggleButtonRef = useRef<HTMLButtonElement>(null);

  const updateModalAppData = (newData: Partial<ModalAppDetails>) => {
    setModalAppData((prevData) => ({
      ...prevData,
      ...newData,
    }));
  };

  const updateWalletAppData = (newData: Partial<WalletAppDetails>) => {
    setWalletAppData((prevData) => ({
      ...prevData,
      ...newData,
    }));
  };

  const handleConnectToPushWallet = () => {
    setWalletVisibility(true);
    setConnectionStatus(ConnectionStatus.CONNECTING);
  };

  // sending wallet config to the Push wallet
  const sendWalletConfig = () => {
    const walletConfig = {
      loginDefaults: config.login,
      themeMode,
      appMetadata: walletAppData,
      themeOverrides: themeOverrides || {},
    };

    sendMessageToPushWallet({
      type: APP_TO_WALLET_ACTION.WALLET_CONFIG,
      data: {
        ...walletConfig,
      },
    });
  };

  const handleUserLogOutEvent = () => {
    setConnectionStatus(ConnectionStatus.NOT_CONNECTED);
    setUniversalAccount(null);
    setMinimiseWallet(false);
    setWalletVisibility(false);
    setIframeLoading(true);
  };

  // sending events to wallet from dapp
  const sendMessageToPushWallet = (message: any) => {
    if (iframeRef?.current?.contentWindow) {
      try {
        iframeRef.current.contentWindow.postMessage(
          message,
          WALLET_CONFIG_URL[config.network]
        );
      } catch (error) {
        console.error('Error sending message to push wallet tab:', error);
      }
    }
  };

  // response when the wallet sends logged in action
  const handleIsLoggedInAction = () => {
    handleNewConnectionRequest();
    // setExternalWallet(null);
  };

  // sending a new connection request as soon as wallet gets connected
  const handleNewConnectionRequest = () => {
    setConnectionStatus(ConnectionStatus.AUTHENTICATING);
    sendMessageToPushWallet({
      type: APP_TO_WALLET_ACTION.NEW_CONNECTION_REQUEST,
    });
  };

  const handleAppConnectionSuccess = (response: WalletEventRespoonse) => {
    setConnectionStatus(ConnectionStatus.CONNECTED);
    setMinimiseWallet(true);
    if (response.account) {
      setUniversalAccount(response.account);
    }
  };

  const handleAppConnectionRejection = () => {
    setConnectionStatus(ConnectionStatus.RETRY);
    setUniversalAccount(null);
  };

  // Connect external wallet
  const handleExternalWalletConnection = async (data: {
    chain: ChainType;
    provider: IWalletProvider['name'];
  }) => {
    try {
      const providerReceived = walletRegistry.getProvider(data.provider);

      if (!providerReceived) {
        return;
      }

      const walletInfo = await providerReceived.connect(data.chain);

      console.log('@@@@@@@ walletInfo', walletInfo);
      console.log('#######', PushChain.utils.account);
      console.log('$$$$$$', PushChain.utils.account.fromChainAgnostic);

      setConnectionStatus(ConnectionStatus.CONNECTED);
      setMinimiseWallet(true);

      const result = PushChain.utils.account.fromChainAgnostic(
        walletInfo.caipAddress
      );

      setUniversalAccount(result);

      const connectedWallet: WalletInfo = {
        address: walletInfo.caipAddress,
        providerName: data.provider,
        chainType: data.chain,
      };

      setExternalWallet(connectedWallet);

      sendMessageToPushWallet({
        type: APP_TO_WALLET_ACTION.CONNECTION_STATUS,
        data: {
          status: 'successful',
          ...connectedWallet,
        },
      });
    } catch (error) {
      console.log('Failed to connect to provider', error);
      sendMessageToPushWallet({
        type: APP_TO_WALLET_ACTION.CONNECTION_STATUS,
        data: {
          status: 'rejected',
        },
      });
      throw new Error('Failed to connect to provider');
    }
  };

  // handles external wallet signature request
  const handleExternalWalletSignRequest = async (
    data: Uint8Array
  ): Promise<Uint8Array> => {
    if (!externalWallet) {
      throw new Error('No External wallet connected');
    }

    try {
      const providerReceived = walletRegistry.getProvider(
        externalWallet.providerName
      );

      if (!providerReceived) {
        throw new Error('Provider not found');
      }

      const signature = await providerReceived.signMessage(data);

      return signature;
    } catch (error) {
      console.log('Error in generating signature', error);
      throw new Error('Signature request failed');
    }
  };

  const handleExternalWalletSignTransactionRequest = async (
    data: Uint8Array
  ): Promise<Uint8Array> => {
    if (!externalWallet) {
      throw new Error('No External wallet connected');
    }

    try {
      const providerReceived = walletRegistry.getProvider(
        externalWallet.providerName
      );

      if (!providerReceived) {
        throw new Error('Provider not found');
      }

      const signature = await providerReceived.signAndSendTransaction(data);

      return signature;
    } catch (error) {
      console.log('Error in generating signature', error);
      throw new Error('Signature request failed');
    }
  };

  const handleExternalWalletSignTypedDataRequest = async (
    data: ITypedData
  ): Promise<Uint8Array> => {
    if (!externalWallet) {
      throw new Error('No External wallet connected');
    }

    try {
      const providerReceived = walletRegistry.getProvider(
        externalWallet.providerName
      );

      if (!providerReceived) {
        throw new Error('Provider not found');
      }

      const signature = await providerReceived.signTypedData(data);

      return signature;
    } catch (error) {
      console.log('Error in generating signature', error);
      throw new Error('Signature request failed');
    }
  };

  // handles Push wallet signature request
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

      // Send the sign request to the wallet tab
      sendMessageToPushWallet({
        type: APP_TO_WALLET_ACTION.SIGN_MESSAGE,
        data,
      });
    });
  };

  const handleSendSignTransactionRequestToPushWallet = (
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

      // Send the sign request to the wallet tab
      sendMessageToPushWallet({
        type: APP_TO_WALLET_ACTION.SIGN_TRANSACTION,
        data,
      });
    });
  };

  const handleSendSignTypedDataRequestToPushWallet = (
    data: ITypedData
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

      // Send the sign request to the wallet tab
      sendMessageToPushWallet({
        type: APP_TO_WALLET_ACTION.SIGN_TYPED_DATA,
        data,
      });
    });
  };

  // sending Message sign request to wallet based on which wallet is connected (external or pushwallet)
  const handleSignMessage = async (data: Uint8Array): Promise<Uint8Array> => {
    let signature;
    if (externalWallet) {
      signature = await handleExternalWalletSignRequest(data);
    } else {
      signature = await handleSendSignRequestToPushWallet(data);
    }

    return signature;
  };

  const handleSignAndSendTransaction = async (
    data: Uint8Array
  ): Promise<Uint8Array> => {
    let signature;
    if (externalWallet) {
      signature = await handleExternalWalletSignTransactionRequest(data);
    } else {
      signature = await handleSendSignTransactionRequestToPushWallet(data);
    }

    return signature;
  };

  const handleSignTypedData = async (data: ITypedData): Promise<Uint8Array> => {
    let signature;
    if (externalWallet) {
      signature = await handleExternalWalletSignTypedDataRequest(data);
    } else {
      signature = await handleSendSignTypedDataRequestToPushWallet(data);
    }

    return signature;
  };

  const handleCloseIFrame = useCallback(() => {
    
  }, [universalAccount])

  useEffect(() => {
    const messageHandler = (event: MessageEvent) => {
      if (iframeRef.current?.contentWindow !== event.source) return;

      switch (event.data.type) {
        case WALLET_TO_APP_ACTION.CONNECT_EXTERNAL_WALLET:
          console.log('External wallet connection req');
          handleExternalWalletConnection(event.data.data);
          break;
        case WALLET_TO_APP_ACTION.IS_LOGGED_IN:
          console.log('wallet connected successfully', event.data);
          handleIsLoggedInAction();
          break;
        case WALLET_TO_APP_ACTION.APP_CONNECTION_SUCCESS:
          handleAppConnectionSuccess(event.data.data);
          break;
        case WALLET_TO_APP_ACTION.APP_CONNECTION_REJECTED:
          handleAppConnectionRejection();
          break;
        case WALLET_TO_APP_ACTION.SIGN_MESSAGE:
          if (signatureResolverRef.current) {
            signatureResolverRef?.current?.success?.(event.data.data);
          }
          break;
        case WALLET_TO_APP_ACTION.SIGN_TRANSACTION:
          if (signatureResolverRef.current) {
            signatureResolverRef?.current?.success?.(event.data.data);
          }
          break;
        case WALLET_TO_APP_ACTION.SIGN_TYPED_DATA:
          if (signatureResolverRef.current) {
            signatureResolverRef?.current?.success?.(event.data.data);
          }
          break;
        case WALLET_TO_APP_ACTION.IS_LOGGED_OUT:
          handleUserLogOutEvent();
          break;
        case WALLET_TO_APP_ACTION.ERROR:
          signatureResolverRef?.current?.error?.(event.data.data);
          break;
        case WALLET_TO_APP_ACTION.CLOSE_IFRAME:
          if (universalAccount) setMinimiseWallet(true);
          else handleUserLogOutEvent();
          break;
        default:
          console.warn('Unknown message type:', event.data.type);
      }
    };

    window.addEventListener('message', messageHandler);

    return () => window.removeEventListener('message', messageHandler);
  }, [universalAccount]);

  const WalletContext = getWalletContext(config?.uid || 'default');

  const dummyProgress: ProgressEvent = {
    id: PROGRESS_HOOK.SEND_TX_99_01,
    title: 'Push Chain Tx Success',
    message: '',
    level: 'SUCCESS',
    response: null,
    timestamp: '',
  }

  return (
    <WalletContext.Provider
      value={{
        app,
        config,
        connectionStatus,
        universalAccount,
        isWalletMinimised,
        modalAppData,
        themeMode,
        themeOverrides: {},
        updateModalAppData,
        walletAppData,
        updateWalletAppData,
        setMinimiseWallet,
        handleConnectToPushWallet,
        handleUserLogOutEvent,
        handleSignMessage,
        handleSignAndSendTransaction,
        handleSignTypedData,
        toggleButtonRef,
        setProgress,
      }}
    >
      <LoginModal
        iframeRef={iframeRef}
        themeMode={themeMode}
        modalAppData={modalAppData}
        isWalletVisible={isWalletVisible}
        isIframeLoading={isIframeLoading}
        setIframeLoading={setIframeLoading}
        sendWalletConfig={sendWalletConfig}
        config={config}
        universalAccount={universalAccount}
        isWalletMinimised={isWalletMinimised}
        setMinimiseWallet={setMinimiseWallet}
        handleUserLogOutEvent={handleUserLogOutEvent}
        toggleButtonRef={toggleButtonRef}
        sendMessageToPushWallet={sendMessageToPushWallet}
      />
      {progress && <PushWalletToast progress={progress} setProgress={setProgress} />}
      {children}
    </WalletContext.Provider>
  );
};

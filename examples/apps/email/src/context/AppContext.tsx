'use client';
import React, { createContext, useContext } from 'react';
import {
  getWalletDataFromAccount,
  usePushWalletContext,
} from '@pushprotocol/pushchain-ui-kit';
import PushMail from 'push-mail';
import { ReactNode, useEffect, useState } from 'react';
import {
  Email,
  EMAIL_BOX,
  getFullCaipAddress,
  RPC_URL,
  Wallet,
} from '@/common';
import {
  checkAndUpdateActivity,
  checkAndUpdateReceiveEmailActivity,
} from '@/services/rewards';
import { CONSTANTS, createUniversalSigner, PushChain } from '@pushchain/devnet';
import { getSentPushEmails } from '@/services/getSentEmails';
import { getReceivedPushEmails } from '@/services/getReceivedEmails';

interface AppContextType {
  searchInput: string;
  setSearchInput: React.Dispatch<React.SetStateAction<string>>;
  selectedEmail: Email | null; // this is the email that is currently selected by the user
  setSelectedEmail: React.Dispatch<React.SetStateAction<Email | null>>;
  emails: {
    sent: Email[];
    inbox: Email[];
  };
  setEmails: React.Dispatch<
    React.SetStateAction<{
      sent: Email[];
      inbox: Email[];
    }>
  >;
  currTab: EMAIL_BOX;
  setCurrTab: React.Dispatch<React.SetStateAction<EMAIL_BOX>>;
  replyTo: Email | undefined;
  setReplyTo: React.Dispatch<React.SetStateAction<Email | undefined>>;
  account: string | null;
  handleSignMessage: (data: Uint8Array) => Promise<Uint8Array>;
  wallet: Wallet | null;
  isLoading: boolean;
  getSentEmails: () => Promise<void>;
  isSentEmailLoading: boolean;
  getReceivedEmails: () => Promise<void>;
  isReceivedEmailLoading: boolean;
  emailBot: boolean;
  setEmailBot: React.Dispatch<React.SetStateAction<boolean>>;
  pushChain: PushChain | null;
}

export const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState<string>('');
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null);
  const [pushChain, setPushChain] = useState<PushChain | null>(null);
  const [pushEmail, setPushEmail] = useState<PushMail | null>(null);
  const [currTab, setCurrTab] = useState<EMAIL_BOX>(EMAIL_BOX.INBOX);
  const [emails, setEmails] = useState<{
    sent: Email[];
    inbox: Email[];
  }>({
    sent: [],
    inbox: [],
  });
  const [replyTo, setReplyTo] = useState<Email | undefined>(undefined);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSentEmailLoading, setIsSentEmailLoading] = useState(false);
  const [isReceivedEmailLoading, setIsReceivedEmailLoading] = useState(false);
  const [emailBot, setEmailBot] = useState(false);

  const { universalAddress, handleSignMessage } = usePushWalletContext();

  const getSentEmails = async () => {
    if (!universalAddress || !pushChain || isSentEmailLoading) return;
    setIsSentEmailLoading(true);
    try {
      const data = await getSentPushEmails(pushChain, universalAddress);
      setEmails((prev) => ({
        ...prev,
        sent: data,
      }));
    } finally {
      setIsSentEmailLoading(false);
    }
  };

  const getReceivedEmails = async () => {
    if (!universalAddress || !pushChain || isReceivedEmailLoading) return;
    setIsReceivedEmailLoading(true);
    try {
      const data = await getReceivedPushEmails(pushChain, universalAddress);
      setEmails((prev) => ({
        ...prev,
        inbox: data,
      }));
    } finally {
      setIsReceivedEmailLoading(false);
    }
  };

  const getEmails = async () => {
    if (!universalAddress || !pushChain) return;
    setIsLoading(true);
    try {
      await Promise.all([getSentEmails(), getReceivedEmails()]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (
      selectedEmail &&
      selectedEmail.txHash !== 'welcome' &&
      universalAddress
    ) {
      checkAndUpdateReceiveEmailActivity(
        universalAddress,
        selectedEmail.txHash
      );
    }
  }, [selectedEmail, universalAddress]);

  useEffect(() => {
    if (!universalAddress || !pushChain) return;
    getEmails();
    const interval = setInterval(() => {
      getSentEmails();
      getReceivedEmails();
    }, 5 * 60 * 1000); // 5 minutes interval

    return () => clearInterval(interval);
  }, [universalAddress, pushChain]);

  useEffect(() => {
    if (account) {
      const { chainId, address, chain } = getWalletDataFromAccount(account);
      setWallet({ address, chainId, chain });
    }
  }, [account]);

  useEffect(() => {
    if (universalAddress) {
      setAccount(getFullCaipAddress(universalAddress));
      checkAndUpdateActivity(universalAddress);
    }
  }, [universalAddress]);

  useEffect(() => {
    if (universalAddress) {
      const setNetwork = async () => {
        const signer = createUniversalSigner({
          address: universalAddress.address,
          chain: universalAddress.chain,
          chainId: universalAddress.chainId,
          signMessage: async (data: Uint8Array) => {
            try {
              return await handleSignMessage(data);
            } catch (error) {
              console.error('Error signing with Push Wallet:', error);
              throw error;
            }
          },
        });
        try {
          const pushNetworkInstance = await PushChain.initialize(signer, {
            network: CONSTANTS.ENV.DEVNET,
            rpcUrl: RPC_URL,
          });
          setPushChain(pushNetworkInstance);
        } catch (error) {
          console.error('Error initializing Push Network:', error);
          alert(`Error initializing Push Network`);
        }
      };
      setNetwork();
    }
  }, [universalAddress]);

  return (
    <AppContext.Provider
      value={{
        searchInput,
        setSearchInput,
        selectedEmail,
        setSelectedEmail,
        emails,
        setEmails,
        currTab,
        setCurrTab,
        replyTo,
        setReplyTo,
        account,
        handleSignMessage,
        wallet,
        isLoading,
        getSentEmails,
        isSentEmailLoading,
        getReceivedEmails,
        isReceivedEmailLoading,
        emailBot,
        setEmailBot,
        pushChain,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return context;
}

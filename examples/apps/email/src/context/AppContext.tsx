'use client';
import { PushNetwork } from '@pushprotocol/push-chain';
import React, { createContext, useContext } from 'react';
import { ENV } from '@pushprotocol/push-chain/src/lib/constants';
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
  transformEmails,
  Wallet,
} from '@/common';
import {
  checkAndUpdateActivity,
  checkAndUpdateReceiveEmailActivity,
} from '@/services/rewards';

interface AppContextType {
  searchInput: string;
  setSearchInput: React.Dispatch<React.SetStateAction<string>>;
  selectedEmail: Email | null; // this is the email that is currently selected by the user
  setSelectedEmail: React.Dispatch<React.SetStateAction<Email | null>>;
  pushNetwork: PushNetwork | null;
  setPushNetwork: React.Dispatch<React.SetStateAction<PushNetwork | null>>;
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
}

export const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState<string>('');
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null);
  const [pushNetwork, setPushNetwork] = useState<PushNetwork | null>(null);
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
    if (!account || !pushEmail || isSentEmailLoading) return;
    setIsSentEmailLoading(true);
    console.log('check');
    try {
      const sent = await pushEmail.getBySender(account);
      setEmails((prev) => ({
        ...prev,
        sent: transformEmails(sent),
      }));
    } catch (err) {
      console.log('Error fetching Sent Emails', err);
    } finally {
      setIsSentEmailLoading(false);
    }
  };

  const getReceivedEmails = async () => {
    if (!account || !pushEmail || isReceivedEmailLoading) return;
    setIsReceivedEmailLoading(true);
    try {
      const received = await pushEmail.getByRecipient(account);
      setEmails((prev) => ({
        ...prev,
        inbox: transformEmails(received),
      }));
    } catch (err) {
      console.log('Error fetching Received Emails', err);
    } finally {
      setIsReceivedEmailLoading(false);
    }
  };

  const getEmails = async () => {
    if (!account || !pushEmail) return;
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
    if (!account || !pushEmail) return;
    getEmails();
    const interval = setInterval(() => {
      getSentEmails();
      getReceivedEmails();
    }, 5 * 60 * 1000); // 5 minutes interval

    return () => clearInterval(interval);
  }, [account, pushEmail]);

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
    const setNetwork = async () => {
      try {
        const pushNetworkInstance = await PushNetwork.initialize(ENV.DEV);
        const pushMail = await PushMail.initialize(ENV.DEV);
        setPushNetwork(pushNetworkInstance);
        setPushEmail(pushMail);
      } catch (error) {
        console.error('Error initializing Push Network:', error);
      }
    };
    setNetwork();
  }, []);
  return (
    <AppContext.Provider
      value={{
        searchInput,
        setSearchInput,
        selectedEmail,
        setSelectedEmail,
        pushNetwork,
        setPushNetwork,
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

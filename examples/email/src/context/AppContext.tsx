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
import { IEmail, Wallet } from '@/helpers/types';

interface AppContextType {
  searchInput: string;
  setSearchInput: React.Dispatch<React.SetStateAction<string>>;
  selectedEmail: IEmail | null; // this is the email that is currently selected by the user
  setSelectedEmail: React.Dispatch<React.SetStateAction<IEmail | null>>;
  pushNetwork: PushNetwork | null;
  setPushNetwork: React.Dispatch<React.SetStateAction<PushNetwork | null>>;
  emails: {
    sent: IEmail[];
    inbox: IEmail[];
  };
  setEmails: React.Dispatch<
    React.SetStateAction<{
      sent: IEmail[];
      inbox: IEmail[];
    }>
  >;
  currTab: 'inbox' | 'sent';
  setCurrTab: React.Dispatch<React.SetStateAction<'inbox' | 'sent'>>;
  replyTo: IEmail | undefined;
  setReplyTo: React.Dispatch<React.SetStateAction<IEmail | undefined>>;
  account: string | null;
  handleSendSignRequestToPushWallet: (data: Uint8Array) => Promise<Uint8Array>;
  wallet: Wallet | null;
  getEmails: () => Promise<void>;
}

export const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const [searchInput, setSearchInput] = useState<string>('');
  const [selectedEmail, setSelectedEmail] = useState<IEmail | null>(null);
  const [pushNetwork, setPushNetwork] = useState<PushNetwork | null>(null);
  const [currTab, setCurrTab] = useState<'inbox' | 'sent'>('inbox');
  const [emails, setEmails] = useState<{
    sent: IEmail[];
    inbox: IEmail[];
  }>({
    sent: [],
    inbox: [],
  });
  const [replyTo, setReplyTo] = useState<IEmail | undefined>(undefined);
  const [wallet, setWallet] = useState<Wallet | null>(null);

  const { account, handleSendSignRequestToPushWallet } = usePushWalletContext();

  const getEmails = async () => {
    if (!account) return;
    const pushMail = await PushMail.initialize(ENV.DEV);
    const [sent, received] = await Promise.all([
      pushMail.getBySender(account),
      pushMail.getByRecipient(account),
    ]);

    console.log(sent, received);

    setEmails({
      sent: sent.map((email: any) => ({
        from: email.from,
        to: email.to,
        subject: email.subject,
        timestamp: email.ts,
        body: email.body.content,
        attachments: email.attachments,
        txHash: email.txHash,
      })),
      inbox: received.map((email: any) => ({
        from: email.from,
        to: email.to,
        subject: email.subject,
        timestamp: email.ts,
        body: email.body.content,
        attachments: email.attachments,
        txHash: email.txHash,
      })),
    });
  };

  useEffect(() => {
    getEmails();
  }, [account]);

  useEffect(() => {
    if (account) {
      const { chainId, address, chain } = getWalletDataFromAccount(account);
      setWallet({ address, chainId, chain });
    }
  }, [account]);

  useEffect(() => {
    const setNetwork = async () => {
      try {
        const pushNetworkInstance = await PushNetwork.initialize(ENV.DEV);
        console.log('Push Network initialized:', pushNetworkInstance);
        setPushNetwork(pushNetworkInstance);
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
        handleSendSignRequestToPushWallet,
        wallet,
        getEmails,
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

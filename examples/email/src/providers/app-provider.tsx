'use client';
import { AppContext } from '@/context/app-context';
import { IEmail } from '@/types';
import { PushNetwork } from '@pushprotocol/push-chain';
import { ENV } from '@pushprotocol/push-chain/src/lib/constants';
import { usePushWalletContext } from '@pushprotocol/pushchain-ui-kit';
import PushMail from 'push-mail';
import { ReactNode, useEffect, useState } from 'react';

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

  const { account, handleSendSignRequestToPushWallet } = usePushWalletContext();

  const getEmails = async (account: string) => {
    const pushMail = await PushMail.initialize(ENV.DEV);
    const [sent, received] = await Promise.all([
      pushMail.getBySender(account),
      pushMail.getByRecipient(account),
    ]);

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
    if (account) {
      getEmails(account);
    }
  }, [pushNetwork, account]);

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
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

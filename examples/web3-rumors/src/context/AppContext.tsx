'use client';
import { PushNetwork } from '@pushprotocol/push-chain';
import React, { createContext, useContext } from 'react';
import { ENV } from '@pushprotocol/push-chain/src/lib/constants';
import { usePushWalletContext } from '@pushprotocol/pushchain-ui-kit';
import { ReactNode, useEffect, useState } from 'react';
import { getFullCaipAddress, RumorType, TABS } from '@/common';
import { getConfessions } from '@/services/getConfessions';
import { getSentConfessions } from '@/services/getSentConfessions';
import { checkAndUpdateActivity } from '@/services/rewards';

interface AppContextType {
  pushNetwork: PushNetwork | null;
  setPushNetwork: React.Dispatch<React.SetStateAction<PushNetwork | null>>;
  currTab: TABS;
  setCurrTab: React.Dispatch<React.SetStateAction<TABS>>;
  account: string | null;
  handleSendSignRequestToPushWallet: (data: Uint8Array) => Promise<Uint8Array>;
  fetchSentConfessions: (page: number) => Promise<void>;
  fetchConfessions: (page: number) => Promise<void>;
  data: {
    [TABS.LATEST]: RumorType[];
    [TABS.MY_RUMORS]: RumorType[];
  };
  setData: React.Dispatch<
    React.SetStateAction<{
      [TABS.LATEST]: RumorType[];
      [TABS.MY_RUMORS]: RumorType[];
    }>
  >;
  hasMore: {
    [TABS.LATEST]: boolean;
    [TABS.MY_RUMORS]: boolean;
  };
  loading: {
    [TABS.LATEST]: boolean;
    [TABS.MY_RUMORS]: boolean;
  };
}

export const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<string | null>(null);
  const [pushNetwork, setPushNetwork] = useState<PushNetwork | null>(null);
  const [currTab, setCurrTab] = useState<TABS>(TABS.LATEST);
  const [data, setData] = useState<{
    [TABS.LATEST]: RumorType[];
    [TABS.MY_RUMORS]: RumorType[];
  }>({
    [TABS.LATEST]: [],
    [TABS.MY_RUMORS]: [],
  });
  const [loading, setLoading] = useState({
    [TABS.LATEST]: true,
    [TABS.MY_RUMORS]: true,
  });
  const [hasMore, setHasMore] = useState({
    [TABS.LATEST]: true,
    [TABS.MY_RUMORS]: true,
  });

  const { universalAddress, handleSendSignRequestToPushWallet } =
    usePushWalletContext();

  const fetchConfessions = async (page: number) => {
    if (!pushNetwork) return;
    setLoading((prev) => ({
      ...prev,
      [TABS.LATEST]: true,
    }));
    try {
      const fetchedConfessions = await getConfessions(pushNetwork, page, 15);
      if (fetchedConfessions.length > 0) {
        setData((prev) => ({
          ...prev,
          [TABS.LATEST]: [
            ...new Map(
              [...prev[TABS.LATEST], ...fetchedConfessions].map((item) => [
                item.txnHash,
                item,
              ])
            ).values(),
          ],
        }));
      } else {
        setHasMore((prev) => ({
          ...prev,
          [TABS.LATEST]: false,
        }));
      }
    } catch (error) {
      console.error('Error fetching confessions:', error);
    } finally {
      setLoading((prev) => ({
        ...prev,
        [TABS.LATEST]: false,
      }));
    }
  };

  const fetchSentConfessions = async (page: number) => {
    if (!account || !pushNetwork) return;
    setLoading((prev) => ({
      ...prev,
      [TABS.MY_RUMORS]: true,
    }));
    try {
      // const address = extractWalletAddress(account);
      if (!account) {
        throw new Error('No wallet connected');
      }
      const fetchedSentConfessions = await getSentConfessions(
        pushNetwork,
        account,
        page,
        15
      );
      if (fetchedSentConfessions.length > 0) {
        setData((prev) => ({
          ...prev,
          [TABS.MY_RUMORS]: [
            ...new Map(
              [...prev[TABS.MY_RUMORS], ...fetchedSentConfessions].map(
                (item) => [item.txnHash, item]
              )
            ).values(),
          ],
        }));
      } else {
        setHasMore((prev) => ({
          ...prev,
          [TABS.MY_RUMORS]: false,
        }));
      }
    } catch (error) {
      console.error('Error fetching sent confessions:', error);
    } finally {
      setLoading((prev) => ({
        ...prev,
        [TABS.MY_RUMORS]: false,
      }));
    }
  };

  useEffect(() => {
    fetchConfessions(1);
  }, [pushNetwork]);

  useEffect(() => {
    fetchSentConfessions(1);
  }, [account, pushNetwork]);

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
        pushNetwork,
        setPushNetwork,
        currTab,
        setCurrTab,
        account,
        handleSendSignRequestToPushWallet,
        fetchSentConfessions,
        fetchConfessions,
        data,
        setData,
        hasMore,
        loading,
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

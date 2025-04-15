'use client';
import React, { createContext, useContext } from 'react';
import { usePushWalletContext } from '@pushprotocol/pushchain-ui-kit';
import { ReactNode, useEffect, useState } from 'react';
import { RPC_URL, RumorType, TABS } from '@/common';
import { getConfessions } from '@/services/getConfessions';
import { getSentConfessions } from '@/services/getSentConfessions';
import { checkAndUpdateActivity } from '@/services/rewards';
import { CONSTANTS, createUniversalSigner, PushChain } from '@pushchain/devnet';

interface AppContextType {
  pushChain: PushChain | null;
  setPushChain: React.Dispatch<React.SetStateAction<PushChain | null>>;
  currTab: TABS;
  setCurrTab: React.Dispatch<React.SetStateAction<TABS>>;
  account: string | null;
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
  const [pushChain, setPushChain] = useState<PushChain | null>(null);
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

  const { universalAddress, handleSignMessage } = usePushWalletContext();

  const fetchConfessions = async (page: number) => {
    if (!pushChain) return;
    setLoading((prev) => ({
      ...prev,
      [TABS.LATEST]: true,
    }));
    try {
      const fetchedConfessions = await getConfessions(pushChain, page, 15);
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
    if (!universalAddress || !pushChain) return;
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
        pushChain,
        universalAddress,
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
  }, [pushChain]);

  useEffect(() => {
    fetchSentConfessions(1);
  }, [account, pushChain]);

  useEffect(() => {
    if (universalAddress) {
      setAccount(PushChain.utils.account.toChainAgnostic(universalAddress));
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
        pushChain,
        setPushChain,
        currTab,
        setCurrTab,
        account,
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

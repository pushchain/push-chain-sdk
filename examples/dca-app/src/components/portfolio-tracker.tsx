import { useEffect, useState } from 'react';
import { Card } from './ui/card';
import { Switch } from './ui/switch';
import { Label } from './ui/label';
import PortfolioChart from './portfolio-chart';
import WalletAssetsTable from './ui/wallet-assets-table';
import { goldrushClient } from '@/lib/utils';

import { Chain } from '@covalenthq/client-sdk';
import type {
  BalancesResponse,
  Transaction,
  GoldRushResponse,
} from '@covalenthq/client-sdk';

export default function PortfolioTracker({
  walletAddress,
  chainId,
  onUpdate,
}: {
  walletAddress: string;
  chainId: number;
  onUpdate: (data: any) => void;
}) {
  const [showSmallHoldings, setShowSmallHoldings] = useState(false);
  const [balances, setBalances] = useState<BalancesResponse | null>(null);
  const [allTransactions, setAllTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchBalances = async (chainName: Chain, walletAddress: string) => {
      setLoading(true);
      try {
        const response: GoldRushResponse<BalancesResponse> =
          await goldrushClient.BalanceService.getTokenBalancesForWalletAddress(
            chainName,
            walletAddress,
            { quoteCurrency: 'USD' }
          );

        if (response.data) {
          setBalances(response.data);
          onUpdate({
            address: walletAddress,
            totalValue: response.data.items?.reduce((sum, item) => sum + (item.quote || 0), 0),
            assets: response.data.items?.map(item => ({
              symbol: item.contract_ticker_symbol,
              balance: item.balance,
              value: item.quote || 0,
            })),
          });
        }
      } catch (error) {
        console.error('Error fetching balances:', error);
      } finally {
        setLoading(false);
      }
    };

    if (walletAddress) {
      fetchBalances(chainId, walletAddress);
    }
  }, [walletAddress, chainId]);

  useEffect(() => {
    const fetchTransactions = async (
      chainName: Chain,
      walletAddress: string
    ) => {
      const allFetchedTransactions: Transaction[] = [];
      let currentPage = 1;
      const maxPages = 15;

      try {
        // Fetch first page
        let response =
          await goldrushClient.TransactionService.getAllTransactionsForAddressByPage(
            chainName,
            walletAddress,
            {
              quoteCurrency: 'USD',
              noLogs: false,
            }
          );

        // Process first page
        if (response?.data?.items) {
          allFetchedTransactions.push(...response.data.items);
        }

        // Continue fetching while there's a next page and we haven't hit max pages
        while (response?.data?.next && currentPage < maxPages) {
          currentPage++;
          response = await response.data.next();

          if (response?.data?.items) {
            allFetchedTransactions.push(...response.data.items);
          }
        }

        // Set state once with all collected transactions
        setAllTransactions(allFetchedTransactions);
      } catch (error) {
        console.error('Error fetching transactions:', error);
      }
    };

    if (walletAddress) {
      fetchTransactions(chainId, walletAddress);
    }
  }, [walletAddress, chainId]);
  return (
    <div className="w-full mx-auto space-y-4">
      <div className="bg-gray-800/50 border border-gray-700 rounded-xl overflow-hidden">
        <PortfolioChart walletAddress={walletAddress} chainId={chainId} />
      </div>
      
      <div className="flex justify-end py-4 items-center space-x-2">
        <Switch
          id="hide-small-assets"
          onCheckedChange={(e) => {
            if (e) {
              setShowSmallHoldings(true);
            } else {
              setShowSmallHoldings(false);
            }
          }}
          className="data-[state=checked]:bg-blue-600"
        />
        <Label htmlFor="hide-small-assets" className="text-gray-300">
          Show Small Holdings
        </Label>
      </div>
      
      {!loading && (
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl overflow-hidden">
          <WalletAssetsTable
            balances={balances!}
            allTransactions={allTransactions}
            walletAddress={walletAddress as string}
            showSmallHoldings={showSmallHoldings}
          />
        </div>
      )}
      
      {loading && (
        <div className="flex justify-center items-center h-12 bg-gray-800/50 border border-gray-700 rounded-xl">
          <p className="text-gray-400">Loading...</p>
        </div>
      )}
    </div>
  );
}
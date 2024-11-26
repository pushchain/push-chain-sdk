import { useEffect, useState } from 'react';

import { Card } from './ui/card';
import { Switch } from './ui/switch';
import { Label } from './ui/label';
import PortfolioChart from './portfolio-chart';
import WalletAssetsTable from './ui/wallet-assets-table';

import { goldrushClient } from '@/lib/utils';

import { useAccount } from 'wagmi';

export default function PortfolioTracker() {
  const [showSmallHoldings, setShowSmallHoldings] = useState(false);
  const [balances, setBalances] = useState<any>(null);
  const [allTransactions, setAllTransactions] = useState<any>([]);
  const [loading, setLoading] = useState(false);
  const { address: walletAddress } = useAccount();
  useEffect(() => {
    const fetchAllTransactions = async () => {
      let page = 1;
      let allTx: any[] = [];
      let hasMore = true;
      const chainName = 'base-mainnet';
      while (hasMore) {
        try {
          const response =
            await goldrushClient.TransactionService.getTransactionsForAddressV3(
              chainName,
              walletAddress as string,
              page,
              {
                quoteCurrency: 'USD',
                noLogs: false,
              }
            );

          if (
            response.data &&
            response.data.items &&
            response.data.items.length > 0
          ) {
            allTx = [...allTx, ...response.data.items];
            page++;
          } else {
            hasMore = false;
          }

          // Optional: Add a reasonable limit to prevent infinite loops
          if (page > 15) hasMore = false; // Adjust limit as needed
        } catch (error) {
          console.error('Error fetching transactions:', error);
          hasMore = false;
        }
      }

      return allTx;
    };

    const fetchData = async () => {
      setLoading(true);
      try {
        // Fetch balances
        const chainName = 'base-mainnet';
        const balancesResponse =
          await goldrushClient.BalanceService.getTokenBalancesForWalletAddress(
            chainName,
            walletAddress as string,
            { quoteCurrency: 'USD' }
          );
        if (balancesResponse.data) setBalances(balancesResponse.data);

        // Fetch all transactions
        const transactions = await fetchAllTransactions();
        setAllTransactions(transactions);
      } catch (error) {
        console.error('Error fetching data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [walletAddress]);

  return (
    <div className="w-full mx-auto">
      <Card className="px-2 py-4 flex flex-col gap-2">
        <PortfolioChart />
      </Card>
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
        />
        <Label htmlFor="hide-small-assets">Show Small Holdings</Label>
      </div>
      {!loading && (
        <WalletAssetsTable
          balances={balances}
          allTransactions={allTransactions}
          walletAddress={walletAddress}
          showSmallHoldings={showSmallHoldings}
        />
      )}
      {loading && (
        <div className="flex justify-center items-center h-12">
          <p className="text-gray-500">Loading...</p>
        </div>
      )}
    </div>
  );
}

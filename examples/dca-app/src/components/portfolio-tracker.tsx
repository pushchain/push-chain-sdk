import { useEffect, useState } from 'react';
import { Card } from './ui/card';
import { Switch } from './ui/switch';
import { Label } from './ui/label';
import PortfolioChart from './portfolio-chart';
import WalletAssetsTable from './ui/wallet-assets-table';
import { goldrushClient } from '@/lib/utils';
import { useAccount, useChainId } from 'wagmi';
import { Chain } from '@covalenthq/client-sdk';
import type {
  BalancesResponse,
  Transaction,
  GoldRushResponse,
  TransactionsResponse,
} from '@covalenthq/client-sdk';

export default function PortfolioTracker() {
  const [showSmallHoldings, setShowSmallHoldings] = useState(false);
  const [balances, setBalances] = useState<BalancesResponse | null>(null);
  const [allTransactions, setAllTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);
  const { address: walletAddress } = useAccount();
  const chaindId = useChainId();
  useEffect(() => {
    const fetchBalances = async (chainName: Chain) => {
      setLoading(true);
      try {
        const response: GoldRushResponse<BalancesResponse> =
          await goldrushClient.BalanceService.getTokenBalancesForWalletAddress(
            chainName,
            walletAddress as string,
            { quoteCurrency: 'USD' }
          );

        if (response.data) {
          setBalances(response.data);
        }
      } catch (error) {
        console.error('Error fetching balances:', error);
      } finally {
        setLoading(false);
      }
    };

    if (walletAddress) {
      fetchBalances(chaindId);
    }
  }, [walletAddress]);

  useEffect(() => {
    const fetchTransactions = async (chainName: Chain) => {
      let page = 1;
      const maxPages = 15;
      setAllTransactions([]);

      const fetchPage = async (chainName: Chain) => {
        try {
          const response: GoldRushResponse<TransactionsResponse> =
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
            response &&
            response.data &&
            response.data.items &&
            response.data?.items?.length > 0
          ) {
            setAllTransactions((prevTx: Transaction[]) => [
              ...prevTx,
              ...(response.data?.items || []),
            ]);

            if (page < maxPages) {
              page++;
              await fetchPage(chainName);
            }
          }
        } catch (error) {
          console.error(`Error fetching transactions page ${page}:`, error);
        }
      };

      fetchPage(chainName);
    };

    if (walletAddress) {
      fetchTransactions(chaindId);
    }
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
          balances={balances!}
          allTransactions={allTransactions}
          walletAddress={walletAddress as string}
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

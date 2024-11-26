import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import { goldrushClient } from '@/lib/utils';

import { TransactionsTable } from './ui/transactions-table';

import { useAccount } from 'wagmi';
import { Transaction } from '@/types';
import { Switch } from './ui/switch';
import { Label } from './ui/label';
import PortfolioChart from './portfolio-chart';
import WalletAssetsTable from './ui/wallet-assets-table';
import WalletTransactions from './wallet-transactions';
import WalletTokenTransfers from './wallet-transactions';

const mockTransactions: Transaction[] = [
  {
    id: '1',
    date: '2023-05-01',
    type: 'buy',
    coin: 'Bitcoin',
    amount: 0.5,
    price: 28000,
  },
  {
    id: '2',
    date: '2023-05-15',
    type: 'buy',
    coin: 'Ethereum',
    amount: 2,
    price: 1800,
  },
  {
    id: '3',
    date: '2023-06-01',
    type: 'sell',
    coin: 'Bitcoin',
    amount: 0.1,
    price: 30000,
  },
  {
    id: '4',
    date: '2023-06-15',
    type: 'buy',
    coin: 'Cardano',
    amount: 1000,
    price: 0.35,
  },
];

export default function PortfolioTracker() {
  const [showSmallHoldings, setShowSmallHoldings] = useState(false);

  const [balances, setBalances] = useState<any>(null);
  const { address } = useAccount();
  useEffect(() => {
    const fetchBalances = async () => {
      if (!address) return;
      const response =
        await goldrushClient.BalanceService.getTokenBalancesForWalletAddress(
          'base-mainnet',
          address as string,
          { quoteCurrency: 'USD' }
        );
      setBalances(response.data || null);
    };
    fetchBalances();
  }, [address]);

  return (
    <div className="w-full mx-auto">
      {/* <div className="flex flex-col  gap-4">
        <Card className="p-4 flex flex-col gap-2">
          <PortfolioChart />
        </Card>
        <Tabs
          defaultValue="assets"
          className="w-full h-full p-4 border rounded-xl"
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger
              value="assets"
              className="data-[state=active]:bg-gray-400/30 backdrop-blur-sm"
            >
              Assets
            </TabsTrigger>
            <TabsTrigger
              value="transactions"
              className="data-[state=active]:bg-gray-400/30 backdrop-blur-sm"
            >
              Transactions
            </TabsTrigger>
          </TabsList>
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
          <TabsContent value="transactions">
            <WalletTokenTransfers chainName={'base-mainnet'} />
          </TabsContent>
          <TabsContent value="assets">
            <WalletAssetsTable
              balances={balances}
              showSmallHoldings={showSmallHoldings}
            />
          </TabsContent>
        </Tabs>
      </div> */}
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
      <WalletAssetsTable
        balances={balances}
        showSmallHoldings={showSmallHoldings}
      />
    </div>
  );
}

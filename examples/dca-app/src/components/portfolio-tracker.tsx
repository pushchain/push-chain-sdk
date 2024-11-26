import { useEffect, useState } from 'react';
import { Card, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import { alchemy, TimeRange, timeRanges } from '@/lib/utils';
import { TimeRangeSelector } from './ui/time-range-selector';
import { CryptoChart } from './ui/crypto-chart';

import { TransactionsTable } from './ui/transactions-table';
import { AssetsTable } from './ui/sets-table';
import fetchTokenPrices from '@/lib/getTokenPrice';
import { useAccount } from 'wagmi';
import { Asset, Transaction } from '@/types';
import { Switch } from './ui/switch';
import { Label } from './ui/label';

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
  const [selectedRange, setSelectedRange] = useState<TimeRange>('7d');
  const [accountAssets, setAccountAssets] = useState<Asset[]>([]);
  const [showSmallHoldings, setShowSmallHoldings] = useState(false);
  const { address } = useAccount();
  const handleRangeChange = (range: TimeRange) => {
    setSelectedRange(range);
  };

  const fetchAssets = async () => {
    const balances = await alchemy.core.getTokenBalances(address!);

    if (balances) {
      const nonZeroBalances = balances.tokenBalances.filter(
        (balance) => Number(balance.tokenBalance) > 0
      );

      const promises = nonZeroBalances.map(async (balance) => {
        const [price, metadata] = await Promise.all([
          fetchTokenPrices([
            {
              network: 'base-mainnet',
              address: balance.contractAddress,
            },
          ]),
          alchemy.core.getTokenMetadata(balance.contractAddress),
        ]);

        return { price, metadata, balance: Number(balance.tokenBalance) };
      });

      const results = await Promise.all(promises);
      const assets = results.filter((result) => result.price != null);

      const assetsData = [];
      for (const asset of assets) {
        const value =
          asset.price! *
          (asset.balance / 10 ** (asset.metadata?.decimals ?? 0));
        const assetData = {
          coin: asset.metadata?.symbol ?? 'Unknown',
          amount: asset.balance / 10 ** (asset.metadata?.decimals ?? 0),
          price: asset.price!,
          value,
        };
        assetsData.push(assetData);
      }

      //  Get ETH balance and add it to the assets
      const ethBalance = await alchemy.core.getBalance(address!, 'latest');
      const ethPrice = await fetchTokenPrices([
        {
          network: 'base-mainnet',
          address: '0x4200000000000000000000000000000000000006',
        },
      ]);

      const ethHolding = {
        coin: 'ETH',
        amount: Number(ethBalance._hex) / 10 ** 18,
        price: ethPrice ?? 0,
        value: (Number(ethBalance._hex) / 10 ** 18) * (ethPrice ?? 0),
      };
      assetsData.push(ethHolding);
      setAccountAssets(assetsData.sort((a, b) => b.value - a.value));
    }
  };

  useEffect(() => {
    fetchAssets();
  }, [address]);

  return (
    <div className="w-full mx-auto">
      <div className="my-4 flex flex-col gap-2">
        <CardTitle>Portfolio</CardTitle>
      </div>
      <div className="flex flex-col  gap-4">
        <Card className="p-4 flex flex-col gap-2">
          <TimeRangeSelector
            selectedRange={selectedRange}
            onRangeChange={handleRangeChange}
          />
          <CryptoChart data={timeRanges[selectedRange]} />
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
            <TransactionsTable transactions={mockTransactions} />
          </TabsContent>
          <TabsContent value="assets">
            <AssetsTable
              assets={
                showSmallHoldings
                  ? accountAssets
                  : accountAssets.filter((asset) => asset.value > 1)
              }
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

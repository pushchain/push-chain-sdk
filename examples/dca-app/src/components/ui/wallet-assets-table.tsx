import { useState, useEffect } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from './card';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { format } from 'date-fns';

import { Loader2, MoveDownLeft, MoveUpRight } from 'lucide-react';
import { BalancesResponse, Transaction } from '@covalenthq/client-sdk';
import { AssetTransactionHistoryProps } from '@/types';

const formatBalance = (
  balance: bigint | null,
  decimals: number | null
): string => {
  if (balance === null) {
    return '';
  }
  const divisor = BigInt(10 ** (decimals ?? 0));
  const integerPart = balance / divisor;
  const fractionalPart = balance % divisor;
  const paddedFractionalPart = fractionalPart
    .toString()
    .padStart(decimals ?? 0, '0');
  return `${integerPart}.${paddedFractionalPart}`;
};

const AssetTransactionHistory: React.FC<AssetTransactionHistoryProps> = ({
  asset,
  allTransactions,
  walletAddress,
}) => {
  const [loading, setLoading] = useState(true);
  const [assetTransactions, setAssetTransactions] = useState<
    {
      timestamp: Date;
      hash: string;
      amount: bigint;
      type: string;
      from: string;
      to: string;
      successful: boolean;
      value_quote: number;
      pretty_value_quote: string;
    }[]
  >([]);
  const [costAnalysis, setCostAnalysis] = useState<{
    avgCost: number;
    totalInvested: number;
    totalTokens: bigint;
  }>({
    avgCost: 0,
    totalInvested: 0,
    totalTokens: BigInt(0),
  });

  useEffect(() => {
    if (!allTransactions || !asset) return;

    const processTransactions = async () => {
      try {
        const processedTx = allTransactions
          .flatMap((tx) => {
            const changes = [];

            // Handle native token transfers
            if (asset.native_token && BigInt(tx.value) > 0) {
              const isIncoming =
                tx.to_address.toLowerCase() === walletAddress.toLowerCase();
              changes.push({
                timestamp: tx.block_signed_at,
                hash: tx.tx_hash,
                amount: tx.value,
                type: isIncoming ? 'receive' : 'send',
                from: tx.from_address,
                to: tx.to_address,
                successful: tx.successful,
                value_quote: tx.value_quote,
                pretty_value_quote: tx.pretty_value_quote,
              });
            }

            // Handle ERC20 transfers
            if (!asset.native_token && tx.log_events) {
              const transfers = tx.log_events.filter(
                (event) =>
                  event.decoded?.name === 'Transfer' &&
                  event.sender_address?.toLowerCase() ===
                    asset.contract_address!.toLowerCase() &&
                  (event.decoded?.params[0].value.toLowerCase() ===
                    walletAddress.toLowerCase() ||
                    event.decoded?.params[1].value.toLowerCase() ===
                      walletAddress.toLowerCase())
              );

              transfers.forEach(async (transfer) => {
                const isIncoming =
                  transfer.decoded &&
                  transfer.decoded.params[1].value.toLowerCase() ===
                    walletAddress.toLowerCase();
                if (transfer.decoded) {
                  changes.push({
                    timestamp: tx.block_signed_at,
                    hash: tx.tx_hash,
                    amount: transfer.decoded.params[2].value,
                    type: isIncoming ? 'receive' : 'send',
                    from: transfer.decoded.params[0].value,
                    to: transfer.decoded.params[1].value,
                    successful: tx.successful,
                    value_quote: tx.value_quote,
                    pretty_value_quote: tx.pretty_value_quote,
                  });
                }
              });
            }

            return changes;
          })
          .filter((tx) => tx.successful);

        // Sort transactions by timestamp
        const sortedTx = processedTx.sort(
          (a, b) =>
            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );

        let totalTokens = BigInt(0);
        let totalInvested = 0;

        // Process only incoming transfers as "buys"
        sortedTx.forEach((tx) => {
          const amount = BigInt(tx.amount);
          if (tx.type === 'receive') {
            const valueAtTime = tx.value_quote || 0;
            totalTokens += amount;
            totalInvested += valueAtTime;
          }
        });

        // Calculate average cost
        const avgCost =
          totalTokens > BigInt(0)
            ? totalInvested /
              Number(formatBalance(totalTokens, asset.contract_decimals))
            : 0;

        setCostAnalysis({
          avgCost,
          totalInvested,
          totalTokens,
        });
        setAssetTransactions(sortedTx);
      } catch (error) {
        console.error('Error processing transactions:', error);
      } finally {
        setLoading(false);
      }
    };

    processTransactions();
  }, [asset, allTransactions, walletAddress]);

  if (loading) {
    return (
      <div className="flex justify-center p-4">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  const currentValue = asset.quote || 0;
  const currentBalance = asset.balance || BigInt(0);
  const unrealizedPnL =
    currentBalance > BigInt(0)
      ? currentValue -
        costAnalysis.avgCost *
          Number(formatBalance(currentBalance, asset.contract_decimals))
      : 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-4 p-4 bg-gray-50 rounded-lg">
        <div>
          <p className="text-sm text-gray-500">Average Cost Per Token</p>
          <p className="font-medium">${costAnalysis.avgCost.toFixed(2)}</p>
        </div>
        <div>
          <p className="text-sm text-gray-500">Current Price</p>
          <p className="font-medium">
            $
            {(
              currentValue /
              Number(formatBalance(currentBalance, asset.contract_decimals))
            ).toFixed(2)}
          </p>
        </div>
        <div>
          <p className="text-sm text-gray-500">PnL</p>
          <p
            className={`font-medium ${
              unrealizedPnL >= 0 ? 'text-green-600' : 'text-red-600'
            }`}
          >
            {unrealizedPnL.toFixed(2)}%
          </p>
        </div>
      </div>

      {assetTransactions.length === 0 ? (
        <p className="text-sm text-gray-500 p-4">No transfers found</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Price at Time</TableHead>
              <TableHead>Value</TableHead>
              <TableHead>Tx Hash</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {assetTransactions.map((transfer, index) => {
              const amount = BigInt(transfer.amount);
              const formattedAmount = Number(
                formatBalance(amount, asset.contract_decimals)
              );
              const priceAtTime = transfer.value_quote / formattedAmount;

              return (
                <TableRow key={`${transfer.hash}-${index}`}>
                  <TableCell>
                    {format(new Date(transfer.timestamp), 'MMM dd, yyyy HH:mm')}
                  </TableCell>
                  <TableCell>
                    {transfer.type === 'receive' ? (
                      <MoveDownLeft color={'green'} />
                    ) : (
                      <MoveUpRight color="red" />
                    )}
                  </TableCell>
                  <TableCell>
                    <span
                      className={
                        transfer.type === 'receive'
                          ? 'text-green-600'
                          : 'text-red-600'
                      }
                    >
                      {transfer.type === 'receive' ? '+' : '-'}
                      {formatBalance(amount, asset.contract_decimals)}
                    </span>
                  </TableCell>
                  <TableCell>${priceAtTime.toFixed(2)}</TableCell>
                  <TableCell>{transfer.pretty_value_quote || 'N/A'}</TableCell>
                  <TableCell>
                    <a
                      href={`https://etherscan.io/tx/${transfer.hash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:text-blue-800 text-sm"
                    >
                      {transfer.hash.slice(0, 6)}...{transfer.hash.slice(-4)}
                    </a>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
};
const WalletAssetsTable = ({
  balances,
  showSmallHoldings = false,
  allTransactions,
  walletAddress,
}: {
  balances: BalancesResponse;
  showSmallHoldings?: boolean;
  allTransactions: Transaction[];
  walletAddress: string;
}) => {
  if (!balances || !balances.items || balances.items.length === 0) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Wallet Assets</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-center text-gray-500">No assets found</p>
        </CardContent>
      </Card>
    );
  }

  // Filter items based on showSmallHoldings
  const filteredItems = showSmallHoldings
    ? balances.items
    : balances.items.filter((item) => item.quote && item.quote >= 1);

  return (
    <Card className="w-full">
      <CardContent>
        <Accordion type="single" collapsible className="w-full">
          {filteredItems.map((item, index) => (
            <AccordionItem
              key={`${item.contract_address}-${index}`}
              value={item.contract_address || 'native'}
            >
              <AccordionTrigger className="hover:no-underline">
                <div className="flex flex-1 items-center justify-between pr-4">
                  <div className="flex flex-col">
                    <span className="font-medium">{item.contract_name}</span>
                    <span className="text-sm text-gray-500">
                      {item.contract_ticker_symbol}
                    </span>
                  </div>
                  <div className="flex items-center gap-8">
                    <div className="text-right">
                      <div>
                        {formatBalance(item.balance, item.contract_decimals)}
                      </div>
                      <div className="text-sm text-gray-500">
                        {item.pretty_quote}
                      </div>
                    </div>
                    <div>
                      <span
                        className={
                          item.quote && item.quote_24h
                            ? item.quote > item.quote_24h
                              ? 'text-green-600'
                              : item.quote < item.quote_24h
                                ? 'text-red-600'
                                : 'text-gray-600'
                            : 'text-gray-600'
                        }
                      >
                        {item.quote_24h && item.quote
                          ? `${(((item.quote - item.quote_24h) / item.quote_24h) * 100).toFixed(2)}%`
                          : 'N/A'}
                      </span>
                    </div>
                  </div>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <AssetTransactionHistory
                  asset={item}
                  allTransactions={allTransactions as any}
                  walletAddress={walletAddress}
                />
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </CardContent>
    </Card>
  );
};

export default WalletAssetsTable;

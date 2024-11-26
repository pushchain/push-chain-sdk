import React, { useState, useEffect } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { format } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';

// Helper function to format balance using contract decimals
const formatBalance = (balance: bigint, decimals: number): string => {
  const divisor = BigInt(10 ** decimals);
  const integerPart = balance / divisor;
  const fractionalPart = balance % divisor;
  const paddedFractionalPart = fractionalPart
    .toString()
    .padStart(decimals, '0');
  return `${integerPart}.${paddedFractionalPart}`;
};

const AssetTransactionHistory = ({ asset, allTransactions, walletAddress }) => {
  const [loading, setLoading] = useState(true);
  const [assetTransactions, setAssetTransactions] = useState([]);

  useEffect(() => {
    if (!allTransactions || !asset) return;

    // Filter and process transactions for this specific asset
    const filteredTx = allTransactions
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
                asset.contract_address.toLowerCase() &&
              (event.decoded.params[0].value.toLowerCase() ===
                walletAddress.toLowerCase() ||
                event.decoded.params[1].value.toLowerCase() ===
                  walletAddress.toLowerCase())
          );

          transfers.forEach((transfer) => {
            const isIncoming =
              transfer.decoded.params[1].value.toLowerCase() ===
              walletAddress.toLowerCase();
            changes.push({
              timestamp: tx.block_signed_at,
              hash: tx.tx_hash,
              amount: transfer.decoded.params[2].value,
              type: isIncoming ? 'receive' : 'send',
              from: transfer.decoded.params[0].value,
              to: transfer.decoded.params[1].value,
              successful: tx.successful,
            });
          });
        }

        return changes;
      })
      .filter((tx) => tx.successful);

    setAssetTransactions(filteredTx);
    setLoading(false);
  }, [asset, allTransactions, walletAddress]);

  if (loading) {
    return (
      <div className="flex justify-center p-4">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (assetTransactions.length === 0) {
    return <p className="text-sm text-gray-500 p-4">No transfers found</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Amount</TableHead>
          <TableHead>Value</TableHead>
          <TableHead>From/To</TableHead>
          <TableHead>Tx Hash</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {assetTransactions.map((transfer, index) => (
          <TableRow key={`${transfer.hash}-${index}`}>
            <TableCell>
              {format(new Date(transfer.timestamp), 'MMM dd, yyyy HH:mm')}
            </TableCell>
            <TableCell>
              <Badge
                variant={transfer.type === 'receive' ? 'success' : 'secondary'}
                className={
                  transfer.type === 'receive'
                    ? 'bg-green-100 text-green-800'
                    : 'bg-gray-100 text-gray-800'
                }
              >
                {transfer.type === 'receive' ? 'Received' : 'Sent'}
              </Badge>
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
                {formatBalance(
                  BigInt(transfer.amount),
                  asset.contract_decimals
                )}
              </span>
            </TableCell>
            <TableCell>{transfer.pretty_value_quote || 'N/A'}</TableCell>
            <TableCell>
              <div className="flex flex-col gap-1">
                <span className="text-xs">
                  From: {transfer.from.slice(0, 6)}...{transfer.from.slice(-4)}
                </span>
                <span className="text-xs">
                  To: {transfer.to.slice(0, 6)}...{transfer.to.slice(-4)}
                </span>
              </div>
            </TableCell>
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
        ))}
      </TableBody>
    </Table>
  );
};

const WalletAssetsTable = ({
  balances,
  showSmallHoldings = false,
  allTransactions, // Changed from transactions to allTransactions to be more explicit
  walletAddress,
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
    : balances.items.filter((item) => item.quote >= 1);

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
                          item.quote > item.quote_24h
                            ? 'text-green-600'
                            : item.quote < item.quote_24h
                              ? 'text-red-600'
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
                  allTransactions={allTransactions}
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

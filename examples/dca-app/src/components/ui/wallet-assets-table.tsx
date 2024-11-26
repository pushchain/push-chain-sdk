import React from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

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

const WalletAssetsTable = ({ balances, showSmallHoldings = false }) => {
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
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Asset</TableHead>
              <TableHead>Balance</TableHead>
              <TableHead>Value</TableHead>
              <TableHead>24h Change</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredItems.map((item, index) => (
              <TableRow key={`${item.contract_address}-${index}`}>
                <TableCell>
                  <div className="flex flex-col">
                    <span className="font-medium">{item.contract_name}</span>
                    <span className="text-sm text-gray-500">
                      {item.contract_ticker_symbol}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  {formatBalance(item.balance, item.contract_decimals)}
                </TableCell>
                <TableCell>{item.pretty_quote}</TableCell>
                <TableCell>
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
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
};

export default WalletAssetsTable;

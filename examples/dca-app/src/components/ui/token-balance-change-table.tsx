import React from 'react';
import { format } from 'date-fns';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardFooter,
} from '@/components/ui/card';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
import { Badge } from '@/components/ui/badge';

const formatTokenAmount = (
  value: string | bigint,
  decimals: number
): string => {
  if (typeof value === 'string') {
    value = BigInt(value);
  }
  const divisor = BigInt(10 ** decimals);
  const integerPart = value / divisor;
  const fractionalPart = value % divisor;
  const paddedFractional = fractionalPart.toString().padStart(decimals, '0');
  const fractionalDisplay = paddedFractional.slice(0, Math.min(4, decimals));
  return `${integerPart}${fractionalDisplay !== '0000' ? '.' + fractionalDisplay : ''}`;
};

const TokenBalanceChangesTable = ({
  transactions,
  currentPage,
  onPageChange,
}) => {
  if (!transactions || !transactions.items || transactions.items.length === 0) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Token Balance Changes</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-center text-gray-500">No token transfers found</p>
        </CardContent>
      </Card>
    );
  }

  // Filter and transform transactions that represent token balance changes
  const tokenChanges = transactions.items
    .flatMap((tx) => {
      const changes = [];

      // Handle native ETH transfers
      if (BigInt(tx.value) > 0) {
        const isIncoming =
          tx.to_address.toLowerCase() === transactions.address.toLowerCase();
        changes.push({
          type: isIncoming ? 'receive' : 'send',
          timestamp: tx.block_signed_at,
          hash: tx.tx_hash,
          successful: tx.successful,
          token: {
            symbol: transactions.chain_name.split('-')[0].toUpperCase(),
            amount: tx.value,
            decimals: 18, // ETH has 18 decimals
            value: tx.value_quote,
            prettyValue: tx.pretty_value_quote,
            isNative: true,
          },
        });
      }

      // Handle ERC20 transfers
      if (tx.log_events) {
        const transferEvents = tx.log_events.filter(
          (event) =>
            event.decoded?.name === 'Transfer' &&
            event.decoded?.params.length === 3 &&
            (event.decoded.params[0].value.toLowerCase() ===
              transactions.address.toLowerCase() ||
              event.decoded.params[1].value.toLowerCase() ===
                transactions.address.toLowerCase())
        );

        transferEvents.forEach((event) => {
          const isReceiving =
            event.decoded.params[1].value.toLowerCase() ===
            transactions.address.toLowerCase();

          // Skip if we can't determine the token details
          if (
            !event.sender_contract_ticker_symbol ||
            !event.sender_contract_decimals
          ) {
            return;
          }

          changes.push({
            type: isReceiving ? 'receive' : 'send',
            timestamp: tx.block_signed_at,
            hash: tx.tx_hash,
            successful: tx.successful,
            token: {
              symbol: event.sender_contract_ticker_symbol,
              name: event.sender_contract_name,
              amount: event.decoded.params[2].value,
              decimals: event.sender_contract_decimals,
              logo: event.sender_logo_url,
              contract: event.sender_address,
              isNative: false,
            },
          });
        });
      }

      return changes;
    })
    .filter((change) => change.successful); // Only show successful transactions

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Token Balance Changes ({transactions.chain_name})</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Token</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Transaction</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tokenChanges.map((change, index) => (
              <TableRow
                key={`${change.hash}-${index}`}
                className="hover:bg-gray-50"
              >
                <TableCell>
                  <div className="flex flex-col">
                    <span>
                      {format(new Date(change.timestamp), 'MMM dd, yyyy')}
                    </span>
                    <span className="text-sm text-gray-500">
                      {format(new Date(change.timestamp), 'HH:mm:ss')}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center">
                      {change.token.symbol[0]}
                    </div>
                    <div className="flex flex-col">
                      <span className="font-medium">{change.token.symbol}</span>
                      {!change.token.isNative && (
                        <span className="text-xs text-gray-500">
                          {change.token.contract.slice(0, 6)}...
                          {change.token.contract.slice(-4)}
                        </span>
                      )}
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <span
                    className={
                      change.type === 'receive'
                        ? 'text-green-600'
                        : 'text-red-600'
                    }
                  >
                    {change.type === 'receive' ? '+' : '-'}
                    {formatTokenAmount(
                      change.token.amount,
                      change.token.decimals
                    )}{' '}
                    {change.token.symbol}
                  </span>
                </TableCell>
                <TableCell>
                  <a
                    href={`https://etherscan.io/tx/${change.hash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:text-blue-800"
                  >
                    {change.hash.slice(0, 6)}...{change.hash.slice(-4)}
                  </a>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
      <CardFooter className="flex justify-center">
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                onClick={() => onPageChange(currentPage - 1)}
                disabled={currentPage === 1}
              />
            </PaginationItem>
            <PaginationItem>
              <PaginationNext
                onClick={() => onPageChange(currentPage + 1)}
                disabled={!transactions.next}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      </CardFooter>
    </Card>
  );
};

export default TokenBalanceChangesTable;

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
  value: bigint | string | number,
  decimals: number = 18
): string => {
  if (typeof value === 'bigint') {
    const divisor = BigInt(10 ** decimals);
    const integerPart = value / divisor;
    const fractionalPart = value % divisor;
    return `${integerPart}.${fractionalPart.toString().padStart(decimals, '0').slice(0, 4)}`;
  }
  return Number(value).toFixed(4);
};

const PortfolioTransactionsTable = ({
  transactions,
  currentPage,
  onPageChange,
}) => {
  if (!transactions || !transactions.items || transactions.items.length === 0) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Portfolio Transactions</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-center text-gray-500">No asset changes found</p>
        </CardContent>
      </Card>
    );
  }

  // Filter and transform transactions that represent asset changes
  const assetChanges = transactions.items.flatMap((tx) => {
    const changes = [];

    // Handle DEX transactions
    if (tx.dex_details && tx.dex_details.length > 0) {
      tx.dex_details.forEach((dex) => {
        changes.push({
          type: 'swap',
          timestamp: tx.block_signed_at,
          hash: tx.tx_hash,
          successful: tx.successful,
          protocol: dex.protocol_name,
          tokenIn: {
            symbol: dex.token_0_ticker,
            amount: dex.token_0_amount,
            value: dex.token_0_usd_quote,
            prettyValue: dex.pretty_token_0_usd_quote,
            logo: dex.token_0_logo_url,
          },
          tokenOut: {
            symbol: dex.token_1_ticker,
            amount: dex.token_1_amount,
            value: dex.token_1_usd_quote,
            prettyValue: dex.pretty_token_1_usd_quote,
            logo: dex.token_1_logo_url,
          },
        });
      });
    }

    // Handle ERC20 transfers
    if (tx.log_events) {
      const transferEvents = tx.log_events.filter(
        (event) =>
          event.decoded?.name === 'Transfer' &&
          (event.decoded.params[0].value.toLowerCase() ===
            transactions.address.toLowerCase() ||
            event.decoded.params[1].value.toLowerCase() ===
              transactions.address.toLowerCase())
      );

      transferEvents.forEach((event) => {
        const isReceiving =
          event.decoded.params[1].value.toLowerCase() ===
          transactions.address.toLowerCase();
        changes.push({
          type: isReceiving ? 'receive' : 'send',
          timestamp: tx.block_signed_at,
          hash: tx.tx_hash,
          successful: tx.successful,
          protocol: 'Transfer',
          token: {
            symbol: event.sender_contract_ticker_symbol,
            amount: event.decoded.params[2].value,
            decimals: event.sender_contract_decimals,
            logo: event.sender_logo_url,
          },
        });
      });
    }

    return changes;
  });

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>
          Portfolio Asset Changes ({transactions.chain_name})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Details</TableHead>
              <TableHead>Protocol</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {assetChanges.map((change, index) => (
              <TableRow key={`${change.hash}-${index}`}>
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
                  <Badge
                    variant={
                      change.type === 'swap'
                        ? 'default'
                        : change.type === 'receive'
                          ? 'success'
                          : 'secondary'
                    }
                  >
                    {change.type.charAt(0).toUpperCase() + change.type.slice(1)}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex flex-col gap-1">
                    {change.type === 'swap' ? (
                      <>
                        <div className="flex items-center gap-2">
                          <span className="text-red-600">
                            -{formatTokenAmount(change.tokenIn.amount)}{' '}
                            {change.tokenIn.symbol}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <img
                            src={
                              change.tokenOut.logo || '/api/placeholder/16/16'
                            }
                            alt={change.tokenOut.symbol}
                            className="w-4 h-4 rounded-full"
                          />
                          <span className="text-green-600">
                            +{formatTokenAmount(change.tokenOut.amount)}{' '}
                            {change.tokenOut.symbol}
                          </span>
                        </div>
                      </>
                    ) : (
                      <div className="flex items-center gap-2">
                        <img
                          src={change.token.logo || '/api/placeholder/16/16'}
                          alt={change.token.symbol}
                          className="w-4 h-4 rounded-full"
                        />
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
                      </div>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <span className="text-sm">{change.protocol}</span>
                </TableCell>
                <TableCell>
                  {change.successful ? (
                    <Badge
                      variant="success"
                      className="bg-green-100 text-green-800"
                    >
                      Success
                    </Badge>
                  ) : (
                    <Badge
                      variant="destructive"
                      className="bg-red-100 text-red-800"
                    >
                      Failed
                    </Badge>
                  )}
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

export default PortfolioTransactionsTable;

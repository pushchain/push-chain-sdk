import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Asset } from '@/types';

interface AssetsTableProps {
  assets: Asset[];
}

export function AssetsTable({ assets }: AssetsTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Coin</TableHead>
          <TableHead>Amount</TableHead>
          <TableHead>Price (USD)</TableHead>
          <TableHead>Value (USD)</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {assets.map((asset) => (
          <TableRow key={asset.coin}>
            <TableCell className="font-semibold">{asset.coin}</TableCell>
            <TableCell>
              {Number.isInteger(asset.amount)
                ? asset.amount
                : asset.amount.toFixed(4)}
            </TableCell>
            <TableCell>${asset.price.toFixed(4)}</TableCell>
            <TableCell>${asset.value.toFixed(2)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

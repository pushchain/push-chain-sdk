// import { goldrushClient } from '@/lib/utils';
// import { useState, useEffect } from 'react';
// import TransactionsTable from './ui/wallet-transactions-table';
// import { useAccount } from 'wagmi';
// import PortfolioTransactionsTable from './ui/wallet-transactions-table';

import { useEffect, useState } from 'react';
import TokenBalanceChangesTable from './ui/token-balance-change-table';
import { goldrushClient } from '@/lib/utils';
import { useAccount } from 'wagmi';

// const WalletTransactions = ({ chainName }) => {
//   const [transactions, setTransactions] = useState<any>(null);
//   const [currentPage, setCurrentPage] = useState(1);
//   const [loading, setLoading] = useState(false);
//   const { address } = useAccount();

//   const fetchTransactions = async (page: number) => {
//     setLoading(true);
//     try {
//       const response =
//         await goldrushClient.TransactionService.getTransactionsForAddressV3(
//           chainName,
//           address as string,
//           page,
//           { quoteCurrency: 'USD' }
//         );
//       setTransactions(response.data);
//     } catch (error) {
//       console.error('Error fetching transactions:', error);
//     } finally {
//       setLoading(false);
//     }
//   };

//   useEffect(() => {
//     fetchTransactions(currentPage);
//   }, [currentPage, chainName, address]);

//   const handlePageChange = (newPage: number) => {
//     setCurrentPage(newPage);
//   };

//   if (loading) return <div>Loading...</div>;

//   return (
//     <PortfolioTransactionsTable
//       transactions={transactions}
//       currentPage={currentPage}
//       onPageChange={handlePageChange}
//     />
//   );
// };

// export default WalletTransactions;

const WalletTokenTransfers = ({ chainName }) => {
  const [transactions, setTransactions] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const { address: walletAddress } = useAccount();

  const fetchTransactions = async (page: number) => {
    setLoading(true);
    try {
      const response =
        await goldrushClient.TransactionService.getTransactionsForAddressV3(
          chainName,
          walletAddress as string,
          page,
          {
            quoteCurrency: 'USD',
            noLogs: false, // Required to get ERC20 transfers
          }
        );
      setTransactions(response.data);
    } catch (error) {
      console.error('Error fetching transactions:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTransactions(currentPage);
  }, [currentPage, chainName, walletAddress]);

  const handlePageChange = (newPage: number) => {
    setCurrentPage(newPage);
  };

  if (loading) return <div>Loading...</div>;

  return (
    <TokenBalanceChangesTable
      transactions={transactions}
      currentPage={currentPage}
      onPageChange={handlePageChange}
    />
  );
};

export default WalletTokenTransfers;

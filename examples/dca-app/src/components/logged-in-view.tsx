import { useEffect, useState } from 'react';
import { useAccount, useChainId } from 'wagmi';
import { usePrivy } from '@privy-io/react-auth';
import { PushNetwork } from '@pushprotocol/push-chain';
import protobuf from 'protobufjs';
import { ethers } from 'ethers';
import PortfolioTracker from './portfolio-tracker';
import ConnectedWalletCard from './ui/connected-wallet-card';
import { useAppContext } from '@/context/app-context';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { isAddress } from 'viem';

// Define the protobuf schema for portfolio data
const portfolioSchema = `
  syntax = "proto3";

  message PortfolioData {
    string address = 1;
    double totalValue = 2;
    repeated Asset assets = 3;
  }

  message Asset {
    string symbol = 1;
    double balance = 2;
    double value = 3;
  }
`;

const Header = () => {
  const { logout } = usePrivy();

  return (
    <div className="flex flex-row justify-between items-center my-6 md:my-8">
      <h2 className="text-2xl font-bold text-[#3B82F6]">Dashboard</h2>
      <div className="flex items-center gap-4">
        <ConnectedWalletCard />
        <Button 
          onClick={logout}
          className="bg-[#3B82F6] text-white hover:bg-[#2563EB]"
        >
          Logout
        </Button>
      </div>
    </div>
  );
};

const MainContent = () => {
  const { address } = useAccount();
  const chainId = useChainId();
  const { watchAccount, setWatchAccount, pushAccount, pushNetwork } = useAppContext();
  const [watchAddresses, setWatchAddresses] = useState<string[]>([]);
  const [newWatchAddress, setNewWatchAddress] = useState('');
  const [selectedAddress, setSelectedAddress] = useState<string | null>(null);
  const [portfolioData, setPortfolioData] = useState(null);

  useEffect(() => {
    const savedAddresses = localStorage.getItem('watchedAddresses');
    if (savedAddresses) {
      setWatchAddresses(JSON.parse(savedAddresses));
    }
    setSelectedAddress(address || null);
  }, [address]);

  const addWatchAddress = () => {
    if (isAddress(newWatchAddress) && !watchAddresses.includes(newWatchAddress)) {
      const updatedAddresses = [...watchAddresses, newWatchAddress];
      setWatchAddresses(updatedAddresses);
      localStorage.setItem('watchedAddresses', JSON.stringify(updatedAddresses));
      setNewWatchAddress('');
      setWatchAccount(newWatchAddress);
      setSelectedAddress(newWatchAddress);
    }
  };

  const selectAddress = (addr: string | null) => {
    setSelectedAddress(addr);
    setWatchAccount(addr || '');
  };

  const storePortfolioData = async (data: any) => {
    if (!pushAccount || !pushNetwork) {
      console.log("Push Wallet not connected. Skipping on-chain storage.");
      return;
    }
  
    try {
      // Create a protobuf root and load the schema
      const root = await protobuf.parse(portfolioSchema).root;
  
      // Obtain a message type
      const PortfolioData = root.lookupType("PortfolioData");
  
      // Format the data to ensure all numeric values are properly converted
      const formattedData = {
        address: data.address,
        totalValue: Number(data.totalValue || 0), // Ensure it's a number, default to 0
        assets: data.assets.map((asset: any) => ({
          symbol: asset.symbol,
          // Convert BigInt or numeric values to Number, with fallback to 0
          balance: Number(asset.balance || 0),
          value: Number(asset.value || 0)
        }))
      };
  
      // Verify the data against the schema
      const errMsg = PortfolioData.verify(formattedData);
      if (errMsg) throw Error(errMsg);
  
      // Encode the object into a binary format
      const buffer = PortfolioData.encode(PortfolioData.create(formattedData)).finish();
  
      // Create an unsigned transaction
      const unsignedTx = pushNetwork.tx.createUnsigned(
        "CUSTOM:PORTFOLIO_DATA",
        [`${pushAccount}`],
        buffer
      );
  
      const signer = {
        account: `${pushAccount}`,
        signMessage: async (data: any) => {
          const signature = await pushNetwork.wallet.sign(data);
          return ethers.getBytes(signature);
        },
      };
  
      // Send a transaction
      const txHash = await pushNetwork.tx.send(unsignedTx, signer);
      console.log("Portfolio data stored on Push Chain. Transaction Hash:", txHash);
    } catch (error) {
      console.error("Error storing portfolio data on Push Chain:", error);
    }
  };
  const onPortfolioUpdate = (newData: any) => {
    setPortfolioData(newData);
    storePortfolioData(newData);
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-6">
        <Input
          value={newWatchAddress}
          onChange={(e) => setNewWatchAddress(e.target.value)}
          placeholder="Add a wallet to watch"
          className="flex-1"
        />
        <Button 
          onClick={addWatchAddress} 
          disabled={!isAddress(newWatchAddress)}
          className="bg-[#3B82F6] text-white hover:bg-[#2563EB]"
        >
          Add
        </Button>
      </div>
      
      <div className="mb-4 flex flex-wrap gap-2">
        <Button
          variant="ghost"
          className={`text-sm ${selectedAddress === address ? 'bg-[#3B82F6] text-white' : 'text-gray-600'}`}
          onClick={() => selectAddress(address || null)}
        >
          Your Wallet
        </Button>
        {watchAddresses.map((addr) => (
          <Button
            key={addr}
            variant="ghost"
            className={`text-sm ${addr === selectedAddress ? 'bg-[#3B82F6] text-white' : 'text-gray-600'}`}
            onClick={() => selectAddress(addr)}
          >
            {addr.slice(0, 6)}...{addr.slice(-4)}
          </Button>
        ))}
      </div>

      <div>
        <h3 className="text-lg font-semibold mb-4">
          {selectedAddress === address ? 'Your Portfolio:' : 'Watched Portfolio:'}
        </h3>
        <PortfolioTracker 
          walletAddress={selectedAddress || address!} 
          chainId={selectedAddress === address ? chainId : 1}
          onUpdate={onPortfolioUpdate}
        />
      </div>
    </div>
  );
};

const LoggedInView = () => {
  return (
    <div className="w-[90vw] md:w-[96vw] m-auto">
      <Header />
      <MainContent />
    </div>
  );
};

export default LoggedInView;


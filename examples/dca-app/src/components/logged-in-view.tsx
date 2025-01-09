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
import { usePushWalletContext } from '@pushprotocol/pushchain-ui-kit';

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
    <div className="flex flex-row justify-between items-center py-6 md:py-8">
      <h2 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-blue-600">
        Dashboard
      </h2>
      <div className="flex items-center gap-4">
        <ConnectedWalletCard />
        <Button 
          onClick={logout}
          className="bg-blue-600 hover:bg-blue-700 text-white transition-colors"
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
  const { handleSendSignRequestToPushWallet, connectionStatus } = usePushWalletContext();
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

    if (connectionStatus !== "connected") {
      console.log("Push Wallet not connected. Current status:", connectionStatus);
      return;
    }
  
    try {
      console.log("Starting portfolio data storage...");
      
      // Create a protobuf root and load the schema
      const root = await protobuf.parse(portfolioSchema).root;
      const PortfolioData = root.lookupType("PortfolioData");
  
      // Format the data
      const formattedData = {
        address: data.address,
        totalValue: Number(data.totalValue || 0),
        assets: data.assets.map((asset: any) => ({
          symbol: asset.symbol,
          balance: Number(asset.balance || 0),
          value: Number(asset.value || 0)
        }))
      };
  
      // Verify the data
      const errMsg = PortfolioData.verify(formattedData);
      if (errMsg) throw Error(errMsg);
  
      // Encode the data
      const buffer = PortfolioData.encode(PortfolioData.create(formattedData)).finish();
  
      console.log("Creating unsigned transaction...");
      // Create an unsigned transaction
      const unsignedTx = pushNetwork.tx.createUnsigned(
        "CUSTOM:PORTFOLIO_DATA",
        [`${pushAccount}`],
        buffer
      );
  
      console.log("Setting up signer...");
      const signer = {
        account: `${pushAccount}`,
        signMessage: async (data: any) => {
          console.log("Signing message...");
          try {
            const signature = await handleSendSignRequestToPushWallet(new Uint8Array(data));
            return signature;
          } catch (error) {
            console.error("Error signing message:", error);
            throw error;
          }
        },
      };
  
      console.log("Sending transaction...");
      // Send transaction
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
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Input
          value={newWatchAddress}
          onChange={(e) => setNewWatchAddress(e.target.value)}
          placeholder="Add a wallet to watch"
          className="flex-1 bg-white/5 border-gray-700 text-white placeholder:text-gray-400"
        />
        <Button 
          onClick={addWatchAddress} 
          disabled={!isAddress(newWatchAddress)}
          className="bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:bg-blue-800 disabled:text-gray-300"
        >
          Add
        </Button>
      </div>
      
      <div className="flex flex-wrap gap-2">
        <Button
          variant="ghost"
          className={`text-sm transition-colors ${
            selectedAddress === address 
              ? 'bg-blue-600 text-white hover:bg-blue-700' 
              : 'text-gray-300 hover:bg-white/5'
          }`}
          onClick={() => selectAddress(address || null)}
        >
          Your Wallet
        </Button>
        {watchAddresses.map((addr) => (
          <Button
            key={addr}
            variant="ghost"
            className={`text-sm transition-colors ${
              addr === selectedAddress 
                ? 'bg-blue-600 text-white hover:bg-blue-700' 
                : 'text-gray-300 hover:bg-white/5'
            }`}
            onClick={() => selectAddress(addr)}
          >
            {addr.slice(0, 6)}...{addr.slice(-4)}
          </Button>
        ))}
      </div>

      <div>
        <h3 className="text-lg font-semibold mb-4 text-blue-400">
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
    <div className="min-h-screen bg-gradient-to-b from-gray-900 to-black text-white">
      <div className="max-w-6xl mx-auto px-4">
        <Header />
        <MainContent />
      </div>
    </div>
  );
};

export default LoggedInView;
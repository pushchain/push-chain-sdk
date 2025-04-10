import { useEffect, useState } from 'react';
import { useAccount, useChainId } from 'wagmi';
import { usePrivy } from '@privy-io/react-auth';
import { PushNetwork } from '@pushprotocol/push-chain';
import protobuf from 'protobufjs';
import PortfolioTracker from './portfolio-tracker';
import ConnectedWalletCard from './ui/connected-wallet-card';
import { useAppContext } from '@/context/app-context';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
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
  const { setPushAccount } = useAppContext();

  const handleLogout = () => {
    setPushAccount(null);
    logout();
  };

  return (
    <div className="flex flex-row justify-between items-center py-6 md:py-8">
      <h2 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-blue-600">
        DCA Portfolio Tracker
      </h2>
      <div className="flex items-center gap-4">
        <ConnectedWalletCard />
        <Button 
          onClick={handleLogout}
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

  // Extract the actual address from pushAccount (it's in format 'eip155:1:0x...')
  const pushAccountAddress = pushAccount ? pushAccount.split(':').pop() : null;

  // Set selectedAddress to pushAccountAddress if nothing else is selected
  useEffect(() => {
    if (!selectedAddress && pushAccountAddress) {
      setSelectedAddress(pushAccountAddress);
    }
  }, [pushAccountAddress]);

  useEffect(() => {
    const savedAddresses = localStorage.getItem('watchedAddresses');
    if (savedAddresses) {
      setWatchAddresses(JSON.parse(savedAddresses));
    }
    setSelectedAddress(address || pushAccountAddress || null);
  }, [address, pushAccountAddress]);

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
      
      const root = await protobuf.parse(portfolioSchema).root;
      const PortfolioData = root.lookupType("PortfolioData");
  
      const formattedData = {
        address: data.address,
        totalValue: Number(data.totalValue || 0),
        assets: data.assets.map((asset: any) => ({
          symbol: asset.symbol,
          balance: Number(asset.balance || 0),
          value: Number(asset.value || 0)
        }))
      };
  
      const errMsg = PortfolioData.verify(formattedData);
      if (errMsg) throw Error(errMsg);
  
      const buffer = PortfolioData.encode(PortfolioData.create(formattedData)).finish();
  
      console.log("Creating unsigned transaction...");
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
        {(address || pushAccountAddress) && (
          <Button
            variant="ghost"
            className={`text-sm transition-colors ${
              selectedAddress === (address || pushAccountAddress) 
                ? 'bg-blue-600 text-white hover:bg-blue-700' 
                : 'text-gray-300 hover:bg-white/5'
            }`}
            onClick={() => selectAddress(address || pushAccountAddress)}
          >
            Your Wallet
          </Button>
        )}
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
          {selectedAddress === (address || pushAccountAddress) 
            ? 'Your Portfolio:' 
            : 'Watched Portfolio:'}
        </h3>
        {(selectedAddress || pushAccountAddress || address) ? (
          <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-4">
            <PortfolioTracker 
              walletAddress={selectedAddress || pushAccountAddress || address!} 
              chainId={selectedAddress === (address || pushAccountAddress) ? chainId : 1}
              onUpdate={onPortfolioUpdate}
            />
          </div>
        ) : (
          <div className="p-4 bg-gray-800/50 border border-gray-700 rounded-xl">
            <p className="text-gray-400">Please connect a wallet to view portfolio</p>
          </div>
        )}
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
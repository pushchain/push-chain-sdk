import { useAppContext } from '@/context/app-context';
import { useEffect } from 'react';
import { ConnectPushWalletButton } from '@pushprotocol/pushchain-ui-kit';
import { usePushWalletContext } from '@pushprotocol/pushchain-ui-kit';
import { LineChart, TrendingUp, Wallet, Eye } from 'lucide-react';

const FeatureCard = ({ icon, title, description }) => (
  <div className="bg-white/5 backdrop-blur-lg rounded-lg p-6 flex flex-col items-center text-center max-w-sm">
    <div className="bg-blue-500/10 p-3 rounded-full mb-4">
      {icon}
    </div>
    <h3 className="text-lg font-semibold mb-2 text-blue-500">{title}</h3>
    <p className="text-gray-600 dark:text-gray-300">{description}</p>
  </div>
);

const LoggedOutView = () => {
  const { setPushAccount } = useAppContext();
  const { account: pushWalletAccount } = usePushWalletContext();

  useEffect(() => {
    if (pushWalletAccount) {
      setPushAccount(pushWalletAccount);
    }
  }, [pushWalletAccount, setPushAccount]);

  return (
    <div className="w-screen min-h-screen bg-gradient-to-b from-gray-900 to-black text-white">
      <div className="max-w-6xl mx-auto px-4 py-12">
        {/* Hero Section */}
        <div className="text-center mb-16">
          <h1 className="text-4xl md:text-6xl font-bold mb-6 bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-blue-600">
            DCA Portfolio Tracker
          </h1>
          <p className="text-xl text-gray-300 mb-8 max-w-2xl mx-auto">
            Track your DCA investments and monitor any wallet's portfolio with on-chain data storage powered by Push Chain.
          </p>
          <div className="flex justify-center">
            <ConnectPushWalletButton showLogOutButton />
          </div>
        </div>

        {/* Features Section */}
        <div className="grid md:grid-cols-3 gap-8 mb-16">
          <FeatureCard
            icon={<TrendingUp size={24} className="text-blue-500" />}
            title="DCA Investment Tracking"
            description="Monitor your dollar-cost averaging strategy with detailed portfolio analytics and performance metrics."
          />
          <FeatureCard
            icon={<Eye size={24} className="text-blue-500" />}
            title="Multi-Wallet Monitoring"
            description="Watch and analyze multiple wallet addresses to track various investment strategies or portfolios."
          />
          <FeatureCard
            icon={<Wallet size={24} className="text-blue-500" />}
            title="Push Chain Integration"
            description="Secure on-chain storage of portfolio data using Push Chain for reliable and transparent tracking."
          />
        </div>

        {/* How It Works Section */}
        <div className="text-center mb-16">
          <h2 className="text-2xl font-bold mb-6">How It Works</h2>
          <div className="grid md:grid-cols-3 gap-6 text-left">
            <div className="bg-white/5 p-4 rounded-lg">
              <span className="text-blue-500 font-bold text-lg">1.</span>
              <p>Connect your Push wallet to get started with secure authentication</p>
            </div>
            <div className="bg-white/5 p-4 rounded-lg">
              <span className="text-blue-500 font-bold text-lg">2.</span>
              <p>Add wallets to track their DCA and portfolio performance</p>
            </div>
            <div className="bg-white/5 p-4 rounded-lg">
              <span className="text-blue-500 font-bold text-lg">3.</span>
              <p>Monitor investments with real-time updates and analytics</p>
            </div>
          </div>
        </div>

        {/* Security Note */}
        <div className="text-center">
          <p className="text-sm text-gray-400">
            Powered by Push Chain for secure, decentralized portfolio tracking
          </p>
        </div>
      </div>
    </div>
  );
};

export default LoggedOutView;
import PortfolioTracker from './portfolio-tracker';
import ConnectedWalletCard from './ui/connected-wallet-card';

const Header = () => {
  return (
    <div className="flex flex-row justify-between my-6 md:my-8">
      <h2 className="scroll-m-20 pb-2 text-3xl font-semibold tracking-tight first:mt-0 bg-gradient-to-r from-blue-600 to-blue-400 text-transparent bg-clip-text">
        Dashboard
      </h2>
      <ConnectedWalletCard />
    </div>
  );
};

const MainContent = () => {
  return (
    <div>
      <PortfolioTracker />
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

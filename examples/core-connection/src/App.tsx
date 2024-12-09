import React from 'react';
import { WalletProvider, ENV } from '@pushprotocol/pushchain-ui-kit';
import { HomePage } from './components/HomePage';

const App: React.FC = () => {
  return (
    <WalletProvider env={ENV.PROD}>
      <HomePage />
    </WalletProvider>
  );
};

export default App;

import React from 'react';
import { WalletProvider } from '../../../packages/ui-kit/src/lib';
import { HomePage } from './components/HomePage';
import { ENV } from '../../../packages/ui-kit/src';

const App: React.FC = () => {
  return (
    <WalletProvider env={ENV.PROD}>
      <HomePage />
    </WalletProvider>
  );
};

export default App;

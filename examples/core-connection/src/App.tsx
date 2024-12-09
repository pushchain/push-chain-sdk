import React from 'react';
import { WalletProvider, ENV } from '../../../packages/ui-kit/src';
import { HomePage } from './components/HomePage';

const App: React.FC = () => {
  return (
    <WalletProvider env={ENV.LOCAL}>
      <HomePage />
    </WalletProvider>
  );
};

export default App;

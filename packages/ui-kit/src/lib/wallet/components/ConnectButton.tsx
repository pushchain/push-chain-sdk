import React from 'react';
import { useWallet } from '../WalletProvider';

export const ConnectWalletButton: React.FC = () => {
  const { isConnected, address, connectWallet, disconnectWallet } = useWallet();

  return (
    <div>
      {isConnected ? (
        <div>
          <p>Connected as: {address}</p>
          <button onClick={disconnectWallet}>Disconnect Wallet</button>
        </div>
      ) : (
        <button onClick={connectWallet}>Connect Wallet</button>
      )}
    </div>
  );
};

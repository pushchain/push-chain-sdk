import React, { useEffect, useState } from 'react';
import PushNetwork, { Tx } from '@pushprotocol/node-core/src/lib';
import { ENV } from '@pushprotocol/node-core/src/lib/constants';
import { TxCategory } from '@pushprotocol/node-core/src/lib/tx/tx.types';
import './App.css';
import { Transaction } from '@pushprotocol/node-core/src/lib/generated/tx';

// Mock data for testing
const mockInitDidTxData = {
  did: 'did:example:123',
  masterPubKey: 'master_pub_key',
  derivedKeyIndex: 0,
  derivedPubKey: 'derived_pub_key',
  walletToEncDerivedKey: {
    push10222n3232mwdeicej3: 'stringified_encrypted_pk',
  },
};

const mockRecipients = [
  'eip155:1:0x35B84d6848D16415177c64D64504663b998A6ab4',
  'eip155:97:0xD8634C39BBFd4033c0d3289C4515275102423681',
];

const App: React.FC = () => {
  const [pushNetwork, setPushNetwork] = useState<PushNetwork | null>(null);
  const [mockTx, setMockTx] = useState<Transaction | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    const setNetwork = async () => {
      try {
        const pushNetworkInstance = await PushNetwork.initialize(ENV.DEV);
        setPushNetwork(pushNetworkInstance);

        const unsignedTx = pushNetworkInstance.tx.createUnsigned(
          TxCategory.INIT_DID,
          mockRecipients,
          Tx.serializeData(mockInitDidTxData, TxCategory.INIT_DID)
        );
        setMockTx(unsignedTx);
      } catch (error) {
        console.error('Error initializing Push Network:', error);
      }
    };
    setNetwork();
  }, []);

  const sendTransaction = async () => {
    setLoading(true);
    try {
      if (pushNetwork && mockTx) {
        const txHash = await pushNetwork.tx.send(mockTx);
        console.log('Transaction sent, hash:', txHash);
        alert(`Tx Sent - ${txHash}`);
      } else {
        console.error('Push Network or Transaction not initialized');
      }
    } catch (error) {
      alert(error);
      console.error('Transaction error:', error);
    }
    setLoading(false);
  };

  return (
    <div className="app-container">
      <h1>Send Transaction to Push Network</h1>
      <button
        className="send-button"
        onClick={sendTransaction}
        disabled={loading}
      >
        {loading ? 'Sending' : 'Send'} Transaction
      </button>
      {mockTx && (
        <div className="transaction-card">
          <h2>Mock Unsigned Transaction Data:</h2>
          <pre>{JSON.stringify(mockTx, null, 2)}</pre>
        </div>
      )}
    </div>
  );
};

export default App;

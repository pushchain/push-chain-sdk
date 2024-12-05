import React, { useEffect, useState } from 'react';
import { PushNetwork } from '../../../packages/core/src/index';
import { ENV } from '@pushprotocol/push-chain/src/lib/constants';
import './App.css';
import { Transaction } from '@pushprotocol/push-chain/src/lib/generated/tx';
import { toHex } from 'viem';
import { ConnectPushWallet } from './ConnectWallet';

// Mock data for testing
const mockRecipients = [
  'eip155:1:0x35B84d6848D16415177c64D64504663b998A6ab4',
  'eip155:97:0xD8634C39BBFd4033c0d3289C4515275102423681',
];

const App: React.FC = () => {
  const [pushNetwork, setPushNetwork] = useState<PushNetwork | null>(null);
  const [mockTx, setMockTx] = useState<Transaction | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [account, setAccount] = useState<string>('');
  const [walletConnectionLoading, setWalletConnectionLoading] =
    useState<boolean>(false);

  // For signing message
  const [userInput, setUserInput] = useState<string>('');
  const [signedData, setSignedData] = useState<Uint8Array | null>(null);

  useEffect(() => {
    const setNetwork = async () => {
      try {
        const pushNetworkInstance = await PushNetwork.initialize(ENV.DEV);
        console.log("Push Network", pushNetworkInstance);
        setPushNetwork(pushNetworkInstance);

        const unsignedTx = pushNetworkInstance.tx.createUnsigned(
          'CUSTOM:SAMPLE_TX',
          mockRecipients,
          new Uint8Array([1, 2, 3, 4, 5])
        );
        setMockTx(unsignedTx);
      } catch (error) {
        console.error('Error initializing Push Network:', error);
      }
    };
    setNetwork();
  }, []);

  const connectWallet = async (tryCount: number = 1) => {
    setWalletConnectionLoading(true);
    if (pushNetwork) {
      console.log("Trying to fetch wallet", tryCount, pushNetwork);
      try {
        const appConnectionOrigin = window.location.origin
        console.log("App Connection origin", appConnectionOrigin);
        const acc = await pushNetwork.wallet.connect(`http://localhost:5173/wallet?app=${encodeURIComponent(appConnectionOrigin)}`);
        console.log("Acc", acc);

        setAccount(acc);
        setWalletConnectionLoading(false);
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (err) {
        console.log("Err", err);

        if (tryCount < 30 && err === 'PushWallet Not Logged In') {
          // wait for 5 seconds and try again
          setTimeout(() => {
            connectWallet(tryCount + 1);
          }, 2000);
        } else {
          alert(err);
          setWalletConnectionLoading(false);
        }
      }
    }
  };

  const sendTransaction = async () => {
    setLoading(true);
    try {
      if (pushNetwork && mockTx) {
        const txHash = await pushNetwork.tx.send(mockTx, {
          account,
          signMessage: async (data: Uint8Array) => {
            return await pushNetwork.wallet.sign(data);
          },
        });

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
  const signMessage = async () => {
    try {
      if (pushNetwork) {
        console.log("Push network", pushNetwork);

        const signedData = await pushNetwork.wallet.sign(
          new TextEncoder().encode(userInput)
        );
        setSignedData(signedData);
      }
    } catch (error) {
      alert(error);
      console.error('Sign message error:', error);
    }
  };

  return (
    <div className="app-container">
      <h1>Send Transaction to Push Network</h1>

      {pushNetwork && <ConnectPushWallet setAccount={setAccount} pushNetwork={pushNetwork} />}

      {pushNetwork &&
        account === '' &&
        (walletConnectionLoading ? (
          <div className="loader-container">
            <div className="loader"></div>
            <p className="loader-text">Connecting Wallet...</p>
          </div>
        ) : (
          <button
            className="send-button"
            onClick={() => connectWallet(1)}
            disabled={loading}
            style={{
              backgroundColor: '#3498db',
              color: '#fff',
              border: 'none',
              borderRadius: '5px',
              padding: '10px 20px',
              cursor: 'pointer',
              fontSize: '1rem',
            }}
          >
            Connect Push Wallet
          </button>
        ))}

      {account !== '' && (
        <div className="account-info">
          <h2>Connected Account:</h2>
          <p>{account}</p>
        </div>
      )}

      {account !== '' && (
        <div className="sign-message-container">
          <div>
            <input
              type="text"
              value={userInput}
              onChange={(e) => {
                setUserInput(e.target.value);
              }}
              placeholder="Enter data to send"
            />
            <button onClick={signMessage}>SignMessage</button>
          </div>
          {signedData && (
            <div className="transaction-card">
              <h2>Signed Data:</h2>
              <pre>{toHex(signedData)}</pre>
            </div>
          )}
        </div>
      )}
      {mockTx && account !== '' && (
        <>
          <button
            className="send-button"
            onClick={sendTransaction}
            disabled={loading}
          >
            {loading ? 'Sending' : 'Send'} Transaction
          </button>

          <div className="transaction-card">
            <h2>Mock Unsigned Transaction Data:</h2>
            <pre>{JSON.stringify(mockTx, null, 2)}</pre>
          </div>
        </>
      )}
    </div>
  );
};

export default App;

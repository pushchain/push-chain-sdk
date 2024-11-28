import { PushNetwork } from '@pushprotocol/push-chain';

export const connectPushWallet = async () => {
  try {
    // Initialize Push Network
    const userAlice = await PushNetwork.initialize('dev');
    const wallet = userAlice.wallet;

    // Connect to Push Wallet
    const walletAddress = await wallet.connect();
    console.log('Push Wallet Connected: ', walletAddress);

    return { success: true, walletAddress };
  } catch (error) {
    console.error('Push Wallet Connection Error: ', error);
    return { success: false, error };
  }
};

export const signInPushWallet = async (data) => {
  try {
    // Initialize Push Network
    const userAlice = await PushNetwork.initialize('dev');
    const wallet = userAlice.wallet;

    // Sign message
    const signedMessage = await wallet.sign(data);
    console.log('Message Signed: ', signedMessage);

    return { success: true, signedMessage };
  } catch (error) {
    console.error('Push Wallet Sign Error: ', error);
    return { success: false, error };
  }
};

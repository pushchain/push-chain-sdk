import { PushChain } from '../../../src';
import { CHAIN } from '../../../src/lib/constants/enums';
import { CHAIN_INFO } from '../../../src/lib/constants/chain';
import {
  createWalletClient,
  createPublicClient,
  http,
  Hex,
  parseEther,
} from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { bscTestnet } from 'viem/chains';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

describe('BNB Testnet - Send Value (e2e)', () => {
  const originChain = CHAIN.BNB_TESTNET;

  it('should send value to self from a NEW wallet (fresh UEA, hits gateway)', async () => {
    const mainPrivateKey = process.env['EVM_PRIVATE_KEY'] as Hex;
    if (!mainPrivateKey) throw new Error('EVM_PRIVATE_KEY not set');

    // 1. Generate fresh wallet
    const newPrivateKey = generatePrivateKey();
    const newAccount = privateKeyToAccount(newPrivateKey);
    console.log('\n=== TEST: SEND VALUE TO SELF FROM NEW BNB WALLET ===');
    console.log(`New wallet address: ${newAccount.address}`);

    // 2. Fund new wallet with BNB from master
    const mainAccount = privateKeyToAccount(mainPrivateKey);
    const mainWalletClient = createWalletClient({
      account: mainAccount,
      chain: bscTestnet,
      transport: http(CHAIN_INFO[originChain].defaultRPC[0]),
    });
    const publicClient = createPublicClient({
      chain: bscTestnet,
      transport: http(CHAIN_INFO[originChain].defaultRPC[0]),
    });

    console.log('Funding new wallet with BNB for gas...');
    const bnbTxHash = await mainWalletClient.sendTransaction({
      to: newAccount.address,
      value: parseEther('0.01'),
    });
    await publicClient.waitForTransactionReceipt({ hash: bnbTxHash });
    console.log(`BNB funded: ${bnbTxHash}`);

    // 3. Initialize PushChain client for new wallet
    const newWalletClient = createWalletClient({
      account: newAccount,
      chain: bscTestnet,
      transport: http(CHAIN_INFO[originChain].defaultRPC[0]),
    });

    const newSigner =
      await PushChain.utils.signer.toUniversal(newWalletClient);
    const newPushClient = await PushChain.initialize(newSigner, {
      network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET,
      progressHook: (val: any) => {
        console.log(`[Progress] ${val.id}: ${val.title} - ${val.message}`);
      },
    });

    console.log(`New wallet UEA: ${newPushClient.universal.account}`);

    // 4. Send value to self — fresh UEA forces fee-lock path through BSC gateway
    const value = parseEther('0.0000001');
    console.log(`Sending 0.0000001 BNB to self (${newPushClient.universal.account})...`);

    const res = await newPushClient.universal.sendTransaction({
      to: newPushClient.universal.account,
      value: value,
    });

    console.log(`TX Hash: ${res.hash}`);

    const receipt = await res.wait();
    console.log(`Receipt Status: ${receipt.status}`);

    expect(receipt.status).toBe(1);
  }, 600000);
});

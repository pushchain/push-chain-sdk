import '@e2e/shared/setup';
import { PushChain } from '../../../src';
import { CHAIN } from '../../../src/lib/constants/enums';
import { CHAIN_INFO } from '../../../src/lib/constants/chain';
import {
  createWalletClient,
  createPublicClient,
  http,
  Hex,
  parseEther,
  encodeFunctionData,
} from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { sepolia } from 'viem/chains';


describe('Send USDT to Self vs Different Address (e2e)', () => {
  let pushClient: PushChain;

  beforeAll(async () => {
    const privateKey = process.env['EVM_PRIVATE_KEY'] as Hex;
    if (!privateKey) throw new Error('EVM_PRIVATE_KEY not set');

    const originChain = CHAIN.ETHEREUM_SEPOLIA;
    const account = privateKeyToAccount(privateKey);
    const walletClient = createWalletClient({
      account,
      chain: { id: 11155111, name: 'Sepolia' } as any,
      transport: http(CHAIN_INFO[originChain].defaultRPC[0]),
    });

    // Using toUniversal (like user's original code) instead of toUniversalFromKeypair
    const universalSigner = await PushChain.utils.signer.toUniversal(walletClient);

    pushClient = await PushChain.initialize(universalSigner, {
      network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET, // Using TESTNET like user's original code
      progressHook: (val: any) => {
        console.log(`[Progress] ${val.id}: ${val.title}`);
      },
    });

    console.log('\n=== TEST SETUP COMPLETE ===');
    console.log(`UEA Address: ${pushClient.universal.account}`);
    console.log(`USDT Address: ${pushClient.moveable.token.USDT.address}`);
  }, 100000);

  it('should send USDT to self (client.universal.account) - expects success, failure proves bug', async () => {
    const usdt = pushClient.moveable.token.USDT;
    const oneCent = PushChain.utils.helpers.parseUnits('0.01', {
      decimals: usdt.decimals,
    });

    console.log('\n=== TEST: SEND USDT TO SELF ===');
    console.log(`Recipient: ${pushClient.universal.account} (self)`);
    console.log(`Amount: 0.01 USDT`);

    const res = await pushClient.universal.sendTransaction({
      to: pushClient.universal.account,
      funds: { amount: oneCent, token: usdt },
    });

    console.log(`TX Hash: ${res.hash}`);

    const receipt = await res.wait();
    console.log(`Receipt Status: ${receipt.status}`);

    expect(receipt.status).toBe(1);
  }, 300000);

  it('should send USDT to different address - expects success', async () => {
    const usdt = pushClient.moveable.token.USDT;
    const oneCent = PushChain.utils.helpers.parseUnits('0.01', {
      decimals: usdt.decimals,
    });

    const differentAddress =
      '0x742d35Cc6634c0532925A3b844BC9e7595F5bE21' as `0x${string}`;

    console.log('\n=== TEST: SEND USDT TO DIFFERENT ADDRESS ===');
    console.log(`Recipient: ${differentAddress}`);
    console.log(`Amount: 0.01 USDT`);

    const res = await pushClient.universal.sendTransaction({
      to: differentAddress,
      funds: { amount: oneCent, token: usdt },
    });

    console.log(`TX Hash: ${res.hash}`);

    const receipt = await res.wait();
    console.log(`Receipt Status: ${receipt.status}`);

    expect(receipt.status).toBe(1);
  }, 300000);

  it('should send USDT to self from a NEW wallet (fresh UEA)', async () => {
    const originChain = CHAIN.ETHEREUM_SEPOLIA;
    const mainPrivateKey = process.env['EVM_PRIVATE_KEY'] as Hex;

    // 1. Generate fresh wallet
    const newPrivateKey = generatePrivateKey();
    const newAccount = privateKeyToAccount(newPrivateKey);
    console.log('\n=== TEST: SEND USDT TO SELF FROM NEW WALLET ===');
    console.log(`New wallet address: ${newAccount.address}`);

    // 2. Setup main wallet for funding
    const mainAccount = privateKeyToAccount(mainPrivateKey);
    const mainWalletClient = createWalletClient({
      account: mainAccount,
      chain: sepolia,
      transport: http(CHAIN_INFO[originChain].defaultRPC[0]),
    });
    const publicClient = createPublicClient({
      chain: sepolia,
      transport: http(CHAIN_INFO[originChain].defaultRPC[0]),
    });

    // 3. Fund new wallet with ETH for gas
    console.log('Funding new wallet with ETH for gas...');
    const ethTxHash = await mainWalletClient.sendTransaction({
      to: newAccount.address,
      value: parseEther('0.01'),
    });
    await publicClient.waitForTransactionReceipt({ hash: ethTxHash });
    console.log(`ETH funded: ${ethTxHash}`);

    // 4. Fund new wallet with USDT
    const usdt = pushClient.moveable.token.USDT;
    const usdtAmount = PushChain.utils.helpers.parseUnits('0.02', {
      decimals: usdt.decimals,
    });

    console.log('Funding new wallet with USDT...');
    const erc20TransferData = encodeFunctionData({
      abi: [
        {
          name: 'transfer',
          type: 'function',
          inputs: [
            { name: 'to', type: 'address' },
            { name: 'amount', type: 'uint256' },
          ],
          outputs: [{ type: 'bool' }],
        },
      ],
      functionName: 'transfer',
      args: [newAccount.address, usdtAmount],
    });

    const usdtTxHash = await mainWalletClient.sendTransaction({
      to: usdt.address as `0x${string}`,
      data: erc20TransferData,
    });
    await publicClient.waitForTransactionReceipt({ hash: usdtTxHash });
    console.log(`USDT funded: ${usdtTxHash}`);

    // 5. Create PushChain client with new wallet
    const newWalletClient = createWalletClient({
      account: newAccount,
      chain: sepolia,
      transport: http(CHAIN_INFO[originChain].defaultRPC[0]),
    });

    const newSigner = await PushChain.utils.signer.toUniversal(newWalletClient);
    const newPushClient = await PushChain.initialize(newSigner, {
      network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET,
      progressHook: (val: any) => {
        console.log(`[New Wallet Progress] ${val.id}: ${val.title}`);
      },
    });

    console.log(`New wallet UEA: ${newPushClient.universal.account}`);

    // 6. Send USDT to self from new wallet
    const oneCent = PushChain.utils.helpers.parseUnits('0.01', {
      decimals: usdt.decimals,
    });

    console.log(`Sending 0.01 USDT to self (${newPushClient.universal.account})...`);

    const res = await newPushClient.universal.sendTransaction({
      to: newPushClient.universal.account,
      funds: { amount: oneCent, token: usdt },
    });

    console.log(`TX Hash: ${res.hash}`);

    const receipt = await res.wait();
    console.log(`Receipt Status: ${receipt.status}`);

    expect(receipt.status).toBe(1);
  }, 600000);

  it('should send USDT to other from a NEW wallet (fresh UEA)', async () => {
    const originChain = CHAIN.ETHEREUM_SEPOLIA;
    const mainPrivateKey = process.env['EVM_PRIVATE_KEY'] as Hex;

    // 1. Generate fresh wallet
    const newPrivateKey = generatePrivateKey();
    const newAccount = privateKeyToAccount(newPrivateKey);
    console.log('\n=== TEST: SEND USDT TO SELF FROM NEW WALLET ===');
    console.log(`New wallet address: ${newAccount.address}`);

    // 2. Setup main wallet for funding
    const mainAccount = privateKeyToAccount(mainPrivateKey);
    const mainWalletClient = createWalletClient({
      account: mainAccount,
      chain: sepolia,
      transport: http(CHAIN_INFO[originChain].defaultRPC[0]),
    });
    const publicClient = createPublicClient({
      chain: sepolia,
      transport: http(CHAIN_INFO[originChain].defaultRPC[0]),
    });

    // 3. Fund new wallet with ETH for gas
    console.log('Funding new wallet with ETH for gas...');
    const ethTxHash = await mainWalletClient.sendTransaction({
      to: newAccount.address,
      value: parseEther('0.01'),
    });
    await publicClient.waitForTransactionReceipt({ hash: ethTxHash });
    console.log(`ETH funded: ${ethTxHash}`);

    // 4. Fund new wallet with USDT
    const usdt = pushClient.moveable.token.USDT;
    const usdtAmount = PushChain.utils.helpers.parseUnits('0.02', {
      decimals: usdt.decimals,
    });

    console.log('Funding new wallet with USDT...');
    const erc20TransferData = encodeFunctionData({
      abi: [
        {
          name: 'transfer',
          type: 'function',
          inputs: [
            { name: 'to', type: 'address' },
            { name: 'amount', type: 'uint256' },
          ],
          outputs: [{ type: 'bool' }],
        },
      ],
      functionName: 'transfer',
      args: [newAccount.address, usdtAmount],
    });

    const usdtTxHash = await mainWalletClient.sendTransaction({
      to: usdt.address as `0x${string}`,
      data: erc20TransferData,
    });
    await publicClient.waitForTransactionReceipt({ hash: usdtTxHash });
    console.log(`USDT funded: ${usdtTxHash}`);

    // 5. Create PushChain client with new wallet
    const newWalletClient = createWalletClient({
      account: newAccount,
      chain: sepolia,
      transport: http(CHAIN_INFO[originChain].defaultRPC[0]),
    });

    const newSigner = await PushChain.utils.signer.toUniversal(newWalletClient);
    const newPushClient = await PushChain.initialize(newSigner, {
      network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET,
      progressHook: (val: any) => {
        console.log(`[New Wallet Progress] ${val.id}: ${val.title}`);
      },
    });

    console.log(`New wallet UEA: ${newPushClient.universal.account}`);

    // 6. Send USDT to self from new wallet
    const oneCent = PushChain.utils.helpers.parseUnits('0.01', {
      decimals: usdt.decimals,
    });

    console.log(`Sending 0.01 USDT to self (${newPushClient.universal.account})...`);

    const differentAddress =
    '0x742d35Cc6634c0532925A3b844BC9e7595F5bE21' as `0x${string}`;

    const res = await newPushClient.universal.sendTransaction({
      to: differentAddress,
      funds: { amount: oneCent, token: usdt },
    });

    console.log(`TX Hash: ${res.hash}`);

    const receipt = await res.wait();
    console.log(`Receipt Status: ${receipt.status}`);

    expect(receipt.status).toBe(1);
  }, 600000);

  it('should send ETH value to self from a NEW wallet (Route 1)', async () => {
    const originChain = CHAIN.ETHEREUM_SEPOLIA;
    const mainPrivateKey = process.env['EVM_PRIVATE_KEY'] as Hex;

    // 1. Generate fresh wallet
    const newPrivateKey = generatePrivateKey();
    const newAccount = privateKeyToAccount(newPrivateKey);
    console.log('\n=== TEST: SEND VALUE TO SELF (Route 1) ===');
    console.log(`Generated new wallet: ${newAccount.address}`);

    // 2. Fund new wallet with ETH from master
    const mainAccount = privateKeyToAccount(mainPrivateKey);
    const mainWalletClient = createWalletClient({
      account: mainAccount,
      chain: sepolia,
      transport: http(CHAIN_INFO[originChain].defaultRPC[0]),
    });
    const publicClient = createPublicClient({
      chain: sepolia,
      transport: http(CHAIN_INFO[originChain].defaultRPC[0]),
    });

    console.log('Transferring ETH from master wallet...');
    const ethTxHash = await mainWalletClient.sendTransaction({
      to: newAccount.address,
      value: parseEther('0.002'),
    });
    await publicClient.waitForTransactionReceipt({ hash: ethTxHash });
    console.log('ETH transferred');

    // 3. Initialize PushChain client for new wallet
    const newWalletClient = createWalletClient({
      account: newAccount,
      chain: sepolia,
      transport: http(CHAIN_INFO[originChain].defaultRPC[0]),
    });

    const newSigner = await PushChain.utils.signer.toUniversal(newWalletClient);
    const newPushClient = await PushChain.initialize(newSigner, {
      network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET,
      printTraces: true,
      progressHook: (val: any) => {
        console.log(`[Progress] ${val.id}: ${val.title}`);
      },
    });

    console.log(`New User UEA: ${newPushClient.universal.account}`);

    // 4. Send value to self
    const value = parseEther('0.0000001');
    console.log(`Value: 0.0000001 ETH`);
    console.log(`To: ${newPushClient.universal.account}`);
    console.log('Sending transaction...');

    const res = await newPushClient.universal.sendTransaction({
      to: newPushClient.universal.account,
      value: value,
    });

    console.log(`Transaction sent! Hash: ${res.hash}`);

    const receipt = await res.wait();
    console.log('Receipt:', JSON.stringify(receipt, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));

    expect(receipt.status).toBe(1);
  }, 300000);

  it('should send ETH value to OTHER from a NEW wallet (Route 2)', async () => {
    const originChain = CHAIN.ETHEREUM_SEPOLIA;
    const mainPrivateKey = process.env['EVM_PRIVATE_KEY'] as Hex;

    // 1. Generate fresh wallet
    const newPrivateKey = generatePrivateKey();
    const newAccount = privateKeyToAccount(newPrivateKey);
    console.log('\n=== TEST: SEND VALUE TO OTHER (Route 2) ===');
    console.log(`Generated new wallet: ${newAccount.address}`);

    // 2. Fund new wallet with ETH from master
    const mainAccount = privateKeyToAccount(mainPrivateKey);
    const mainWalletClient = createWalletClient({
      account: mainAccount,
      chain: sepolia,
      transport: http(CHAIN_INFO[originChain].defaultRPC[0]),
    });
    const publicClient = createPublicClient({
      chain: sepolia,
      transport: http(CHAIN_INFO[originChain].defaultRPC[0]),
    });

    console.log('Transferring ETH from master wallet...');
    const ethTxHash = await mainWalletClient.sendTransaction({
      to: newAccount.address,
      value: parseEther('0.002'),
    });
    await publicClient.waitForTransactionReceipt({ hash: ethTxHash });
    console.log('ETH transferred');

    // 3. Initialize PushChain client for new wallet
    const newWalletClient = createWalletClient({
      account: newAccount,
      chain: sepolia,
      transport: http(CHAIN_INFO[originChain].defaultRPC[0]),
    });

    const newSigner = await PushChain.utils.signer.toUniversal(newWalletClient);
    const newPushClient = await PushChain.initialize(newSigner, {
      network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET,
      printTraces: true,
      progressHook: (val: any) => {
        console.log(`[Progress] ${val.id}: ${val.title}`);
      },
    });

    console.log(`New User UEA: ${newPushClient.universal.account}`);

    // 4. Send value to different address
    const differentAddress = '0x742d35Cc6634c0532925A3b844BC9e7595F5bE21' as `0x${string}`;
    const value = parseEther('0.0000001');
    console.log(`Value: 0.0000001 ETH`);
    console.log(`To: ${differentAddress}`);
    console.log('Sending transaction...');

    const res = await newPushClient.universal.sendTransaction({
      to: differentAddress,
      value: value,
    });

    console.log(`Transaction sent! Hash: ${res.hash}`);

    const receipt = await res.wait();
    console.log('Receipt:', JSON.stringify(receipt, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));

    expect(receipt.status).toBe(1);
  }, 300000);
});

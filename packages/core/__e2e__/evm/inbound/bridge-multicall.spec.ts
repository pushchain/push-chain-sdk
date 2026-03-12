import '@e2e/shared/setup';
import { PushChain } from '../../../src';
import { PUSH_NETWORK, CHAIN } from '../../../src/lib/constants/enums';
import { CHAIN_INFO } from '../../../src/lib/constants/chain';
import { MOVEABLE_TOKENS } from '../../../src/lib/constants/tokens';
import { createWalletClient, http, Hex, encodeFunctionData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';


/**
 * E2E Tests for Bridge + Multicall functionality
 *
 * These tests validate the executeMulticallWithBridge pattern:
 * - Bridge funds from external chain (Ethereum Sepolia)
 * - Execute multiple contract calls atomically on Push Chain
 */
describe('Bridge + Multicall (e2e)', () => {
  // Helper to create a simple test call (transfer to self)
  const createTestMulticall = (recipient: `0x${string}`, value: bigint) => {
    return [
      {
        to: recipient,
        value: value,
        data: '0x' as `0x${string}`,
      },
    ];
  };

  it('should bridge USDT + execute single call', async () => {
    const privateKey = process.env['EVM_PRIVATE_KEY'] as Hex;
    if (!privateKey) throw new Error('EVM_PRIVATE_KEY not set');

    const originChain = CHAIN.ETHEREUM_SEPOLIA;
    const account = privateKeyToAccount(privateKey);
    const walletClient = createWalletClient({
      account,
      transport: http(CHAIN_INFO[originChain].defaultRPC[0]),
    });

    const universalSigner = await PushChain.utils.signer.toUniversalFromKeypair(
      walletClient,
      {
        chain: originChain,
        library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
      }
    );

    console.log('\n=== BRIDGE USDT + SINGLE CALL TEST ===\n');

    const progressEvents: { event: any; timestamp: number }[] = [];
    const startTime = Date.now();

    const pushClient = await PushChain.initialize(universalSigner, {
      network: PUSH_NETWORK.TESTNET_DONUT,
      progressHook: (val: any) => {
        const now = Date.now();
        progressEvents.push({ event: val, timestamp: now });
        const elapsed = ((now - startTime) / 1000).toFixed(2);
        console.log(`[${elapsed}s] ${val.id}: ${val.title}`);
      },
    });

    const UEA = pushClient.universal.account;
    console.log(`\nUEA Address: ${UEA}`);

    // Get USDT token (ERC-20 with mechanism: 'approve')
    const tokens = MOVEABLE_TOKENS[originChain] || [];
    const usdtToken = tokens.find(t => t.symbol === 'USDT');
    if (!usdtToken) throw new Error('USDT token not found');

    console.log(`\nBridging 0.01 USDT + executing single call...\n`);

    // Bridge USDT + execute a simple value transfer on Push Chain
    const tx = await pushClient.universal.sendTransaction({
      to: '0x0000000000000000000000000000000000000000' as `0x${string}`, // Multicall mode
      funds: {
        amount: PushChain.utils.helpers.parseUnits('0.01', 6), // USDT has 6 decimals
        token: usdtToken,
      },
      data: createTestMulticall(UEA as `0x${string}`, BigInt(0)),
    });

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n=== TRANSACTION COMPLETE (Total: ${totalTime}s) ===`);
    console.log(`Hash: ${tx.hash}`);

    // Verify transaction completed
    expect(tx.hash).toBeDefined();
    expect(typeof tx.hash).toBe('string');
  }, 300000);

  it('should bridge USDT + execute multicall array', async () => {
    const privateKey = process.env['EVM_PRIVATE_KEY'] as Hex;
    if (!privateKey) throw new Error('EVM_PRIVATE_KEY not set');

    const originChain = CHAIN.ETHEREUM_SEPOLIA;
    const account = privateKeyToAccount(privateKey);
    const walletClient = createWalletClient({
      account,
      transport: http(CHAIN_INFO[originChain].defaultRPC[0]),
    });

    const universalSigner = await PushChain.utils.signer.toUniversalFromKeypair(
      walletClient,
      {
        chain: originChain,
        library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
      }
    );

    console.log('\n=== BRIDGE USDT + MULTICALL ARRAY TEST ===\n');

    const progressEvents: { event: any; timestamp: number }[] = [];
    const startTime = Date.now();

    const pushClient = await PushChain.initialize(universalSigner, {
      network: PUSH_NETWORK.TESTNET_DONUT,
      progressHook: (val: any) => {
        const now = Date.now();
        progressEvents.push({ event: val, timestamp: now });
        const elapsed = ((now - startTime) / 1000).toFixed(2);
        console.log(`[${elapsed}s] ${val.id}: ${val.title}`);
      },
    });

    const UEA = pushClient.universal.account;
    console.log(`\nUEA Address: ${UEA}`);

    // Get USDT token
    const tokens = MOVEABLE_TOKENS[originChain] || [];
    const usdtToken = tokens.find(t => t.symbol === 'USDT');
    if (!usdtToken) throw new Error('USDT token not found');

    console.log(`\nBridging 0.01 USDT + executing multicall array...\n`);

    // Create multicall with multiple operations
    const multicallData = [
      {
        to: UEA as `0x${string}`,
        value: BigInt(0),
        data: '0x' as `0x${string}`,
      },
      {
        to: UEA as `0x${string}`,
        value: BigInt(0),
        data: '0x' as `0x${string}`,
      },
    ];

    const tx = await pushClient.universal.sendTransaction({
      to: '0x0000000000000000000000000000000000000000' as `0x${string}`,
      funds: {
        amount: PushChain.utils.helpers.parseUnits('0.01', 6),
        token: usdtToken,
      },
      data: multicallData,
    });

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n=== TRANSACTION COMPLETE (Total: ${totalTime}s) ===`);
    console.log(`Hash: ${tx.hash}`);

    expect(tx.hash).toBeDefined();
  }, 300000);

  it('should bridge native ETH + execute single call', async () => {
    const privateKey = process.env['EVM_PRIVATE_KEY'] as Hex;
    if (!privateKey) throw new Error('EVM_PRIVATE_KEY not set');

    const originChain = CHAIN.ETHEREUM_SEPOLIA;
    const account = privateKeyToAccount(privateKey);
    const walletClient = createWalletClient({
      account,
      transport: http(CHAIN_INFO[originChain].defaultRPC[0]),
    });

    const universalSigner = await PushChain.utils.signer.toUniversalFromKeypair(
      walletClient,
      {
        chain: originChain,
        library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
      }
    );

    console.log('\n=== BRIDGE NATIVE ETH + SINGLE CALL TEST ===\n');

    const progressEvents: { event: any; timestamp: number }[] = [];
    const startTime = Date.now();

    const pushClient = await PushChain.initialize(universalSigner, {
      network: PUSH_NETWORK.TESTNET_DONUT,
      progressHook: (val: any) => {
        const now = Date.now();
        progressEvents.push({ event: val, timestamp: now });
        const elapsed = ((now - startTime) / 1000).toFixed(2);
        console.log(`[${elapsed}s] ${val.id}: ${val.title}`);
      },
    });

    const UEA = pushClient.universal.account;
    console.log(`\nUEA Address: ${UEA}`);

    // Get ETH token (native with mechanism: 'native')
    const tokens = MOVEABLE_TOKENS[originChain] || [];
    const ethToken = tokens.find(t => t.symbol === 'ETH');
    if (!ethToken) throw new Error('ETH token not found');

    console.log(`\nBridging 0.0001 ETH + executing single call...\n`);

    // Bridge ETH + execute a simple call on Push Chain
    const tx = await pushClient.universal.sendTransaction({
      to: '0x0000000000000000000000000000000000000000' as `0x${string}`,
      funds: {
        amount: PushChain.utils.helpers.parseUnits('0.0001', 18),
        token: ethToken,
      },
      data: createTestMulticall(UEA as `0x${string}`, BigInt(0)),
    });

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n=== TRANSACTION COMPLETE (Total: ${totalTime}s) ===`);
    console.log(`Hash: ${tx.hash}`);

    expect(tx.hash).toBeDefined();
  }, 300000);

  it('should bridge native ETH + execute multicall array', async () => {
    const privateKey = process.env['EVM_PRIVATE_KEY'] as Hex;
    if (!privateKey) throw new Error('EVM_PRIVATE_KEY not set');

    const originChain = CHAIN.ETHEREUM_SEPOLIA;
    const account = privateKeyToAccount(privateKey);
    const walletClient = createWalletClient({
      account,
      transport: http(CHAIN_INFO[originChain].defaultRPC[0]),
    });

    const universalSigner = await PushChain.utils.signer.toUniversalFromKeypair(
      walletClient,
      {
        chain: originChain,
        library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
      }
    );

    console.log('\n=== BRIDGE NATIVE ETH + MULTICALL ARRAY TEST ===\n');

    const progressEvents: { event: any; timestamp: number }[] = [];
    const startTime = Date.now();

    const pushClient = await PushChain.initialize(universalSigner, {
      network: PUSH_NETWORK.TESTNET_DONUT,
      progressHook: (val: any) => {
        const now = Date.now();
        progressEvents.push({ event: val, timestamp: now });
        const elapsed = ((now - startTime) / 1000).toFixed(2);
        console.log(`[${elapsed}s] ${val.id}: ${val.title}`);
      },
    });

    const UEA = pushClient.universal.account;
    console.log(`\nUEA Address: ${UEA}`);

    // Get ETH token
    const tokens = MOVEABLE_TOKENS[originChain] || [];
    const ethToken = tokens.find(t => t.symbol === 'ETH');
    if (!ethToken) throw new Error('ETH token not found');

    console.log(`\nBridging 0.0001 ETH + executing multicall array...\n`);

    // Create multicall with multiple operations
    const multicallData = [
      {
        to: UEA as `0x${string}`,
        value: BigInt(0),
        data: '0x' as `0x${string}`,
      },
      {
        to: UEA as `0x${string}`,
        value: BigInt(0),
        data: '0x' as `0x${string}`,
      },
    ];

    const tx = await pushClient.universal.sendTransaction({
      to: '0x0000000000000000000000000000000000000000' as `0x${string}`,
      funds: {
        amount: PushChain.utils.helpers.parseUnits('0.0001', 18),
        token: ethToken,
      },
      data: multicallData,
    });

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n=== TRANSACTION COMPLETE (Total: ${totalTime}s) ===`);
    console.log(`Hash: ${tx.hash}`);

    expect(tx.hash).toBeDefined();
  }, 300000);
});

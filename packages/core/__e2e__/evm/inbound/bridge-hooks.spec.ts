import '@e2e/shared/setup';
import { PushChain } from '../../../src';
import { PUSH_NETWORK, CHAIN } from '../../../src/lib/constants/enums';
import { CHAIN_INFO } from '../../../src/lib/constants/chain';
import { MOVEABLE_TOKENS } from '../../../src/lib/constants/tokens';
import { ProgressEvent } from '../../../src/lib/progress-hook/progress-hook.types';
import { createWalletClient, http, Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

describe('EVM Bridge Progress Hooks (e2e)', () => {
  it('should emit all progress hooks and measure timing', async () => {
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

    console.log('\n=== PROGRESS HOOKS TIMING TEST ===\n');

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

    console.log(`\nBridging 0.0001 ETH to self...\n`);

    const tx = await pushClient.universal.sendTransaction({
      to: UEA as `0x${string}`,
      funds: {
        amount: PushChain.utils.helpers.parseUnits('0.0001', 18),
        token: ethToken,
      },
    });

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n=== TRANSACTION COMPLETE (Total: ${totalTime}s) ===`);
    console.log(`Hash: ${tx.hash}`);

    // Calculate time between each step
    console.log(`\n=== STEP DURATIONS (sorted by time DESC) ===\n`);

    const durations: { step: string; duration: number; from: string; to: string }[] = [];

    for (let i = 1; i < progressEvents.length; i++) {
      const prev = progressEvents[i - 1];
      const curr = progressEvents[i];
      const duration = (curr.timestamp - prev.timestamp) / 1000;
      durations.push({
        step: `${prev.event.id} → ${curr.event.id}`,
        duration,
        from: prev.event.title,
        to: curr.event.title,
      });
    }

    // Sort by duration descending
    durations.sort((a, b) => b.duration - a.duration);

    durations.forEach((d, i) => {
      console.log(`${i + 1}. ${d.duration.toFixed(2)}s: ${d.step}`);
      console.log(`   (${d.from} → ${d.to})\n`);
    });

    // Count confirmations
    const confirmationHooks = progressEvents.filter(
      p => p.event.id.startsWith('SEND-TX-06-03')
    );
    console.log(`\n=== CONFIRMATION INFO ===`);
    console.log(`Total confirmation hooks: ${confirmationHooks.length}`);
    confirmationHooks.forEach(c => {
      console.log(`  - ${c.event.id}: ${c.event.message}`);
    });

    // Verify expected hooks were emitted
    const hookIds = progressEvents.map(e => e.event.id);
    expect(hookIds).toContain('SEND-TX-01');
    expect(hookIds).toContain('SEND-TX-06-04'); // Funds Confirmed
    expect(hookIds).toContain('SEND-TX-06-05'); // Syncing with Push Chain
    expect(hookIds).toContain('SEND-TX-06-06'); // Funds Credited on Push Chain
    expect(hookIds).toContain('SEND-TX-99-01');
  }, 300000);
});

describe('Cross-Chain Fund Transfer Progress Hooks (e2e)', () => {
  const pushNetwork = PUSH_NETWORK.TESTNET_DONUT;
  const originChain = CHAIN.ETHEREUM_SEPOLIA;

  let pushClient: PushChain;
  let orchestratorEvents: ProgressEvent[];

  beforeAll(async () => {
    const privateKey = process.env['EVM_PRIVATE_KEY'] as Hex;
    if (!privateKey) {
      console.log('EVM_PRIVATE_KEY not set, skipping cross-chain tests');
      return;
    }

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

    orchestratorEvents = [];
    pushClient = await PushChain.initialize(universalSigner, {
      network: pushNetwork,
      progressHook: (event: ProgressEvent) => {
        orchestratorEvents.push(event);
        console.log(`[HOOK] ${event.id}: ${event.message}`);
      },
    });

    console.log(`\nUEA Address: ${pushClient.universal.account}`);
  }, 60000);

  beforeEach(() => {
    orchestratorEvents = [];
  });

  it('should emit all progress hooks when bridging native ETH', async () => {
    if (!pushClient) {
      console.log('Setup failed, skipping test');
      return;
    }

    const tokens = MOVEABLE_TOKENS[originChain] || [];
    const ethToken = tokens.find((t) => t.symbol === 'ETH');
    if (!ethToken) {
      console.log('ETH token not found for origin chain');
      return;
    }

    orchestratorEvents = [];
    const txEvents: ProgressEvent[] = [];
    const UEA = pushClient.universal.account;

    console.log('\n=== Test: Bridging native ETH (0.0001 ETH) ===');

    const tx = await pushClient.universal.sendTransaction({
      to: UEA as `0x${string}`,
      funds: {
        amount: PushChain.utils.helpers.parseUnits('0.0001', 18),
        token: ethToken,
      },
    });

    console.log(`TX Hash: ${tx.hash}`);

    // Register callback - should replay SEND_TX_* events immediately from buffer
    tx.progressHook((event: ProgressEvent) => {
      txEvents.push(event);
      console.log(`[TX.HOOK] ${event.id}: ${event.message}`);
    });

    // Log buffered events that were replayed
    console.log('\n=== Buffered Events Replayed via tx.progressHook() ===');
    txEvents.forEach((e, i) => {
      console.log(`${i + 1}. ${e.id}: ${e.title}`);
    });

    // Verify SEND_TX_* events were replayed from buffer via tx.progressHook()
    expect(txEvents.some((e) => e.id === 'SEND-TX-01')).toBe(true);
    expect(txEvents.some((e) => e.id === 'SEND-TX-06-01')).toBe(true);
    expect(txEvents.some((e) => e.id === 'SEND-TX-06-04')).toBe(true);
    expect(txEvents.some((e) => e.id === 'SEND-TX-06-05')).toBe(true);
    expect(txEvents.some((e) => e.id === 'SEND-TX-06-06')).toBe(true);
    expect(txEvents.some((e) => e.id === 'SEND-TX-99-01')).toBe(true);

    // Log orchestrator events
    console.log('\n=== Orchestrator Events ===');
    orchestratorEvents.forEach((e, i) => {
      console.log(`${i + 1}. ${e.id}: ${e.title}`);
    });

    // Verify orchestrator also received events
    expect(orchestratorEvents.some((e) => e.id === 'SEND-TX-01')).toBe(true);
    expect(orchestratorEvents.some((e) => e.id === 'SEND-TX-99-01')).toBe(true);

    console.log(
      `\n✓ tx.progressHook() received ${txEvents.length} buffered events, orchestrator received ${orchestratorEvents.length} events`
    );
  }, 300000);

  it('should emit all progress hooks when bridging USDT', async () => {
    if (!pushClient) {
      console.log('Setup failed, skipping test');
      return;
    }

    const tokens = MOVEABLE_TOKENS[originChain] || [];
    const usdtToken = tokens.find((t) => t.symbol === 'USDT');
    if (!usdtToken) {
      console.log('USDT token not found for origin chain');
      return;
    }

    orchestratorEvents = [];
    const txEvents: ProgressEvent[] = [];
    const UEA = pushClient.universal.account;

    console.log('\n=== Test: Bridging USDT (0.01 USDT) ===');

    const tx = await pushClient.universal.sendTransaction({
      to: UEA as `0x${string}`,
      funds: {
        amount: PushChain.utils.helpers.parseUnits('0.01', 6), // USDT has 6 decimals
        token: usdtToken,
      },
    });

    console.log(`TX Hash: ${tx.hash}`);

    // Register callback - should replay SEND_TX_* events immediately from buffer
    tx.progressHook((event: ProgressEvent) => {
      txEvents.push(event);
      console.log(`[TX.HOOK] ${event.id}: ${event.message}`);
    });

    // Log buffered events that were replayed
    console.log('\n=== Buffered Events Replayed via tx.progressHook() ===');
    txEvents.forEach((e, i) => {
      console.log(`${i + 1}. ${e.id}: ${e.title}`);
    });

    // Verify SEND_TX_* events were replayed from buffer via tx.progressHook()
    expect(txEvents.some((e) => e.id === 'SEND-TX-01')).toBe(true);
    // USDT may require approval - check for approval hooks if not already approved
    const hasApprovalHooks = txEvents.some(
      (e) => e.id === 'SEND-TX-04-01' || e.id === 'SEND-TX-04-02'
    );
    console.log(`Approval hooks emitted: ${hasApprovalHooks}`);
    expect(txEvents.some((e) => e.id === 'SEND-TX-06-01')).toBe(true);
    expect(txEvents.some((e) => e.id === 'SEND-TX-06-04')).toBe(true);
    expect(txEvents.some((e) => e.id === 'SEND-TX-06-05')).toBe(true);
    expect(txEvents.some((e) => e.id === 'SEND-TX-06-06')).toBe(true);
    expect(txEvents.some((e) => e.id === 'SEND-TX-99-01')).toBe(true);

    // Log orchestrator events
    console.log('\n=== Orchestrator Events ===');
    orchestratorEvents.forEach((e, i) => {
      console.log(`${i + 1}. ${e.id}: ${e.title}`);
    });

    // Verify orchestrator also received events
    expect(orchestratorEvents.some((e) => e.id === 'SEND-TX-01')).toBe(true);
    expect(orchestratorEvents.some((e) => e.id === 'SEND-TX-99-01')).toBe(true);

    console.log(
      `\n✓ tx.progressHook() received ${txEvents.length} buffered events, orchestrator received ${orchestratorEvents.length} events`
    );
  }, 300000);
});

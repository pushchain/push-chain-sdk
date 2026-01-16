import { PushChain } from '../src';
import { PUSH_NETWORK, CHAIN } from '../src/lib/constants/enums';
import { CHAIN_INFO } from '../src/lib/constants/chain';
import { MOVEABLE_TOKENS } from '../src/lib/constants/tokens';
import { createWalletClient, http, Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

describe('Bridge Progress Hooks (e2e)', () => {
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

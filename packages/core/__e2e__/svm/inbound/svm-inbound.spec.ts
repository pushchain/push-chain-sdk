import '@e2e/shared/setup';
import { PUSH_NETWORK, CHAIN } from '../../../src/lib/constants/enums';
import { Keypair } from '@solana/web3.js';
import { PushChain } from '../../../src';
import { UniversalSigner } from '../../../src/lib/universal/universal.types';
import bs58 from 'bs58';
import { MOVEABLE_TOKENS } from '../../../src/lib/constants/tokens';
import { txValidator } from '@e2e/shared/validators';

describe('SVM Inbound (e2e)', () => {
  const pushNetwork = PUSH_NETWORK.TESTNET_DONUT;
  const to = '0x35B84d6848D16415177c64D64504663b998A6ab4';
  let universalSigner: UniversalSigner;

  describe('Origin - SVM: SOLANA_DEVNET', () => {
    const originChain = CHAIN.SOLANA_DEVNET;
    let pushClient: PushChain;

    beforeAll(async () => {
      const privateKeyHex = process.env['SOLANA_PRIVATE_KEY'];
      if (!privateKeyHex) throw new Error('SOLANA_PRIVATE_KEY not set');

      const privateKey = bs58.decode(privateKeyHex);

      const account = Keypair.fromSecretKey(privateKey);

      universalSigner = await PushChain.utils.signer.toUniversalFromKeypair(
        account,
        {
          chain: originChain,
          library: PushChain.CONSTANTS.LIBRARY.SOLANA_WEB3JS,
        }
      );

      pushClient = await PushChain.initialize(universalSigner, {
        network: pushNetwork,
        progressHook: (val: any) => {
          console.log(val);
        },
      });
    });

    it('should fail to send universal.sendTransaction with invalid feeLockTxHash', async () => {
      await expect(
        pushClient.universal.sendTransaction({
          to,
          feeLockTxHash: '0xABC', // Invalid txHash
          value: BigInt(1e1),
        })
      ).rejects.toThrow();
    }, 30000);

    it('should successfully send universal.sendTransaction', async () => {
      const uea = pushClient.universal.account;
      const tx = await pushClient.universal.sendTransaction({
        to,
        value: BigInt(1),
      });
      const after = await PushChain.utils.account.convertOriginToExecutor(
        universalSigner.account,
        {
          onlyCompute: true,
        }
      );
      expect(after.deployed).toBe(true);
      await txValidator(tx, pushClient.universal.origin.address, to);
    }, 300000);
  });

  describe('SVM Bridge Progress Hooks', () => {
    it('should emit all progress hooks for Solana bridge and measure timing', async () => {
      const privateKeyHex = process.env['SOLANA_PRIVATE_KEY'];
      if (!privateKeyHex) throw new Error('SOLANA_PRIVATE_KEY not set');

      const privateKey = bs58.decode(privateKeyHex);
      const originChain = CHAIN.SOLANA_DEVNET;
      const account = Keypair.fromSecretKey(privateKey);

      const universalSigner = await PushChain.utils.signer.toUniversalFromKeypair(
        account,
        {
          chain: originChain,
          library: PushChain.CONSTANTS.LIBRARY.SOLANA_WEB3JS,
        }
      );

      console.log('\n=== SOLANA PROGRESS HOOKS TIMING TEST ===\n');

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

      // Get SOL token
      const tokens = MOVEABLE_TOKENS[originChain] || [];
      const solToken = tokens.find(t => t.symbol === 'SOL');
      if (!solToken) throw new Error('SOL token not found');

      // Use a different recipient address (not self)
      const differentRecipient = '0x742d35Cc6634C0532925a3b844Bc9e7595f5bE21' as `0x${string}`;

      console.log(`\nBridging 0.001 SOL to different address: ${differentRecipient}\n`);

      console.log('SOL token', UEA as `0x${string}`);

      const tx = await pushClient.universal.sendTransaction({
        to: differentRecipient,
        funds: {
          amount: PushChain.utils.helpers.parseUnits('0.001', 9), // SOL has 9 decimals
          token: solToken,
        },
      });

      const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`\n=== SOLANA TRANSACTION COMPLETE (Total: ${totalTime}s) ===`);
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

    it('should emit all progress hooks for Solana bridge self-send and measure timing', async () => {
      const privateKeyHex = process.env['SOLANA_PRIVATE_KEY'];
      if (!privateKeyHex) throw new Error('SOLANA_PRIVATE_KEY not set');

      const privateKey = bs58.decode(privateKeyHex);
      const originChain = CHAIN.SOLANA_DEVNET;
      const account = Keypair.fromSecretKey(privateKey);

      const universalSigner = await PushChain.utils.signer.toUniversalFromKeypair(
        account,
        {
          chain: originChain,
          library: PushChain.CONSTANTS.LIBRARY.SOLANA_WEB3JS,
        }
      );

      console.log('\n=== SOLANA SELF-SEND PROGRESS HOOKS TIMING TEST ===\n');

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

      // Get SOL token
      const tokens = MOVEABLE_TOKENS[originChain] || [];
      const solToken = tokens.find(t => t.symbol === 'SOL');
      if (!solToken) throw new Error('SOL token not found');

      console.log(`\nBridging 0.001 SOL to self (UEA)...\n`);

      const tx = await pushClient.universal.sendTransaction({
        to: UEA as `0x${string}`,
        funds: {
          amount: PushChain.utils.helpers.parseUnits('0.001', 9),
          token: solToken,
        },
      });

      const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`\n=== SOLANA SELF-SEND COMPLETE (Total: ${totalTime}s) ===`);
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
});

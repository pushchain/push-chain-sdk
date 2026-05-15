import '@e2e/shared/setup';
import { PushChain } from '../../src';
import { CHAIN, PUSH_NETWORK } from '../../src/lib/constants/enums';
import { CHAIN_INFO } from '../../src/lib/constants/chain';
import { ProgressEvent } from '../../src/lib/progress-hook/progress-hook.types';
import { UniversalTxResponse } from '../../src/lib/orchestrator/orchestrator.types';
import { Hex, createWalletClient, encodeFunctionData, http } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { createEvmPushClient } from '@e2e/shared/evm-client';
import { COUNTER_ABI } from '@e2e/shared/outbound-helpers';
import {
  deriveBnbCea,
  fundBnbCea,
  fundSepoliaUoa,
  makeBnbContext,
  makeSepoliaContext,
} from '../docs-examples/_helpers/docs-fund';

/**
 * E2E tests for tx.progressHook() method feature.
 *
 * Tests verify that:
 * 1. tx.progressHook() method registers callback
 * 2. Registered callback receives SEND-TX-* events during wait()
 * 3. Both tx.progressHook and orchestrator hooks work together
 * 4. trackTransaction progress callback still works
 */
describe('tx.progressHook() Method (e2e)', () => {
  const to = '0x35B84d6848D16415177c64D64504663b998A6ab4';

  let pushClient: PushChain;
  let orchestratorEvents: ProgressEvent[];
  let sharedTxResponse: UniversalTxResponse;

  beforeAll(async () => {
    const privateKey = process.env['PUSH_PRIVATE_KEY'] as Hex;
    if (!privateKey) {
      console.log('PUSH_PRIVATE_KEY not set, skipping all tests');
      return;
    }

    // Initialize client WITH orchestrator-level hook to test both hook scenarios
    orchestratorEvents = [];
    const setup = await createEvmPushClient({
      chain: CHAIN.PUSH_TESTNET_DONUT,
      privateKey,
      progressHook: (event: ProgressEvent) => {
        orchestratorEvents.push({
          ...event,
          _source: 'orchestrator',
        } as ProgressEvent & { _source: string });
      },
    });
    pushClient = setup.pushClient;

    // Send ONE transaction to be reused by tracking tests
    console.log('\n=== [beforeAll] Sending shared transaction ===');
    sharedTxResponse = await pushClient.universal.sendTransaction({
      to,
      value: BigInt(1000),
    });
    console.log('Shared TX Hash:', sharedTxResponse.hash);
    await sharedTxResponse.wait();
    console.log('Shared TX confirmed!\n');
  }, 120000);

  beforeEach(() => {
    // Clear orchestrator events before each test
    orchestratorEvents = [];
  });

  it('should call tx.progressHook callback during wait()', async () => {
    if (!pushClient) {
      console.log('Setup failed, skipping test');
      return;
    }

    const methodEvents: ProgressEvent[] = [];
    orchestratorEvents = []; // Clear

    console.log('\n=== Test: tx.progressHook() method receives events during wait() ===');

    const tx = await pushClient.universal.sendTransaction({
      to,
      value: BigInt(100),
    });

    // Register callback AFTER getting tx (new API)
    tx.progressHook((event: ProgressEvent) => {
      methodEvents.push(event);
      console.log(`[TX.HOOK] ${event.id}: ${event.message}`);
    });

    // Wait triggers tracking events
    await tx.wait();

    // Should have received SEND-TX-* events (replayed from execution buffer + tracking)
    expect(methodEvents.length).toBeGreaterThan(0);
    expect(methodEvents.some((e) => e.id === 'SEND-TX-101')).toBe(true);
    expect(methodEvents.some((e) => e.id === 'SEND-TX-199-01')).toBe(true);

    console.log(`✓ tx.progressHook() received ${methodEvents.length} events`);
  }, 60000);

  it('should call both tx.progressHook and orchestrator hook', async () => {
    if (!pushClient) {
      console.log('Setup failed, skipping test');
      return;
    }

    const methodEvents: ProgressEvent[] = [];
    orchestratorEvents = []; // Clear

    console.log('\n=== Test: Both hooks receive events ===');

    const tx = await pushClient.universal.sendTransaction({
      to,
      value: BigInt(100),
    });

    // Register method callback
    tx.progressHook((event: ProgressEvent) => {
      methodEvents.push(event);
    });

    await tx.wait();

    // Both should have received SEND-TX-* events
    expect(methodEvents.length).toBeGreaterThan(0);
    expect(orchestratorEvents.length).toBeGreaterThan(0);

    // Verify both have the same events
    for (const methodEvent of methodEvents) {
      const orchestratorEvent = orchestratorEvents.find(
        (e) => e.id === methodEvent.id
      );
      expect(orchestratorEvent).toBeDefined();
    }

    console.log(
      `✓ tx.progressHook received ${methodEvents.length} events, orchestrator received ${orchestratorEvents.length} events`
    );
  }, 60000);

  it('should work with trackTransaction progress callback', async () => {
    if (!pushClient || !sharedTxResponse) {
      console.log('Setup failed, skipping test');
      return;
    }

    const trackEvents: ProgressEvent[] = [];
    orchestratorEvents = []; // Clear

    console.log('\n=== Test: trackTransaction with progress callback ===');
    const receipt = await pushClient.universal.trackTransaction(
      sharedTxResponse.hash,
      {
        waitForCompletion: true,
        progressHook: (event: ProgressEvent) => {
          console.log(`[TRACK] ${event.id}: ${event.message}`);
          trackEvents.push(event);
        },
        advanced: {
          timeout: 30000,
        },
      }
    );

    expect(receipt.hash).toBe(sharedTxResponse.hash);
    expect(trackEvents.some((e) => e.id === 'SEND-TX-101')).toBe(true);
    expect(trackEvents.some((e) => e.id === 'SEND-TX-199-01')).toBe(true);

    // Both per-tx and orchestrator hooks should have received events
    expect(orchestratorEvents.length).toBeGreaterThan(0);

    console.log(
      `✓ trackTransaction received ${trackEvents.length} per-tx events and ${orchestratorEvents.length} orchestrator events`
    );
  }, 60000);

  it('should work without tx.progressHook (orchestrator only)', async () => {
    if (!pushClient) {
      console.log('Setup failed, skipping test');
      return;
    }

    orchestratorEvents = []; // Clear

    console.log('\n=== Test: Orchestrator hook only (no tx.progressHook) ===');
    const tx = await pushClient.universal.sendTransaction({
      to,
      value: BigInt(100),
      // No tx.progressHook() called
    });

    await tx.wait();

    // Orchestrator hook should still receive SEND_TX_* events
    expect(orchestratorEvents.length).toBeGreaterThan(0);
    expect(orchestratorEvents.some((e) => e.id === 'SEND-TX-101')).toBe(true);
    expect(orchestratorEvents.some((e) => e.id === 'SEND-TX-199-01')).toBe(true);

    console.log(
      `✓ Orchestrator hook received ${orchestratorEvents.length} events (no tx.progressHook)`
    );
  }, 60000);

  it('should receive events with expected structure via tx.progressHook', async () => {
    if (!pushClient) {
      console.log('Setup failed, skipping test');
      return;
    }

    const methodEvents: ProgressEvent[] = [];

    console.log('\n=== Test: Event structure validation via tx.progressHook ===');
    const tx = await pushClient.universal.sendTransaction({
      to,
      value: BigInt(100),
    });

    tx.progressHook((event: ProgressEvent) => {
      methodEvents.push(event);
    });

    await tx.wait();

    // Verify event structure
    expect(methodEvents.length).toBeGreaterThan(0);

    for (const event of methodEvents) {
      expect(event.id).toBeDefined();
      expect(typeof event.id).toBe('string');
      expect(event.title).toBeDefined();
      expect(typeof event.title).toBe('string');
      expect(event.message).toBeDefined();
      expect(typeof event.message).toBe('string');
      expect(['INFO', 'SUCCESS', 'WARNING', 'ERROR']).toContain(event.level);
      expect(event.timestamp).toBeDefined();
      expect(typeof event.timestamp).toBe('string');
    }

    // Verify expected SEND-TX events are present
    expect(methodEvents.some((e) => e.id === 'SEND-TX-101')).toBe(true);
    expect(methodEvents.some((e) => e.id === 'SEND-TX-199-01')).toBe(true);

    // Doc requirement: progress.response must be present (non-null) on every event
    const nullResponseEvents = methodEvents.filter((e) => e.response === null);
    if (nullResponseEvents.length) {
      console.log(
        'R1 events with null response:',
        nullResponseEvents.map((e) => e.id)
      );
    }
    expect(nullResponseEvents.length).toBe(0);

    console.log(`✓ All ${methodEvents.length} events have valid structure`);
  }, 60000);
});

// ============================================================================
// executeTransactions per-call progressHook (e2e)
// Validates that executeTransactions(txs, { progressHook }) fires the per-call
// hook ADDITIVE with the init-time hook, with reference-dedup.
// ============================================================================
describe('executeTransactions per-call progressHook (e2e)', () => {
  const toExec = '0x35B84d6848D16415177c64D64504663b998A6ab4';

  let pushClientExec: PushChain;
  let initHookEventsExec: ProgressEvent[] = [];

  const initHookExec = (event: ProgressEvent) => {
    initHookEventsExec.push(event);
  };

  const privateKeyExec = process.env['EVM_PRIVATE_KEY'] as Hex | undefined;
  const skipExec = !privateKeyExec;

  beforeAll(async () => {
    if (skipExec) {
      console.log('Skipping — EVM_PRIVATE_KEY not set');
      return;
    }
    initHookEventsExec = [];
    const setup = await createEvmPushClient({
      chain: CHAIN.ETHEREUM_SEPOLIA,
      privateKey: privateKeyExec!,
      progressHook: initHookExec,
    });
    pushClientExec = setup.pushClient;
  }, 120_000);

  beforeEach(() => {
    initHookEventsExec = [];
  });

  function countByIdExec(events: ProgressEvent[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const e of events) {
      counts[e.id] = (counts[e.id] ?? 0) + 1;
    }
    return counts;
  }

  function subtractCountsExec(
    after: Record<string, number>,
    before: Record<string, number>
  ): Record<string, number> {
    const delta: Record<string, number> = {};
    for (const [id, count] of Object.entries(after)) {
      const prev = before[id] ?? 0;
      if (count - prev > 0) delta[id] = count - prev;
    }
    return delta;
  }

  it(
    'fires both init-time and per-call hooks during executeTransactions (additive)',
    async () => {
      if (skipExec) return;

      const perCallEvents: ProgressEvent[] = [];
      const perCallHook = (event: ProgressEvent) => {
        perCallEvents.push(event);
      };

      const prep = await pushClientExec.universal.prepareTransaction({
        to: toExec,
        value: BigInt(100),
      });
      const result = await pushClientExec.universal.executeTransactions(
        [prep],
        { progressHook: perCallHook }
      );

      expect(result.initialTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);

      const initIds = initHookEventsExec.map((e) => e.id);
      const perCallIds = perCallEvents.map((e) => e.id);
      expect(initIds).toContain('SEND-TX-101');
      expect(initIds).toContain('SEND-TX-199-01');
      expect(perCallIds).toContain('SEND-TX-101');
      expect(perCallIds).toContain('SEND-TX-199-01');

      expect(perCallIds).toEqual(initIds);
    },
    120_000
  );

  it(
    'dedups when the per-call hook IS the init-time hook (no double-fire)',
    async () => {
      if (skipExec) return;

      const countsBefore = countByIdExec(initHookEventsExec);

      const prep = await pushClientExec.universal.prepareTransaction({
        to: toExec,
        value: BigInt(100),
      });
      const result = await pushClientExec.universal.executeTransactions(
        [prep],
        { progressHook: initHookExec }
      );
      expect(result.initialTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);

      const countsAfter = countByIdExec(initHookEventsExec);
      const delta = subtractCountsExec(countsAfter, countsBefore);

      expect(delta['SEND-TX-101'] ?? 0).toBe(1);
      expect(delta['SEND-TX-199-01'] ?? 0).toBe(1);

      for (const [, count] of Object.entries(delta)) {
        expect(count).toBeLessThanOrEqual(1);
      }
    },
    120_000
  );

  it(
    'falls back to init-time hook only when no per-call hook is provided',
    async () => {
      if (skipExec) return;

      const prep = await pushClientExec.universal.prepareTransaction({
        to: toExec,
        value: BigInt(100),
      });
      const result = await pushClientExec.universal.executeTransactions([prep]);
      expect(result.initialTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);

      const ids = initHookEventsExec.map((e) => e.id);
      expect(ids).toContain('SEND-TX-101');
      expect(ids).toContain('SEND-TX-199-01');
    },
    120_000
  );

  it(
    'isolates the per-call hook to its own call (does not leak into subsequent calls)',
    async () => {
      if (skipExec) return;

      const perCallA: ProgressEvent[] = [];
      const prepA = await pushClientExec.universal.prepareTransaction({
        to: toExec,
        value: BigInt(100),
      });
      await pushClientExec.universal.executeTransactions([prepA], {
        progressHook: (e) => perCallA.push(e),
      });

      expect(perCallA.map((e) => e.id)).toContain('SEND-TX-101');

      const perCallALengthBefore = perCallA.length;
      const prepB = await pushClientExec.universal.prepareTransaction({
        to: toExec,
        value: BigInt(100),
      });
      await pushClientExec.universal.executeTransactions([prepB]);

      expect(perCallA.length).toBe(perCallALengthBefore);
    },
    180_000
  );
});

// ============================================================================
// External Chain Polling Progress Hooks (Routes 2 & 3)
// Verifies route-specific external-chain polling hooks (209/299, 309/310/399)
// fired from response-builder.wait().
// ============================================================================
describe('External Chain Polling Progress Hooks (Routes 2 & 3)', () => {
  const BNB_COUNTER_EX: `0x${string}` = '0xf4bd8c13da0f5831d7b6dd3275a39f14ec7ddaa6';

  describe('Route 2: UOA_TO_CEA outbound', () => {
    const privateKeyR2 = process.env['PUSH_PRIVATE_KEY'] as Hex;
    const skipR2 = !privateKeyR2;

    it('emits SEND-TX-209-01 / 209-02 / 299-01 during outbound polling', async () => {
      if (skipR2) {
        console.log('Skipping — PUSH_PRIVATE_KEY not set');
        return;
      }

      const orchestratorEvents: ProgressEvent[] = [];
      const { pushClient } = await createEvmPushClient({
        chain: CHAIN.PUSH_TESTNET_DONUT,
        privateKey: privateKeyR2,
        printTraces: false,
        progressHook: (event: ProgressEvent) => {
          orchestratorEvents.push(event);
        },
      });

      const tx = await pushClient.universal.sendTransaction({
        to: {
          address: BNB_COUNTER_EX,
          chain: CHAIN.BNB_TESTNET,
        },
        data: encodeFunctionData({
          abi: COUNTER_ABI,
          functionName: 'increment',
        }),
      });

      const events: ProgressEvent[] = [];
      tx.progressHook((event) => {
        events.push(event);
      });

      const receipt = await tx.wait();

      const allEvents = [...orchestratorEvents, ...events];
      const ids = allEvents.map((e) => e.id);
      expect(receipt.status).toBe(1);
      expect(receipt.externalTxHash).toBeDefined();
      expect(receipt.externalChain).toBe(CHAIN.BNB_TESTNET);

      expect(ids).toContain('SEND-TX-209-01');
      expect(ids).toContain('SEND-TX-299-01');

      [
        'SEND-TX-201',
        'SEND-TX-202-01',
        'SEND-TX-202-02',
        'SEND-TX-203-01',
        'SEND-TX-203-02',
        'SEND-TX-204-01',
        'SEND-TX-204-02',
        'SEND-TX-204-03',
        'SEND-TX-207',
      ].forEach((id) => expect(ids).toContain(id));

      const nullResponseEvents = allEvents.filter((e) => e.response === null);
      expect(nullResponseEvents.length).toBe(0);

      const confirmed = events.find((e) => e.id === 'SEND-TX-299-01')!;
      expect(confirmed.level).toBe('SUCCESS');
      expect(confirmed.response).toBeDefined();
      const details = confirmed.response as {
        txHash: string;
        externalTxHash: string;
        destinationChain: CHAIN;
        explorerUrl: string;
      };
      expect(details.txHash).toBe(receipt.externalTxHash);
      expect(details.externalTxHash).toBe(receipt.externalTxHash);
      expect(details.destinationChain).toBe(CHAIN.BNB_TESTNET);
      expect(details.explorerUrl).toContain('testnet.bscscan.com/tx/');

      expect(ids.indexOf('SEND-TX-209-01')).toBeLessThan(
        ids.indexOf('SEND-TX-299-01')
      );
    }, 360000);
  });

  describe('Route 3: CEA_TO_PUSH native-bridge round-trip', () => {
    const evmKeyR3 = process.env['EVM_PRIVATE_KEY'] as Hex | undefined;

    (evmKeyR3 ? it : it.skip)(
      'emits SEND-TX-301..307 pre-broadcast + 309/310/399 during wait()',
      async () => {
        const sepoliaCtx = makeSepoliaContext(evmKeyR3 as Hex);
        const bnbCtx = makeBnbContext(evmKeyR3 as Hex);
        const account = privateKeyToAccount(generatePrivateKey());
        const walletClient = createWalletClient({
          account,
          chain: sepolia,
          transport: http(CHAIN_INFO[CHAIN.ETHEREUM_SEPOLIA].defaultRPC[0]),
        });

        const universalSigner =
          await PushChain.utils.signer.toUniversalFromKeypair(walletClient, {
            chain: CHAIN.ETHEREUM_SEPOLIA,
            library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
          });

        const orchestratorEvents: ProgressEvent[] = [];
        const client = await PushChain.initialize(universalSigner, {
          network: PUSH_NETWORK.TESTNET_DONUT,
          progressHook: (event: ProgressEvent) => {
            orchestratorEvents.push(event);
          },
        });

        const ceaAddress = await deriveBnbCea(
          bnbCtx,
          client.universal.account as `0x${string}`
        );
        await fundSepoliaUoa(sepoliaCtx, account.address, '0.005');
        await fundBnbCea(bnbCtx, ceaAddress, '0.02');

        const tx = await client.universal.sendTransaction({
          from: { chain: PushChain.CONSTANTS.CHAIN.BNB_TESTNET },
          to: client.universal.account,
          value: PushChain.utils.helpers.parseUnits('0.00005', 18),
        });

        const responseEvents: ProgressEvent[] = [];
        tx.progressHook((event) => {
          responseEvents.push(event);
        });

        let waitError: unknown;
        try {
          await tx.wait();
        } catch (err) {
          waitError = err;
        }

        const allEvents = [...orchestratorEvents, ...responseEvents];
        const ids = allEvents.map((e) => e.id);

        [
          'SEND-TX-301',
          'SEND-TX-302-01',
          'SEND-TX-302-02',
          'SEND-TX-303-01',
          'SEND-TX-303-02',
          'SEND-TX-304-01',
          'SEND-TX-304-02',
          'SEND-TX-304-03',
          'SEND-TX-307',
        ].forEach((id) => expect(ids).toContain(id));

        expect(ids).toContain('SEND-TX-309-01');
        expect(ids).toContain('SEND-TX-309-03');
        expect(ids).toContain('SEND-TX-310-01');

        const terminalInbound = ids.filter(
          (id) =>
            id === 'SEND-TX-399-01' ||
            id === 'SEND-TX-399-02' ||
            id === 'SEND-TX-399-03'
        );
        expect(terminalInbound.length).toBeGreaterThan(0);

        const indexOf = (id: string) => ids.indexOf(id);
        const lastTerminal = Math.max(
          ids.lastIndexOf('SEND-TX-399-01'),
          ids.lastIndexOf('SEND-TX-399-02'),
          ids.lastIndexOf('SEND-TX-399-03')
        );
        expect(indexOf('SEND-TX-307')).toBeLessThan(indexOf('SEND-TX-309-01'));
        expect(indexOf('SEND-TX-309-01')).toBeLessThan(
          indexOf('SEND-TX-309-03')
        );
        expect(indexOf('SEND-TX-309-03')).toBeLessThan(
          indexOf('SEND-TX-310-01')
        );
        expect(indexOf('SEND-TX-310-01')).toBeLessThan(lastTerminal);

        if (terminalInbound.length === 0 && waitError) throw waitError;

        const nullResponseEvents = allEvents.filter((e) => e.response === null);
        expect(nullResponseEvents.length).toBe(0);
      },
      600000
    );
  });
});

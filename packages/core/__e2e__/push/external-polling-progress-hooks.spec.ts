import '@e2e/shared/setup';
/**
 * E2E verification for the route-specific external-chain polling progress
 * hooks emitted from response-builder.wait():
 *   Route 2 (UOA_TO_CEA):
 *     SEND-TX-209-01  Awaiting Push Chain Relay
 *     SEND-TX-209-02  Syncing State with {ChainName}
 *     SEND-TX-299-01  {ChainName} TX Success
 *     SEND-TX-299-02  {ChainName} TX Failed
 *     SEND-TX-299-03  Syncing State with {ChainName} Timeout
 *     SEND-TX-299-99  Intermediate {ChainName} TX Completed
 *   Route 3 (CEA_TO_PUSH):
 *     SEND-TX-309-01/02/03, SEND-TX-310-01/02, SEND-TX-399-01/02/03
 *
 * Fired from response-builder.wait() via the response-level progressHook
 * (registered via tx.progressHook(cb)) on outbound routes.
 */
import { CHAIN, PUSH_NETWORK } from '../../src/lib/constants/enums';
import { CHAIN_INFO } from '../../src/lib/constants/chain';
import {
  Hex,
  createWalletClient,
  encodeFunctionData,
  http,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { PushChain } from '../../src';
import { createEvmPushClient } from '@e2e/shared/evm-client';
import { COUNTER_ABI } from '@e2e/shared/outbound-helpers';
import { ProgressEvent } from '../../src/lib/progress-hook/progress-hook.types';
import {
  deriveBnbCea,
  fundBnbCea,
  fundSepoliaUoa,
  makeBnbContext,
  makeSepoliaContext,
} from '../docs-examples/_helpers/docs-fund';

const BNB_COUNTER: `0x${string}` = '0xf4bd8c13da0f5831d7b6dd3275a39f14ec7ddaa6';

describe('External Chain Polling Progress Hooks (Routes 2 & 3)', () => {
  // ========================================================================
  // Route 2: UOA_TO_CEA — Push native EOA → counter increment on BNB Testnet
  // ========================================================================
  describe('Route 2: UOA_TO_CEA outbound', () => {
    const privateKey = process.env['PUSH_PRIVATE_KEY'] as Hex;
    const skipE2E = !privateKey;

    it('emits SEND-TX-209-01 / 209-02 / 299-01 during outbound polling', async () => {
      if (skipE2E) {
        console.log('Skipping — PUSH_PRIVATE_KEY not set');
        return;
      }

      const { pushClient } = await createEvmPushClient({
        chain: CHAIN.PUSH_TESTNET_DONUT,
        privateKey,
        printTraces: false,
      });

      const tx = await pushClient.universal.sendTransaction({
        to: {
          address: BNB_COUNTER,
          chain: CHAIN.BNB_TESTNET,
        },
        data: encodeFunctionData({
          abi: COUNTER_ABI,
          functionName: 'increment',
        }),
      });

      console.log(`Route 2 Push Chain TX Hash: ${tx.hash}`);

      // Register response-level hook BEFORE wait() — new events fire via
      // registeredProgressHook only (not ctx.progressHook) per the core
      // scoping in response-builder.ts.
      const events: ProgressEvent[] = [];
      tx.progressHook((event) => {
        events.push(event);
        console.log(`[${event.id}] ${event.title} (${event.level})`);
      });

      const receipt = await tx.wait();

      console.log(`Route 2 External TX Hash: ${receipt.externalTxHash}`);
      console.log(`Route 2 External Chain: ${receipt.externalChain}`);

      const ids = events.map((e) => e.id);
      expect(receipt.status).toBe(1);
      expect(receipt.externalTxHash).toBeDefined();
      expect(receipt.externalChain).toBe(CHAIN.BNB_TESTNET);

      // Core assertion: the route-2 external-polling events fired
      expect(ids).toContain('SEND-TX-209-01');
      expect(ids).toContain('SEND-TX-299-01');

      // Full R2 pre-wait sequence (doc alignment): 202-xx gas + 204-xx signature
      // must now fire live, not just in trackTransaction replay.
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

      // Doc requirement: progress.response must be present (non-null) on every event
      const nullResponseEvents = events.filter((e) => e.response === null);
      if (nullResponseEvents.length) {
        console.log(
          'Events with null response:',
          nullResponseEvents.map((e) => e.id)
        );
      }
      expect(nullResponseEvents.length).toBe(0);

      // 299-01 must carry txHash + OutboundTxDetails in the `response` field
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

      // 209-01 must fire BEFORE 299-01
      expect(ids.indexOf('SEND-TX-209-01')).toBeLessThan(
        ids.indexOf('SEND-TX-299-01')
      );

      // 209-02 is emitted by the translator on the 'polling' transition.
      // It's optional because the mock/real relay may short-circuit if the
      // outbound hash is available immediately after the initial wait.
      // Log but don't hard-assert.
      console.log(
        `SEND-TX-209-02 present: ${ids.includes('SEND-TX-209-02')}`
      );
    }, 360000);
  });

  // ========================================================================
  // Route 3: CEA_TO_PUSH — native-bridge variant
  //
  // Uses the route3_native pattern (value-only, no Push-side payload). The
  // outbound CEA-on-source-chain leg + the inbound credit on Push Chain
  // exercise the full 309/310/399 progress sequence via
  // pickWaitHooks(CEA_TO_PUSH) and waitForInboundPushTx. The inbound leg may
  // hit the 182s default timeout on testnet (emits 399-03 instead of 399-01)
  // — any 399-xx terminal proves the wiring fired.
  // ========================================================================
  describe('Route 3: CEA_TO_PUSH native-bridge round-trip', () => {
    const evmKey = process.env['EVM_PRIVATE_KEY'] as Hex | undefined;

    (evmKey ? it : it.skip)(
      'emits SEND-TX-301..307 pre-broadcast + 309/310/399 during wait()',
      async () => {
        const sepoliaCtx = makeSepoliaContext(evmKey as Hex);
        const bnbCtx = makeBnbContext(evmKey as Hex);
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
            console.log(`[ctx ${event.id}] ${event.title} (${event.level})`);
          },
        });

        const ceaAddress = await deriveBnbCea(
          bnbCtx,
          client.universal.account as `0x${string}`
        );
        console.log('CEA on BNB Testnet:', ceaAddress);
        await fundSepoliaUoa(sepoliaCtx, account.address, '0.005');
        await fundBnbCea(bnbCtx, ceaAddress, '0.02');

        // Native-bridge: value-only, NO data — inbound payload stays '0x',
        // sidestepping the buildInboundUniversalPayload(to: ZERO_ADDRESS) bug
        const tx = await client.universal.sendTransaction({
          from: { chain: PushChain.CONSTANTS.CHAIN.BNB_TESTNET },
          to: client.universal.account,
          value: PushChain.utils.helpers.parseUnits('0.00005', 18),
        });
        console.log(`Route 3 Push Chain TX Hash: ${tx.hash}`);

        const responseEvents: ProgressEvent[] = [];
        tx.progressHook((event) => {
          responseEvents.push(event);
          console.log(`[tx ${event.id}] ${event.title} (${event.level})`);
        });

        // wait() may resolve or throw depending on inbound timeout — we only
        // care about the progress-hook sequence here, not round-trip success.
        let waitError: unknown;
        try {
          await tx.wait();
        } catch (err) {
          waitError = err;
          console.log(
            `wait() threw (acceptable for progress-hook validation): ${err instanceof Error ? err.message : String(err)}`
          );
        }

        // Collate — pre-broadcast events land on ctx hook; wait() events on both
        const allEvents = [...orchestratorEvents, ...responseEvents];
        const ids = allEvents.map((e) => e.id);
        console.log(
          `R3 event sequence (${ids.length} total):`,
          ids.join(', ')
        );

        // Pre-broadcast R3 lifecycle
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

        // Outbound (source chain CEA execution)
        expect(ids).toContain('SEND-TX-309-01');
        expect(ids).toContain('SEND-TX-309-03');

        // Inbound-submitted marker
        expect(ids).toContain('SEND-TX-310-01');

        // Terminal: 399-01 (success) or 399-02 (failed) or 399-03 (timeout).
        // Testnet relay latency can cause inbound timeout even on the happy
        // path; any 399-xx proves the inbound-tracker wiring fired.
        const terminalInbound = ids.filter(
          (id) =>
            id === 'SEND-TX-399-01' ||
            id === 'SEND-TX-399-02' ||
            id === 'SEND-TX-399-03'
        );
        expect(terminalInbound.length).toBeGreaterThan(0);
        console.log(`R3 terminal inbound ID: ${terminalInbound.join(', ')}`);

        // Ordering: 307 (broadcast) < 309-01 (awaiting relay) < 309-03 (CEA
        // confirmed) < 310-01 (inbound submitted) < terminal 399-xx
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

        // Surface wait() error only if no terminal fired at all
        if (terminalInbound.length === 0 && waitError) throw waitError;

        // Doc requirement: progress.response must be present (non-null)
        const nullResponseEvents = allEvents.filter((e) => e.response === null);
        if (nullResponseEvents.length) {
          console.log(
            'R3 events with null response:',
            nullResponseEvents.map((e) => e.id)
          );
        }
        expect(nullResponseEvents.length).toBe(0);
      },
      600000
    );
  });
});

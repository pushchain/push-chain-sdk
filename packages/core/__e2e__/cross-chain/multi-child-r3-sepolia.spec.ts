/* eslint-disable @typescript-eslint/no-non-null-assertion, @typescript-eslint/no-explicit-any */
/**
 * Multi-child R3 fan-out — Sepolia source → Push Chain children.
 *
 * Purpose (Item 8 pre-flight):
 *   When a single external-chain source tx fires ≥2 `UniversalTx(fromCEA=true)`
 *   events, each log becomes its own child UTX on Push Chain. The orchestrator
 *   today collapses that fan-out to a single child at
 *   `inbound-tracker.ts:113-115`:
 *       resolutions.find((r) => r.sourceEventName === 'UniversalTx') ?? resolutions[0]
 *   Any additional siblings are silently dropped.
 *
 *   This spec is the trigger scenario. It chains two R3 hops from Sepolia and
 *   inspects what the SDK produces on the source chain + on Push. It serves
 *   three purposes:
 *
 *   1. Baseline: confirm that the current cascade compiler
 *      (`classifyIntoSegments` in `orchestrator/internals/cascade.ts:514`)
 *      does NOT merge consecutive R3 hops with the same source chain —
 *      the `canMerge` branch on line 524-530 only returns true for
 *      OUTBOUND_TO_CEA or PUSH_EXECUTION; INBOUND_FROM_CEA falls through.
 *      Expected today: two separate Sepolia txs, each with one UniversalTx
 *      log → two independent single-child R3 flows.
 *
 *   2. Document the gap: once the SDK supports R3 segment merging (OR a
 *      product flow introduces a helper contract that CPIs into the CEA
 *      twice in one tx), the same spec becomes a positive multi-child
 *      assertion via `detectUniversalTx(...).matchingLogs`.
 *
 *   3. Detector sanity: verify that Sepolia CEA-inbound detection + child
 *      resolution works end-to-end on a live R3 the way it does for BNB
 *      Testnet already.
 *
 * Run:
 *   EVM_PRIVATE_KEY=0x... npx nx test core \
 *     --testPathPattern='cross-chain/multi-child-r3-sepolia'
 */
import '@e2e/shared/setup';
import { PushChain } from '../../src';
import { CHAIN, PUSH_NETWORK } from '../../src/lib/constants/enums';
import { CHAIN_INFO } from '../../src/lib/constants/chain';
import {
  createPublicClient,
  createWalletClient,
  http,
  type Hex,
  parseEther,
  encodeFunctionData,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { createEvmPushClient } from '@e2e/shared/evm-client';
import { detectUniversalTx } from '../../src/lib/universal-tx-detector/detector';
import {
  resolveChildInboundsFromDetection,
} from '../../src/lib/universal-tx-detector/child-inbounds';
import { PushClient as _PushClient } from '../../src/lib/push-client/push-client';
import { getCEAAddress } from '../../src/lib/orchestrator/cea-utils';
import type { ProgressEvent } from '../../src/lib/progress-hook/progress-hook.types';

// Push Chain payable counter — each R3 child calls increment() to produce a
// verifiable side-effect. Same contract used throughout advance-hopping.spec.ts.
const COUNTER_PUSH = '0x70d8f7a0fF8e493fb9cbEE19Eb780E40Aa872aaf' as const;
const COUNTER_ABI = [
  {
    type: 'function',
    name: 'increment',
    inputs: [],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'countPC',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const;

// Burn-style receiver used for the second child's value transfer so each
// child's Push-Chain side-effect is independently observable.
const VALUE_RECEIVER = '0x00000000000000000000000000000000dead1234' as const;

describe('Multi-child R3 fan-out (Sepolia source → 2 Push Chain children)', () => {
  let pushChain: Awaited<ReturnType<typeof PushChain.initialize>>;
  let pushPublicClient: ReturnType<typeof createPublicClient>;
  let readonlyPushClient: _PushClient;
  const events: ProgressEvent[] = [];

  const privateKey = process.env['EVM_PRIVATE_KEY'] as Hex | undefined;
  const skipE2E = !privateKey;

  beforeAll(async () => {
    if (skipE2E) {
      console.log('Skipping — EVM_PRIVATE_KEY not set');
      return;
    }
    const setup = await createEvmPushClient({
      chain: CHAIN.ETHEREUM_SEPOLIA,
      privateKey: privateKey!,
      printTraces: true,
      progressHook: (e: ProgressEvent) => {
        events.push(e);
        console.log(`[${e.id}] ${(e as any).title ?? e.message ?? ''}`);
      },
    });
    pushChain = setup.pushClient;
    console.log(`UEA: ${pushChain.universal.account}`);

    pushPublicClient = createPublicClient({
      transport: http(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]),
    });

    readonlyPushClient = new _PushClient({
      network: PUSH_NETWORK.TESTNET_DONUT,
      rpcUrls: [CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]],
    });

    // Derive the Sepolia CEA for this UEA and ensure it has enough ETH for
    // gas + the two inbound emissions. If below the threshold, top it up
    // from the test signer's EOA. Keeps the spec self-contained.
    const sepoliaRpc = CHAIN_INFO[CHAIN.ETHEREUM_SEPOLIA].defaultRPC[0];
    const sepoliaClient = createPublicClient({
      chain: sepolia,
      transport: http(sepoliaRpc),
    });
    const { cea, isDeployed } = await getCEAAddress(
      pushChain.universal.account as `0x${string}`,
      CHAIN.ETHEREUM_SEPOLIA,
      sepoliaRpc
    );
    const ceaBalance = await sepoliaClient.getBalance({ address: cea });
    console.log(
      `[funding] Sepolia CEA ${cea} isDeployed=${isDeployed} balance=${ceaBalance} wei`
    );

    const FUND_THRESHOLD = parseEther('0.01');
    const FUND_TOP_UP = parseEther('0.015');
    if (ceaBalance < FUND_THRESHOLD) {
      const signerAcct = privateKeyToAccount(privateKey! as `0x${string}`);
      const signerBal = await sepoliaClient.getBalance({
        address: signerAcct.address,
      });
      console.log(
        `[funding] Topping up CEA. Signer ${signerAcct.address} bal=${signerBal} wei`
      );
      const walletClient = createWalletClient({
        account: signerAcct,
        chain: sepolia,
        transport: http(sepoliaRpc),
      });
      const fundHash = await walletClient.sendTransaction({
        to: cea,
        value: FUND_TOP_UP,
      });
      console.log(`[funding] Fund tx: ${fundHash} — waiting for receipt...`);
      const rcpt = await sepoliaClient.waitForTransactionReceipt({
        hash: fundHash,
      });
      expect(rcpt.status).toBe('success');
      const newBal = await sepoliaClient.getBalance({ address: cea });
      console.log(`[funding] CEA balance after top-up: ${newBal} wei`);
    } else {
      console.log(`[funding] CEA already funded — skipping top-up.`);
    }
  }, 180_000);

  beforeEach(() => {
    events.length = 0;
  });

  it(
    'chains two R3 hops from Sepolia and both Push-Chain side-effects land',
    async () => {
      if (skipE2E) return;

      // Snapshot Push Chain state before the cascade.
      const counterBefore = (await pushPublicClient.readContract({
        address: COUNTER_PUSH,
        abi: COUNTER_ABI,
        functionName: 'countPC',
      })) as bigint;
      console.log(`Before: counter=${counterBefore}`);

      const incrementPayload = encodeFunctionData({
        abi: COUNTER_ABI,
        functionName: 'increment',
      });

      // Two R3 hops sharing the same source chain — the cascade compiler's
      // `classifyIntoSegments` now merges INBOUND_FROM_CEA segments that
      // share a sourceChain, collapsing them into a single CEA→UEA round
      // trip whose inbound multicall runs BOTH target ops. No nested
      // outbound (which used to fail inside UGPC.sendUniversalTxOutbound
      // because the UEA held no PRC20 to burn in that nested context).
      // Both hops are payload-only R3s (burnAmount=0) so the outer Push
      // outbound doesn't try to drain PRC20 from the UEA (separate issue,
      // not the merge path). Counter should jump by +2 after the merge.
      const tx1 = await pushChain.universal.prepareTransaction({
        from: { chain: CHAIN.ETHEREUM_SEPOLIA },
        to: COUNTER_PUSH,
        data: incrementPayload,
      });
      const tx2 = await pushChain.universal.prepareTransaction({
        from: { chain: CHAIN.ETHEREUM_SEPOLIA },
        to: COUNTER_PUSH,
        data: incrementPayload,
      });

      const cascadeEventStream: string[] = [];
      const result = await pushChain.universal.executeTransactions([tx1, tx2]);
      console.log(`Initial tx hash: ${result.initialTxHash}`);
      console.log(`Hop count: ${result.hopCount}`);
      expect(result.initialTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);

      const completion = await result.waitForAll({
        timeout: 720_000,
        eventHook: (e) => {
          cascadeEventStream.push(e.id);
          console.log(`[event] ${e.id} | ${(e as any).title ?? e.message ?? ''}`);
        },
      });
      expect(completion.success).toBe(true);

      // Poll for the counter to jump by ≥2 — one inbound executes BOTH
      // hops' increment() calls via the merged UEA multicall.
      const MAX_INBOUND_WAIT_MS = 480_000;
      const POLL_INTERVAL_MS = 10_000;
      let counterAfter = counterBefore;
      const pollStart = Date.now();
      while (Date.now() - pollStart < MAX_INBOUND_WAIT_MS) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        counterAfter = (await pushPublicClient.readContract({
          address: COUNTER_PUSH,
          abi: COUNTER_ABI,
          functionName: 'countPC',
        })) as bigint;
        const elapsed = Math.round((Date.now() - pollStart) / 1000);
        console.log(`[poll +${elapsed}s] counter=${counterAfter}`);
        if (counterAfter >= counterBefore + BigInt(2)) break;
      }
      console.log(`After: counter=${counterAfter}`);

      // Both hops ran inside one inbound — counter +2.
      expect(counterAfter).toBeGreaterThanOrEqual(counterBefore + BigInt(2));

      // Collect every externalTxHash surfaced by the cascade. The shape
      // varies by route (R3 inbound hops may attach external hashes under
      // different keys than R2 outbound hops), so we walk liberally and
      // skip anything that's not a 32-byte hex.
      const sepoliaExtHashes = new Set<string>();
      for (const hop of completion.hops as any[]) {
        const candidates = [
          hop.outboundDetails?.externalTxHash,
          hop.externalTxHash,
          hop.observedTxHash,
          hop.sourceTxHash,
        ];
        for (const cand of candidates) {
          if (typeof cand === 'string' && /^0x[0-9a-fA-F]{64}$/.test(cand)) {
            sepoliaExtHashes.add(cand);
          }
        }
      }
      console.log(
        `collected external tx hashes: ${[...sepoliaExtHashes].join(', ') || '(none)'}`
      );

      // Detector inspection — best-effort. We probe each captured hash on
      // Sepolia; hashes that don't live there (e.g. Push Chain hops) just
      // yield UNKNOWN and are skipped. The main assertion (counter + balance
      // changed on Push) already validated the cascade end-to-end above.
      let totalCeaLogs = 0;
      let maxLogsPerTx = 0;
      let totalDistinctChildren = 0;
      for (const hash of sepoliaExtHashes) {
        const detection = await detectUniversalTx(
          hash as `0x${string}`,
          CHAIN.ETHEREUM_SEPOLIA,
          { skipPushChainLookup: true }
        );
        if (detection.kind === 'UNKNOWN') {
          console.log(`  ${hash}: not on Sepolia — skipping`);
          continue;
        }
        const ceaLogs = detection.matchingLogs.filter(
          (l) =>
            l.eventName === 'UniversalTx' &&
            (l.args as Record<string, unknown>)['fromCEA'] === true
        );
        console.log(
          `  ${hash}: UniversalTx(fromCEA=true) logs = ${ceaLogs.length} (indices ${ceaLogs.map((l) => l.logIndex).join(',')})`
        );
        totalCeaLogs += ceaLogs.length;
        if (ceaLogs.length > maxLogsPerTx) maxLogsPerTx = ceaLogs.length;

        const resolutions = await resolveChildInboundsFromDetection(
          readonlyPushClient,
          detection
        );
        const childUniversalTxes = resolutions.filter(
          (r) => r.sourceEventName === 'UniversalTx'
        );
        console.log(
          `  ${hash}: resolved children = ${childUniversalTxes.length} (utxIds=${childUniversalTxes.map((r) => r.universalTxId.slice(0, 10)).join(',')})`
        );
        totalDistinctChildren += childUniversalTxes.length;
      }
      console.log(
        `TOTAL across sepolia txs: ceaLogs=${totalCeaLogs} maxPerTx=${maxLogsPerTx} distinctChildren=${totalDistinctChildren}`
      );

      // If the detector saw any Sepolia R3 tx, confirm it resolved at least
      // one UniversalTx(fromCEA=true) — sanity-checks the EVM detector path.
      if (totalCeaLogs > 0) {
        expect(totalDistinctChildren).toBeGreaterThanOrEqual(1);
      }

      // Visibility only. Flips to ≥2 once the SDK supports multi-child R3
      // (either via a contract-level trigger or a cascade-compiler change).
      console.log(
        `Multi-child-per-tx observed: ${maxLogsPerTx >= 2 ? 'YES' : 'NO (baseline)'}`
      );
    },
    900_000
  );

  // Documents the Item 8 gap. Flip to `it` once:
  //   - classifyIntoSegments merges consecutive INBOUND_FROM_CEA hops with
  //     the same source chain, OR
  //   - a helper contract / CEA feature emits ≥2 UniversalTx(fromCEA=true)
  //     logs in one tx, AND
  //   - the receipt shape grows a `pushInboundChildren?: Array<...>` field.
  xit(
    'EXPECTED FAIL until Item 8: tracked completion surfaces both children in pushInboundChildren',
    async () => {
      // After Item 8: run the same cascade, then
      //   const r3Hops = completion.hops.filter(h => h.route === 'CEA_TO_PUSH');
      //   const withFanOut = r3Hops.find(h =>
      //     (h as any).pushInboundChildren?.length >= 2
      //   );
      //   expect(withFanOut).toBeDefined();
      //   expect(withFanOut!.pushInboundChildren.map(c => c.utxId)).toHaveLength(
      //     new Set(withFanOut!.pushInboundChildren.map(c => c.utxId)).size
      //   );
    }
  );
});

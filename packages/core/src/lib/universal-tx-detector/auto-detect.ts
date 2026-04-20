/**
 * Stage 4a — chain auto-detection.
 *
 * When a user pastes a tx hash without knowing which chain it lives on,
 * probe every registered EVM chain in parallel, classify the first one that
 * contains a universal-tx event, and return the detection.
 *
 * Probe order:
 *   1. Push Chain CAIPs (most common case for "PC Execution" hashes)
 *   2. All other EVM chains from CHAIN_INFO, in parallel
 *
 * The function resolves as soon as a non-UNKNOWN detection is found. Other
 * pending probes are abandoned via an AbortController-style race.
 */
import { CHAIN_INFO } from '../constants/chain';
import { CHAIN, VM } from '../constants/enums';
import { detectUniversalTx } from './detector';
import type { DetectUniversalTxOptions, UniversalTxDetection } from './types';

const PUSH_CHAIN_CAIPS: CHAIN[] = [
  CHAIN.PUSH_TESTNET_DONUT,
  CHAIN.PUSH_MAINNET,
  CHAIN.PUSH_LOCALNET,
];

/**
 * Every chain registered in CHAIN_INFO whose vm the detector supports
 * (EVM + SVM), ordered Push-first.
 */
export function listAutoProbeChains(): CHAIN[] {
  const supported = Object.keys(CHAIN_INFO).filter((c) => {
    const vm = CHAIN_INFO[c as CHAIN]?.vm;
    return vm === VM.EVM || vm === VM.SVM;
  }) as CHAIN[];
  const push: CHAIN[] = [];
  const rest: CHAIN[] = [];
  for (const c of supported) {
    if (PUSH_CHAIN_CAIPS.includes(c)) push.push(c);
    else rest.push(c);
  }
  return [...push, ...rest];
}

export interface DetectUniversalTxAutoOptions
  extends Omit<DetectUniversalTxOptions, 'rpcUrls'> {
  /** Per-chain RPC overrides. Falls back to CHAIN_INFO defaults. */
  rpcUrls?: Partial<Record<CHAIN, string[]>>;
  /**
   * Override the set of chains to probe. Defaults to every EVM chain in
   * CHAIN_INFO with Push Chain first.
   */
  chains?: CHAIN[];
  /**
   * When true, continue probing all chains even after the first match and
   * return every non-UNKNOWN detection. Default false (return first match).
   */
  exhaustive?: boolean;
}

export interface AutoDetectionResult {
  /** The chosen detection — the first non-UNKNOWN result. `undefined` if no chain had a universal-tx event. */
  detection?: UniversalTxDetection;
  /** Every chain that was probed, whether or not it matched. */
  attempts: Array<{
    chain: CHAIN;
    matched: boolean;
    kind: UniversalTxDetection['kind'];
    error?: string;
  }>;
}

/**
 * Probe every supported chain in parallel and return the first detection
 * with a recognized universal-tx kind.
 */
export async function detectUniversalTxAuto(
  txHash: `0x${string}`,
  opts: DetectUniversalTxAutoOptions = {}
): Promise<AutoDetectionResult> {
  const chains = opts.chains ?? listAutoProbeChains();
  const exhaustive = opts.exhaustive ?? false;
  const attempts: AutoDetectionResult['attempts'] = [];

  // Race probes. When a non-UNKNOWN detection lands, resolve early (unless
  // `exhaustive` is set).
  const seen: UniversalTxDetection[] = [];
  await new Promise<void>((resolve) => {
    let remaining = chains.length;
    let resolved = false;

    const finish = () => {
      if (resolved) return;
      resolved = true;
      resolve();
    };

    if (chains.length === 0) return finish();

    for (const chain of chains) {
      detectUniversalTx(txHash, chain, {
        pushClient: opts.pushClient,
        rpcUrls: opts.rpcUrls,
        pushNetwork: opts.pushNetwork,
        skipPushChainLookup: opts.skipPushChainLookup,
      })
        .then((d) => {
          const matched = d.kind !== 'UNKNOWN';
          attempts.push({ chain, matched, kind: d.kind });
          if (matched) seen.push(d);
          if (matched && !exhaustive) finish();
        })
        .catch((err) => {
          attempts.push({
            chain,
            matched: false,
            kind: 'UNKNOWN',
            error: err instanceof Error ? err.message : String(err),
          });
        })
        .finally(() => {
          remaining -= 1;
          if (remaining === 0) finish();
        });
    }
  });

  // Sort attempts so matched chains come first for deterministic caller UX.
  attempts.sort((a, b) => (a.matched === b.matched ? 0 : a.matched ? -1 : 1));

  // Prefer the first chain from the probe list that matched — preserves
  // Push-first order when exhaustive=true.
  const winner = chains
    .map((c) => seen.find((d) => d.chain === c))
    .find((d): d is UniversalTxDetection => d !== undefined);

  return { detection: winner, attempts };
}

import {
  runPreflight,
  maybeFireSvmWarnThreshold,
  SVM_NATIVE_VALUE_WARN_THRESHOLD,
} from '../internals/preflight';
import {
  InsufficientUEABalanceError,
  PushChainExecutionError,
} from '../internals/errors';
import { PROGRESS_HOOK, ProgressEvent } from '../../progress-hook/progress-hook.types';
import type { OrchestratorContext } from '../internals/context';

/**
 * Build a minimal OrchestratorContext that captures progress hook events
 * into a buffer the test can inspect.
 */
function makeCtx(): { ctx: OrchestratorContext; events: ProgressEvent[] } {
  const events: ProgressEvent[] = [];
  const ctx = {
    pushClient: {} as never,
    universalSigner: { account: { chain: 'PUSH_TESTNET_DONUT' as never } } as never,
    pushNetwork: 'TESTNET_DONUT' as never,
    rpcUrls: {},
    printTraces: false,
    progressHook: (e: ProgressEvent) => {
      events.push(e);
    },
    accountStatusCache: null,
  } as unknown as OrchestratorContext;
  return { ctx, events };
}

const UEA = '0x1111111111111111111111111111111111111111' as const;
const TOKEN = '0x2222222222222222222222222222222222222222' as const;

describe('runPreflight', () => {
  it('emits 203_03 INFO and returns ok when balance is sufficient', () => {
    const { ctx, events } = makeCtx();
    const result = runPreflight({
      ctx,
      ueaAddress: UEA,
      ueaBalance: BigInt('1000000000000000000000'), // 1000 PC
      requiredValue: BigInt('100000000000000000000'), // 100 PC
      gasReserve: BigInt(3e18),
      pathTag: 'R2_SVM',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.adjustedValue).toBe(BigInt('100000000000000000000'));
    }
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe(PROGRESS_HOOK.SEND_TX_203_03);
    expect(events[0].level).toBe('INFO');
    expect((events[0].response as any).sufficient).toBe(true);
  });

  it('emits 203_03 ERROR + 203_04 and throws InsufficientUEABalanceError on shortfall', () => {
    const { ctx, events } = makeCtx();
    expect(() =>
      runPreflight({
        ctx,
        ueaAddress: UEA,
        ueaBalance: BigInt('50000000000000000000'), // 50 PC
        requiredValue: BigInt('100000000000000000000'), // 100 PC
        gasReserve: BigInt(3e18),
        pathTag: 'R2_SVM',
      })
    ).toThrow(InsufficientUEABalanceError);

    expect(events).toHaveLength(2);
    expect(events[0].id).toBe(PROGRESS_HOOK.SEND_TX_203_03);
    expect(events[0].level).toBe('ERROR');
    expect((events[0].response as any).sufficient).toBe(false);
    expect(events[1].id).toBe(PROGRESS_HOOK.SEND_TX_203_04);
    expect(events[1].level).toBe('ERROR');
    expect((events[1].response as any).pathTag).toBe('R2_SVM');
  });

  it('error carries structured fields (required, available, shortfall, pathTag)', () => {
    const { ctx } = makeCtx();
    const required = BigInt('100000000000000000000');
    const reserve = BigInt(3e18);
    const available = BigInt('50000000000000000000');
    try {
      runPreflight({
        ctx,
        ueaAddress: UEA,
        ueaBalance: available,
        requiredValue: required,
        gasReserve: reserve,
        pathTag: 'R2_SVM',
      });
      fail('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(InsufficientUEABalanceError);
      const err = e as InsufficientUEABalanceError;
      expect(err.required).toBe(required + reserve);
      expect(err.available).toBe(available);
      expect(err.shortfall).toBe(required + reserve - available);
      expect(err.pathTag).toBe('R2_SVM');
      expect(err.reason).toBe('NATIVE');
      expect(err.ueaAddress).toBe(UEA);
    }
  });

  it('PRC-20 burn-balance shortfall throws with reason=PRC20', () => {
    const { ctx, events } = makeCtx();
    try {
      runPreflight({
        ctx,
        ueaAddress: UEA,
        ueaBalance: BigInt('1000000000000000000000'), // ample UPC
        requiredValue: BigInt('1000000000000000000'),
        gasReserve: BigInt(3e18),
        pathTag: 'R2_SVM',
        burnToken: TOKEN,
        burnAmount: BigInt(100),
        prc20Balance: BigInt(0),
      });
      fail('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(InsufficientUEABalanceError);
      const err = e as InsufficientUEABalanceError;
      expect(err.reason).toBe('PRC20');
      expect(err.burnToken).toBe(TOKEN);
      expect(err.required).toBe(BigInt(100));
      expect(err.available).toBe(BigInt(0));
    }
    // PRC-20 check fires 203_03 (insufficient) + 203_04 — does NOT reach the
    // native check, so only those two events should be emitted.
    expect(events).toHaveLength(2);
    expect(events[0].id).toBe(PROGRESS_HOOK.SEND_TX_203_03);
    expect((events[0].response as any).kind).toBe('PRC20');
    expect(events[1].id).toBe(PROGRESS_HOOK.SEND_TX_203_04);
    expect((events[1].response as any).kind).toBe('PRC20');
  });

  it('skips PRC-20 check when burnToken/burnAmount/prc20Balance are undefined (native value transfer)', () => {
    // Mirrors the route-handler behaviour: when prc20Token === gasToken on a
    // native value transfer, the route handler passes undefined to skip the
    // PRC-20 pre-check (swapAndBurnGas mints+burns atomically from msg.value).
    const { ctx, events } = makeCtx();
    const result = runPreflight({
      ctx,
      ueaAddress: UEA,
      ueaBalance: BigInt('1000000000000000000000'),
      requiredValue: BigInt('1000000000000000000'),
      gasReserve: BigInt(3e18),
      pathTag: 'R2_SVM',
      // burnToken / burnAmount / prc20Balance intentionally omitted
    });
    expect(result.ok).toBe(true);
    // Only 1 hook fires — the native UPC check. PRC-20 path fully skipped.
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe(PROGRESS_HOOK.SEND_TX_203_03);
    expect((events[0].response as any).kind).toBe('NATIVE');
  });

  it('PRC-20 sufficient + native sufficient → 203_03 INFO twice, no throw', () => {
    const { ctx, events } = makeCtx();
    const result = runPreflight({
      ctx,
      ueaAddress: UEA,
      ueaBalance: BigInt('1000000000000000000000'),
      requiredValue: BigInt('1000000000000000000'),
      gasReserve: BigInt(3e18),
      pathTag: 'R2_EVM',
      burnToken: TOKEN,
      burnAmount: BigInt(100),
      prc20Balance: BigInt(200),
    });
    expect(result.ok).toBe(true);
    // 1 event for PRC-20 INFO, 1 for native INFO.
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.level === 'INFO')).toBe(true);
    expect((events[0].response as any).kind).toBe('PRC20');
    expect((events[1].response as any).kind).toBe('NATIVE');
  });

  it('allowUnderfundedSwap=true skips throw and returns legacy clamped value', () => {
    const { ctx, events } = makeCtx();
    const result = runPreflight({
      ctx,
      ueaAddress: UEA,
      ueaBalance: BigInt('50000000000000000000'), // 50 PC
      requiredValue: BigInt('100000000000000000000'), // 100 PC
      gasReserve: BigInt(3e18),
      pathTag: 'R2_SVM',
      allowUnderfundedSwap: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // 50 PC > 3 PC reserve → ueaBalance - reserve
      expect(result.legacyClampedValue).toBe(BigInt('50000000000000000000') - BigInt(3e18));
    }
    // 203_04 should NOT fire under opt-out — only 203_03 (insufficient) for telemetry.
    expect(events.find((e) => e.id === PROGRESS_HOOK.SEND_TX_203_04)).toBeUndefined();
  });

  it('InsufficientUEABalanceError auto-populates decodedError for terminal hook payload', () => {
    const { ctx } = makeCtx();
    try {
      runPreflight({
        ctx,
        ueaAddress: UEA,
        ueaBalance: BigInt('50000000000000000000'),
        requiredValue: BigInt('100000000000000000000'),
        gasReserve: BigInt(3e18),
        pathTag: 'R2_SVM',
      });
      fail('expected throw');
    } catch (e) {
      // The new decodedError field must be populated so the orchestrator's
      // outer catch can pass it straight through to 299-02 / 399-02 / 999-02.
      const err = e as InsufficientUEABalanceError;
      expect(err.decodedError).toBeDefined();
      expect(err.decodedError?.name).toBe('InsufficientUEABalance');
      expect(typeof err.decodedError?.hint).toBe('string');
      expect(err.decodedError?.hint).toContain('Bridge');
    }
  });

  it('PRC-20 InsufficientUEABalanceError decodedError hint is PRC-20-flavoured', () => {
    const { ctx } = makeCtx();
    try {
      runPreflight({
        ctx,
        ueaAddress: UEA,
        ueaBalance: BigInt('1000000000000000000000'),
        requiredValue: BigInt('1000000000000000000'),
        gasReserve: BigInt(3e18),
        pathTag: 'R2_SVM',
        burnToken: TOKEN,
        burnAmount: BigInt(100),
        prc20Balance: BigInt(0),
      });
      fail('expected throw');
    } catch (e) {
      const err = e as InsufficientUEABalanceError;
      expect(err.decodedError?.name).toBe('InsufficientUEABalance');
      expect(err.decodedError?.hint).toContain('Bridge the burn token');
    }
  });

  it('InsufficientUEABalanceError is also instanceof PushChainExecutionError (for legacy catch handlers)', () => {
    const { ctx } = makeCtx();
    try {
      runPreflight({
        ctx,
        ueaAddress: UEA,
        ueaBalance: BigInt(0),
        requiredValue: BigInt(1),
        gasReserve: BigInt(3e18),
        pathTag: 'R2_EVM',
      });
      fail('expected throw');
    } catch (e) {
      // Existing call-sites use `instanceof PushChainExecutionError` to
      // classify failures — must continue to match.
      expect(e).toBeInstanceOf(InsufficientUEABalanceError);
      expect(e).toBeInstanceOf(PushChainExecutionError);
      expect(e).toBeInstanceOf(Error);
    }
  });

  it('CASCADE pathTag fires 003-03/04 (cascade bucket), NOT 203-03/04', () => {
    const { ctx, events } = makeCtx();
    try {
      runPreflight({
        ctx,
        ueaAddress: UEA,
        ueaBalance: BigInt(0),
        requiredValue: BigInt(1),
        gasReserve: BigInt(3e18),
        pathTag: 'CASCADE',
        segmentIndex: 1,
      });
      fail('expected throw');
    } catch {
      // expected
    }
    // Cascade context must emit 003-03 (not 203-03) and 003-04 (not 203-04).
    const ids = events.map((e) => e.id);
    expect(ids).toContain(PROGRESS_HOOK.SEND_TX_003_03);
    expect(ids).toContain(PROGRESS_HOOK.SEND_TX_003_04);
    expect(ids).not.toContain(PROGRESS_HOOK.SEND_TX_203_03);
    expect(ids).not.toContain(PROGRESS_HOOK.SEND_TX_203_04);
    // segmentIndex still propagates.
    const fail04 = events.find((e) => e.id === PROGRESS_HOOK.SEND_TX_003_04);
    expect((fail04?.response as any).segmentIndex).toBe(1);
  });

  it('R2_SVM pathTag continues to fire 203-03/04 (single-route bucket unchanged)', () => {
    const { ctx, events } = makeCtx();
    try {
      runPreflight({
        ctx,
        ueaAddress: UEA,
        ueaBalance: BigInt(0),
        requiredValue: BigInt(1),
        gasReserve: BigInt(3e18),
        pathTag: 'R2_SVM',
      });
      fail('expected throw');
    } catch {
      // expected
    }
    const ids = events.map((e) => e.id);
    expect(ids).toContain(PROGRESS_HOOK.SEND_TX_203_03);
    expect(ids).toContain(PROGRESS_HOOK.SEND_TX_203_04);
    expect(ids).not.toContain(PROGRESS_HOOK.SEND_TX_003_03);
    expect(ids).not.toContain(PROGRESS_HOOK.SEND_TX_003_04);
  });

  it('cascade segmentIndex propagates through to error and hook payload', () => {
    const { ctx, events } = makeCtx();
    try {
      runPreflight({
        ctx,
        ueaAddress: UEA,
        ueaBalance: BigInt(0),
        requiredValue: BigInt(1),
        gasReserve: BigInt(3e18),
        pathTag: 'CASCADE',
        segmentIndex: 2,
      });
      fail('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(InsufficientUEABalanceError);
      const err = e as InsufficientUEABalanceError;
      expect(err.pathTag).toBe('CASCADE');
      expect(err.segmentIndex).toBe(2);
    }
    // Cascade emits 003-04 (cascade bucket), not 203-04.
    const hook04 = events.find((e) => e.id === PROGRESS_HOOK.SEND_TX_003_04);
    expect(hook04).toBeDefined();
    expect((hook04!.response as any).segmentIndex).toBe(2);
  });
});

describe('maybeFireSvmWarnThreshold', () => {
  it('does NOT fire when buffered quote is at or below threshold', () => {
    const { ctx, events } = makeCtx();
    maybeFireSvmWarnThreshold(
      ctx,
      SVM_NATIVE_VALUE_WARN_THRESHOLD,
      '0xabc' as `0x${string}`,
      'R2_SVM'
    );
    expect(events).toHaveLength(0);
  });

  it('fires SEND_TX_203_05 INFO when buffered quote exceeds threshold (single-route)', () => {
    const { ctx, events } = makeCtx();
    const overThreshold =
      SVM_NATIVE_VALUE_WARN_THRESHOLD + BigInt('1000000000000000000');
    maybeFireSvmWarnThreshold(
      ctx,
      overThreshold,
      '0xabc' as `0x${string}`,
      'R2_SVM'
    );
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe(PROGRESS_HOOK.SEND_TX_203_05);
    expect(events[0].level).toBe('INFO');
    expect((events[0].response as any).quoted).toBe(overThreshold);
    expect((events[0].response as any).pathTag).toBe('R2_SVM');
  });

  it('fires SEND_TX_003_05 INFO (cascade bucket) when pathTag is CASCADE', () => {
    const { ctx, events } = makeCtx();
    const overThreshold =
      SVM_NATIVE_VALUE_WARN_THRESHOLD + BigInt('1000000000000000000');
    maybeFireSvmWarnThreshold(
      ctx,
      overThreshold,
      '0xabc' as `0x${string}`,
      'CASCADE'
    );
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe(PROGRESS_HOOK.SEND_TX_003_05);
    expect(events[0].level).toBe('INFO');
    expect((events[0].response as any).pathTag).toBe('CASCADE');
  });
});

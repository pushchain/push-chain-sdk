import PROGRESS_HOOKS from '../progress-hook';
import { PROGRESS_HOOK } from '../progress-hook.types';

/**
 * Per-hook stub args. The Record (not Partial) gives compile-time exhaustiveness:
 * adding a new PROGRESS_HOOK enum member without an entry here is a TS error,
 * so the invariant test exercises every hook with realistic args.
 *
 * Hooks taking no args use `[]`. Hooks with positional args follow the order
 * defined in progress-hook.ts.
 */
const STUB_ARGS: Record<PROGRESS_HOOK, unknown[]> = {
  // R1 (101–199)
  [PROGRESS_HOOK.SEND_TX_101]: ['eip155:1', '0xabc'],
  [PROGRESS_HOOK.SEND_TX_102_01]: [],
  [PROGRESS_HOOK.SEND_TX_102_02]: [BigInt(123)],
  [PROGRESS_HOOK.SEND_TX_103_01]: [],
  [PROGRESS_HOOK.SEND_TX_103_02]: ['0xuea', true],
  [PROGRESS_HOOK.SEND_TX_104_01]: [],
  [PROGRESS_HOOK.SEND_TX_104_02]: [],
  [PROGRESS_HOOK.SEND_TX_104_03]: [],
  [PROGRESS_HOOK.SEND_TX_104_04]: ['user declined'],
  [PROGRESS_HOOK.SEND_TX_105_01]: ['0xtxhash', null],
  [PROGRESS_HOOK.SEND_TX_105_02]: [],
  [PROGRESS_HOOK.SEND_TX_106_01]: [BigInt(1000), 18, 'ETH'],
  [PROGRESS_HOOK.SEND_TX_106_02]: ['0xtxhash', BigInt(1000), 18, 'ETH', null],
  [PROGRESS_HOOK.SEND_TX_106_03]: [3],
  [PROGRESS_HOOK.SEND_TX_106_03_01]: [1, 3],
  [PROGRESS_HOOK.SEND_TX_106_03_02]: [3, 3],
  [PROGRESS_HOOK.SEND_TX_106_04]: [],
  [PROGRESS_HOOK.SEND_TX_106_05]: [],
  [PROGRESS_HOOK.SEND_TX_106_06]: [BigInt(1000), 18, 'ETH'],
  [PROGRESS_HOOK.SEND_TX_107]: [],
  [PROGRESS_HOOK.SEND_TX_199_01]: [
    [{ hash: '0xpushtx', from: '0xfrom', to: '0xto' } as never],
  ],
  [PROGRESS_HOOK.SEND_TX_199_02]: ['err'],
  [PROGRESS_HOOK.SEND_TX_199_99_99]: ['0xpushtx'],
  // R2 (201–299)
  [PROGRESS_HOOK.SEND_TX_201]: ['eip155:11155111', '0xtarget'],
  [PROGRESS_HOOK.SEND_TX_202_01]: ['eip155:11155111'],
  [PROGRESS_HOOK.SEND_TX_202_02]: ['eip155:11155111', BigInt(100), BigInt(50)],
  [PROGRESS_HOOK.SEND_TX_203_01]: ['eip155:11155111'],
  [PROGRESS_HOOK.SEND_TX_203_02]: ['0xuea', '0xcea', 'eip155:11155111', true],
  [PROGRESS_HOOK.SEND_TX_204_01]: [],
  [PROGRESS_HOOK.SEND_TX_204_02]: [],
  [PROGRESS_HOOK.SEND_TX_204_03]: [],
  [PROGRESS_HOOK.SEND_TX_204_04]: ['declined'],
  [PROGRESS_HOOK.SEND_TX_207]: ['eip155:11155111'],
  [PROGRESS_HOOK.SEND_TX_209_01]: ['eip155:11155111'],
  [PROGRESS_HOOK.SEND_TX_209_02]: ['eip155:11155111', 5000],
  [PROGRESS_HOOK.SEND_TX_299_01]: [
    {
      externalTxHash: '0xext',
      destinationChain: 'eip155:11155111',
      explorerUrl: '',
      recipient: '',
      amount: '0',
      assetAddr: '',
    },
  ],
  [PROGRESS_HOOK.SEND_TX_299_02]: ['err'],
  [PROGRESS_HOOK.SEND_TX_299_03]: ['eip155:11155111', 60000],
  [PROGRESS_HOOK.SEND_TX_299_99]: ['eip155:11155111', '0xpushtx'],
  // R3 (301–399)
  [PROGRESS_HOOK.SEND_TX_301]: ['eip155:11155111', '0xcea'],
  [PROGRESS_HOOK.SEND_TX_302_01]: ['eip155:11155111'],
  [PROGRESS_HOOK.SEND_TX_302_02]: ['eip155:11155111', BigInt(100), BigInt(50)],
  [PROGRESS_HOOK.SEND_TX_303_01]: ['eip155:11155111'],
  [PROGRESS_HOOK.SEND_TX_303_02]: ['0xuea', '0xcea', 'eip155:11155111'],
  [PROGRESS_HOOK.SEND_TX_304_01]: [],
  [PROGRESS_HOOK.SEND_TX_304_02]: [],
  [PROGRESS_HOOK.SEND_TX_304_03]: [],
  [PROGRESS_HOOK.SEND_TX_304_04]: ['declined'],
  [PROGRESS_HOOK.SEND_TX_307]: ['eip155:11155111'],
  [PROGRESS_HOOK.SEND_TX_309_01]: ['eip155:11155111'],
  [PROGRESS_HOOK.SEND_TX_309_02]: ['eip155:11155111', 5000],
  [PROGRESS_HOOK.SEND_TX_309_03]: ['eip155:11155111', '0xtx'],
  [PROGRESS_HOOK.SEND_TX_310_01]: ['eip155:11155111'],
  [PROGRESS_HOOK.SEND_TX_310_02]: ['eip155:11155111', 5000],
  [PROGRESS_HOOK.SEND_TX_399_01]: ['eip155:11155111', '0xpushtx', undefined],
  [PROGRESS_HOOK.SEND_TX_399_02]: ['err'],
  [PROGRESS_HOOK.SEND_TX_399_03]: ['eip155:11155111', 60000],
  // Migration
  [PROGRESS_HOOK.UEA_MIG_01]: [],
  [PROGRESS_HOOK.UEA_MIG_02]: [],
  [PROGRESS_HOOK.UEA_MIG_03]: [],
  [PROGRESS_HOOK.UEA_MIG_9901]: ['v2.0.0'],
  [PROGRESS_HOOK.UEA_MIG_9902]: [],
  [PROGRESS_HOOK.UEA_MIG_9903]: [],
};

describe('progress-hook response invariants', () => {
  // Every entry of PROGRESS_HOOKS must return response: object | null.
  // Catches accidental string regressions and missing wrappers.
  it.each(Object.keys(PROGRESS_HOOKS))(
    '%s returns response of type object | null',
    (id) => {
      const hook = PROGRESS_HOOKS[id];
      const args = STUB_ARGS[id as PROGRESS_HOOK];
      const event = hook(...args);
      const t = typeof event.response;
      expect(t === 'object').toBe(true);
      // typeof null === 'object', so this also passes when response is null.
    }
  );

  it('every hook event carries an id, title, message, level, timestamp', () => {
    for (const id of Object.keys(PROGRESS_HOOKS)) {
      const hook = PROGRESS_HOOKS[id];
      const args = STUB_ARGS[id as PROGRESS_HOOK] ?? [];
      const event = hook(...args);
      expect(event.id).toBe(id);
      expect(typeof event.title).toBe('string');
      expect(typeof event.message).toBe('string');
      expect(['INFO', 'SUCCESS', 'WARNING', 'ERROR']).toContain(event.level);
      expect(typeof event.timestamp).toBe('string');
      expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });
});

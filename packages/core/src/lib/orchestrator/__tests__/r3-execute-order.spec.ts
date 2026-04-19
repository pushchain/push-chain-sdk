/**
 * Anti-regression lint-style guard: R3 execute-phase hooks must appear in
 * numeric-ascending order in the source of `executeCeaToPush` (and the SVM
 * twin). A previous session emitted 303-01/02 *before* 302-xx and 307
 * *before* 304-01; the hoist landed in commit `689b0ba+`. This static check
 * catches accidental swaps on future refactors without requiring a full
 * handler stub (the live r3-parity E2E is the functional counterpart).
 *
 * Tolerates 304-04 appearing in the catch-branch between 304-01 and 304-02
 * because that's the source-order of the error path, not the happy path.
 */
import fs from 'fs';
import path from 'path';

const ROUTE_HANDLERS_PATH = path.join(
  __dirname,
  '../internals/route-handlers.ts'
);

type Section = 'EVM' | 'SVM';

function sliceHandlerBody(src: string, section: Section): string {
  if (section === 'EVM') {
    const start = src.indexOf('export async function executeCeaToPush(');
    const end = src.indexOf('export async function executeCeaToPushSvm');
    return src.slice(start, end);
  }
  const start = src.indexOf('export async function executeCeaToPushSvm(');
  // Next function or end-of-file
  const after = src.indexOf('export async function', start + 1);
  return src.slice(start, after === -1 ? undefined : after);
}

describe('R3 execute-phase hook emission order (static guard)', () => {
  const src = fs.readFileSync(ROUTE_HANDLERS_PATH, 'utf8');

  // Happy-path emission sequence — what the hook stream should look like for
  // a successful R3 sendTransaction. 302_03 (sizer) is fired via
  // `fireSizingHook` not a direct enum reference, so check that marker too.
  const EXPECTED_ORDER = [
    'PROGRESS_HOOK.SEND_TX_301',
    'PROGRESS_HOOK.SEND_TX_302_01',
    'PROGRESS_HOOK.SEND_TX_302_02',
    "fireSizingHook(ctx, 'R3'",
    'PROGRESS_HOOK.SEND_TX_303_01',
    'PROGRESS_HOOK.SEND_TX_303_02',
    'PROGRESS_HOOK.SEND_TX_304_01',
    'PROGRESS_HOOK.SEND_TX_304_02',
    'PROGRESS_HOOK.SEND_TX_304_03',
    'PROGRESS_HOOK.SEND_TX_307',
  ];

  it.each(['EVM', 'SVM'] as const)(
    '%s variant: emission sites are in numeric-ascending order',
    (section) => {
      const body = sliceHandlerBody(src, section);
      const positions = EXPECTED_ORDER.map((needle) => ({
        needle,
        idx: body.indexOf(needle),
      }));

      positions.forEach(({ needle, idx }) => {
        expect(idx).toBeGreaterThan(-1);
        if (idx < 0) {
          throw new Error(
            `[${section}] expected needle "${needle}" not found in handler body`
          );
        }
      });

      const indices = positions.map((p) => p.idx);
      const sorted = [...indices].sort((a, b) => a - b);
      expect(indices).toEqual(sorted);
    }
  );

  it('304-04 (decline) appears in the catch-branch between 304-01 and 304-02', () => {
    const body = sliceHandlerBody(src, 'EVM');
    const idx304_01 = body.indexOf('PROGRESS_HOOK.SEND_TX_304_01');
    const idx304_04 = body.indexOf('PROGRESS_HOOK.SEND_TX_304_04');
    const idx304_02 = body.indexOf('PROGRESS_HOOK.SEND_TX_304_02');

    expect(idx304_01).toBeGreaterThan(-1);
    expect(idx304_04).toBeGreaterThan(idx304_01);
    expect(idx304_02).toBeGreaterThan(idx304_04);
  });
});

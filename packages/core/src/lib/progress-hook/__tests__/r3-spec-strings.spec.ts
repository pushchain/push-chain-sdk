/**
 * Locks Route 3 (UEA → UGPC → CEA → sendUniversalTxToUEA → Push Chain,
 * 301–399) progress-hook titles + messages + levels to the spec's exact
 * copy.
 *
 * Source of truth: the R3 (301–399) spec table shown in product docs
 * (Route 3 — Signature only. No fee-lock. No funds bridge. Round-trip.
 * Finality back on Push Chain). If a title / message / level needs to
 * change, update both this test and the spec image together — never
 * just the code.
 *
 * Also covers the 199-99-99 intermediate marker (internally consumed,
 * suppressed at fanOut before consumer dispatch) and both 302-03-XX
 * sizer hooks (emitted in live execute only).
 */
import PROGRESS_HOOKS from '../progress-hook';
import { PROGRESS_HOOK } from '../progress-hook.types';

// Concrete values used for interpolation — chosen so that spec-style
// placeholders (`{sourceChain}`, `{ueaAddr}`, etc.) resolve to readable
// but deterministic strings. `friendlyChain` is used inside the code for
// the `{Source Chain}` title slot; `eip155:11155111` → `ETHEREUM_SEPOLIA`.
const sourceChain = 'eip155:11155111';
const chainName = 'ETHEREUM_SEPOLIA'; // friendlyChain(sourceChain) returns the CHAIN enum key
const ceaAddress = '0x1111111111111111111111111111111111111111';
const ueaAddr = '0x2222222222222222222222222222222222222222' as `0x${string}`;
const txHash = '0xabcdef0123456789';

describe('Route 3 spec strings (301–399)', () => {
  it('301 — {Source Chain}\'s Executor Account Detected', () => {
    const ev = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_301](sourceChain, ceaAddress);
    expect(ev.title).toBe(`${chainName}'s Executor Account Detected`);
    expect(ev.message).toBe(
      `Source chain: ${sourceChain} — CEA: ${ceaAddress}`
    );
    expect(ev.level).toBe('INFO');
  });

  it('302-01 — Estimating {Source Chain} Gas', () => {
    const ev = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_302_01](sourceChain);
    expect(ev.title).toBe(`Estimating ${chainName} Gas`);
    expect(ev.message).toBe('Querying Push Chain gas and UGPC relay fee');
    expect(ev.level).toBe('INFO');
  });

  it('302-02 — {Source Chain} Gas Estimated', () => {
    const ev = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_302_02](
      sourceChain,
      BigInt(100),
      BigInt(50)
    );
    expect(ev.title).toBe(`${chainName} Gas Estimated`);
    expect(ev.message).toBe(
      'Push gas: 100 UPC + UGPC relay: 50 UPC = 150 UPC'
    );
    expect(ev.level).toBe('SUCCESS');
  });

  // 302-03-XX sizer hooks are emitted in live execute when queryOutboundGasFee
  // returns a sizing decision. Not part of the top-level spec image; covered
  // here because they're part of the live-stream contract.

  it('302-03-01 — {Source Chain} Gas Sizing: Case A', () => {
    const ev = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_302_03_01](
      sourceChain,
      BigInt(50_000_000), // gasUsd (8-decimals = $0.50)
      BigInt(1_000_000_000_000_000_000) // 1 UPC
    );
    expect(ev.title).toBe(`${chainName} Gas Sizing: Case A`);
    expect(ev.message).toBe(
      'Gas cost < $1; padding to $1 minimum (gasUsd=50000000, gasLeg=1000000000000000000 UPC)'
    );
    expect(ev.level).toBe('INFO');
  });

  it('302-03-02 — {Source Chain} Gas Sizing: Case B', () => {
    const ev = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_302_03_02](
      sourceChain,
      BigInt(500_000_000), // $5
      BigInt(5_000_000_000_000_000_000) // 5 UPC
    );
    expect(ev.title).toBe(`${chainName} Gas Sizing: Case B`);
    expect(ev.message).toBe(
      'Gas cost within $1–$10 window; happy path (gasUsd=500000000, gasLeg=5000000000000000000 UPC)'
    );
    expect(ev.level).toBe('INFO');
  });

  it('302-03-03 — {Source Chain} Gas Sizing: Case C', () => {
    const ev = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_302_03_03](
      sourceChain,
      BigInt(1_500_000_000), // $15
      BigInt(10_000_000_000_000_000_000), // 10 UPC gas leg
      BigInt(5_000_000_000_000_000_000) // 5 UPC overflow
    );
    expect(ev.title).toBe(`${chainName} Gas Sizing: Case C`);
    expect(ev.message).toBe(
      'Gas cost > $10; splitting into $10 gas leg + 5000000000000000000 UPC overflow bridged as funds'
    );
    expect(ev.level).toBe('INFO');
  });

  it('303-01 — Resolving Execution Accounts on Chains', () => {
    const ev = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_303_01](sourceChain);
    expect(ev.title).toBe('Resolving Execution Accounts on Chains');
    expect(ev.message).toBe(
      `Resolving UEA on Push Chain and CEA on ${sourceChain}`
    );
    expect(ev.level).toBe('INFO');
  });

  it('303-02 — Execution Accounts Resolved', () => {
    const ev = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_303_02](
      ueaAddr,
      ceaAddress,
      sourceChain
    );
    expect(ev.title).toBe('Execution Accounts Resolved');
    expect(ev.message).toBe(
      `UEA: ${ueaAddr}. CEA: ${ceaAddress} on ${sourceChain}. Deployed: true`
    );
    expect(ev.level).toBe('SUCCESS');
  });

  it('304-01 — Awaiting Signature', () => {
    const ev = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_304_01]();
    expect(ev.title).toBe('Awaiting Signature');
    expect(ev.message).toBe('Awaiting user signature for universal payload');
    expect(ev.level).toBe('INFO');
  });

  it('304-02 — Signature Received', () => {
    const ev = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_304_02]();
    expect(ev.title).toBe('Signature Received');
    expect(ev.message).toBe('Universal payload signed — preparing broadcast');
    expect(ev.level).toBe('SUCCESS');
  });

  it('304-03 — Verification Success', () => {
    const ev = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_304_03]();
    expect(ev.title).toBe('Verification Success');
    expect(ev.message).toBe('Verification completed');
    expect(ev.level).toBe('SUCCESS');
  });

  it('304-04 — Verification Declined (genuine user decline)', () => {
    const ev = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_304_04](
      'UserRejectedRequestError: User rejected the request.'
    );
    expect(ev.title).toBe('Verification Declined');
    expect(ev.message).toBe('Verification declined by user');
    expect(ev.level).toBe('ERROR');
  });

  it('307 — Broadcasting from Push Chain → {Source Chain}', () => {
    const ev = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_307](sourceChain);
    expect(ev.title).toBe(`Broadcasting from Push Chain → ${chainName}`);
    expect(ev.message).toBe('Sending tx from Push Chain...');
    expect(ev.level).toBe('INFO');
  });

  it('309-01 — Awaiting {Source Chain} Relay', () => {
    const ev = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_309_01](sourceChain);
    expect(ev.title).toBe(`Awaiting ${chainName} Relay`);
    expect(ev.message).toBe(`Waiting for UGPC to relay to CEA on ${sourceChain}`);
    expect(ev.level).toBe('INFO');
  });

  it('309-02 — Syncing State with {Source Chain}', () => {
    const ev = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_309_02](sourceChain, 5000);
    expect(ev.title).toBe(`Syncing State with ${chainName}`);
    expect(ev.message).toBe(`Polling ${sourceChain} for CEA execution`);
    expect(ev.level).toBe('INFO');
  });

  it('309-03 — {Source Chain} Tx Confirmed', () => {
    const ev = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_309_03](sourceChain, txHash);
    expect(ev.title).toBe(`${chainName} Tx Confirmed`);
    expect(ev.message).toBe(
      `CEA executed on ${sourceChain}: ${txHash} — return inbound initiated`
    );
    expect(ev.level).toBe('INFO');
  });

  it('310-01 — {Source Chain} → Push Chain Inbound Tx Submitted', () => {
    const ev = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_310_01](sourceChain);
    expect(ev.title).toBe(`${chainName} → Push Chain Inbound Tx Submitted`);
    expect(ev.message).toBe(
      `CEA initiated return — waiting for Push Chain inbound from ${sourceChain}`
    );
    expect(ev.level).toBe('INFO');
  });

  it('310-02 — Syncing State with Push Chain for Inbound Tx', () => {
    const ev = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_310_02](sourceChain, 5000);
    expect(ev.title).toBe('Syncing State with Push Chain for Inbound Tx');
    expect(ev.message).toBe(`Polling Push Chain for inbound from ${sourceChain}`);
    expect(ev.level).toBe('INFO');
  });

  it('399-01 — Push Chain Inbound Tx Success', () => {
    const ev = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_399_01](sourceChain, txHash);
    expect(ev.title).toBe('Push Chain Inbound Tx Success');
    expect(ev.message).toBe(
      `Inbound from ${sourceChain} confirmed · Push tx: ${txHash}`
    );
    expect(ev.level).toBe('SUCCESS');
  });

  // 399-02 / 399-03 are tri-phase terminal hooks:
  //   • 'inbound' (default) — round-trip Push tx failed/timed out
  //   • 'outbound' — source-chain CEA tx failed/timed out
  //   • 'push' — Push Chain execution itself failed (pre-wait)
  // The spec table only pictures the 'inbound' default; 'outbound' +
  // 'push' variants are explicit feature choices (see session S126).

  it('399-02 [inbound] — Push Chain Inbound Tx Failed', () => {
    const ev = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_399_02](
      'inbound execution failed on Push Chain',
      'inbound',
      sourceChain
    );
    expect(ev.title).toBe('Push Chain Inbound Tx Failed');
    expect(ev.message).toBe('inbound execution failed on Push Chain');
    expect(ev.level).toBe('ERROR');
  });

  it('399-02 [outbound] — {Source Chain} Tx Failed', () => {
    const ev = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_399_02](
      'Outbound to eip155:97 reverted on source-chain RPC.',
      'outbound',
      sourceChain
    );
    expect(ev.title).toBe(`${chainName} Tx Failed`);
    expect(ev.message).toBe('Outbound to eip155:97 reverted on source-chain RPC.');
    expect(ev.level).toBe('ERROR');
  });

  it('399-02 [push] — Push Chain Tx Failed', () => {
    const ev = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_399_02](
      'Push Chain gateway tx reverted',
      'push'
    );
    expect(ev.title).toBe('Push Chain Tx Failed');
    expect(ev.message).toBe('Push Chain gateway tx reverted');
    expect(ev.level).toBe('ERROR');
  });

  it('399-03 [inbound] — Push Chain Inbound Timeout', () => {
    const ev = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_399_03](
      sourceChain,
      300_000,
      'inbound'
    );
    expect(ev.title).toBe('Push Chain Inbound Timeout');
    expect(ev.message).toBe(`Timed out waiting for inbound from ${sourceChain}`);
    expect(ev.level).toBe('ERROR');
  });

  it('399-03 [outbound] — Syncing State with {Source Chain} Timeout', () => {
    const ev = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_399_03](
      sourceChain,
      30_000,
      'outbound'
    );
    expect(ev.title).toBe(`Syncing State with ${chainName} Timeout`);
    expect(ev.message).toBe(`Timed out waiting for ${chainName} relay`);
    expect(ev.level).toBe('ERROR');
  });

  it('399-03 [push] — Push Chain Tx Timeout', () => {
    const ev = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_399_03](
      sourceChain,
      60_000,
      'push'
    );
    expect(ev.title).toBe('Push Chain Tx Timeout');
    expect(ev.message).toBe('Timed out waiting for Push Chain tx');
    expect(ev.level).toBe('ERROR');
  });

  it('199-99-99 — Push Chain TX Completed (intermediate, internal)', () => {
    const ev = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_199_99_99]('0xpushtx');
    expect(ev.title).toBe('Push Chain TX Completed');
    expect(ev.message).toBe(
      'Intermediate Push Chain tx confirmed: 0xpushtx, progressing to next phase'
    );
    expect(ev.level).toBe('INFO');
  });
});

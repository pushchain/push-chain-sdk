/**
 * Locks Route 2 (UEA → UGPC → CEA, 201–299) progress-hook titles + messages
 * + levels to the spec's exact copy.
 *
 * Source of truth: the R2 (201–299) spec table shown in product docs
 * (Route 2 — UEA → UGPC → CEA on target chain). If a title / message /
 * level needs to change, update both this test and the spec image together
 * — never just the code.
 */
import PROGRESS_HOOKS from '../progress-hook';
import { PROGRESS_HOOK } from '../progress-hook.types';

// Concrete values used for interpolation — chosen so that spec-style
// placeholders (`{targetChain}`, `{ueaAddr}`, etc.) resolve to readable
// but deterministic strings. `friendlyChain` is used inside the code for
// the `{ChainName}` title slot; `eip155:11155111` → `Ethereum Sepolia`.
const targetChain = 'eip155:11155111';
const chainName = 'Ethereum Sepolia'; // friendlyChain(targetChain) returns the human-readable chain name
const targetAddress = '0x1111111111111111111111111111111111111111';
const ueaAddr = '0x2222222222222222222222222222222222222222' as `0x${string}`;
const ceaAddr = '0x3333333333333333333333333333333333333333';

describe('Route 2 spec strings (201–299)', () => {
  it('201 — {ChainName} Detected', () => {
    const ev = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_201](targetChain, targetAddress);
    expect(ev.title).toBe(`${chainName} Detected`);
    expect(ev.message).toBe(
      `External chain: ${targetChain} — Target address: ${targetAddress}`
    );
    expect(ev.level).toBe('INFO');
  });

  it('202-01 — Estimating {ChainName} Chain Gas', () => {
    const ev = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_202_01](targetChain);
    expect(ev.title).toBe(`Estimating ${chainName} Chain Gas`);
    expect(ev.message).toBe('Querying Push Chain gas and UGPC relay fee');
    expect(ev.level).toBe('INFO');
  });

  it('202-02 — {ChainName} Chain Gas Estimated', () => {
    const ev = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_202_02](
      targetChain,
      BigInt(100),
      BigInt(50)
    );
    expect(ev.title).toBe(`${chainName} Chain Gas Estimated`);
    expect(ev.message).toBe(
      'Push gas: 100 UPC + UGPC relay: 50 UPC = 150 UPC'
    );
    expect(ev.level).toBe('SUCCESS');
  });

  it('203-01 — Resolving {ChainName} Execution Account', () => {
    const ev = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_203_01](targetChain);
    expect(ev.title).toBe(`Resolving ${chainName} Execution Account`);
    expect(ev.message).toBe(
      `Resolving UEA on Push Chain and CEA on ${targetChain}`
    );
    expect(ev.level).toBe('INFO');
  });

  it('203-02 — {ChainName} Execution Account Ready', () => {
    const ev = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_203_02](
      ueaAddr,
      ceaAddr,
      targetChain,
      true
    );
    expect(ev.title).toBe(`${chainName} Execution Account Ready`);
    expect(ev.message).toBe(
      `UEA: ${ueaAddr}. CEA: ${ceaAddr} on ${targetChain}. Deployed: true`
    );
    expect(ev.level).toBe('SUCCESS');
  });

  it('204-01 — Awaiting Signature', () => {
    const ev = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_204_01]();
    expect(ev.title).toBe('Awaiting Signature');
    expect(ev.message).toBe('Awaiting user signature for universal payload');
    expect(ev.level).toBe('INFO');
  });

  it('204-02 — Signature Received', () => {
    const ev = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_204_02]();
    expect(ev.title).toBe('Signature Received');
    expect(ev.message).toBe('Universal payload signed — preparing broadcast');
    expect(ev.level).toBe('SUCCESS');
  });

  it('204-03 — Verification Success', () => {
    const ev = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_204_03]();
    expect(ev.title).toBe('Verification Success');
    expect(ev.message).toBe('Verification completed');
    expect(ev.level).toBe('SUCCESS');
  });

  it('204-04 — Verification Declined (genuine user decline)', () => {
    const ev = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_204_04](
      'UserRejectedRequestError: User rejected the request.'
    );
    expect(ev.title).toBe('Verification Declined');
    expect(ev.message).toBe('Verification declined by user');
    expect(ev.level).toBe('ERROR');
  });

  it('207 — Broadcasting from Push Chain → {ChainName}', () => {
    const ev = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_207](targetChain);
    expect(ev.title).toBe(`Broadcasting from Push Chain → ${chainName}`);
    expect(ev.message).toBe('Sending tx to Push Chain...');
    expect(ev.level).toBe('INFO');
  });

  it('209-01 — Awaiting Push Chain Relay', () => {
    const ev = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_209_01](targetChain);
    expect(ev.title).toBe('Awaiting Push Chain Relay');
    expect(ev.message).toBe(
      `Waiting for UGPC to relay execution to ${targetChain}`
    );
    expect(ev.level).toBe('INFO');
  });

  it('209-02 — Syncing State with {ChainName}', () => {
    const ev = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_209_02](targetChain, 5000);
    expect(ev.title).toBe(`Syncing State with ${chainName}`);
    expect(ev.message).toBe(`Polling ${targetChain} for CEA execution`);
    expect(ev.level).toBe('INFO');
  });

  it('299-01 — {ChainName} Tx Success', () => {
    const ev = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_299_01]({
      externalTxHash: '0xext',
      destinationChain: targetChain,
      explorerUrl: '',
      recipient: '',
      amount: '0',
      assetAddr: '',
    });
    expect(ev.title).toBe(`${chainName} Tx Success`);
    expect(ev.message).toBe(`CEA executed on ${targetChain} - tx: 0xext`);
    expect(ev.level).toBe('SUCCESS');
  });

  it('299-02 — {ChainName} Tx Failed', () => {
    const ev = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_299_02](
      targetChain,
      'relay rejected payload'
    );
    expect(ev.title).toBe(`${chainName} Tx Failed`);
    // Spec message column is the raw {errorMessage} passthrough.
    expect(ev.message).toBe('relay rejected payload');
    expect(ev.level).toBe('ERROR');
  });

  it('299-03 — Syncing State with {ChainName} Timeout', () => {
    const ev = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_299_03](targetChain, 60000);
    expect(ev.title).toBe(`Syncing State with ${chainName} Timeout`);
    expect(ev.message).toBe(`Timed out waiting for UGPC relay to ${targetChain}`);
    expect(ev.level).toBe('ERROR');
  });

  it('299-99 — {ChainName} Tx Completed (intermediate)', () => {
    const ev = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_299_99](targetChain, '0xpushtx');
    expect(ev.title).toBe(`${chainName} Tx Completed`);
    expect(ev.message).toBe(
      `Intermediate ${chainName} tx confirmed: 0xpushtx, progressing to next phase`
    );
    expect(ev.level).toBe('INFO');
  });
});

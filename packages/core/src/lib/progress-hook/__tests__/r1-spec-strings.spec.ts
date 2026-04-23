/**
 * Locks Route 1 (UOA → Push Chain, 101–199) progress-hook titles + messages
 * + levels to the spec's exact copy.
 *
 * Source of truth: the R1 (101–199) spec table shown in product docs
 * (Route 1 — UOA → Push Chain). If a title / message / level needs to
 * change, update both this test and the spec image together — never just
 * the code.
 *
 * Hooks not in the R1 spec image (106-07-01/02/03 sizer hooks, 199-99-99
 * shared intermediate marker) are intentionally excluded.
 */
import PROGRESS_HOOKS from '../progress-hook';
import { PROGRESS_HOOK } from '../progress-hook.types';

// Concrete values used for interpolation — chosen so spec-style placeholders
// (`{chain}`, `{address}`, `{txHash}`) resolve to deterministic strings.
// `friendlyChain('eip155:11155111')` returns the human-readable name `Ethereum Sepolia`.
const originChain = 'eip155:11155111';
const chainName = 'Ethereum Sepolia';
const originAddress = '0xaaaabbbbccccddddeeeeffff00001111aaaabbbb';
const uea = '0x2222222222222222222222222222222222222222' as `0x${string}`;
const txHash =
  '0xdeadbeefcafef00d0123456789abcdef0123456789abcdef0123456789abcdef';

describe('Route 1 spec strings (101–199)', () => {
  it('101 — Origin Chain Detected', () => {
    const ev = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_101](originChain, originAddress);
    expect(ev.title).toBe('Origin Chain Detected');
    expect(ev.message).toBe(
      `Origin chain: ${chainName} — Address: ${originAddress}`
    );
    expect(ev.level).toBe('INFO');
  });

  it('102-01 — Estimating Gas', () => {
    const ev = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_102_01]();
    expect(ev.title).toBe('Estimating Gas');
    expect(ev.message).toBe('Estimating and fetching gas limit, gas price for TX');
    expect(ev.level).toBe('INFO');
  });

  it('103-03-04 — Prepaid Deposit Estimated', () => {
    const ev = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_103_03_04](
      BigInt('1000000000000000000'),
      BigInt(100_000_000)
    );
    expect(ev.title).toBe('Prepaid Deposit Estimated');
    expect(ev.message).toBe(
      'Estimated prepaid deposit: $100000000 (1000000000000000000 UPC)'
    );
    expect(ev.level).toBe('SUCCESS');
  });

  it('103-01 — Resolving Universal Execution Account', () => {
    const ev = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_103_01]();
    expect(ev.title).toBe('Resolving Universal Execution Account');
    expect(ev.message).toBe(
      'Resolving UEA – computing address, checking deployment and balance'
    );
    expect(ev.level).toBe('INFO');
  });

  it('103-02 — Universal Execution Account Resolved', () => {
    const ev = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_103_02](uea, true);
    expect(ev.title).toBe('Universal Execution Account Resolved');
    expect(ev.message).toBe(`UEA: ${uea}, Deployed: true`);
    expect(ev.level).toBe('SUCCESS');
  });

  it('104-01 — Awaiting Transaction', () => {
    const ev = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_104_01]();
    expect(ev.title).toBe('Awaiting Transaction');
    expect(ev.message).toBe('Awaiting user transaction on origin chain');
    expect(ev.level).toBe('INFO');
  });

  it('104-02 — Awaiting Signature', () => {
    const ev = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_104_02]();
    expect(ev.title).toBe('Awaiting Signature');
    expect(ev.message).toBe('Awaiting user signature for universal payload');
    expect(ev.level).toBe('INFO');
  });

  it('104-03 — Verification Success', () => {
    const ev = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_104_03]();
    expect(ev.title).toBe('Verification Success');
    expect(ev.message).toBe('Verification completed via Transaction or Signature');
    expect(ev.level).toBe('SUCCESS');
  });

  it('104-04 — Verification Declined (user decline)', () => {
    const ev = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_104_04]();
    expect(ev.title).toBe('Verification Declined');
    expect(ev.message).toBe('Verification declined by user');
    expect(ev.level).toBe('ERROR');
  });

  it('104-04 — Signature Failed (non-decline error)', () => {
    const ev = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_104_04](
      'insufficient funds for intrinsic transaction cost'
    );
    expect(ev.title).toBe('Signature Failed');
    expect(ev.message).toBe('insufficient funds for intrinsic transaction cost');
    expect(ev.level).toBe('ERROR');
  });

  it('105-01 — Gas Funding In Progress', () => {
    const ev = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_105_01](txHash);
    expect(ev.title).toBe('Gas Funding In Progress');
    expect(ev.message).toBe(`Gas funding tx sent: ${txHash}`);
    expect(ev.level).toBe('INFO');
  });

  it('105-02 — Gas Funding Confirmed', () => {
    const ev = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_105_02]();
    expect(ev.title).toBe('Gas Funding Confirmed');
    expect(ev.message).toBe('Gas funding confirmed on origin chain');
    expect(ev.level).toBe('SUCCESS');
  });

  it('106-01 — Preparing Funds Transfer', () => {
    const ev = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_106_01](BigInt(1), 18, 'ETH');
    expect(ev.title).toBe('Preparing Funds Transfer');
    expect(ev.message).toBe('Preparing to move 0.000000000000000001 ETH from origin chain');
    expect(ev.level).toBe('INFO');
  });

  it('106-02 — Funds Lock Submitted', () => {
    const ev = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_106_02](
      txHash,
      BigInt(1),
      18,
      'ETH'
    );
    expect(ev.title).toBe('Funds Lock Submitted');
    expect(ev.message).toBe(
      `Locking 0.000000000000000001 ETH — Tx: ${txHash}`
    );
    expect(ev.level).toBe('INFO');
  });

  it('106-03 — Awaiting Confirmations', () => {
    const ev = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_106_03](1);
    expect(ev.title).toBe('Awaiting Confirmations');
    expect(ev.message).toBe('Waiting for 1 confirmations');
    expect(ev.level).toBe('INFO');
  });

  it('106-03-01 — Confirmation intermediate (INFO)', () => {
    const ev = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_106_03_01](1, 2);
    expect(ev.title).toBe('Confirmation 1/2 Received');
    expect(ev.message).toBe('1/2 confirmations received');
    expect(ev.level).toBe('INFO');
  });

  it('106-03-02 — Confirmation terminal (SUCCESS)', () => {
    const ev = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_106_03_02](2, 2);
    expect(ev.title).toBe('Confirmation 2/2 Received');
    expect(ev.message).toBe('2/2 confirmations received');
    expect(ev.level).toBe('SUCCESS');
  });

  it('106-04 — Funds Confirmed', () => {
    const ev = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_106_04]();
    expect(ev.title).toBe('Funds Confirmed');
    expect(ev.message).toBe('Origin chain lock confirmed');
    expect(ev.level).toBe('SUCCESS');
  });

  it('106-05 — Syncing with Push Chain', () => {
    const ev = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_106_05]();
    expect(ev.title).toBe('Syncing with Push Chain');
    expect(ev.message).toBe('Waiting for transaction to appear on Push Chain');
    expect(ev.level).toBe('INFO');
  });

  it('106-06 — Funds Credited on Push Chain', () => {
    const ev = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_106_06](BigInt(1), 18, 'ETH');
    expect(ev.title).toBe('Funds Credited on Push Chain');
    expect(ev.message).toBe('Funds credited: 0.000000000000000001 ETH');
    expect(ev.level).toBe('SUCCESS');
  });

  it('107 — Broadcasting to Push Chain', () => {
    const ev = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_107]();
    expect(ev.title).toBe('Broadcasting to Push Chain');
    expect(ev.message).toBe('Sending tx to Push Chain...');
    expect(ev.level).toBe('INFO');
  });

  it('199-01 — Push Chain Tx Success', () => {
    const ev = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_199_01]([
      { hash: txHash } as never,
    ]);
    expect(ev.title).toBe('Push Chain Tx Success');
    expect(ev.message).toBe(`Tx confirmed: ${txHash}`);
    expect(ev.level).toBe('SUCCESS');
  });

  it('199-02 — Push Chain Tx Failed', () => {
    const ev = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_199_02](
      'Push Chain transaction failed for gateway tx: 0xabc: ExecutionReverted'
    );
    expect(ev.title).toBe('Push Chain Tx Failed');
    expect(ev.message).toBe(
      'Push Chain transaction failed for gateway tx: 0xabc: ExecutionReverted'
    );
    expect(ev.level).toBe('ERROR');
  });
});

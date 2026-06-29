import PROGRESS_HOOKS from '../progress-hook';
import { PROGRESS_HOOK } from '../progress-hook.types';

describe('multichain (multi-hop) progress hooks', () => {
  it('SEND_TX_001 renders hop count and chain arrow', () => {
    const event = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_001](
      3,
      ['eip155:1', 'eip155:11155111', 'solana:devnet']
    );
    expect(event.id).toBe('SEND-TX-001');
    expect(event.title).toBe('Multichain Transactions Initiated');
    expect(event.message).toContain('3-hop transaction');
    expect(event.message).toContain('→');
    expect(event.level).toBe('INFO');
    expect(event.response).toMatchObject({
      hopCount: 3,
      chains: ['eip155:1', 'eip155:11155111', 'solana:devnet'],
    });
  });

  it('SEND_TX_002_01 includes hop number/total and from→to chains', () => {
    const event = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_002_01](
      2,
      3,
      'eip155:1',
      'eip155:11155111'
    );
    expect(event.id).toBe('SEND-TX-002-01');
    expect(event.title).toBe('Starting Intermediate Transaction #2/3');
    expect(event.message).toMatch(/Starting tx 2 of 3/);
    expect(event.response).toMatchObject({
      n: 2,
      total: 3,
      fromChain: 'eip155:1',
      toChain: 'eip155:11155111',
    });
  });

  it('SEND_TX_002_99_99 marks intermediate completion', () => {
    const event = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_002_99_99](1, 3);
    expect(event.id).toBe('SEND-TX-002-99-99');
    expect(event.title).toBe('Intermediate Transaction #1/3 Complete');
    expect(event.message).toMatch(/Tx 1 of 3 confirmed/);
    expect(event.message).toMatch(/proceeding to tx 2/);
  });

  it('SEND_TX_003_03 uses Multichain user-facing text', () => {
    const event = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_003_03](
      BigInt(2),
      BigInt(1),
      false,
      '0x1111111111111111111111111111111111111111',
      'CASCADE'
    );

    expect(event.id).toBe('SEND-TX-003-03');
    expect(event.title).toBe('Checking Balance Requirements');
    expect(event.message).toContain('INSUFFICIENT (MULTICHAIN)');
    expect(event.message).not.toContain('CASCADE');
    expect(event.message).not.toContain('Cascade');
  });

  it('SEND_TX_999_01 emits multichain success', () => {
    const event = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_999_01](3, '0xfinal');
    expect(event.id).toBe('SEND-TX-999-01');
    expect(event.level).toBe('SUCCESS');
    expect(event.message).toBe('3-hop transaction confirmed across all chains');
    expect(event.response).toMatchObject({ txHash: '0xfinal' });
  });

  it('SEND_TX_999_02 reports failedAt and error', () => {
    const event = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_999_02](
      2,
      3,
      'cea revert',
      '0xfailed',
      '0xroot'
    );
    expect(event.id).toBe('SEND-TX-999-02');
    expect(event.level).toBe('ERROR');
    expect(event.message).toBe('Multichain failed at hop 2 of 3: cea revert');
    expect(event.response).toMatchObject({
      failedAt: 2,
      total: 3,
      error: 'cea revert',
      txHash: '0xfailed',
      pushTxHash: '0xroot',
    });
  });

  it('SEND_TX_999_03 reports timeout location', () => {
    const event = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_999_03](
      2,
      3,
      undefined,
      '0xroot'
    );
    expect(event.id).toBe('SEND-TX-999-03');
    expect(event.level).toBe('ERROR');
    expect(event.message).toBe('Multichain timed out at hop 2 of 3');
    expect(event.response).toMatchObject({
      failedAt: 2,
      total: 3,
      error: 'multichain timeout',
      pushTxHash: '0xroot',
    });
  });
});

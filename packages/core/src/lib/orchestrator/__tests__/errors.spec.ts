import {
  PushChainExecutionError,
  InsufficientUEABalanceError,
} from '../internals/errors';

describe('PushChainExecutionError', () => {
  it('default construction has undefined decodedError + gatewayTxHash', () => {
    const err = new PushChainExecutionError('boom');
    expect(err.message).toBe('boom');
    expect(err.code).toBe('PUSH_CHAIN_EXECUTION_FAILED');
    expect(err.gatewayTxHash).toBeUndefined();
    expect(err.decodedError).toBeUndefined();
    expect(err.name).toBe('PushChainExecutionError');
  });

  it('preserves gatewayTxHash + decodedError when provided', () => {
    const err = new PushChainExecutionError('boom', {
      gatewayTxHash: '0xdead',
      decodedError: {
        name: 'ExecutionFailed',
        hint: 'Likely cause: subcall reverted.',
        selector: '0xacfdb444',
      },
    });
    expect(err.gatewayTxHash).toBe('0xdead');
    expect(err.decodedError?.name).toBe('ExecutionFailed');
    expect(err.decodedError?.selector).toBe('0xacfdb444');
    expect(err.decodedError?.hint).toContain('subcall');
  });

  it('is throwable and survives instanceof through async/await', async () => {
    const thrower = async (): Promise<never> => {
      throw new PushChainExecutionError('async boom', {
        decodedError: { selector: '0xf4d678b8', name: 'InsufficientBalance' },
      });
    };
    let caught: unknown;
    try {
      await thrower();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(PushChainExecutionError);
    expect((caught as PushChainExecutionError).decodedError?.selector).toBe(
      '0xf4d678b8'
    );
  });
});

describe('InsufficientUEABalanceError carries decodedError', () => {
  const baseOpts = {
    required: BigInt(1000),
    available: BigInt(500),
    shortfall: BigInt(500),
    ueaAddress: '0xaaa1111111111111111111111111111111111111' as `0x${string}`,
    pathTag: 'R2_SVM' as const,
  };

  it('NATIVE shortfall populates decodedError.name + hint', () => {
    const err = new InsufficientUEABalanceError(baseOpts);
    expect(err.decodedError?.name).toBe('InsufficientUEABalance');
    expect(err.decodedError?.hint).toMatch(/Bridge/);
    expect(err.decodedError?.hint).toContain('0.0000000000000005 PC');
    // Native hint mentions PC, not the burn token
    expect(err.decodedError?.hint).not.toMatch(/burn token/i);
  });

  it('formats native UPC amounts as decimal PC in the thrown message', () => {
    const err = new InsufficientUEABalanceError({
      ...baseOpts,
      required: BigInt('7410755801443190242892'),
      available: BigInt('5500000000000000000'),
      shortfall: BigInt('7405255801443190242892'),
    });

    expect(err.message).toContain('has 5.5 PC');
    expect(err.message).toContain(
      'outbound requires 7410.755801443190242892 PC'
    );
    expect(err.message).toContain(
      'shortfall 7405.255801443190242892 PC'
    );
    expect(err.message).toContain(
      'Bridge >=7405.255801443190242892 PC to the UEA on Push Chain before retrying.'
    );
    expect(err.message).not.toContain('wei UPC');
  });

  it('PRC20 shortfall populates decodedError with PRC-20-flavoured hint', () => {
    const err = new InsufficientUEABalanceError({
      ...baseOpts,
      reason: 'PRC20',
      burnToken: '0xbbb2222222222222222222222222222222222222' as `0x${string}`,
    });
    expect(err.decodedError?.name).toBe('InsufficientUEABalance');
    expect(err.decodedError?.hint).toMatch(/Bridge the burn token/);
  });

  it('still satisfies instanceof PushChainExecutionError (legacy compat)', () => {
    const err = new InsufficientUEABalanceError(baseOpts);
    expect(err).toBeInstanceOf(InsufficientUEABalanceError);
    expect(err).toBeInstanceOf(PushChainExecutionError);
    expect(err.code).toBe('PUSH_CHAIN_EXECUTION_FAILED');
  });

  it('preserves segmentIndex for cascade callers', () => {
    const err = new InsufficientUEABalanceError({
      ...baseOpts,
      pathTag: 'CASCADE',
      segmentIndex: 2,
    });
    expect(err.segmentIndex).toBe(2);
    expect(err.pathTag).toBe('CASCADE');
    expect(err.message).toContain(':seg2:');
  });
});

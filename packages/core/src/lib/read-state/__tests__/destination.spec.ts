import { resolveDestination } from '../destination';
import { UnsupportedReadDestinationError } from '../errors';
import { CHAIN } from '../../constants/enums';

describe('resolveDestination — the joined CAIP-2 guard is symmetric', () => {
  it('splits a CAIP-2 chain into namespace and id', () => {
    expect(resolveDestination({ chain: CHAIN.ETHEREUM_MAINNET })).toEqual({
      chainNamespace: 'eip155', chainId: '1', caip2: 'eip155:1', namespace: 'eip155',
    });
  });

  it('accepts the explicit form', () => {
    expect(resolveDestination({ chainNamespace: 'eip155', chainId: '11155111' }).caip2).toBe('eip155:11155111');
  });

  const rejected: [string, () => unknown][] = [
    ['joined form in the namespace', () => resolveDestination({ chainNamespace: 'eip155:1', chainId: '1' })],
    ['joined form in the chain id', () => resolveDestination({ chainNamespace: 'eip155', chainId: '1:1' })],
    ['a three-part chain string', () => resolveDestination({ chain: 'eip155:1:1' as never })],
    ['a chain string with a trailing colon', () => resolveDestination({ chain: 'eip155:' as never })],
    ['a chain string with no colon', () => resolveDestination({ chain: 'eip155' as never })],
    ['a chain string starting with a colon', () => resolveDestination({ chain: ':1' as never })],
  ];
  it.each(rejected)('rejects %s', (_name, fn) => {
    expect(fn).toThrow(UnsupportedReadDestinationError);
  });

  it('names the offending value in the chain-id hint', () => {
    expect(() => resolveDestination({ chainNamespace: 'eip155', chainId: '1:1' }))
      .toThrow(/chainId must be the bare chain id, not CAIP-2: 1:1/);
  });
});

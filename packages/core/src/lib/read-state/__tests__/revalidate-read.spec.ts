import { CHAIN, PUSH_NETWORK } from '../../constants/enums';
import { buildReadSpecFromPreflight, prepareRead, revalidateRead, type PrepareReadDeps } from '../spec-builder';
import { resolveDestination } from '../destination';

const target = '0x1111111111111111111111111111111111111111';
const params = {
  destination: { chain: CHAIN.ETHEREUM_SEPOLIA },
  query: { type: 'accountBalance', target } as const,
  callbackGasLimit: 200_000n, refundTo: target as `0x${string}`,
};
function setup() {
  const state = { height: 100n, pushHeight: 101n, fee: 1n, blocked: false, baseFee: 1_000_000_000n as bigint | null };
  const emit = jest.fn();
  const deps: PrepareReadDeps = {
    pushNetwork: PUSH_NETWORK.TESTNET_DONUT, emit,
    pushClient: {
      readContract: jest.fn(async ({ functionName }) => {
        if (functionName === 'estimateFee') return state.fee;
        if (functionName === 'blockedDomains') return state.blocked;
        return state.height;
      }) as never,
      getGasPrice: jest.fn().mockResolvedValue(1_000_000_000n),
      publicClient: {
        getBlockNumber: jest.fn(async () => state.pushHeight),
        getBlock: jest.fn(async () => ({ baseFeePerGas: state.baseFee })),
        getCode: jest.fn().mockResolvedValue('0x'),
      } as never,
    },
  };
  const prepared = buildReadSpecFromPreflight({
    destination: resolveDestination(params.destination), protocolFee: 1n,
    observedChainHeight: 100n, pushBlockNumber: 100n, pushGasPrice: 1_000_000_000n,
    universalCallback: target, universalCore: target, fetchedAt: 0,
  }, params);
  return { state, deps, prepared, emit };
}

describe('revalidateRead', () => {
  it('accepts an old but valid preparation without changing any field', async () => {
    const { deps, prepared, state } = setup();
    state.height = 200n;
    const before = structuredClone(prepared);
    await revalidateRead(deps, prepared);
    expect(prepared).toEqual(before);
  });
  it.each([1n, 199_999_999_999_999n])('rejects remaining escrow of %s wei without changing the prepared payment', async remaining => {
    const { deps, prepared, state } = setup();
    state.fee = prepared.value - remaining;
    const before = structuredClone(prepared);
    await expect(revalidateRead(deps, prepared)).rejects.toMatchObject({ violations: ['INSUFFICIENT_CALLBACK_BUDGET'] });
    expect(prepared).toEqual(before);
  });
  it('accepts the exact affordability boundary, using base fee rather than suggested gas price', async () => {
    const { deps, prepared, state } = setup();
    state.fee = prepared.value - prepared.callbackGasLimit * state.baseFee!;
    (deps.pushClient.getGasPrice as jest.Mock).mockResolvedValue(100_000_000_000n);
    await expect(revalidateRead(deps, prepared)).resolves.toBeUndefined();
    expect(deps.pushClient.publicClient.getBlock).toHaveBeenCalledWith({ blockTag: 'latest' });
  });
  it('rejects a rise in base fee even when the protocol fee and gas suggestion are unchanged', async () => {
    const { deps, prepared, state } = setup();
    state.baseFee = 4_000_000_000n;
    await expect(revalidateRead(deps, prepared)).rejects.toMatchObject({ violations: ['INSUFFICIENT_CALLBACK_BUDGET'] });
  });
  it('does not guess when the base fee is missing', async () => {
    const { deps, prepared, state } = setup();
    state.baseFee = null;
    await expect(revalidateRead(deps, prepared)).rejects.toMatchObject({ code: 'READ_CALLBACK_BASE_FEE_UNAVAILABLE' });
  });
  it('uses a reported zero base fee without substituting a sizing floor', async () => {
    const { deps, prepared, state } = setup();
    state.baseFee = 0n;
    state.fee = prepared.value - 1n;
    await expect(revalidateRead(deps, prepared)).resolves.toBeUndefined();
  });
  it.each(['expiry', 'fee', 'budget', 'height', 'blocked'] as const)('rejects changed %s conditions', async kind => {
    const { deps, prepared, state } = setup();
    if (kind === 'expiry') state.pushHeight = prepared.spec.expiryPushChainHeight;
    if (kind === 'fee') state.fee = prepared.value + 1n;
    if (kind === 'budget') state.fee = prepared.value;
    if (kind === 'height') state.height = 50n;
    if (kind === 'blocked') state.blocked = true;
    await expect(revalidateRead(deps, prepared)).rejects.toMatchObject({
      code: kind === 'blocked' ? 'UNSUPPORTED_READ_DESTINATION' : 'INVALID_READ_SPEC',
    });
  });
});

describe('preparation progress', () => {
  it('emits requested, preflight and assembled in order', async () => {
    const { deps, emit } = setup();
    await prepareRead(deps, params);
    expect(emit.mock.calls.map(([id]) => id)).toEqual(['READ-TX-101', 'READ-TX-102-01', 'READ-TX-102-02']);
  });
  it('emits height failure without claiming the spec was assembled', async () => {
    const { deps, emit, state } = setup();
    state.height = 0n;
    await expect(prepareRead(deps, params)).rejects.toMatchObject({ code: 'READ_HEIGHT_UNAVAILABLE' });
    expect(emit.mock.calls.map(([id]) => id)).toEqual(['READ-TX-101', 'READ-TX-102-01', 'READ-TX-102-03']);
  });
  it('warns with header names, never secret values', async () => {
    const { deps, emit, state } = setup();
    state.height = 0n;
    await prepareRead(deps, { ...params,
      destination: { chainNamespace: 'web2', chainId: 'https' },
      query: { type: 'http', url: 'https://example.com', headers: { Authorization: 'private-value' }, extract: [{ path: '$', valueType: 'string' }] },
    });
    expect(emit).toHaveBeenCalledWith('READ-TX-103-03', ['Authorization']);
    expect(JSON.stringify(emit.mock.calls, (_, value) => typeof value === 'bigint' ? String(value) : value)).not.toContain('private-value');
  });
});

import { resolveDestination } from '../destination';
import { InvalidReadSpecError, type ReadSpecViolation } from '../errors';
import type { ReadPreflight, ReadSpec } from '../read-state.types';
import { assertValidReadSpec, validateReadSpec } from '../validate';

const OK_OWNER = '0x000000000000000000000000000000000000dead' as const;
const PF: ReadPreflight = {
  destination: resolveDestination({ chainNamespace: 'eip155', chainId: '11155111' }),
  protocolFee: 1_000n,
  observedChainHeight: 11_667_924n,
  pushBlockNumber: 22_963_000n,
  pushGasPrice: 1_000_000_000n,
  universalCallback: '0x00000000000000000000000000000000000000c2',
  universalCore: '0x00000000000000000000000000000000000000C0',
  fetchedAt: Date.now(),
};
const GOOD: ReadSpec = {
  account: { chainNamespace: 'eip155', chainId: '11155111', owner: OK_OWNER },
  query: '0x1234',
  minConfirmations: 1,
  blockNumber: 11_667_923n,
  expiryPushChainHeight: 22_963_300n,
  maxFee: 10_000n,
  revertRecipient: '0x0A16CBa65FfCAa4C2282b27b027Ab4A2fE46E0Bf',
};
const base = { spec: GOOD, value: 5_000n, callbackGasLimit: 200_000n, preflight: PF };

describe('validateReadSpec — one row per contract revert', () => {
  it('a good spec passes', () => {
    expect(validateReadSpec(base)).toEqual({ ok: true });
    expect(() => assertValidReadSpec(base)).not.toThrow();
  });

  const rows: [string, Partial<typeof base> | ((b: typeof base) => typeof base), ReadSpecViolation][] = [
    ['UniversalCallback.sol:98 empty chainNamespace', (b) => ({ ...b, spec: { ...b.spec, account: { ...b.spec.account, chainNamespace: '' } } }), 'INVALID_ACCOUNT_ID'],
    ['UniversalCallback.sol:98 empty chainId', (b) => ({ ...b, spec: { ...b.spec, account: { ...b.spec.account, chainId: '' } } }), 'INVALID_ACCOUNT_ID'],
    ['UniversalCallback.sol:100 empty owner', (b) => ({ ...b, spec: { ...b.spec, account: { ...b.spec.account, owner: '0x' } } }), 'INVALID_ACCOUNT_ID'],
    ['UniversalCallback.sol:104 empty query', (b) => ({ ...b, spec: { ...b.spec, query: '0x' } }), 'EMPTY_QUERY'],
    ['UniversalCallback.sol:107 minConfirmations 0', (b) => ({ ...b, spec: { ...b.spec, minConfirmations: 0 } }), 'INVALID_MIN_CONFIRMATIONS'],
    ['uint16 overflow minConfirmations', (b) => ({ ...b, spec: { ...b.spec, minConfirmations: 70_000 } }), 'INVALID_MIN_CONFIRMATIONS'],
    ['UniversalCallback.sol:131 blockNumber 0 on a chain with a height', (b) => ({ ...b, spec: { ...b.spec, blockNumber: 0n } }), 'INVALID_BLOCK_NUMBER'],
    ['UniversalCallback.sol:131 blockNumber above the oracle height', (b) => ({ ...b, spec: { ...b.spec, blockNumber: PF.observedChainHeight + 1n } }), 'INVALID_BLOCK_NUMBER'],
    ['UniversalCallback.sol:129 heightless namespace with non-zero blockNumber', (b) => ({ ...b, preflight: { ...PF, observedChainHeight: 0n }, spec: { ...b.spec, blockNumber: 1n } }), 'INVALID_BLOCK_NUMBER'],
    ['UniversalCallback.sol:119 expiry == current height', (b) => ({ ...b, spec: { ...b.spec, expiryPushChainHeight: PF.pushBlockNumber } }), 'INVALID_EXPIRY_HEIGHT'],
    ['UniversalCallback.sol:122 zero revertRecipient', (b) => ({ ...b, spec: { ...b.spec, revertRecipient: '0x0000000000000000000000000000000000000000' } }), 'ZERO_REVERT_RECIPIENT'],
    ['UniversalCallback.sol:125 callbackGasLimit 0', { callbackGasLimit: 0n }, 'ZERO_CALLBACK_GAS_LIMIT'],
    ['ReadTypes.sol:50 callbackGasLimit > 1_000_000', { callbackGasLimit: 1_000_001n }, 'CALLBACK_GAS_LIMIT_EXCEEDED'],
    ['UniversalCallback.sol:134 value below protocol fee', { value: 999n }, 'INSUFFICIENT_FEE'],
    ['UniversalCallback.sol:137 value above maxFee', { value: 10_001n }, 'EXCESSIVE_FEE'],
    ['node CanAffordCallback: value == fee leaves zero budget', { value: 1_000n }, 'ZERO_CALLBACK_BUDGET'],
    ['svm/read_executor.go:29 owner not 32 bytes on solana', (b) => ({ ...b, preflight: { ...PF, destination: resolveDestination({ chainNamespace: 'solana', chainId: 'x' }) }, spec: { ...b.spec, account: { chainNamespace: 'solana', chainId: 'x', owner: OK_OWNER } } }), 'SVM_OWNER_NOT_32_BYTES'],
  ];

  it.each(rows)('%s → %s', (_name, mutate, expected) => {
    const input = typeof mutate === 'function' ? mutate(base) : { ...base, ...mutate };
    const r = validateReadSpec(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violations).toContain(expected);
    expect(() => assertValidReadSpec(input)).toThrow(InvalidReadSpecError);
  });

  it('heightless namespace with blockNumber 0 is valid', () => {
    const r = validateReadSpec({ ...base, preflight: { ...PF, observedChainHeight: 0n }, spec: { ...GOOD, blockNumber: 0n } });
    expect(r).toEqual({ ok: true });
  });

  it('without a preflight, only the chain-independent rules apply', () => {
    const r = validateReadSpec({ spec: { ...GOOD, blockNumber: 0n }, value: 0n, callbackGasLimit: 1n });
    expect(r).toEqual({ ok: true });
  });

  it('reports every violation at once, not just the first', () => {
    const r = validateReadSpec({ ...base, spec: { ...GOOD, query: '0x', minConfirmations: 0 }, callbackGasLimit: 0n });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violations).toEqual(expect.arrayContaining(['EMPTY_QUERY', 'INVALID_MIN_CONFIRMATIONS', 'ZERO_CALLBACK_GAS_LIMIT']));
  });

  it('the thrown error carries the violations and the destination', () => {
    try {
      assertValidReadSpec({ ...base, callbackGasLimit: 0n });
      fail('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidReadSpecError);
      expect((e as InvalidReadSpecError).violations).toEqual(['ZERO_CALLBACK_GAS_LIMIT']);
      expect((e as InvalidReadSpecError).destination).toBe('eip155:11155111');
      expect((e as InvalidReadSpecError).code).toBe('INVALID_READ_SPEC');
    }
  });
});

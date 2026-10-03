import { decodeFunctionData, getAddress, type Address, type Hex } from 'viem';
import vectorsJson from '../__fixtures__/e704d5b-vectors.json';
import { actionId, agentConfig, configId, deriveWallet, rulesId } from '../codec/ids';
import {
  decodeNativeTerms,
  encodeNativeTerms,
  nativeRuleToTerms,
  nativeTermsToRule,
} from '../codec/native';
import { buildSession, decodeEnvelope, decodeSession, encodeEnvelope, encodeSession } from '../codec/session';
import { parseSelector, VALUE_ONLY_SELECTOR } from '../codec/selectors';
import { argumentOffset, headSize } from '../codec/abi-layout';
import { AGENTIC_DEFAULTS, UINT256_MAX } from '../codec/defaults';
import { e704d5b } from '../contracts/e704d5b';
import { AGW_ABI } from '../contracts/abi/e704d5b';
import { AGENTIC_ERROR_CODE } from '../errors';
import type { NativeRule } from '../agentic.types';

/** Restore {$bigint} markers written by the vector generator. */
function revive<T>(v: T): T {
  return JSON.parse(JSON.stringify(v), (_k, x) =>
    x && typeof x === 'object' && '$bigint' in x ? BigInt(x.$bigint) : x
  );
}
const vectors = revive(vectorsJson) as unknown as {
  rulesId: { validator: Address; agent: Address; grantNonce: bigint; agentConfig: Hex; expected: Hex }[];
  deriveWallet: { factory: Address; walletImplementation: Address; owner: Address; index: number; expected: Address }[];
  native: {
    rule: NativeRule;
    nativeChain: string;
    wallet: Address;
    rulesId: Hex;
    actionId: Hex;
    configId: Hex;
    configInitialized: boolean;
    storedTarget: Address;
    storedSelector: Hex;
    storedPins: { offset: number; expected: Hex }[];
    storedAmountOffset: number;
    encodedSession: Hex;
  };
};

const NOW = 1_700_000_000;
const target = getAddress('0x0000000000000000000000000000000000007a76');
const agent = getAddress('0x00000000000000000000000000000000000000a9');

describe('IDs against contract-generated vectors (e704d5b)', () => {
  it.each(vectors.rulesId)('rulesId(agent, nonce) = engine.getPermissionId — nonce $grantNonce', (v) => {
    expect(agentConfig(v.agent)).toBe(v.agentConfig);
    expect(rulesId({ validator: v.validator, agent: v.agent, grantNonce: v.grantNonce })).toBe(v.expected);
  });

  it.each(vectors.deriveWallet)('deriveWallet mirrors factory.predictWallet for $owner', (v) => {
    expect(deriveWallet(v)).toBe(getAddress(v.expected));
  });

  it('actionId/configId: the policy holds an initialized config under exactly this key', () => {
    const n = vectors.native;
    expect(n.configInitialized).toBe(true);
    expect(actionId(getAddress(n.storedTarget), n.storedSelector)).toBe(n.actionId);
    expect(configId(n.wallet, n.rulesId, n.actionId)).toBe(n.configId);
  });

  it('rulesId rejects a grant nonce outside uint64', () => {
    expect(() => rulesId({ validator: agent, agent, grantNonce: BigInt(2) ** BigInt(64) })).toThrow(/uint64/);
  });
});

describe('native rule codec', () => {
  const v = vectors.native;

  it('encodes the session the contracts accepted and stored', () => {
    const { terms } = nativeRuleToTerms(v.rule, { nowSeconds: NOW });
    const session = buildSession({
      validator: decodeSession(v.encodedSession).sessionValidator,
      agent: v.rule.agent,
      rulesPolicy: decodeSession(v.encodedSession).actions[0].actionPolicies[0].policy,
      actions: [{ target: terms.target, selector: terms.selector, initData: encodeEnvelope(v.nativeChain, encodeNativeTerms(terms)) }],
    });
    expect(encodeSession(session)).toBe(v.encodedSession);
    expect(terms.pins).toEqual(v.storedPins);
    expect(terms.amount.offset).toBe(v.storedAmountOffset);
    expect(terms.selector).toBe(v.storedSelector);
  });

  it('round-trips terms through the envelope and back to a public rule', () => {
    const { terms } = nativeRuleToTerms(v.rule, { nowSeconds: NOW });
    const env = decodeEnvelope(encodeEnvelope(v.nativeChain, encodeNativeTerms(terms)));
    expect(env.chainNamespace).toBe(v.nativeChain);
    const back = decodeNativeTerms(env.body);
    expect(back).toEqual({ ...terms, validUntil: terms.validUntil });
    const rule = nativeTermsToRule(back, v.rule.agent, `0x${'00'.repeat(32)}`);
    // Stored terms carry offsets, not an ABI: decoded rules report the raw offset form.
    expect(rule.pins).toEqual([{ offset: 4, expected: terms.pins[0].expected.toLowerCase() }]);
    expect(rule.amount).toEqual({ offset: 36, maxPerCall: BigInt(10), maxTotal: BigInt(100) });
    expect(rule.ref).toBeUndefined();
    // …and the decoded rule re-encodes to identical terms with only its 4-byte selector.
    expect(nativeRuleToTerms(rule, { nowSeconds: NOW }).terms).toEqual(terms);
  });

  it('decoding never invents argument indexes: a static array before a pin stays a raw offset', () => {
    const input: NativeRule = { agent, target, selector: 'deposit(uint256[2],address)', validUntil: NOW + 10, pins: [{ arg: 1, expected: agent }] };
    const { terms } = nativeRuleToTerms(input, { nowSeconds: NOW });
    expect(terms.pins[0].offset).toBe(4 + 64);
    const decoded = nativeTermsToRule(terms, agent, `0x${'00'.repeat(32)}`);
    expect(decoded.pins).toEqual([{ offset: 68, expected: terms.pins[0].expected }]);
    expect(nativeRuleToTerms(decoded, { nowSeconds: NOW }).terms).toEqual(terms);
  });

  it('a decoded address pin re-encodes in argument form once the signature is restored', () => {
    const input: NativeRule = { agent, target, selector: 'deposit(address,uint256)', validUntil: NOW + 10, pins: [{ arg: 0, expected: agent }] };
    const { terms } = nativeRuleToTerms(input, { nowSeconds: NOW });
    const word = terms.pins[0].expected;
    expect(nativeRuleToTerms({ ...input, pins: [{ arg: 0, expected: word }] }, { nowSeconds: NOW }).terms).toEqual(terms);
    expect(() =>
      nativeRuleToTerms({ ...input, pins: [{ arg: 0, expected: `0x${'ff'.repeat(32)}` }] }, { nowSeconds: NOW })
    ).toThrow(/does not encode/);
  });

  it('offset-form pins must be exact words at a valid offset', () => {
    const base: NativeRule = { agent, target, selector: '0xd09de08a', validUntil: NOW + 10 };
    expect(() => nativeRuleToTerms({ ...base, pins: [{ offset: 3, expected: `0x${'00'.repeat(32)}` }] }, { nowSeconds: NOW })).toThrow(/offset/);
    expect(() => nativeRuleToTerms({ ...base, pins: [{ offset: 4, expected: '0x01' }] }, { nowSeconds: NOW })).toThrow(/32-byte/);
    expect(nativeRuleToTerms({ ...base, pins: [{ offset: 36, expected: `0x${'00'.repeat(31)}01` }] }, { nowSeconds: NOW }).terms.pins).toEqual([
      { offset: 36, expected: `0x${'00'.repeat(31)}01` },
    ]);
  });

  it('applies the single provisional A03 defaults table for omitted limits', () => {
    const { terms } = nativeRuleToTerms(
      { agent, target, selector: 'f(uint256)', validUntil: NOW + 10, amount: { arg: 0, maxPerCall: BigInt(1) } },
      { nowSeconds: NOW }
    );
    expect(terms.maxValuePerCall).toBe(AGENTIC_DEFAULTS.native.maxValuePerCall.value);
    expect(terms.maxValueTotal).toBe(BigInt(0));
    expect(terms.maxCalls).toBe(0);
    expect(terms.amount.maxTotal).toBe(UINT256_MAX);
  });

  it('keeps an explicit zero as zero', () => {
    const { terms } = nativeRuleToTerms(
      { agent, target, selector: 'f(uint256)', validUntil: NOW + 10, amount: { arg: 0, maxPerCall: BigInt(1), maxTotal: BigInt(0) } },
      { nowSeconds: NOW }
    );
    expect(terms.amount.maxTotal).toBe(BigInt(0));
  });

  it('value-only rules encode the reserved selector and refuse pins/amount', () => {
    const { terms } = nativeRuleToTerms({ agent, target, selector: 'value-only', validUntil: NOW + 10 }, { nowSeconds: NOW });
    expect(terms.selector).toBe(VALUE_ONLY_SELECTOR);
    expect(() =>
      nativeRuleToTerms(
        { agent, target, selector: 'value-only', validUntil: NOW + 10, pins: [{ arg: 0, expected: agent }] },
        { nowSeconds: NOW }
      )
    ).toThrow(/value-only/);
  });

  it.each([
    ['past expiry', { validUntil: NOW }],
    ['zero target', { target: '0x0000000000000000000000000000000000000000' }],
    ['too many pins', { selector: 'f(uint256)', pins: Array.from({ length: 9 }, () => ({ arg: 0, expected: BigInt(1) })) }],
    ['pin needs a signature', { selector: '0x12345678', pins: [{ arg: 0, expected: BigInt(1) }] }],
    ['pin on a dynamic argument', { selector: 'f(bytes)', pins: [{ arg: 0, expected: '0x01' }] }],
    ['pin index out of range', { selector: 'f(uint256)', pins: [{ arg: 1, expected: BigInt(1) }] }],
    ['pin value of the wrong type', { selector: 'f(address)', pins: [{ arg: 0, expected: BigInt(1) }] }],
    ['amount on a non-uint', { selector: 'f(address)', amount: { arg: 0, maxPerCall: BigInt(1) } }],
    ['amount also pinned', { selector: 'f(uint256)', pins: [{ arg: 0, expected: BigInt(1) }], amount: { arg: 0, maxPerCall: BigInt(1) } }],
    ['negative cap', { maxValuePerCall: BigInt(-1) }],
    ['maxCalls beyond uint32', { maxCalls: 2 ** 32 }],
  ])('rejects %s before signing', (_name, patch) => {
    const rule = { agent, target, selector: 'increment()', validUntil: NOW + 10, ...patch } as NativeRule;
    expect(() => nativeRuleToTerms(rule, { nowSeconds: NOW })).toThrow(
      expect.objectContaining({ code: AGENTIC_ERROR_CODE.INVALID_RULE })
    );
  });

  it('approval functions need their spender pinned (A01 / obligation 16)', () => {
    const base = { agent, target, validUntil: NOW + 10 };
    expect(() => nativeRuleToTerms({ ...base, selector: 'approve(address,uint256)' }, { nowSeconds: NOW })).toThrow(/spender/);
    expect(() =>
      nativeRuleToTerms(
        { ...base, selector: 'approve(address,uint256)', pins: [{ arg: 0, expected: agent }] },
        { nowSeconds: NOW }
      )
    ).not.toThrow();
    expect(() =>
      nativeRuleToTerms(
        { ...base, selector: 'permit(address,address,uint256,uint256,uint8,bytes32,bytes32)', pins: [{ arg: 0, expected: agent }] },
        { nowSeconds: NOW }
      )
    ).toThrow(/spender/);
  });
});

describe('ABI layout offsets', () => {
  it('accounts for dynamic heads and multi-word static tuples before the pinned argument', () => {
    const dyn = parseSelector('f(bytes,address)');
    expect(argumentOffset(dyn.inputs, 1, 'pin')).toBe(4 + 32);
    const tup = parseSelector('f((uint256,uint256),address)');
    expect(headSize(tup.inputs![0])).toBe(64);
    expect(argumentOffset(tup.inputs, 1, 'pin')).toBe(4 + 64);
    const arr = parseSelector('f(uint256[3],address)');
    expect(argumentOffset(arr.inputs, 1, 'pin')).toBe(4 + 96);
    const dynTuple = parseSelector('f((uint256,bytes),address)');
    expect(argumentOffset(dynTuple.inputs, 1, 'pin')).toBe(4 + 32);
  });

  it('rejects pinning a tuple', () => {
    const tup = parseSelector('f((uint256,uint256),address)');
    expect(() => argumentOffset(tup.inputs, 0, 'pin')).toThrow(/single-word/);
  });

  it('parses hex, signature and value-only selectors', () => {
    expect(parseSelector('0x617BA037').selector).toBe('0x617ba037');
    expect(parseSelector('supply(address,uint256,address,uint16)').selector).toBe('0x617ba037');
    expect(parseSelector('value-only').valueOnly).toBe(true);
    expect(() => parseSelector('not a selector' as never)).toThrow();
  });
});

describe('wallet call encoders decode back to the same calls', () => {
  const call = { target, value: BigInt(7), data: '0xd09de08a' as Hex };

  it('execute single uses packed ERC-7579 calldata', () => {
    const data = e704d5b.encodeExecute([call]);
    const { functionName, args } = decodeFunctionData({ abi: AGW_ABI, data });
    expect(functionName).toBe('execute');
    expect(args[0]).toBe(`0x${'00'.repeat(32)}`);
    expect((args[1] as Hex).length).toBe(2 + 2 * (20 + 32 + 4));
    expect(e704d5b.decodeWalletCall(data)).toEqual({ kind: 'execute', mode: args[0], calls: [call] });
  });

  it('execute batch uses abi.encode(Execution[])', () => {
    const data = e704d5b.encodeExecute([call, { ...call, value: BigInt(0) }]);
    const decoded = e704d5b.decodeWalletCall(data);
    expect(decoded).toMatchObject({ kind: 'execute', mode: `0x01${'00'.repeat(31)}` });
    expect((decoded as { calls: unknown[] }).calls).toEqual([call, { ...call, value: BigInt(0) }]);
  });

  it('executeAsAgent carries the rule ID and one packed call', () => {
    const id = `0x${'42'.repeat(32)}` as Hex;
    expect(e704d5b.decodeWalletCall(e704d5b.encodeExecuteAsAgent(id, call))).toEqual({
      kind: 'executeAsAgent',
      rulesId: id,
      mode: `0x${'00'.repeat(32)}`,
      calls: [call],
    });
  });

  it('unknown calldata is not mistaken for a wallet call', () => {
    expect(e704d5b.decodeWalletCall('0xdeadbeef')).toBeNull();
  });
});

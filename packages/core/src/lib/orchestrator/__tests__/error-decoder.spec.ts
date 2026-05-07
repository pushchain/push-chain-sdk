import {
  decodeRevert,
  KNOWN_ERROR_SELECTORS,
  ERROR_STRING_SELECTOR,
} from '../internals/error-decoder';

describe('decodeRevert', () => {
  it('returns null on empty input', () => {
    expect(decodeRevert('')).toBeNull();
  });

  it('returns null when no `ret 0x...` blob present', () => {
    expect(decodeRevert('something failed')).toBeNull();
  });

  it('decodes a known parameterless custom selector', () => {
    const msg =
      "execution reverted: ret 0xacfdb444: evm transaction execution failed";
    const decoded = decodeRevert(msg);
    expect(decoded?.kind).toBe('custom');
    if (decoded?.kind === 'custom') {
      expect(decoded.selector).toBe('0xacfdb444');
      expect(decoded.name).toBe('ExecutionFailed');
      expect(decoded.hint).toContain('subcall reverted');
      expect(decoded.provenance).toBeDefined();
    }
  });

  it('decodes a known parameterized custom selector (extra ABI args appended)', () => {
    // Extra zero-padded arg after the 4-byte selector — the regex must still
    // pull the right selector and look it up cleanly.
    const msg =
      "execution reverted: ret 0xf4d678b80000000000000000000000000000000000000000000000000000000000000064: evm transaction execution failed";
    const decoded = decodeRevert(msg);
    expect(decoded?.kind).toBe('custom');
    if (decoded?.kind === 'custom') {
      expect(decoded.selector).toBe('0xf4d678b8');
      expect(decoded.name).toBe('InsufficientBalance');
    }
  });

  it('decodes ABI-encoded Error(string) ("STF")', () => {
    // Error(string) encoding for "STF":
    //   selector(0x08c379a0) + offset(0x20) + length(0x03) + "STF" + zero-padded
    const stfHex =
      '0x08c379a0' +
      // 32-byte offset = 0x20
      '0000000000000000000000000000000000000000000000000000000000000020' +
      // 32-byte length = 3
      '0000000000000000000000000000000000000000000000000000000000000003' +
      // "STF" UTF-8 = 0x535446, padded to 32 bytes
      '5354460000000000000000000000000000000000000000000000000000000000';
    const msg = `execution reverted: ret ${stfHex}: evm transaction execution failed`;
    const decoded = decodeRevert(msg);
    expect(decoded?.kind).toBe('string');
    if (decoded?.kind === 'string') {
      expect(decoded.selector).toBe(ERROR_STRING_SELECTOR);
      expect(decoded.decoded).toBe('STF');
    }
  });

  it('returns kind=unknown for unmapped selectors', () => {
    const msg = "execution reverted: ret 0xdeadbeef: evm transaction execution failed";
    const decoded = decodeRevert(msg);
    expect(decoded?.kind).toBe('unknown');
    if (decoded?.kind === 'unknown') {
      expect(decoded.selector).toBe('0xdeadbeef');
    }
  });

  it('returns null for malformed blob shorter than the 10-char selector', () => {
    const msg = "execution reverted: ret 0xab: evm";
    expect(decodeRevert(msg)).toBeNull();
  });

  it('handles Error(string) with malformed length gracefully (falls through to unknown)', () => {
    // Error(string) selector but the length field is huge — we must NOT crash.
    const malformed =
      '0x08c379a0' +
      '0000000000000000000000000000000000000000000000000000000000000020' +
      'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff' +
      '5354460000000000000000000000000000000000000000000000000000000000';
    const msg = `execution reverted: ret ${malformed}`;
    const decoded = decodeRevert(msg);
    // Either falls through to unknown or returns null — both are acceptable
    // for malformed input. The important thing is no throw.
    expect(decoded === null || decoded.kind === 'unknown').toBe(true);
  });

  it('lowercases the selector regardless of input casing', () => {
    const msg = "execution reverted: ret 0xACFDB444: evm transaction execution failed";
    const decoded = decodeRevert(msg);
    expect(decoded?.kind).toBe('custom');
    if (decoded?.kind === 'custom') {
      expect(decoded.selector).toBe('0xacfdb444');
    }
  });
});

describe('KNOWN_ERROR_SELECTORS table', () => {
  it('every entry has name + hint + provenance', () => {
    for (const sel of Object.keys(KNOWN_ERROR_SELECTORS) as `0x${string}`[]) {
      const e = KNOWN_ERROR_SELECTORS[sel];
      expect(typeof e.name).toBe('string');
      expect(e.name.length).toBeGreaterThan(0);
      expect(typeof e.hint).toBe('string');
      expect(e.hint.length).toBeGreaterThan(0);
      expect(typeof e.provenance).toBe('string');
      expect(e.provenance.length).toBeGreaterThan(0);
    }
  });

  it('selectors are 10 chars (0x + 8 hex)', () => {
    for (const sel of Object.keys(KNOWN_ERROR_SELECTORS)) {
      expect(sel).toMatch(/^0x[0-9a-f]{8}$/);
    }
  });
});

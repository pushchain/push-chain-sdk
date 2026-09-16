import { hexToString, sliceHex } from 'viem';
import vectorsFile from './fixtures/envelope-vectors.json';
import { canonicalizeHeaders, decodeWeb2QueryEnvelope, encodeWeb2QueryEnvelope } from '../envelopes/web2';
import { InvalidReadQueryError } from '../errors';
import type { Web2Extract } from '../read-state.types';

const vectors = vectorsFile.vectors.filter((v) => v.namespace === 'web2');
const URL = 'https://jsonplaceholder.typicode.com/todos/1';
const extract = (n: number): Web2Extract[] => Array.from({ length: n }, (_, i) => ({ path: `$.f${i}`, valueType: 'uint256' }));

describe('Web2 query envelope', () => {
  it.each(vectors)('golden vector: $name', (v) => {
    const out = encodeWeb2QueryEnvelope(v.query as never);
    expect(out.encoded).toBe(v.expectedHex);
    expect(out.namespace).toBe('web2');
    expect(out.blockRef).toBe(0n);
    expect(out.resultShape.kind).toBe('web2');
  });

  it('is a single tuple with a 0x20 head offset', () => {
    const out = encodeWeb2QueryEnvelope({ type: 'http', url: URL, extract: extract(1) });
    expect(sliceHex(out.encoded, 0, 32)).toBe('0x0000000000000000000000000000000000000000000000000000000000000020');
  });

  it('round-trips through the decoder shape with defaults applied', () => {
    const d = decodeWeb2QueryEnvelope(encodeWeb2QueryEnvelope({ type: 'http', url: URL, extract: extract(2) }).encoded);
    expect(d.method).toBe(0);
    expect(d.url).toBe(URL);
    expect(d.headers).toEqual({});
    expect(d.body).toBe('0x');
    expect(d.timeoutMs).toBe(5000n);
    expect(d.extract).toEqual([
      { path: '$.f0', valueType: 0, mode: 0, decimals: 0 },
      { path: '$.f1', valueType: 0, mode: 0, decimals: 0 },
    ]);
  });

  it('canonicalises headers: sorted keys, no whitespace, identical bytes regardless of input order', () => {
    const a = canonicalizeHeaders({ b: '2', a: '1' });
    const b = canonicalizeHeaders({ a: '1', b: '2' });
    expect(a).toBe(b);
    expect(hexToString(a)).toBe('{"a":"1","b":"2"}');
    expect(hexToString(canonicalizeHeaders(undefined))).toBe('{}');
  });

  it('warns — does not throw — on sensitive-looking header names', () => {
    const out = encodeWeb2QueryEnvelope({
      type: 'http',
      url: URL,
      headers: { Authorization: 'Bearer x', 'X-Api-Key': 'k', Accept: 'application/json' },
      extract: extract(1),
    });
    expect(out.warnings).toHaveLength(2);
    expect(out.warnings.join(' ')).toMatch(/Authorization/);
    expect(out.warnings.join(' ')).toMatch(/X-Api-Key/);
  });

  it('maps every value type and keeps decimals', () => {
    const d = decodeWeb2QueryEnvelope(
      encodeWeb2QueryEnvelope({
        type: 'http',
        url: URL,
        extract: [
          { path: '$.a', valueType: 'uint256', decimals: 8 },
          { path: '$.b', valueType: 'int256' },
          { path: '$.c', valueType: 'bool' },
          { path: '$.d', valueType: 'string' },
          { path: '$.e', valueType: 'bytes' },
        ],
      }).encoded,
    );
    expect(d.extract.map((e) => [e.valueType, e.decimals])).toEqual([[0, 8], [1, 0], [2, 0], [3, 0], [4, 0]]);
  });

  it('accepts exactly 16 extracts and rejects 17 or 0', () => {
    expect(() => encodeWeb2QueryEnvelope({ type: 'http', url: URL, extract: extract(16) })).not.toThrow();
    expect(() => encodeWeb2QueryEnvelope({ type: 'http', url: URL, extract: extract(17) })).toThrow(InvalidReadQueryError);
    expect(() => encodeWeb2QueryEnvelope({ type: 'http', url: URL, extract: [] })).toThrow(InvalidReadQueryError);
  });

  it('rejects http://, a body on GET, decimals on a non-numeric type, and a bad path', () => {
    expect(() => encodeWeb2QueryEnvelope({ type: 'http', url: 'http://x.y/z', extract: extract(1) })).toThrow(InvalidReadQueryError);
    expect(() => encodeWeb2QueryEnvelope({ type: 'http', url: URL, body: '{}', extract: extract(1) })).toThrow(InvalidReadQueryError);
    expect(() =>
      encodeWeb2QueryEnvelope({ type: 'http', url: URL, extract: [{ path: '$.x', valueType: 'bool', decimals: 2 }] }),
    ).toThrow(InvalidReadQueryError);
    expect(() =>
      encodeWeb2QueryEnvelope({ type: 'http', url: URL, extract: [{ path: 'x.y', valueType: 'bool' }] }),
    ).toThrow(InvalidReadQueryError);
  });

  it('POST with a body encodes the body bytes', () => {
    const d = decodeWeb2QueryEnvelope(
      encodeWeb2QueryEnvelope({ type: 'http', method: 'POST', url: URL, body: '{"q":1}', extract: extract(1) }).encoded,
    );
    expect(d.method).toBe(1);
    expect(hexToString(d.body)).toBe('{"q":1}');
  });
});

import { bytesToHex, decodeAbiParameters, encodeAbiParameters, hexToString, stringToHex, type Hex } from 'viem';
import {
  READ_NAMESPACE,
  WEB2_DEFAULT_TIMEOUT_MS,
  WEB2_MAX_EXTRACT_ENTRIES,
  WEB2_MAX_TIMEOUT_MS,
} from '../../constants/read-state';
import { InvalidReadQueryError } from '../errors';
import type { EncodedReadQuery, Web2Extract, Web2ReadQuery, Web2ValueType } from '../read-state.types';

/** `universalClient/externalchains/web2/read_envelope.go`. */
export const WEB2_METHOD = { GET: 0, POST: 1 } as const;
export const WEB2_VALUE_TYPE: Record<Web2ValueType, number> = {
  uint256: 0,
  int256: 1,
  bool: 2,
  string: 3,
  bytes: 4,
};
/** Only IDENTICAL (quorum on identical bytes) exists in v1. */
const WEB2_MODE_IDENTICAL = 0;

const WEB2_ENVELOPE_ABI = [
  {
    type: 'tuple',
    components: [
      { name: 'method', type: 'uint8' },
      { name: 'url', type: 'string' },
      { name: 'headers', type: 'bytes' },
      { name: 'body', type: 'bytes' },
      { name: 'timeoutMs', type: 'uint64' },
      {
        name: 'extract',
        type: 'tuple[]',
        components: [
          { name: 'path', type: 'string' },
          { name: 'valueType', type: 'uint8' },
          { name: 'mode', type: 'uint8' },
          { name: 'decimals', type: 'uint8' },
        ],
      },
    ],
  },
] as const;

const SENSITIVE_HEADER = /auth|key|token|secret|bearer|cookie|session/i;
const NUMERIC: ReadonlySet<Web2ValueType> = new Set(['uint256', 'int256']);

/**
 * Deterministic JSON object bytes: keys sorted, no whitespace. The validator
 * `json.Unmarshal`s into map[string]string, so ordering does not affect the read —
 * canonicalising just keeps the on-chain envelope stable across SDK versions.
 */
export function canonicalizeHeaders(headers: Record<string, string> | undefined): Hex {
  const entries = Object.entries(headers ?? {});
  if (entries.length === 0) return stringToHex('{}');
  for (const [k, v] of entries) {
    if (typeof v !== 'string') throw new InvalidReadQueryError(`header ${k} must be a string`);
  }
  const sorted = Object.fromEntries(entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return stringToHex(JSON.stringify(sorted));
}

function toBodyHex(body: string | Uint8Array | undefined): Hex {
  if (body === undefined) return '0x';
  return typeof body === 'string' ? stringToHex(body) : bytesToHex(body);
}

function validateExtract(extract: readonly Web2Extract[]): void {
  if (!Array.isArray(extract) || extract.length === 0) {
    throw new InvalidReadQueryError('web2 query needs at least one extract entry');
  }
  if (extract.length > WEB2_MAX_EXTRACT_ENTRIES) {
    throw new InvalidReadQueryError(`web2 query has ${extract.length} extracts; max is ${WEB2_MAX_EXTRACT_ENTRIES}`);
  }
  extract.forEach((e, i) => {
    if (!e.path || !e.path.startsWith('$')) {
      throw new InvalidReadQueryError(`extract[${i}].path must be a JSONPath starting with "$": ${e.path}`);
    }
    if (!(e.valueType in WEB2_VALUE_TYPE)) {
      throw new InvalidReadQueryError(`extract[${i}].valueType unknown: ${String(e.valueType)}`);
    }
    if (e.decimals !== undefined) {
      if (!NUMERIC.has(e.valueType)) {
        throw new InvalidReadQueryError(`extract[${i}].decimals only applies to uint256/int256`);
      }
      if (!Number.isInteger(e.decimals) || e.decimals < 0 || e.decimals > 255) {
        throw new InvalidReadQueryError(`extract[${i}].decimals must be an integer 0..255`);
      }
    }
  });
}

/** Encode a `web2` read query. Pure. `blockRef` is always 0 (heightless namespace). */
export function encodeWeb2QueryEnvelope(query: Web2ReadQuery): EncodedReadQuery {
  const method = query.method ?? 'GET';
  if (method !== 'GET' && method !== 'POST') throw new InvalidReadQueryError(`unsupported method: ${String(method)}`);
  if (!/^https:\/\/\S+$/i.test(query.url)) {
    throw new InvalidReadQueryError('web2 url must be https:// — validators refuse other schemes');
  }
  if (method === 'GET' && query.body !== undefined) {
    throw new InvalidReadQueryError('body is only allowed with POST');
  }
  const timeoutMs = query.timeoutMs ?? WEB2_DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new InvalidReadQueryError('timeoutMs must be a positive integer');
  validateExtract(query.extract);

  const warnings: string[] = [];
  for (const name of Object.keys(query.headers ?? {})) {
    if (SENSITIVE_HEADER.test(name)) {
      warnings.push(`header "${name}" looks sensitive and will be written to a PUBLIC event log forever`);
    }
  }
  if (timeoutMs > WEB2_MAX_TIMEOUT_MS) {
    warnings.push(`timeoutMs ${timeoutMs} exceeds the validator clamp of ${WEB2_MAX_TIMEOUT_MS}`);
  }

  const encoded = encodeAbiParameters(WEB2_ENVELOPE_ABI, [
    {
      method: WEB2_METHOD[method],
      url: query.url,
      headers: canonicalizeHeaders(query.headers),
      body: toBodyHex(query.body),
      timeoutMs: BigInt(timeoutMs),
      extract: query.extract.map((e) => ({
        path: e.path,
        valueType: WEB2_VALUE_TYPE[e.valueType],
        mode: WEB2_MODE_IDENTICAL,
        decimals: e.decimals ?? 0,
      })),
    },
  ]);

  return {
    namespace: READ_NAMESPACE.WEB2,
    queryType: WEB2_METHOD[method],
    encoded,
    blockRef: 0n,
    resultShape: { kind: 'web2', extract: query.extract },
    warnings,
  };
}

export function decodeWeb2QueryEnvelope(encoded: Hex): {
  method: number;
  url: string;
  headers: Record<string, string>;
  body: Hex;
  timeoutMs: bigint;
  extract: { path: string; valueType: number; mode: number; decimals: number }[];
} {
  const [env] = decodeAbiParameters(WEB2_ENVELOPE_ABI, encoded);
  return {
    method: env.method,
    url: env.url,
    headers: env.headers === '0x' ? {} : (JSON.parse(hexToString(env.headers)) as Record<string, string>),
    body: env.body,
    timeoutMs: env.timeoutMs,
    extract: env.extract.map((e) => ({ ...e })),
  };
}

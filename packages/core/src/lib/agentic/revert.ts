import {
  decodeErrorResult,
  toFunctionSelector,
  type Abi,
  type Hex,
} from 'viem';
import { formatAbiItem } from 'viem/utils';
import type { DecodedErrorPayload } from '../orchestrator/internals/errors';
import {
  AGW_ABI,
  AGW_FACTORY_ABI,
  SMART_SESSION_ABI,
  UNIVERSAL_RULES_POLICY_ABI,
} from './contracts/abi/v5';

/** URP reverts reached through the engine are truncated to this wrapper. */
export const POLICY_CHECK_REVERTED_SELECTOR = '0xf4270752';

const ERROR_ABIS: readonly Abi[] = [
  AGW_ABI as unknown as Abi,
  UNIVERSAL_RULES_POLICY_ABI as unknown as Abi,
  AGW_FACTORY_ABI as unknown as Abi,
  SMART_SESSION_ABI as unknown as Abi,
];

/** selector → error name across the AGW/URP/factory/engine ABIs. */
const ERROR_NAMES: ReadonlyMap<string, string> = new Map(
  ERROR_ABIS.flatMap((abi) =>
    abi
      .filter((item) => item.type === 'error')
      .map((item) => {
        const err = item as {
          type: 'error';
          name: string;
          inputs: readonly { type: string }[];
        };
        return [
          toFunctionSelector(formatAbiItem(err as never)).toLowerCase(),
          err.name,
        ] as const;
      })
  )
);

const HEX_DATA = /0x[0-9a-fA-F]{8,}/g;
const CUSTOM_ERROR_TEXT = /custom error (0x[0-9a-fA-F]{8}):?\s*([0-9a-fA-F]*)/g;

/** Pull candidate revert data out of an error (viem chains, nested causes, messages). */
function revertDataCandidates(err: unknown, depth = 0): Hex[] {
  if (!err || depth > 6) return [];
  const out: Hex[] = [];
  const e = err as {
    data?: unknown;
    raw?: unknown;
    cause?: unknown;
    message?: unknown;
    details?: unknown;
  };
  if (typeof e.raw === 'string' && /^0x[0-9a-fA-F]{8,}$/.test(e.raw))
    out.push(e.raw as Hex);
  if (typeof e.data === 'string' && /^0x[0-9a-fA-F]{8,}$/.test(e.data))
    out.push(e.data as Hex);
  if (
    e.data &&
    typeof e.data === 'object' &&
    typeof (e.data as { data?: unknown }).data === 'string'
  ) {
    out.push((e.data as { data: Hex }).data);
  }
  for (const text of [e.message, e.details]) {
    if (typeof text !== 'string') continue;
    // viem renders unknown custom errors as "custom error 0x<selector>: <args hex>".
    for (const m of text.matchAll(CUSTOM_ERROR_TEXT))
      out.push(`${m[1]}${m[2] ?? ''}` as Hex);
    out.push(...((text.match(HEX_DATA) ?? []) as Hex[]));
  }
  out.push(...revertDataCandidates(e.cause, depth + 1));
  return out;
}

/** Decode raw revert data against the AGW/URP/factory/engine error ABIs. */
export function decodeAgwErrorData(data: Hex): DecodedErrorPayload | undefined {
  const selector = data.slice(0, 10).toLowerCase();
  if (selector === POLICY_CHECK_REVERTED_SELECTOR && data.length >= 10 + 64) {
    // bytes32 = 4-byte policy error selector ‖ 28 bytes of its first argument.
    // The arguments are truncated, so the inner error is named by selector only.
    const word = `0x${data.slice(10, 74)}` as Hex;
    const innerName = ERROR_NAMES.get(word.slice(0, 10).toLowerCase());
    return {
      name: innerName
        ? `PolicyCheckReverted(${innerName})`
        : 'PolicyCheckReverted',
      selector,
      decoded: word,
      hint: 'URP rejected the action (truncated through the session engine). The inner selector names the gate; arguments are truncated to 28 bytes.',
    };
  }
  for (const abi of ERROR_ABIS) {
    try {
      const r = decodeErrorResult({ abi, data });
      return {
        name: r.errorName,
        selector,
        decoded: r.args && r.args.length ? stringifyArgs(r.args) : undefined,
      };
    } catch {
      // try the next ABI
    }
  }
  // Arguments lost (e.g. a node rendered them as text): name the error by its selector.
  const name = ERROR_NAMES.get(selector);
  return name
    ? { name, selector, hint: 'Error arguments were not available.' }
    : undefined;
}

export function decodeAgenticRevert(
  err: unknown
): DecodedErrorPayload | undefined {
  for (const data of revertDataCandidates(err)) {
    const decoded = decodeAgwErrorData(data);
    if (decoded) return decoded;
  }
  return undefined;
}

function stringifyArgs(args: readonly unknown[]): string {
  return JSON.stringify(args, (_k, v) =>
    typeof v === 'bigint' ? v.toString() : v
  );
}

import {
  decodeFunctionData,
  encodeFunctionData,
  getAbiItem,
  toFunctionSelector,
  type Abi,
  type Hex,
} from 'viem';

/** Copy public data before awaiting RPCs or a wallet; BigInts and array order are retained. */
export function copyData<T>(value: T): T {
  if (Array.isArray(value)) return value.map(copyData) as T;
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, copyData(v)])
    ) as T;
  return value;
}
export function fingerprint(value: unknown): string {
  const sorted = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sorted)
      : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.entries(v)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, x]) => [k, sorted(x)])
        )
      : typeof v === 'bigint'
      ? `${v}n`
      : v;
  return JSON.stringify(sorted(value));
}

/** Locate canonical ABI calls inside ordinary, UEA, AGW or multisig transaction inputs.
 * Candidates are data, not proof of execution: callers must bind them to authenticated receipt events.
 */
export function embeddedCalls(
  input: Hex,
  abi: Abi,
  name: string
): readonly unknown[][] {
  const item = getAbiItem({ abi, name });
  if (!item || item.type !== 'function') return [];
  const selector = toFunctionSelector(item).slice(2).toLowerCase();
  const hex = input.toLowerCase();
  const calls: unknown[][] = [];
  let offset = 2;
  while ((offset = hex.indexOf(selector, offset)) !== -1) {
    const at = offset;
    offset += 2;
    if (at % 2 !== 0) continue;
    try {
      const data = ('0x' + input.slice(at)) as Hex;
      const decoded = decodeFunctionData({ abi: [item], data });
      const encoded = encodeFunctionData({
        abi: [item],
        functionName: name,
        args: decoded.args,
      });
      if (data.slice(0, encoded.length).toLowerCase() === encoded.toLowerCase())
        calls.push([...(decoded.args ?? [])]);
    } catch {
      /* A selector-shaped value inside unrelated calldata is not a candidate. */
    }
  }
  return calls;
}

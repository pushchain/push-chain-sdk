import { decodeAbiParameters, decodeFunctionResult, getAbiItem, isHex, size, type AbiFunction, type Hex } from 'viem';
import { ReadDecodeError } from './errors';
import type { DecodedReadResult, ReadResultShape, Web2ValueType } from './read-state.types';

const WEB2_ABI_TYPE: Record<Web2ValueType, string> = {
  uint256: 'uint256',
  int256: 'int256',
  bool: 'bool',
  string: 'string',
  bytes: 'bytes',
};

/**
 * Decode `resultData` using the shape recorded by the query that produced it.
 *
 * `resultData` is not self-describing. Shapes (from the validator executors):
 *   EVM AccountBalance / SVM LamportBalance / SVM SPLTokenAccount → abi.encode(uint256)
 *   EVM ContractCall → raw eth_call return bytes (decoded with the recorded ABI, else raw)
 *   EVM StorageSlot  → raw 32 bytes
 *   SVM RawAccountData → raw account bytes
 *   Web2 → abi.encode(v1, v2, …) — a FLAT argument list, one per extract, in order
 *
 * Throws `ReadDecodeError` rather than mis-decoding. Do not call this for an ERROR
 * result (empty bytes) — check `result.status` first.
 */
export function decodeReadResult(resultData: Hex, shape: ReadResultShape): DecodedReadResult {
  if (!isHex(resultData)) throw new ReadDecodeError('resultData is not hex');
  const len = size(resultData);

  try {
    switch (shape.kind) {
      case 'uint256': {
        if (len !== 32) throw new ReadDecodeError(`expected 32 bytes for uint256, got ${len}`);
        const [value] = decodeAbiParameters([{ type: 'uint256' }], resultData);
        return { kind: 'uint256', value };
      }
      case 'bytes32': {
        if (len !== 32) throw new ReadDecodeError(`expected 32 bytes for bytes32, got ${len}`);
        return { kind: 'bytes32', value: resultData };
      }
      case 'raw':
        return { kind: 'raw', value: resultData };
      case 'evmCall': {
        if (len === 0) throw new ReadDecodeError('empty resultData for a contract call');
        const item = getAbiItem({ abi: shape.abi, name: shape.functionName }) as AbiFunction | undefined;
        if (!item) throw new ReadDecodeError(`function not found in abi: ${shape.functionName}`);
        const decoded = decodeFunctionResult({ abi: shape.abi, functionName: shape.functionName, data: resultData });
        return { kind: 'evmCall', value: decoded };
      }
      case 'web2': {
        if (shape.extract.length === 0) throw new ReadDecodeError('web2 shape has no extracts');
        if (len === 0) throw new ReadDecodeError('empty resultData for a web2 read');
        const params = shape.extract.map((e) => ({ type: WEB2_ABI_TYPE[e.valueType] }));
        const values = decodeAbiParameters(params, resultData);
        return { kind: 'web2', values };
      }
      default:
        throw new ReadDecodeError(`unknown result shape: ${(shape as { kind: string }).kind}`);
    }
  } catch (err) {
    if (err instanceof ReadDecodeError) throw err;
    throw new ReadDecodeError(`resultData does not match shape ${shape.kind}: ${(err as Error).message}`);
  }
}

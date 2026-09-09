import { encodeAbiParameters, erc20Abi, parseAbi } from 'viem';
import { ReadDecodeError } from '../errors';
import { decodeReadResult } from '../result-decoder';

const U256 = (n: bigint) => encodeAbiParameters([{ type: 'uint256' }], [n]);

describe('decodeReadResult', () => {
  it('uint256 — EVM balance / SVM lamports / SPL amount (real Donut bytes)', () => {
    // read 0xf3d62fb9…: Sepolia balance of 0xdead
    const evm = decodeReadResult('0x000000000000000000000000000000000000000000000092b406e140cc2c8871', { kind: 'uint256' });
    expect(evm).toEqual({ kind: 'uint256', value: 2706196938206701455473n });
    // read 0x1e995107…: devnet lamports of 3nK8X1re…
    const svm = decodeReadResult('0x000000000000000000000000000000000000000000000000000000002b5786fd', { kind: 'uint256' });
    expect(svm).toEqual({ kind: 'uint256', value: 727156477n });
  });

  it('bytes32 — storage slot', () => {
    const slot = '0x0000000000000000000000000000000000000000000000000000000000000005' as const;
    expect(decodeReadResult(slot, { kind: 'bytes32' })).toEqual({ kind: 'bytes32', value: slot });
    expect(() => decodeReadResult('0x05', { kind: 'bytes32' })).toThrow(ReadDecodeError);
  });

  it('raw — passthrough, including empty', () => {
    expect(decodeReadResult('0xdeadbeef', { kind: 'raw' })).toEqual({ kind: 'raw', value: '0xdeadbeef' });
    expect(decodeReadResult('0x', { kind: 'raw' })).toEqual({ kind: 'raw', value: '0x' });
  });

  it('evmCall — single output unwrapped into an array; multiple outputs kept in order', () => {
    const single = decodeReadResult(U256(42n), { kind: 'evmCall', abi: erc20Abi, functionName: 'balanceOf' });
    expect(single).toEqual({ kind: 'evmCall', values: [42n] });

    const abi = parseAbi(['function getUserAccountData(address) view returns (uint256 collateral, uint256 debt, bool ok)']);
    const data = encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }, { type: 'bool' }], [1n, 2n, true]);
    expect(decodeReadResult(data, { kind: 'evmCall', abi, functionName: 'getUserAccountData' })).toEqual({
      kind: 'evmCall',
      values: [1n, 2n, true],
    });
  });

  it('web2 — FLAT argument list, one value per extract, in order (real Donut bytes)', () => {
    // read 0x3870d2af…: $.id uint256, $.completed bool
    const data =
      '0x00000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000000';
    const out = decodeReadResult(data, {
      kind: 'web2',
      extract: [
        { path: '$.id', valueType: 'uint256' },
        { path: '$.completed', valueType: 'bool' },
      ],
    });
    expect(out).toEqual({ kind: 'web2', values: [1n, false] });
  });

  it('web2 — decoding against the WRONG extract list throws instead of mis-decoding', () => {
    const data = encodeAbiParameters([{ type: 'uint256' }, { type: 'bool' }], [1n, false]);
    expect(() =>
      decodeReadResult(data, {
        kind: 'web2',
        extract: [
          { path: '$.a', valueType: 'string' },
          { path: '$.b', valueType: 'bytes' },
          { path: '$.c', valueType: 'string' },
        ],
      }),
    ).toThrow(ReadDecodeError);
  });

  it('rejects wrong sizes, empty data for typed shapes, and non-hex', () => {
    expect(() => decodeReadResult('0x01', { kind: 'uint256' })).toThrow(ReadDecodeError);
    expect(() => decodeReadResult('0x', { kind: 'uint256' })).toThrow(ReadDecodeError);
    expect(() => decodeReadResult('0x', { kind: 'evmCall', abi: erc20Abi, functionName: 'balanceOf' })).toThrow(ReadDecodeError);
    expect(() => decodeReadResult('0x', { kind: 'web2', extract: [{ path: '$.x', valueType: 'bool' }] })).toThrow(ReadDecodeError);
    expect(() => decodeReadResult('nope' as never, { kind: 'raw' })).toThrow(ReadDecodeError);
  });
});

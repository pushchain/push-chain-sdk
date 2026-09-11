import { decodeAbiParameters, encodeAbiParameters, erc20Abi, keccak256, sliceHex, parseAbi } from 'viem';
import { decodeReadResult } from '../result-decoder';
import vectorsFile from './fixtures/envelope-vectors.json';
import { EVM_QUERY_TYPE, decodeEvmQueryEnvelope, encodeEvmQueryEnvelope, toStorageSlot } from '../envelopes/evm';
import { InvalidReadQueryError } from '../errors';

const vectors = vectorsFile.vectors.filter((v) => v.namespace === 'eip155');
const DEAD = '0x000000000000000000000000000000000000dEaD' as const;

it('decodes the overload selected by the encoded arguments', () => {
  const abi = parseAbi(['function foo(address x) view returns (bool)', 'function foo(uint256 x) view returns (uint256)']);
  const query = encodeEvmQueryEnvelope({ type: 'contractCall', target: DEAD, abi, functionName: 'foo', args: [42n] }, { blockNumber: 1n });
  expect(decodeReadResult(encodeAbiParameters([{ type: 'uint256' }], [42n]), query.resultShape)).toEqual({ kind: 'evmCall', value: 42n });
});

// The exact tuple shape universalClient/externalchains/evm/read_envelope.go unpacks.
const GO_SHAPE = [
  {
    type: 'tuple',
    components: [
      { name: 'queryType', type: 'uint8' },
      { name: 'blockRef', type: 'tuple', components: [{ name: 'refType', type: 'uint8' }, { name: 'blockNumber', type: 'uint64' }] },
      { name: 'payload', type: 'bytes' },
    ],
  },
] as const;

describe('EVM query envelope', () => {
  it.each(vectors)('golden vector: $name', (v) => {
    const raw = v.query as Record<string, unknown>;
    // JSON cannot carry bigint: a decimal-string slot means "given as bigint"
    const q = (raw['type'] === 'storageSlot' && typeof raw['slot'] === 'string' && !raw['slot'].startsWith('0x')
      ? { ...raw, slot: BigInt(raw['slot']) }
      : raw) as never;
    const out = encodeEvmQueryEnvelope(q, { blockNumber: BigInt(v.blockNumber as string) });
    expect(out.encoded).toBe(v.expectedHex);
    expect(out.namespace).toBe('eip155');
    expect(out.blockRef).toBe(BigInt(v.blockNumber as string));
    expect(out.resultShape.kind).toBe((v.resultShape as { kind: string }).kind);
    // decodes with the validator's own tuple shape
    const [env] = decodeAbiParameters(GO_SHAPE, out.encoded);
    expect(env.blockRef.refType).toBe(0);
    expect(env.blockRef.blockNumber).toBe(BigInt(v.blockNumber as string));
  });

  it('is abi.encode of ONE tuple (0x20 head offset), not three parameters', () => {
    const one = encodeEvmQueryEnvelope({ type: 'accountBalance', target: DEAD }, { blockNumber: 42n }).encoded;
    expect(sliceHex(one, 0, 32)).toBe('0x0000000000000000000000000000000000000000000000000000000000000020');
    const three = encodeAbiParameters(
      [{ type: 'uint8' }, { type: 'tuple', components: [{ type: 'uint8' }, { type: 'uint64' }] }, { type: 'bytes' }],
      [0, [0, 42n], encodeAbiParameters([{ type: 'address' }], [DEAD])],
    );
    expect(one).not.toBe(three);
  });

  it('AccountBalance payload is abi.encode(address) — 32 bytes, not the raw 20', () => {
    const { payload } = decodeEvmQueryEnvelope(
      encodeEvmQueryEnvelope({ type: 'accountBalance', target: DEAD }, { blockNumber: 1n }).encoded,
    );
    expect(payload).toBe('0x000000000000000000000000000000000000000000000000000000000000dead');
    expect(payload.length).toBe(2 + 64);
  });

  it('contractCall with abi encodes the call and records an evmCall result shape', () => {
    const out = encodeEvmQueryEnvelope(
      { type: 'contractCall', target: DEAD, abi: erc20Abi, functionName: 'balanceOf', args: [DEAD] },
      { blockNumber: 7n },
    );
    expect(out.queryType).toBe(EVM_QUERY_TYPE.CONTRACT_CALL);
    expect(out.resultShape).toMatchObject({ kind: 'evmCall', functionName: 'balanceOf' });
    const { payload } = decodeEvmQueryEnvelope(out.encoded);
    const [target, callData] = decodeAbiParameters([{ type: 'address' }, { type: 'bytes' }], payload);
    expect(target.toLowerCase()).toBe(DEAD.toLowerCase());
    expect(callData.slice(0, 10)).toBe('0x70a08231'); // balanceOf(address)
  });

  it('rejects a non-view function', () => {
    expect(() =>
      encodeEvmQueryEnvelope(
        { type: 'contractCall', target: DEAD, abi: erc20Abi, functionName: 'transfer', args: [DEAD, 1n] },
        { blockNumber: 1n },
      ),
    ).toThrow(InvalidReadQueryError);
  });

  it('rejects an unknown function and a bad target', () => {
    expect(() =>
      encodeEvmQueryEnvelope({ type: 'contractCall', target: DEAD, abi: erc20Abi, functionName: 'nope' }, { blockNumber: 1n }),
    ).toThrow(InvalidReadQueryError);
    expect(() => encodeEvmQueryEnvelope({ type: 'accountBalance', target: '0x1234' as never }, { blockNumber: 1n })).toThrow(
      InvalidReadQueryError,
    );
  });

  it('normalises storage slots given as bigint or short hex to bytes32', () => {
    const five = '0x0000000000000000000000000000000000000000000000000000000000000005';
    expect(toStorageSlot(5n)).toBe(five);
    expect(toStorageSlot('0x05')).toBe(five);
    expect(toStorageSlot(keccak256('0x00'))).toBe(keccak256('0x00'));
    expect(() => toStorageSlot(('0x' + 'ff'.repeat(33)) as never)).toThrow(InvalidReadQueryError);
  });

  it('rejects an out-of-range blockNumber', () => {
    expect(() => encodeEvmQueryEnvelope({ type: 'accountBalance', target: DEAD }, { blockNumber: 1n << 64n })).toThrow(
      InvalidReadQueryError,
    );
  });
});

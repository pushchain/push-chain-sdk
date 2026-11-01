import {
  decodeAbiParameters,
  encodeAbiParameters,
  parseAbi,
  parseAbiParameters,
  zeroAddress,
  zeroHash,
} from 'viem';
import {
  buildJobSpec,
  buildJobSpecTemplate,
  decodeJobSpec,
  encodeJobSpec,
} from '../codec';
import { prepareJobRead } from '../read';
import { PRINCIPAL } from '../constants';
import { JOB_SPEC_PARAM } from '../schema';
import { resolveJobSpec, specOrigin } from '../helpers';
import type { LogicTree } from '../types';
const address = '0x1111111111111111111111111111111111111111';
const abi = parseAbi(['function balanceOf(address) view returns (uint256)']);
const read = () =>
  prepareJobRead({
    chain: 'eip155:11155111',
    target: address,
    abi,
    functionName: 'balanceOf',
    args: [address],
  });
const check = {
  read: 0,
  evaluation: 'COMPARE' as const,
  operation: 'GREATER_OR_EQUAL' as const,
  target: BigInt(9),
};
const spec = () =>
  buildJobSpec({
    reads: [read()],
    checks: [check],
    logic: 'ALL',
    executeBy: 1800000000,
    failFinalAt: 1800003600,
  });

it('prepares exact selectors, binary output codes and literal zero arguments without inventing holes', () => {
  const p = prepareJobRead({
    chain: 'eip155:11155111',
    target: address,
    abi,
    functionName: 'balanceOf',
    args: [zeroAddress],
  });
  expect(p.selector).toBe('0x70a08231');
  expect(p.outputs).toBe('0x080101');
  expect(p.fills).toBeUndefined();
});
it('preserves WALLET/PARAM positions and resolves them independently of literal zeros', () => {
  const r = prepareJobRead({
    chain: 'eip155:11155111',
    target: address,
    abi: parseAbi([
      'function quote(address,uint256,uint256) view returns (uint256)',
    ]),
    functionName: 'quote',
    args: ['agentic:wallet', { param: 0 }, BigInt(0)],
  });
  expect(r.fills).toEqual([
    { word: 0, source: 'WALLET' },
    { word: 1, source: 'PARAM', param: 0 },
  ]);
  const t = buildJobSpecTemplate({
    reads: [r],
    checks: [{ ...check, target: PRINCIPAL }],
    logic: 'ALL',
    params: [{ min: BigInt(1), max: BigInt(20) }],
  });
  const resolved = resolveJobSpec(t, {
    principal: BigInt(50),
    params: [BigInt(7)],
    accounts: { 'eip155:11155111': address },
    origin: zeroHash,
    executeBy: 1800000000,
    settleWindow: 3600,
  });
  expect(
    decodeAbiParameters(
      parseAbiParameters('address,uint256,uint256'),
      resolved.reads[0].args
    )
  ).toEqual([address, BigInt(7), BigInt(0)]);
  expect(resolved.checks[0].target).toBe(BigInt(50));
  expect(t.reads[0].args).not.toBe(resolved.reads[0].args);
});
it('encodes the deployed field and enum order and roundtrips a complete spec canonically', () => {
  const bytes = encodeJobSpec(spec());
  const w = decodeAbiParameters([JOB_SPEC_PARAM], bytes)[0];
  expect(w.allowedMutability).toBe(0);
  expect(w.logic[0].kind).toBe(0);
  expect(w.origin).toBe(zeroHash);
  expect(w.executeBy).toBe(BigInt(1800000000));
  expect(encodeJobSpec(decodeJobSpec(bytes))).toBe(bytes);
});
it('roundtrips templates including principal-BPS targets and bounds', () => {
  const t = buildJobSpecTemplate({
    reads: [read()],
    checks: [{ ...check, target: { principalBps: BigInt(9999) } }],
    logic: { kind: 'AT_LEAST', k: 1, of: [0] },
  });
  const bytes = encodeJobSpec(t);
  expect(encodeJobSpec(decodeJobSpec(bytes, { format: 'template' }))).toBe(
    bytes
  );
});
it('keeps a valid non-DFS topological logic order when decoding unchanged signed bytes', () => {
  const w = decodeAbiParameters([JOB_SPEC_PARAM], encodeJobSpec(spec()))[0];
  const bytes = encodeAbiParameters(
    [JOB_SPEC_PARAM],
    [
      {
        ...w,
        logic: [
          { kind: 0, checks: [], children: [2, 1], k: 0 },
          { kind: 1, checks: [0], children: [], k: 0 },
          { kind: 0, checks: [0], children: [], k: 0 },
        ],
      },
    ]
  );
  expect(encodeJobSpec(decodeJobSpec(bytes))).toBe(bytes);
});
it('rejects cycles, invalid indexes and unsupported template holes before encoding', () => {
  const tree: LogicTree = { kind: 'ALL', of: [] };
  tree.of.push(tree);
  expect(() =>
    buildJobSpec({
      reads: [read()],
      checks: [check],
      logic: tree,
      executeBy: 1,
      failFinalAt: 2,
    })
  ).toThrow(/cyclic/);
  expect(() =>
    buildJobSpec({
      reads: [read()],
      checks: [{ ...check, read: 2 }],
      logic: 'ALL',
      executeBy: 1,
      failFinalAt: 2,
    })
  ).toThrow(/index/);
  expect(() =>
    prepareJobRead({
      chain: 'eip155:1',
      target: address,
      abi: parseAbi(['function x(address[]) view returns (uint256)']),
      functionName: 'x',
      args: [['agentic:wallet']],
    })
  ).toThrow();
});
it('rejects malformed enums, trailing bytes, foreign wire and filled format ambiguity', () => {
  const bytes = encodeJobSpec(spec());
  const w = decodeAbiParameters([JOB_SPEC_PARAM], bytes)[0];
  expect(() => decodeJobSpec((bytes + '00') as `0x${string}`)).toThrow(
    /canonical/
  );
  expect(() =>
    decodeJobSpec(
      encodeAbiParameters([JOB_SPEC_PARAM], [{ ...w, allowedMutability: 9 }])
    )
  ).toThrow();
  const foreign = encodeAbiParameters(
    parseAbiParameters('(uint64,uint64,bytes[],bytes[],bytes[],uint8,bytes32)'),
    [[BigInt(1), BigInt(2), [], [], [], 1, zeroHash]]
  );
  expect(() => decodeJobSpec(foreign)).toThrow();
});
it('binds origin to marketplace, integer card version and principal with ABI words', () => {
  const expected =
    '0x' +
    address.slice(2).padStart(64, '0') +
    [BigInt(1), BigInt(2), BigInt(3)]
      .map((n) => n.toString(16).padStart(64, '0'))
      .join('');
  const { keccak256 } = jest.requireActual('viem');
  expect(specOrigin(address, BigInt(1), BigInt(2), BigInt(3))).toBe(
    keccak256(expected)
  );
});

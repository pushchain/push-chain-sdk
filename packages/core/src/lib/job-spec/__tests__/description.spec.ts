import { parseAbi } from 'viem';
import { prepareJobRead, jobReadOptions } from '../read';
import { buildJobSpec } from '../codec';
import { describeJobSpec } from '../helpers';
const token = '0x1111111111111111111111111111111111111111';
const make = () =>
  buildJobSpec({
    reads: [
      prepareJobRead({
        chain: 'eip155:97',
        target: token,
        abi: parseAbi(['function totalSupply() view returns (uint256)']),
        functionName: 'totalSupply',
      }),
    ],
    checks: [
      {
        read: 0,
        evaluation: 'COMPARE',
        operation: 'GREATER_OR_EQUAL',
        target: BigInt(499950000),
      },
    ],
    logic: 'ALL',
    executeBy: 1800000000,
    failFinalAt: 1800000060,
  });
it('retains ABI names and formats decimal targets without hiding their raw units', () => {
  expect(
    describeJobSpec(make(), { decimals: { [token]: 6 } }).checks[0]
  ).toContain('totalSupply');
  expect(
    describeJobSpec(make(), { decimals: { [token]: 6 } }).checks[0]
  ).toContain('499.95 (499950000 raw units; 6 decimals)');
  expect(() =>
    describeJobSpec(make(), { decimals: { [token]: -1 } })
  ).toThrow();
});
it('labels signed percentage targets in percentage and basis points', () => {
  const spec = make();
  spec.checks[0].evaluation = 'PERCENTAGE';
  spec.checks[0].target = BigInt(-250);
  expect(describeJobSpec(spec).checks[0]).toContain('-2.5% (-250 bps)');
});
it('maps a resolved prepared read to the paid call and refuses unfilled markers before sending', () => {
  const read = make().reads[0];
  expect(jobReadOptions(read)).toMatchObject({
    chain: 'eip155:97',
    callData: read.selector,
  });
  const hole = prepareJobRead({
    chain: 'eip155:97',
    target: token,
    abi: parseAbi(['function balanceOf(address) view returns (uint256)']),
    functionName: 'balanceOf',
    args: ['agentic:wallet'],
  });
  expect(() => jobReadOptions(hole)).toThrow(
    expect.objectContaining({ code: 'UNFILLED_PLACEHOLDER' })
  );
  expect(() => jobReadOptions({ ...read, outputs: '0x080101f' })).toThrow();
});

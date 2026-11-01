import {
  decodeAbiParameters,
  getAbiItem,
  toFunctionSelector,
  zeroAddress,
} from 'viem';
import { JOB_KERNEL_ABI } from '../contracts/AgenticCommerce';
import { decodeCreateJob, encodeCreateJob } from '../kernel-wire';
it('preserves arbitrary binary JobSpec bytes in the Solidity string slot with its original selector', () => {
  const bytes = '0xff00c0af8081';
  const data = encodeCreateJob(
    zeroAddress,
    zeroAddress,
    1900000000,
    { jobSpec: bytes },
    zeroAddress
  );
  expect(data.slice(0, 10)).toBe(
    toFunctionSelector(getAbiItem({ abi: JOB_KERNEL_ABI, name: 'createJob' }))
  );
  expect(decodeCreateJob(data).description).toBe(bytes);
  const decoded = decodeAbiParameters(
    [
      { type: 'address' },
      { type: 'address' },
      { type: 'uint256' },
      { type: 'bytes' },
      { type: 'address' },
    ],
    ('0x' + data.slice(10)) as `0x${string}`
  );
  expect(decoded[3]).toBe(bytes);
});
it('supports plain UTF-8 descriptions but refuses conflicting carriers', () => {
  expect(
    decodeCreateJob(
      encodeCreateJob(
        zeroAddress,
        zeroAddress,
        1,
        { description: 'plain job' },
        zeroAddress
      )
    ).description
  ).toBe('0x706c61696e206a6f62');
  expect(() =>
    encodeCreateJob(
      zeroAddress,
      zeroAddress,
      1,
      { jobSpec: '0x00', description: 'x' },
      zeroAddress
    )
  ).toThrow();
});

import {
  decodeAbiParameters,
  encodeAbiParameters,
  getAbiItem,
  stringToHex,
  toFunctionSelector,
  type Abi,
  type AbiParameter,
  type Address,
  type Hex,
} from 'viem';
import { JOB_KERNEL_ABI } from './contracts/AgenticCommerce';
import { JobError } from './errors';
const create = getAbiItem({ abi: JOB_KERNEL_ABI, name: 'createJob' });
export const CREATE_JOB_SELECTOR = toFunctionSelector(create);
const inputs = create.inputs.map((p) =>
  p.name === 'description' ? { ...p, type: 'bytes' } : p
) as readonly AbiParameter[];
/** Solidity string(description) carries arbitrary ABI bytes, not UTF-8 text. */
export const KERNEL_READ_ABI: Abi = JOB_KERNEL_ABI.map((item) =>
  item.type === 'function' && item.name === 'getJob'
    ? {
        ...item,
        outputs: item.outputs.map((p) => ({
          ...p,
          components: p.components.map((c) =>
            c.name === 'description' ? { ...c, type: 'bytes' as const } : c
          ),
        })),
      }
    : item
);
export function encodeCreateJob(
  provider: Address,
  evaluator: Address,
  expiredAt: number,
  payload: { jobSpec?: Hex; description?: string },
  hook: Address
): Hex {
  if (payload.jobSpec && payload.description !== undefined)
    throw new JobError('INVALID_JOB', 'Use jobSpec or description, not both.');
  const bytes = payload.jobSpec ?? stringToHex(payload.description ?? '');
  return (CREATE_JOB_SELECTOR +
    encodeAbiParameters(inputs, [
      provider,
      evaluator,
      BigInt(expiredAt),
      bytes,
      hook,
    ]).slice(2)) as Hex;
}
export function decodeCreateJob(data: Hex): {
  provider: Address;
  evaluator: Address;
  expiredAt: bigint;
  description: Hex;
  hook: Address;
} {
  if (data.slice(0, 10).toLowerCase() !== CREATE_JOB_SELECTOR)
    throw new JobError(
      'INVALID_JOB',
      'Expected the deployed kernel createJob selector.'
    );
  const [provider, evaluator, expiredAt, description, hook] =
    decodeAbiParameters(inputs, ('0x' + data.slice(10)) as Hex) as [
      Address,
      Address,
      bigint,
      Hex,
      Address
    ];
  return { provider, evaluator, expiredAt, description, hook };
}

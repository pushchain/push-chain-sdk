import {
  getAddress,
  isAddress,
  parseAbi,
  zeroAddress,
  type Address,
} from 'viem';
import { UNIVERSAL_CORE_EVM } from '../../constants/abi/prc20.evm';
import { AGENTIC_ERROR_CODE, AgenticError } from '../errors';
import type { Snapshot } from '../reads/snapshot';

export const PRC20_SOURCE_ABI = parseAbi([
  'function SOURCE_CHAIN_NAMESPACE() view returns (string)',
  'function SOURCE_TOKEN_ADDRESS() view returns (string)',
]);
const NATIVE_SOURCE_ABI = parseAbi([
  'function SOURCE_TOKEN_ADDRESS() view returns (address)',
]);
export const CORE_ADDRESS =
  '0x00000000000000000000000000000000000000C0' as Address;
export async function readGasPrc20(
  snap: Snapshot,
  chain: string
): Promise<Address> {
  return getAddress(
    await snap.read<Address>(
      CORE_ADDRESS,
      UNIVERSAL_CORE_EVM,
      'gasTokenPRC20ByChainNamespace',
      [chain]
    )
  );
}
/** Donut native precompile returns a zero word; ERC20 metadata is a dynamic string. */
export async function readOriginToken(
  snap: Snapshot,
  token: Address,
  chain: string
): Promise<Address> {
  let source: string;
  try {
    source = await snap.read<string>(
      token,
      PRC20_SOURCE_ABI,
      'SOURCE_TOKEN_ADDRESS'
    );
  } catch (cause) {
    if ((await readGasPrc20(snap, chain)) !== getAddress(token)) throw cause;
    const native = await snap.read<Address>(
      token,
      NATIVE_SOURCE_ABI,
      'SOURCE_TOKEN_ADDRESS'
    );
    if (getAddress(native) === zeroAddress) return zeroAddress;
    throw cause;
  }
  if (isAddress(source, { strict: false })) return getAddress(source);
  if (source === '' && (await readGasPrc20(snap, chain)) === getAddress(token))
    return zeroAddress;
  throw new AgenticError(
    AGENTIC_ERROR_CODE.RULE_READ_FAILED,
    `PRC20 ${token} has an invalid source token address`
  );
}

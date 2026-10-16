import {
  getAddress,
  isAddress,
  parseAbi,
  zeroAddress,
  type Address,
  type Hex,
} from 'viem';
import { UNIVERSAL_CORE_EVM } from '../../constants/abi/prc20.evm';
import { AGENTIC_ERROR_CODE, AgenticError } from '../errors';
import type { Snapshot } from '../reads/snapshot';
import { CHAIN, PUSH_NETWORK } from '../../constants/enums';
import { MOVEABLE_TOKENS } from '../../constants/tokens';
import { getPRC20Address } from '../../universal/prc20-address';
import { svmKey } from '../codec/svm-accounts';

export const PRC20_SOURCE_ABI = parseAbi([
  'function SOURCE_CHAIN_NAMESPACE() view returns (string)',
  'function SOURCE_TOKEN_ADDRESS() view returns (string)',
]);
const NATIVE_SOURCE_ABI = parseAbi([
  'function SOURCE_TOKEN_ADDRESS() view returns (address)',
]);
const SVM_SOURCE_WORD_ABI = parseAbi([
  'function SOURCE_TOKEN_ADDRESS() view returns (bytes32)',
]);

/** Resolve the SVM source mint from metadata or the current chain-specific token registry. */
export async function readSvmSourceToken(
  snap: Snapshot,
  token: Address,
  chain: string,
  network: PUSH_NETWORK = PUSH_NETWORK.TESTNET_DONUT
): Promise<Hex> {
  let source: string;
  try {
    source = await snap.read<string>(
      token,
      PRC20_SOURCE_ABI,
      'SOURCE_TOKEN_ADDRESS'
    );
  } catch (cause) {
    try {
      source = await snap.read<Hex>(
        token,
        SVM_SOURCE_WORD_ABI,
        'SOURCE_TOKEN_ADDRESS'
      );
    } catch {
      throw cause;
    }
  }
  const zeroKey = `0x${'00'.repeat(32)}` as Hex;
  if (
    source === '' ||
    source.toLowerCase() === zeroAddress ||
    source.toLowerCase() === zeroKey
  ) {
    if (getAddress(token) === (await readGasPrc20(snap, chain))) return zeroKey;
    // Current Donut SVM synthetic metadata exposes a zero word for SPL assets.
    // Ordinary Route 2 already resolves these through the same token registry.
    // Match both full origin chain and exact PRC20; never infer an unknown mint.
    for (const asset of MOVEABLE_TOKENS[chain as CHAIN] ?? []) {
      if (asset.mechanism === 'native') continue;
      try {
        const resolved = getPRC20Address(
          { chain, address: asset.address },
          { network }
        );
        if (getAddress(resolved.address) === getAddress(token))
          return svmKey(asset.address);
      } catch {
        // A token without a deployment in this network is not a candidate.
      }
    }
    throw new AgenticError(
      AGENTIC_ERROR_CODE.INVALID_RULE,
      `source mint unavailable for PRC20 ${token} on ${chain}; no registered mapping matches`
    );
  }
  return svmKey(source);
}
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

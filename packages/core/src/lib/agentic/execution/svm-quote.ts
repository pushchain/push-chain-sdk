import { PublicKey } from '@solana/web3.js';
import { getAddress, hexToBytes, type Address } from 'viem';
import type { CHAIN } from '../../constants/enums';
import {
  PRC20_SOURCE_ABI,
  readGasPrc20,
  readSvmSourceToken,
} from '../contracts/prc20-metadata';
import type { AgenticRuntime } from '../runtime';
import type { Snapshot } from '../reads/snapshot';
import { AGENTIC_ERROR_CODE, AgenticError } from '../errors';

/** Route/fee validation, independent of the selected rule's permissions. */
export async function quoteSvmRequest(
  runtime: AgenticRuntime,
  snap: Snapshot,
  wallet: Address,
  token: Address,
  chain: CHAIN,
  gasLimit: bigint,
  amount: bigint
) {
  if (
    (await snap.read<string>(
      token,
      PRC20_SOURCE_ABI,
      'SOURCE_CHAIN_NAMESPACE'
    )) !== chain
  ) {
    throw new AgenticError(
      AGENTIC_ERROR_CODE.ASSET_CHAIN_MISMATCH,
      'outbound asset belongs to another chain'
    );
  }
  const isNative =
    getAddress(token) === getAddress(await readGasPrc20(snap, chain));
  const splMintBase58 =
    !isNative && amount > BigInt(0)
      ? new PublicKey(
          hexToBytes(
            await readSvmSourceToken(snap, token, chain, runtime.network)
          )
        ).toBase58()
      : undefined;
  const quote = await runtime.quoteOutbound(token, gasLimit, chain, {
    wallet,
    splMintBase58,
    burnAmount: amount,
  });
  return { ...quote, isNative };
}

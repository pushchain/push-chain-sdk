/**
 * Conditional CEA-ATA rent bump for SVM SPL outbounds.
 *
 * The gateway program (svm-gateway) computes per-tx fees with a conditional
 * rent for first-time SPL transfers — see `calculateSplExecuteFees` in
 * `push-chain-gateway-contracts/contracts/svm-gateway/tests/helpers/test-utils.ts`:
 *
 *   const ataExists = await ceaAtaExists(connection, ceaAta);
 *   const ceaAtaRent = ataExists ? 0n : BigInt(getMinimumBalanceForRentExemption(165));
 *   gasFee = executedTxRent + ceaAtaRent + COMPUTE_BUFFER;
 *
 * The gateway's on-chain `getOutboundTxGasAndFees` quote does NOT factor in
 * the ATA rent today, so the SDK has to bump `effectiveGasLimit` itself
 * before calling that quote. Native-SOL outbounds use `calculateSolExecuteFees`
 * which has no conditional rent, so no SDK bump is needed there.
 */
import { Connection, PublicKey } from '@solana/web3.js';
import { Buffer } from 'buffer';
import type { OrchestratorContext } from './context';
import { printLog } from './context';
import type { CHAIN as ChainType } from '../../constants/enums';
import { CHAIN_INFO } from '../../constants/chain';

// ---------------------------------------------------------------------------
// Constants — mirror gateway test-utils.ts. These are SOL protocol values;
// they only change if Solana itself adjusts rent rates (effectively never).
// ---------------------------------------------------------------------------

/** ATA rent (165-byte SPL token account) + executed-tx rent (8-byte) + compute buffer.
 *  Mirrors getMinimumBalanceForRentExemption(165) ≈ 2_039_280
 *       + getMinimumBalanceForRentExemption(8) ≈ 9_200
 *       + COMPUTE_BUFFER 100_000.
 *  Signature fee (5_000) is already included in the gateway's base quote. */
export const CEA_ATA_RENT_LAMPORTS_BUMP = BigInt(2_148_480);

/** SVM gateway program ID (matches CHAIN_INFO[SOLANA_DEVNET].lockerContract). */
const SVM_GATEWAY_PROGRAM = new PublicKey(
  'CFVSincHYbETh2k7w6u1ENEkjbSLtveRCEBupKidw2VS'
);

const TOKEN_PROGRAM_ID = new PublicKey(
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
);

const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'
);

// ---------------------------------------------------------------------------
// PDA derivations
// ---------------------------------------------------------------------------

/** Derive CEA PDA from a 20-byte EVM address. Seeds: ["push_identity", evmBytes]. */
export function deriveSvmCeaPda(evmAddress: `0x${string}`): PublicKey {
  const senderBytes = Buffer.from(evmAddress.slice(2), 'hex');
  const [ceaPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('push_identity'), senderBytes],
    SVM_GATEWAY_PROGRAM
  );
  return ceaPda;
}

/** Derive a standard SPL Associated Token Account address. */
export function deriveAtaPubkey(owner: PublicKey, mint: PublicKey): PublicKey {
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  return ata;
}

// ---------------------------------------------------------------------------
// Public helper
// ---------------------------------------------------------------------------

export interface MaybeBumpInput {
  ctx: OrchestratorContext;
  ueaAddress: `0x${string}`;
  targetChain: ChainType;
  /** SPL mint as base58 (from MoveableToken.address for SVM tokens). undefined ⇒ no SPL. */
  splMintBase58: string | undefined;
  /** Burn amount in token units. 0 ⇒ no SPL transferFrom ⇒ no ATA needed. */
  burnAmount: bigint;
  effectiveGasLimit: bigint;
}

/**
 * Returns the (possibly bumped) effectiveGasLimit. Logs the decision via
 * printLog. On any RPC failure or invalid input, logs a warning and returns
 * the input unchanged — better to risk one underflow than to block all SPL
 * outbounds on RPC flake; pre-flight will surface insufficient gas anyway.
 */
export async function maybeBumpForCeaAtaRent(
  input: MaybeBumpInput
): Promise<bigint> {
  const {
    ctx,
    ueaAddress,
    targetChain,
    splMintBase58,
    burnAmount,
    effectiveGasLimit,
  } = input;

  // Only applies to SPL outbounds. Native SOL outbounds use the gateway's
  // calculateSolExecuteFees which has no ATA conditional.
  if (!splMintBase58 || burnAmount === BigInt(0)) {
    return effectiveGasLimit;
  }

  const rpcUrl =
    ctx.rpcUrls?.[targetChain]?.[0] ??
    CHAIN_INFO[targetChain]?.defaultRPC?.[0];
  if (!rpcUrl) {
    printLog(
      ctx,
      `maybeBumpForCeaAtaRent — no Solana RPC URL for ${targetChain}; skipping rent bump`
    );
    return effectiveGasLimit;
  }

  try {
    const ceaPda = deriveSvmCeaPda(ueaAddress);
    const splMint = new PublicKey(splMintBase58);
    const ceaAta = deriveAtaPubkey(ceaPda, splMint);
    const conn = new Connection(rpcUrl, 'confirmed');
    const info = await conn.getAccountInfo(ceaAta);
    const ataExists = info !== null && info.data.length > 0;

    if (!ataExists) {
      const bumped = effectiveGasLimit + CEA_ATA_RENT_LAMPORTS_BUMP;
      printLog(
        ctx,
        `maybeBumpForCeaAtaRent — CEA ATA ${ceaAta.toBase58()} not deployed on ${targetChain}; ` +
          `bumping effectiveGasLimit ${effectiveGasLimit} → ${bumped} ` +
          `(+${CEA_ATA_RENT_LAMPORTS_BUMP} lamports for ATA rent + exec rent + compute buffer)`
      );
      return bumped;
    }

    printLog(
      ctx,
      `maybeBumpForCeaAtaRent — CEA ATA ${ceaAta.toBase58()} already deployed on ${targetChain}; no rent bump`
    );
    return effectiveGasLimit;
  } catch (err) {
    printLog(
      ctx,
      `maybeBumpForCeaAtaRent — RPC error querying CEA ATA on ${targetChain}: ` +
        `${err instanceof Error ? err.message : String(err)}; proceeding without bump`
    );
    return effectiveGasLimit;
  }
}

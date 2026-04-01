/**
 * Gateway interaction: request conversion, tx sending, and fee locking.
 * All chains use V1 gateway ABI.
 */

import { bs58 } from '../../internal/bs58';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import { Abi, hexToBytes, stringToBytes } from 'viem';
import {
  SVM_GATEWAY_IDL,
  UNIVERSAL_GATEWAY_V1_SEND,
} from '../../constants/abi';
import { CHAIN_INFO, SVM_PYTH_PRICE_FEED } from '../../constants/chain';
import { CHAIN, VM } from '../../constants/enums';
import { PriceFetch } from '../../price-fetch/price-fetch';
import { Utils } from '../../utils';
import { EvmClient } from '../../vm-client/evm-client';
import { SUPPORTED_GATEWAY_CHAINS } from './helpers';
import { SvmClient } from '../../vm-client/svm-client';
import type { UniversalPayload } from '../../generated/v1/tx';
import type {
  UniversalTxRequest,
  UniversalTxRequestV1,
  UniversalTokenTxRequest,
  UniversalTokenTxRequestV1,
} from '../orchestrator.types';
import type { UniversalSigner } from '../../universal/universal.types';
import type { OrchestratorContext } from './context';
import { printLog } from './context';
import { buildSvmUniversalTxRequestFromReq } from './svm-helpers';
import { getSvmProtocolFee } from './svm-helpers';

// ============================================================================
// ABI
// ============================================================================

const GATEWAY_ABI = UNIVERSAL_GATEWAY_V1_SEND as unknown as Abi;

// ============================================================================
// Request Conversion (V0 struct → V1 flat format)
// ============================================================================

export function toGatewayRequestV1(req: UniversalTxRequest): UniversalTxRequestV1 {
  return {
    recipient: req.recipient,
    token: req.token,
    amount: req.amount,
    payload: req.payload,
    revertRecipient: req.revertInstruction.fundRecipient,
    signatureData: req.signatureData,
  };
}

export function toGatewayTokenRequestV1(req: UniversalTokenTxRequest): UniversalTokenTxRequestV1 {
  return {
    recipient: req.recipient,
    token: req.token,
    amount: req.amount,
    gasToken: req.gasToken,
    gasAmount: req.gasAmount,
    payload: req.payload,
    revertRecipient: req.revertInstruction.fundRecipient,
    signatureData: req.signatureData,
    amountOutMinETH: req.amountOutMinETH,
    deadline: req.deadline,
  };
}

// ============================================================================
// Send Gateway Tx (V1 only)
// ============================================================================

export async function sendGatewayTxWithFallback(
  ctx: OrchestratorContext,
  evmClient: EvmClient,
  address: `0x${string}`,
  req: UniversalTxRequest,
  signer: UniversalSigner,
  value: bigint
): Promise<`0x${string}`> {
  return evmClient.writeContract({
    abi: GATEWAY_ABI,
    address,
    functionName: 'sendUniversalTx',
    args: [toGatewayRequestV1(req)],
    signer,
    value,
  });
}

export async function sendGatewayTokenTxWithFallback(
  ctx: OrchestratorContext,
  evmClient: EvmClient,
  address: `0x${string}`,
  req: UniversalTokenTxRequest,
  signer: UniversalSigner,
  value?: bigint
): Promise<`0x${string}`> {
  return evmClient.writeContract({
    abi: GATEWAY_ABI,
    address,
    functionName: 'sendUniversalTx',
    args: [toGatewayTokenRequestV1(req)],
    signer,
    ...(value !== undefined && { value }),
  });
}

// ============================================================================
// Fee Locking
// ============================================================================

export async function lockFee(
  ctx: OrchestratorContext,
  amount: bigint,
  universalPayload: UniversalPayload,
  req: UniversalTxRequest
): Promise<Uint8Array> {
  const chain = ctx.universalSigner.account.chain;
  const { lockerContract, vm, defaultRPC } = CHAIN_INFO[chain];

  if (!lockerContract) {
    throw new Error(`Locker contract not configured for chain: ${chain}`);
  }

  const rpcUrls: string[] = ctx.rpcUrls[chain] || defaultRPC;

  switch (vm) {
    case VM.EVM: {
      const [nativeTokenUsdPrice, evmClient] = await Promise.all([
        new PriceFetch(ctx.rpcUrls).getPrice(chain),
        Promise.resolve(new EvmClient({ rpcUrls })),
      ]);

      const nativeDecimals = 18;
      const oneUsd = Utils.helpers.parseUnits('1', 8);
      const tenUsd = Utils.helpers.parseUnits('10', 8);
      let depositUsd = amount < oneUsd ? oneUsd : amount;
      if (depositUsd > tenUsd) depositUsd = tenUsd;
      let nativeAmount =
        (depositUsd * BigInt(10 ** nativeDecimals) +
          (nativeTokenUsdPrice - BigInt(1))) /
        nativeTokenUsdPrice;
      nativeAmount = nativeAmount + BigInt(1);

      const txHash: `0x${string}` = await sendGatewayTxWithFallback(
        ctx,
        evmClient,
        lockerContract as `0x${string}`,
        req,
        ctx.universalSigner,
        nativeAmount,
      );
      return hexToBytes(txHash);
    }

    case VM.SVM: {
      const [nativeTokenUsdPrice, svmClient] = await Promise.all([
        new PriceFetch(ctx.rpcUrls).getPrice(chain),
        Promise.resolve(new SvmClient({ rpcUrls })),
      ]);
      const nativeDecimals = 9;
      const oneUsd = Utils.helpers.parseUnits('1', 8);
      const tenUsd = Utils.helpers.parseUnits('10', 8);
      let depositUsd = amount < oneUsd ? oneUsd : amount;
      if (depositUsd > tenUsd) depositUsd = tenUsd;
      let nativeAmount =
        (depositUsd * BigInt(10 ** nativeDecimals) +
          (nativeTokenUsdPrice - BigInt(1))) /
        nativeTokenUsdPrice;
      nativeAmount = nativeAmount + BigInt(1);

      const programId = new PublicKey(SVM_GATEWAY_IDL.address);
      const [configPda] = PublicKey.findProgramAddressSync(
        [stringToBytes('config')],
        programId
      );
      const [vaultPda] = PublicKey.findProgramAddressSync(
        [stringToBytes('vault')],
        programId
      );
      const [rateLimitConfigPda] = PublicKey.findProgramAddressSync(
        [stringToBytes('rate_limit_config')],
        programId
      );
      const [tokenRateLimitPda] = PublicKey.findProgramAddressSync(
        [stringToBytes('rate_limit'), PublicKey.default.toBuffer()],
        programId
      );

      const userPk = new PublicKey(ctx.universalSigner.account.address);
      const { feeVaultPda, protocolFeeLamports } =
        await getSvmProtocolFee(svmClient, programId);

      const gasReq = buildSvmUniversalTxRequestFromReq(req, userPk);

      try {
        const txHash = await svmClient.writeContract({
          abi: SVM_GATEWAY_IDL,
          address: programId.toBase58(),
          functionName: 'sendUniversalTx',
          args: [gasReq, nativeAmount + protocolFeeLamports],
          signer: ctx.universalSigner,
          accounts: {
            config: configPda,
            vault: vaultPda,
            feeVault: feeVaultPda,
            userTokenAccount: vaultPda,
            gatewayTokenAccount: vaultPda,
            user: userPk,
            priceUpdate: new PublicKey(SVM_PYTH_PRICE_FEED),
            rateLimitConfig: rateLimitConfigPda,
            tokenRateLimit: tokenRateLimitPda,
            tokenProgram: new PublicKey(
              'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
            ),
            systemProgram: SystemProgram.programId,
          },
        });
        return new Uint8Array(bs58.decode(txHash));
      } catch (error) {
        printLog(ctx, `Error sending UniversalTx: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
      }
    }

    default:
      throw new Error(`Unsupported VM type: ${vm}`);
  }
}

// ============================================================================
// Origin Gateway Context
// ============================================================================

/**
 * Creates an EVM client for the origin chain's gateway.
 * Validates that the chain supports gateway operations.
 */
export function getOriginGatewayContext(ctx: OrchestratorContext): {
  chain: CHAIN;
  evmClient?: EvmClient;
  gatewayAddress?: `0x${string}`;
} {
  const chain = ctx.universalSigner.account.chain;
  if (!SUPPORTED_GATEWAY_CHAINS.includes(chain)) {
    throw new Error(
      'Funds + payload bridging is only supported on Ethereum Sepolia, Arbitrum Sepolia, Base Sepolia, BNB Testnet, and Solana Devnet for now'
    );
  }

  if (CHAIN_INFO[chain].vm === VM.EVM) {
    const { defaultRPC, lockerContract } = CHAIN_INFO[chain];
    const rpcUrls: string[] = ctx.rpcUrls[chain] || defaultRPC;
    const evmClient = new EvmClient({ rpcUrls });
    const gatewayAddress = lockerContract as `0x${string}`;
    if (!gatewayAddress) {
      throw new Error('Universal Gateway address not configured');
    }
    return { chain, evmClient, gatewayAddress };
  }

  // SVM path does not require evmClient/gatewayAddress
  return { chain };
}

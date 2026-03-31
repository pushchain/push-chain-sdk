/**
 * Gateway V0/V1 fallback logic, request conversion, and fee locking — extracted from Orchestrator.
 */

import { utils } from '@coral-xyz/anchor';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import { Abi, hexToBytes, stringToBytes } from 'viem';
import {
  SVM_GATEWAY_IDL,
  UNIVERSAL_GATEWAY_V0,
  UNIVERSAL_GATEWAY_V1_SEND,
} from '../../constants/abi';
import { CHAIN_INFO } from '../../constants/chain';
import { CHAIN, VM } from '../../constants/enums';
import { PriceFetch } from '../../price-fetch/price-fetch';
import { Utils } from '../../utils';
import { EvmClient } from '../../vm-client/evm-client';
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
// Version Detection
// ============================================================================

export function getGatewayVersion(ctx: OrchestratorContext): 'v0' | 'v1' {
  const chain = ctx.universalSigner.account.chain;
  const cached = ctx.gatewayVersionCache.get(chain);
  if (cached) return cached;
  return CHAIN_INFO[chain].gatewayVersion ?? 'v0';
}

export function isV1Gateway(ctx: OrchestratorContext): boolean {
  return getGatewayVersion(ctx) === 'v1';
}

// ============================================================================
// ABI Selection
// ============================================================================

export function getGatewayAbiForVersion(version: 'v0' | 'v1'): unknown[] {
  return version === 'v1'
    ? (UNIVERSAL_GATEWAY_V1_SEND as unknown as unknown[])
    : (UNIVERSAL_GATEWAY_V0 as unknown as unknown[]);
}

export function getGatewayAbi(ctx: OrchestratorContext): unknown[] {
  return getGatewayAbiForVersion(getGatewayVersion(ctx));
}

// ============================================================================
// Request Conversion (V0 → V1)
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

export function toGatewayRequest(
  ctx: OrchestratorContext,
  req: UniversalTxRequest
): UniversalTxRequest | UniversalTxRequestV1 {
  if (!isV1Gateway(ctx)) return req;
  return toGatewayRequestV1(req);
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

export function toGatewayTokenRequest(
  ctx: OrchestratorContext,
  req: UniversalTokenTxRequest
): UniversalTokenTxRequest | UniversalTokenTxRequestV1 {
  if (!isV1Gateway(ctx)) return req;
  return toGatewayTokenRequestV1(req);
}

// ============================================================================
// Send with V1→V0 Fallback
// ============================================================================

export async function sendGatewayTxWithFallback(
  ctx: OrchestratorContext,
  evmClient: EvmClient,
  address: `0x${string}`,
  req: UniversalTxRequest,
  signer: UniversalSigner,
  value: bigint
): Promise<`0x${string}`> {
  const chain = ctx.universalSigner.account.chain;
  const currentVersion = getGatewayVersion(ctx);

  if (ctx.gatewayVersionCache.has(chain)) {
    return evmClient.writeContract({
      abi: getGatewayAbiForVersion(currentVersion) as Abi,
      address,
      functionName: 'sendUniversalTx',
      args: [currentVersion === 'v1' ? toGatewayRequestV1(req) : req],
      signer,
      value,
    });
  }

  try {
    printLog(ctx, `[Gateway] Trying V1 format for chain ${chain}...`);
    const txHash = await evmClient.writeContract({
      abi: getGatewayAbiForVersion('v1') as Abi,
      address,
      functionName: 'sendUniversalTx',
      args: [toGatewayRequestV1(req)],
      signer,
      value,
    });
    ctx.gatewayVersionCache.set(chain, 'v1');
    printLog(ctx, `[Gateway] V1 succeeded for chain ${chain}, cached.`);
    return txHash;
  } catch (v1Error) {
    printLog(ctx, `[Gateway] V1 failed for chain ${chain}, falling back to V0... Error: ${v1Error}`);
  }

  try {
    const txHash = await evmClient.writeContract({
      abi: getGatewayAbiForVersion('v0') as Abi,
      address,
      functionName: 'sendUniversalTx',
      args: [req],
      signer,
      value,
    });
    ctx.gatewayVersionCache.set(chain, 'v0');
    printLog(ctx, `[Gateway] V0 succeeded for chain ${chain}, cached.`);
    return txHash;
  } catch (v0Error) {
    throw v0Error;
  }
}

export async function sendGatewayTokenTxWithFallback(
  ctx: OrchestratorContext,
  evmClient: EvmClient,
  address: `0x${string}`,
  req: UniversalTokenTxRequest,
  signer: UniversalSigner,
  value?: bigint
): Promise<`0x${string}`> {
  const chain = ctx.universalSigner.account.chain;
  const currentVersion = getGatewayVersion(ctx);

  if (ctx.gatewayVersionCache.has(chain)) {
    return evmClient.writeContract({
      abi: getGatewayAbiForVersion(currentVersion) as Abi,
      address,
      functionName: 'sendUniversalTx',
      args: [currentVersion === 'v1' ? toGatewayTokenRequestV1(req) : req],
      signer,
      ...(value !== undefined && { value }),
    });
  }

  try {
    printLog(ctx, `[Gateway] Trying V1 token format for chain ${chain}...`);
    const txHash = await evmClient.writeContract({
      abi: getGatewayAbiForVersion('v1') as Abi,
      address,
      functionName: 'sendUniversalTx',
      args: [toGatewayTokenRequestV1(req)],
      signer,
      ...(value !== undefined && { value }),
    });
    ctx.gatewayVersionCache.set(chain, 'v1');
    printLog(ctx, `[Gateway] V1 token tx succeeded for chain ${chain}, cached.`);
    return txHash;
  } catch (v1Error) {
    printLog(ctx, `[Gateway] V1 token tx failed for chain ${chain}, falling back to V0... Error: ${v1Error}`);
  }

  try {
    const txHash = await evmClient.writeContract({
      abi: getGatewayAbiForVersion('v0') as Abi,
      address,
      functionName: 'sendUniversalTx',
      args: [req],
      signer,
      ...(value !== undefined && { value }),
    });
    ctx.gatewayVersionCache.set(chain, 'v0');
    printLog(ctx, `[Gateway] V0 token tx succeeded for chain ${chain}, cached.`);
    return txHash;
  } catch (v0Error) {
    throw v0Error;
  }
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
            priceUpdate: new PublicKey(
              '7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE'
            ),
            rateLimitConfig: rateLimitConfigPda,
            tokenRateLimit: tokenRateLimitPda,
            tokenProgram: new PublicKey(
              'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
            ),
            systemProgram: SystemProgram.programId,
          },
        });
        return new Uint8Array(utils.bytes.bs58.decode(txHash));
      } catch (error) {
        console.error('Error sending UniversalTx:', error);
        throw error;
      }
    }

    default:
      throw new Error(`Unsupported VM type: ${vm}`);
  }
}

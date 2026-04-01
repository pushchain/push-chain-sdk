/**
 * Funds-only execution flow (no payload) — extracted from Orchestrator.execute().
 *
 * Handles bridging funds from an external chain to Push Chain
 * for both EVM and SVM origin chains.
 */

import { PublicKey, SystemProgram } from '@solana/web3.js';
import { stringToBytes } from 'viem';
import { SVM_GATEWAY_IDL } from '../../constants/abi';
import { CHAIN_INFO, SVM_PYTH_PRICE_FEED } from '../../constants/chain';
import { CHAIN, VM } from '../../constants/enums';
import { MOVEABLE_TOKENS, MoveableToken } from '../../constants/tokens';
import {
  PROGRESS_HOOK,
  ProgressEvent,
} from '../../progress-hook/progress-hook.types';
import { EvmClient } from '../../vm-client/evm-client';
import { SvmClient } from '../../vm-client/svm-client';
import type { TxResponse } from '../../vm-client/vm-client.types';
import type {
  ExecuteParams,
  UniversalTxResponse,
} from '../orchestrator.types';
import type { OrchestratorContext } from './context';
import { fireProgressHook, printLog } from './context';
import { calculateNativeAmountForDeposit, ensureErc20Allowance } from './gas-calculator';
import { sendGatewayTxWithFallback } from './gateway-client';
import { buildGatewayPayloadAndGas } from './payload-builder';
import { getUeaStatusAndNonce } from './uea-manager';
import { computeUEAOffchain } from './uea-manager';
import { waitForEvmConfirmationsWithCountdown, waitForSvmConfirmationsWithCountdown } from './confirmation';
import { queryUniversalTxStatusFromGatewayTx } from './response-builder';
import { extractPcTxAndTransform } from './push-chain-tx';
import { buildSvmUniversalTxRequest, getSvmProtocolFee } from './svm-helpers';
import { fetchOriginChainTransactionForProgress } from './helpers';
import type { ResponseBuilderCallbacks } from './response-builder';
import { transformToUniversalTxResponse } from './response-builder';

export async function executeFundsOnly(
  ctx: OrchestratorContext,
  execute: ExecuteParams,
  eventBuffer: ProgressEvent[],
  getResponseCallbacks: () => ResponseBuilderCallbacks
): Promise<UniversalTxResponse> {
  const transformFn = (tx: TxResponse, buf: ProgressEvent[] = []) =>
    transformToUniversalTxResponse(ctx, tx, buf, getResponseCallbacks());

  const chain = ctx.universalSigner.account.chain;
  const { vm } = CHAIN_INFO[chain];
  if (
    !(
      chain === CHAIN.ETHEREUM_SEPOLIA ||
      chain === CHAIN.ARBITRUM_SEPOLIA ||
      chain === CHAIN.BASE_SEPOLIA ||
      chain === CHAIN.BNB_TESTNET ||
      chain === CHAIN.SOLANA_DEVNET
    )
  ) {
    throw new Error(
      'Funds bridging is only supported on Ethereum Sepolia, Arbitrum Sepolia, Base Sepolia, BNB Testnet, and Solana Devnet for now'
    );
  }

  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_01, chain, ctx.universalSigner.account.address);

  const { defaultRPC, lockerContract } = CHAIN_INFO[chain];
  const rpcUrls: string[] = ctx.rpcUrls[chain] || defaultRPC;

  // Resolve token: default to native token based on VM
  if (!execute.funds!.token) {
    const available: MoveableToken[] =
      (MOVEABLE_TOKENS[chain] as MoveableToken[] | undefined) || [];
    const preferredSymbol = vm === VM.EVM ? 'ETH' : vm === VM.SVM ? 'SOL' : undefined;
    const nativeToken = preferredSymbol
      ? available.find((t) => t.symbol === preferredSymbol)
      : undefined;
    if (!nativeToken) {
      throw new Error('Native token not configured for this chain');
    }
    execute.funds!.token = nativeToken;
  }

  const amount = execute.funds!.amount;
  const symbol = execute.funds!.token.symbol;
  const bridgeAmount = amount;

  if (vm === VM.EVM) {
    return executeFundsOnlyEvm(ctx, execute, eventBuffer, transformFn, chain, rpcUrls, lockerContract, bridgeAmount, symbol);
  } else {
    return executeFundsOnlySvm(ctx, execute, eventBuffer, transformFn, chain, rpcUrls, bridgeAmount, symbol);
  }
}

// ============================================================================
// EVM funds-only path
// ============================================================================

async function executeFundsOnlyEvm(
  ctx: OrchestratorContext,
  execute: ExecuteParams,
  eventBuffer: ProgressEvent[],
  transformFn: (tx: TxResponse, buf?: ProgressEvent[]) => Promise<UniversalTxResponse>,
  chain: CHAIN,
  rpcUrls: string[],
  lockerContract: string | undefined,
  bridgeAmount: bigint,
  symbol: string
): Promise<UniversalTxResponse> {
  const evmClient = new EvmClient({ rpcUrls });
  const gatewayAddress = lockerContract as `0x${string}`;
  const tokenAddr = execute.funds!.token!.address as `0x${string}`;
  const isNative = execute.funds!.token!.mechanism === 'native';
  const { nonce, deployed } = await getUeaStatusAndNonce(ctx);
  const { payload: universalPayload, req } = await buildGatewayPayloadAndGas(
    ctx, execute, nonce, 'sendFunds', bridgeAmount
  );

  const ueaAddress = computeUEAOffchain(ctx);

  printLog(ctx, 'sendFunds — buildGatewayPayloadAndGas result: ' + JSON.stringify({
    recipient: execute.to, ueaAddress,
    isSelfBridge: execute.to.toLowerCase() === ueaAddress.toLowerCase(),
    bridgeAmount: bridgeAmount.toString(), isNative, tokenAddr,
    nonce: nonce.toString(), deployed,
  }, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));

  const ueaBalanceForGas = await ctx.pushClient.getBalance(ueaAddress);
  const nativeAmount = await calculateNativeAmountForDeposit(ctx, chain, BigInt(0), ueaBalanceForGas);
  printLog(ctx, `sendFunds — nativeAmount: ${nativeAmount.toString()}, ueaBalanceForGas: ${ueaBalanceForGas.toString()}`);

  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_03_01);
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_03_02, ueaAddress, deployed);
  printLog(ctx, `UEA resolved: ${ueaAddress}, deployed: ${deployed}`);
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_06_01, execute.funds!.amount, execute.funds!.token!.decimals, symbol);

  // Approve gateway to pull tokens if ERC-20
  if (execute.funds!.token!.mechanism === 'approve') {
    await ensureErc20Allowance(ctx, evmClient, tokenAddr, gatewayAddress, execute.funds!.amount);
  } else if (execute.funds!.token!.mechanism === 'permit2') {
    throw new Error('Permit2 is not supported yet');
  }

  let txHash: `0x${string}`;
  try {
    printLog(ctx, (execute.to.toLowerCase() === ueaAddress.toLowerCase() ? 'FUNDS ONLY SELF' : 'FUNDS ONLY OTHER') +
      ' — gateway call payload: ' + JSON.stringify({
        gatewayAddress, functionName: 'sendUniversalTx', req,
        value: (isNative ? nativeAmount + bridgeAmount : nativeAmount).toString(),
        isNative, bridgeAmount: bridgeAmount.toString(), nativeAmount: nativeAmount.toString(),
      }, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));

    txHash = await sendGatewayTxWithFallback(
      ctx, evmClient, gatewayAddress, req, ctx.universalSigner,
      isNative ? nativeAmount + bridgeAmount : nativeAmount,
    );
  } catch (err) {
    fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_04_04);
    throw err;
  }

  const originTx = await fetchOriginChainTransactionForProgress(ctx, chain, txHash, txHash);
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_06_02, txHash, bridgeAmount, execute.funds!.token!.decimals, symbol, originTx);

  await waitForEvmConfirmationsWithCountdown(ctx, evmClient, txHash, CHAIN_INFO[chain].confirmations, CHAIN_INFO[chain].timeout);

  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_06_04);
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_06_05);

  printLog(ctx, 'sendFunds — querying Push Chain status: ' + JSON.stringify({
    txHash, evmGatewayMethod: execute.to === ueaAddress ? 'sendFunds' : 'sendTxWithFunds',
  }));

  const pushChainUniversalTx = await queryUniversalTxStatusFromGatewayTx(
    ctx, evmClient, gatewayAddress, txHash,
    execute.to === ueaAddress ? 'sendFunds' : 'sendTxWithFunds'
  );

  const response = await extractPcTxAndTransform(ctx, pushChainUniversalTx, txHash, eventBuffer, 'sendFunds', transformFn);
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_06_06, bridgeAmount, execute.funds!.token!.decimals, symbol);
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_99_01, [response]);
  return response;
}

// ============================================================================
// SVM funds-only path
// ============================================================================

async function executeFundsOnlySvm(
  ctx: OrchestratorContext,
  execute: ExecuteParams,
  eventBuffer: ProgressEvent[],
  transformFn: (tx: TxResponse, buf?: ProgressEvent[]) => Promise<UniversalTxResponse>,
  chain: CHAIN,
  rpcUrls: string[],
  bridgeAmount: bigint,
  symbol: string
): Promise<UniversalTxResponse> {
  const svmClient = new SvmClient({ rpcUrls });
  const programId = new PublicKey(SVM_GATEWAY_IDL.address);
  const [configPda] = PublicKey.findProgramAddressSync([stringToBytes('config')], programId);
  const [vaultPda] = PublicKey.findProgramAddressSync([stringToBytes('vault')], programId);
  const { feeVaultPda, protocolFeeLamports } = await getSvmProtocolFee(svmClient, programId);
  const [rateLimitConfigPda] = PublicKey.findProgramAddressSync([stringToBytes('rate_limit_config')], programId);
  const userPk = new PublicKey(ctx.universalSigner.account.address);
  const priceUpdatePk = new PublicKey(SVM_PYTH_PRICE_FEED);

  if (execute.payGasWith !== undefined) {
    throw new Error('Pay-with token is not supported on Solana');
  }

  const recipientEvm20: number[] = Array.from(
    Buffer.from((execute.to as `0x${string}`).slice(2).padStart(40, '0'), 'hex').subarray(0, 20)
  );

  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_03_01);
  const ueaAddress = computeUEAOffchain(ctx);
  const { nonce, deployed } = await getUeaStatusAndNonce(ctx);
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_03_02, ueaAddress, deployed);

  let txSignature: string;

  if (execute.funds!.token!.mechanism === 'native') {
    const [tokenRateLimitPda] = PublicKey.findProgramAddressSync(
      [stringToBytes('rate_limit'), PublicKey.default.toBuffer()], programId
    );
    const reqNative = buildSvmUniversalTxRequest({
      recipient: recipientEvm20, token: PublicKey.default, amount: bridgeAmount,
      payload: '0x', revertRecipient: userPk, signatureData: '0x',
    });
    txSignature = await svmClient.writeContract({
      abi: SVM_GATEWAY_IDL, address: programId.toBase58(), functionName: 'sendUniversalTx',
      args: [reqNative, bridgeAmount + protocolFeeLamports], signer: ctx.universalSigner,
      accounts: {
        config: configPda, vault: vaultPda, feeVault: feeVaultPda,
        userTokenAccount: vaultPda, gatewayTokenAccount: vaultPda, user: userPk,
        priceUpdate: priceUpdatePk, rateLimitConfig: rateLimitConfigPda,
        tokenRateLimit: tokenRateLimitPda,
        tokenProgram: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
        systemProgram: SystemProgram.programId,
      },
    });
  } else if (execute.funds!.token!.mechanism === 'approve') {
    const mintPk = new PublicKey(execute.funds!.token!.address);
    const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
    const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
    const userAta = PublicKey.findProgramAddressSync(
      [userPk.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mintPk.toBuffer()], ASSOCIATED_TOKEN_PROGRAM_ID
    )[0];
    const vaultAta = PublicKey.findProgramAddressSync(
      [vaultPda.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mintPk.toBuffer()], ASSOCIATED_TOKEN_PROGRAM_ID
    )[0];
    const [tokenRateLimitPda] = PublicKey.findProgramAddressSync(
      [stringToBytes('rate_limit'), mintPk.toBuffer()], programId
    );

    const reqSpl = buildSvmUniversalTxRequest({
      recipient: recipientEvm20, token: mintPk, amount: bridgeAmount,
      payload: '0x', revertRecipient: userPk, signatureData: '0x',
    });
    txSignature = await svmClient.writeContract({
      abi: SVM_GATEWAY_IDL, address: programId.toBase58(), functionName: 'sendUniversalTx',
      args: [reqSpl, protocolFeeLamports], signer: ctx.universalSigner,
      accounts: {
        config: configPda, vault: vaultPda, feeVault: feeVaultPda,
        userTokenAccount: userAta, gatewayTokenAccount: vaultAta, user: userPk,
        tokenProgram: TOKEN_PROGRAM_ID, priceUpdate: priceUpdatePk,
        rateLimitConfig: rateLimitConfigPda, tokenRateLimit: tokenRateLimitPda,
        systemProgram: SystemProgram.programId,
      },
    });
  } else {
    throw new Error('Unsupported token mechanism on Solana');
  }

  const originTx = await fetchOriginChainTransactionForProgress(ctx, chain, '0x', txSignature);
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_06_02, txSignature, bridgeAmount, execute.funds!.token!.decimals, symbol, originTx);

  await waitForSvmConfirmationsWithCountdown(ctx, svmClient, txSignature, CHAIN_INFO[chain].confirmations, CHAIN_INFO[chain].timeout);

  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_06_04);
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_06_05);

  const pushChainUniversalTx = await queryUniversalTxStatusFromGatewayTx(ctx, undefined, undefined, txSignature, 'sendFunds');
  const response = await extractPcTxAndTransform(ctx, pushChainUniversalTx, txSignature, eventBuffer, 'sendFunds (SVM)', transformFn);
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_06_06, bridgeAmount, execute.funds!.token!.decimals, symbol);
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_99_01, [response]);
  return response;
}

/**
 * Account management functions extracted from Orchestrator.
 * Covers: getAccountStatus, upgradeAccount, fetchLatestUEAVersion, migrateCEA.
 */

import { utils } from '@coral-xyz/anchor';
import { Abi, bytesToHex, encodeAbiParameters, keccak256 } from 'viem';
import { UEA_FACTORY_ABI } from '../../constants/abi/uea-factory';
import { CHAIN_INFO, UEA_FACTORY, UEA_MIGRATION, VM_NAMESPACE } from '../../constants/chain';
import { CHAIN, VM } from '../../constants/enums';
import { UniversalAccountId } from '../../generated/v1/tx';
import PROGRESS_HOOKS from '../../progress-hook/progress-hook';
import { PROGRESS_HOOK, ProgressEvent } from '../../progress-hook/progress-hook.types';
import { AccountStatus, parseUEAVersion, UniversalTxResponse } from '../orchestrator.types';
import { getCEAAddress, chainSupportsCEA } from '../cea-utils';
import type { OrchestratorContext } from './context';
import { getUeaStatusAndNonce, fetchUEAVersion, computeUEAOffchain } from './uea-manager';
import { signMigrationPayload } from './signing';
import { isPushChain } from './helpers';

// ============================================================================
// Fetch Latest UEA Version from Factory
// ============================================================================

export async function fetchLatestUEAVersion(
  ctx: OrchestratorContext,
  vm: VM
): Promise<string> {
  const factoryAddress = UEA_FACTORY[ctx.pushNetwork];
  if (!factoryAddress || factoryAddress === '0xTBD') {
    return '';
  }

  try {
    const vmHash =
      vm === VM.EVM
        ? keccak256(encodeAbiParameters([{ type: 'string' }], ['EVM']))
        : keccak256(encodeAbiParameters([{ type: 'string' }], ['SVM']));

    return await ctx.pushClient.readContract<string>({
      address: factoryAddress,
      abi: UEA_FACTORY_ABI as unknown as Abi,
      functionName: 'UEA_VERSION',
      args: [vmHash],
    });
  } catch {
    return '';
  }
}

// ============================================================================
// Account Status
// ============================================================================

export async function getAccountStatus(
  ctx: OrchestratorContext,
  options?: { forceRefresh?: boolean }
): Promise<AccountStatus> {
  if (ctx.accountStatusCache && !options?.forceRefresh) {
    return ctx.accountStatusCache;
  }

  const chain = ctx.universalSigner.account.chain;
  const { vm } = CHAIN_INFO[chain];

  const { deployed } = await getUeaStatusAndNonce(ctx);

  if (!deployed) {
    const status: AccountStatus = {
      mode: 'signer',
      uea: {
        loaded: true,
        deployed: false,
        version: '',
        minRequiredVersion: '',
        requiresUpgrade: false,
      },
    };
    ctx.accountStatusCache = status;
    return status;
  }

  const [currentVersion, minRequiredVersion] = await Promise.all([
    fetchUEAVersion(ctx),
    fetchLatestUEAVersion(ctx, vm),
  ]);

  const requiresUpgrade =
    parseUEAVersion(currentVersion) < parseUEAVersion(minRequiredVersion);

  const status: AccountStatus = {
    mode: 'signer',
    uea: {
      loaded: true,
      deployed: true,
      version: currentVersion,
      minRequiredVersion,
      requiresUpgrade,
    },
  };
  ctx.accountStatusCache = status;
  return status;
}

// ============================================================================
// UEA Upgrade
// ============================================================================

export async function upgradeAccount(
  ctx: OrchestratorContext,
  options?: { progressHook?: (progress: ProgressEvent) => void }
): Promise<void> {
  const hook = options?.progressHook || ctx.progressHook;
  const fireHook = (hookId: string, ...args: any[]) => {
    const hookEntry = PROGRESS_HOOKS[hookId];
    if (hookEntry && hook) {
      hook(hookEntry(...args));
    }
  };

  fireHook(PROGRESS_HOOK.UEA_MIG_01);
  const status = await getAccountStatus(ctx, { forceRefresh: true });

  if (!status.uea.requiresUpgrade) {
    fireHook(PROGRESS_HOOK.UEA_MIG_9903);
    return;
  }

  fireHook(PROGRESS_HOOK.UEA_MIG_02);

  try {
    const { chain, address } = ctx.universalSigner.account;
    const { vm, chainId } = CHAIN_INFO[chain];
    const ueaAddress = computeUEAOffchain(ctx);
    const migrationContractAddress = UEA_MIGRATION[ctx.pushNetwork];

    if (!migrationContractAddress || migrationContractAddress === '0xTBD') {
      throw new Error('UEA migration contract address not configured');
    }

    const { nonce } = await getUeaStatusAndNonce(ctx);
    const deadline = BigInt(9999999999);
    const ueaVersion = status.uea.version || '0.1.0';

    const signatureBytes = await signMigrationPayload(ctx, {
      migrationContractAddress,
      nonce,
      deadline,
      ueaVersion,
      ueaAddress,
    });

    const signature = bytesToHex(signatureBytes);

    fireHook(PROGRESS_HOOK.UEA_MIG_03);

    const universalAccountId: UniversalAccountId = {
      chainNamespace: VM_NAMESPACE[vm],
      chainId,
      owner:
        vm === VM.EVM
          ? address
          : vm === VM.SVM
          ? bytesToHex(new Uint8Array(utils.bytes.bs58.decode(address)))
          : address,
    };

    const { cosmosAddress: signer } = ctx.pushClient.getSignerAddress();

    const msg = ctx.pushClient.createMsgMigrateUEA({
      signer,
      universalAccountId,
      migrationPayload: {
        migration: migrationContractAddress,
        nonce: nonce.toString(),
        deadline: deadline.toString(),
      },
      signature,
    });

    const txBody = await ctx.pushClient.createCosmosTxBody([msg]);
    const txRaw = await ctx.pushClient.signCosmosTx(txBody);
    const tx = await ctx.pushClient.broadcastCosmosTx(txRaw);

    if (tx.code !== 0) {
      throw new Error(tx.rawLog || 'UEA migration transaction failed');
    }

    ctx.ueaVersionCache = undefined;

    const updated = await getAccountStatus(ctx, { forceRefresh: true });
    fireHook(PROGRESS_HOOK.UEA_MIG_9901, updated.uea.version);
  } catch (err) {
    fireHook(PROGRESS_HOOK.UEA_MIG_9902);
    throw err;
  }
}

// ============================================================================
// CEA Migration
// ============================================================================

export async function migrateCEA(
  ctx: OrchestratorContext,
  chain: CHAIN,
  executeFn: (params: any) => Promise<UniversalTxResponse>
): Promise<UniversalTxResponse> {
  if (isPushChain(chain)) {
    throw new Error('Cannot migrate CEA on Push Chain');
  }
  if (!chainSupportsCEA(chain)) {
    throw new Error(`Chain ${chain} does not support CEA`);
  }

  const ueaAddress = computeUEAOffchain(ctx);
  const { cea, isDeployed } = await getCEAAddress(
    ueaAddress,
    chain,
    ctx.rpcUrls[chain]?.[0]
  );
  if (!isDeployed) {
    throw new Error(
      `CEA not deployed on chain ${chain}. Deploy CEA first.`
    );
  }

  return executeFn({
    to: { address: cea, chain },
    migration: true,
  });
}

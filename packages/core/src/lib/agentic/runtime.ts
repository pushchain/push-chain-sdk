import { getAddress, type Address } from 'viem';
import { CHAIN, PUSH_NETWORK } from '../constants/enums';
import type { MoveableToken } from '../constants/tokens';
import { AtomicBatchUnavailableError } from '../orchestrator/internals/errors';
import { capabilityUnavailable } from './errors';
import type { Orchestrator } from '../orchestrator/orchestrator';
import type {
  ExecuteParams,
  TransactionExecutionOptions,
  UniversalExecuteParams,
  UniversalTxResponse,
} from '../orchestrator/orchestrator.types';
import type { ProgressEvent } from '../progress-hook/progress-hook.types';
import { getCEAAddress } from '../orchestrator/cea-utils';
import type { OrchestratorContext } from '../orchestrator/internals/context';
import { computeUEAOffchain } from '../orchestrator/internals/uea-manager';
import { queryOutboundGasFee } from '../orchestrator/internals/gas-calculator';
import {
  getNativePRC20ForChain,
  isPushChain,
} from '../orchestrator/internals/helpers';
import { pushChainNamespaceFor } from './chain';
import { getPRC20Address } from '../universal/prc20-address';
import {
  chainReaderFromPublicClient,
  type ChainReader,
} from './contracts/reader';
import type { SvmMetadataProvider } from './management/svm-context';
import { createSvmMetadataProvider } from './management/svm-metadata';
import { CHAIN_INFO } from '../constants/chain';
import type { AgenticProgressHook } from './agentic.types';

/**
 * Everything the AGW module needs from the surrounding client. Tests supply a
 * mock; PushChain builds the real one from its orchestrator. Keeping this
 * explicit is what separates the signer's identity (gas, account status,
 * ownership derivation) from the AGW execution account.
 */
export interface AgenticRuntime {
  readonly network: PUSH_NETWORK;
  /** 'eip155:<id>' of the connected Push chain — the native rule chain. */
  readonly pushChainNamespace: string;
  readonly reader: ChainReader;
  readonly isReadOnly: boolean;
  readonly svmMetadata?: SvmMetadataProvider;
  /** Connected signer's Push identity: its EOA, or its UEA for its actual origin chain. */
  signerPushAccount(): Address;
  /** Connected signer's origin account (universal.origin). */
  signerOrigin(): { chain: CHAIN; address: string };
  signerIsPushNative(): boolean;
  /** The signer's ordinary transaction path (orchestrator.execute). */
  execute(
    params: ExecuteParams | UniversalExecuteParams,
    options?: TransactionExecutionOptions
  ): Promise<UniversalTxResponse>;
  /** Sender-preserving UEA/7702 transport; native sequential fallback is forbidden. */
  executeAtomicBatch(
    params: ExecuteParams,
    options?: TransactionExecutionOptions
  ): Promise<UniversalTxResponse>;
  /** Emit to the init-time hook and, if different, the per-call hook. */
  emit(event: ProgressEvent, perCallHook?: AgenticProgressHook): void;
  /** Whether the signer's own UEA is deployed (always true for a Push EOA). */
  signerAccountDeployed(): Promise<boolean>;
  signerBalance(): Promise<bigint>;
  getGasPrice(): Promise<bigint>;
  quoteOutbound(
    prc20: Address,
    gasLimit: bigint,
    chain: CHAIN
  ): Promise<{
    protocolFee: bigint;
    nativeValueForGas: bigint;
    gasLimitUsed: bigint;
  }>;
  resolveCEA(
    account: Address,
    chain: CHAIN
  ): Promise<{ cea: Address; isDeployed: boolean }>;
  resolvePrc20(
    token: MoveableToken | string | undefined,
    chain: CHAIN
  ): Address;
  nowSeconds(): number;
}

/** Build the runtime over an orchestrator (the orchestrator IS the internal ctx). */
export function createAgenticRuntime(
  orchestrator: Orchestrator,
  isReadOnly: boolean
): AgenticRuntime {
  const ctx = orchestrator as unknown as OrchestratorContext;
  const network = orchestrator.getNetwork();
  return {
    network,
    pushChainNamespace: pushChainNamespaceFor(network),
    get reader() {
      return chainReaderFromPublicClient(ctx.pushClient.publicClient);
    },
    isReadOnly,
    svmMetadata: createSvmMetadataProvider({
      [CHAIN.SOLANA_DEVNET]: {
        gatewayProgram: CHAIN_INFO[CHAIN.SOLANA_DEVNET].lockerContract ?? '',
        rpcUrls:
          orchestrator.getRpcUrls()[CHAIN.SOLANA_DEVNET] ??
          CHAIN_INFO[CHAIN.SOLANA_DEVNET].defaultRPC,
      },
    }),
    signerPushAccount: () => getAddress(computeUEAOffchain(ctx)),
    signerOrigin: () => orchestrator.getUOA(),
    signerIsPushNative: () => isPushChain(ctx.universalSigner.account.chain),
    execute: (params, options) => orchestrator.execute(params, options),
    executeAtomicBatch: async (params, options) => {
      try {
        return await orchestrator.executeAtomicBatch(params, options);
      } catch (error) {
        if (error instanceof AtomicBatchUnavailableError) {
          throw capabilityUnavailable('atomicNativeAgentBatch', error.message);
        }
        throw error;
      }
    },
    emit: (event, perCallHook) => {
      const base = orchestrator.getProgressHook();
      base?.(event);
      if (perCallHook && perCallHook !== base) perCallHook(event);
    },
    signerAccountDeployed: async () => {
      if (isPushChain(ctx.universalSigner.account.chain)) return true;
      const status = await orchestrator.getAccountStatus();
      return status.uea.deployed;
    },
    signerBalance: () => ctx.pushClient.getBalance(computeUEAOffchain(ctx)),
    getGasPrice: () => ctx.pushClient.getGasPrice(),
    quoteOutbound: async (prc20, gasLimit, chain) => {
      const q = await queryOutboundGasFee(ctx, prc20, gasLimit, chain);
      return {
        protocolFee: q.protocolFee,
        nativeValueForGas: q.nativeValueForGas,
        gasLimitUsed: q.gasLimitUsed,
      };
    },
    resolveCEA: async (account, chain) => {
      const r = await getCEAAddress(
        account,
        chain,
        orchestrator.getRpcUrls()[chain]?.[0]
      );
      return { cea: getAddress(r.cea), isDeployed: r.isDeployed };
    },
    resolvePrc20: (token, chain) =>
      getAddress(
        token
          ? getPRC20Address(
              typeof token === 'string' ? { chain, address: token } : token,
              { network }
            ).address
          : getNativePRC20ForChain(chain, network)
      ),
    nowSeconds: () => Math.floor(Date.now() / 1000),
  };
}

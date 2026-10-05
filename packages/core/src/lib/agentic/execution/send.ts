import { getAddress, type Address, type Hex } from 'viem';
import type { CHAIN } from '../../constants/enums';
import { ERC20_EVM } from '../../constants/abi';
import { PROGRESS_HOOK } from '../../progress-hook/progress-hook.types';
import type {
  ExecuteParams,
  MultiCall,
  TransactionExecutionOptions,
  UniversalExecuteParams,
  UniversalTxResponse,
} from '../../orchestrator/orchestrator.types';
import { isChainTarget } from '../../orchestrator/route-detector';
import {
  getPushChainForNetwork,
  isPushChain,
} from '../../orchestrator/internals/helpers';
import { AgenticCapability, requireCapability } from '../capabilities';
import type { AgenticExecutionContext } from '../context';
import type { Call, UniversalConfigRead } from '../contracts/v4';
import { SEND_OUTBOUND_SELECTOR } from '../contracts/v4';
import { actionId, configId } from '../codec/ids';
import { AGENTIC_ERROR_CODE, AgenticError } from '../errors';
import {
  assertCanSign,
  emitAgentic,
  wrapSendError,
} from '../management/common';
import { selectRuleForSend } from '../reads/rules';
import { Snapshot } from '../reads/snapshot';
import { adaptAgenticResponse, outboundResponseCall } from '../response';
import type { AgenticRuntime } from '../runtime';
import type { AgenticHex, AgenticProgressHook } from '../agentic.types';
import { guardAgenticSendParams } from './guards';
import { composeOutbound, type DestinationCall } from './outbound';

const MODE_UNIVERSAL = 0;
const VM_EVM = 0;
/** R1's own required-funds estimate when no gasLimit is given (execute-standard). */
const DEFAULT_GAS_ESTIMATE = BigInt(1e7);

/** Signer-level fields that legitimately carry over to the wrapped Push tx. */
function signerFields(p: UniversalExecuteParams): Partial<ExecuteParams> {
  const out: Partial<ExecuteParams> = {};
  if (p.gasLimit !== undefined && !isChainTarget(p.to))
    out.gasLimit = p.gasLimit;
  if (p.maxFeePerGas !== undefined) out.maxFeePerGas = p.maxFeePerGas;
  if (p.maxPriorityFeePerGas !== undefined)
    out.maxPriorityFeePerGas = p.maxPriorityFeePerGas;
  if (p.nonce !== undefined) out.nonce = p.nonce;
  if (p.deadline !== undefined) out.deadline = p.deadline;
  if (p.feeLockTxHash !== undefined) out.feeLockTxHash = p.feeLockTxHash;
  return out;
}

/**
 * Spec 2.a gas rule: in agenticWallet mode an external signer's UEA must
 * already hold the PC for its Push gas, except for the very first action
 * while that UEA is undeployed (which takes the one-time origin fee lock).
 * Mirrors R1's fee-lock condition so an underfunded UEA fails loudly here
 * instead of silently locking origin funds on every action.
 */
async function enforceSignerGas(
  runtime: AgenticRuntime,
  gasLimit: bigint | undefined
): Promise<void> {
  if (runtime.signerIsPushNative()) return;
  if (!(await runtime.signerAccountDeployed())) return;
  const [gasPrice, balance] = await Promise.all([
    runtime.getGasPrice(),
    runtime.signerBalance(),
  ]);
  const required = (gasLimit ?? DEFAULT_GAS_ESTIMATE) * gasPrice;
  if (balance < required) {
    throw new AgenticError(
      AGENTIC_ERROR_CODE.AGENT_GAS_INSUFFICIENT,
      `the signer's UEA ${runtime.signerPushAccount()} holds ${balance} PC wei but needs ~${required} for Push gas`,
      {
        hint: "The wallet's PC pays outbound fees, not the signer's gas. Top up the signer's UEA (PushChain.utils.account.deriveExecutorAccount) from a client without agenticWallet.",
        details: { required, balance },
      }
    );
  }
}

/**
 * A ChainTarget naming the connected Push chain is a native send, exactly like
 * a bare address (core's route detector treats it the same way). A ChainTarget
 * naming a different Push network is refused rather than routed outbound.
 */
function normalizePushDestination(
  p: UniversalExecuteParams,
  runtime: AgenticRuntime
): UniversalExecuteParams {
  if (!isChainTarget(p.to)) return p;
  const chain = p.to.chain;
  if (chain === getPushChainForNetwork(runtime.network)) {
    return { ...p, to: getAddress(p.to.address) };
  }
  if (isPushChain(chain)) {
    throw new AgenticError(
      AGENTIC_ERROR_CODE.INVALID_RULE,
      `destination ${chain} is a Push chain other than the connected network (${runtime.network})`
    );
  }
  return p;
}

function toCalls(params: UniversalExecuteParams): Call[] {
  if (Array.isArray(params.data)) {
    return params.data.map((c) => ({
      target: getAddress(c.to),
      value: c.value ?? BigInt(0),
      data: c.data,
    }));
  }
  return [
    {
      target: getAddress(params.to as Address),
      value: params.value ?? BigInt(0),
      data: (params.data ?? '0x') as Hex,
    },
  ];
}

/**
 * sendTransaction in agenticWallet mode. Owner door → execute; agent door →
 * executeAsAgent under the one enabled rule for (signer, destination), looked
 * up on every send. Everything is validated before the signer is asked.
 */
export async function agenticSend(
  runtime: AgenticRuntime,
  actx: AgenticExecutionContext,
  params: UniversalExecuteParams | ExecuteParams,
  options?: TransactionExecutionOptions
): Promise<UniversalTxResponse> {
  assertCanSign(runtime, 'sendTransaction');
  guardAgenticSendParams(params);
  const p = normalizePushDestination(params as UniversalExecuteParams, runtime);
  const hook: AgenticProgressHook | undefined =
    options?.progressHook ?? p.progressHook;
  const gen = actx.generation;
  const wallet = actx.wallet;
  const outbound = isChainTarget(p.to);
  const destination = outbound
    ? (p.to as { chain: string }).chain
    : runtime.pushChainNamespace;

  if (!outbound && p.funds) {
    throw new AgenticError(
      AGENTIC_ERROR_CODE.NOT_ALLOWED_IN_AGENTIC_MODE,
      "`funds` on a Push-chain send would bridge from the signer; it does not move the wallet's tokens",
      {
        hint: "Transfer the wallet's PRC20 with a token transfer call in `data`.",
      }
    );
  }

  let wrappedData: Hex;
  let agentBatch: MultiCall[] | undefined;
  let nativeCalls: Call[] | undefined;
  let rulesId: AgenticHex | undefined;
  let logical: { to: string; data: string; value: bigint };
  let meta: { route?: 'UOA_TO_CEA'; destinationAccount?: Address } = {};
  let outboundChain: CHAIN | undefined;
  let destinationCalls: DestinationCall[] | undefined;

  if (actx.door === 'agent') {
    requireCapability(gen.capabilities, AgenticCapability.AGENT_EXECUTE);
  } else {
    requireCapability(gen.capabilities, AgenticCapability.OWNER_EXECUTE);
  }

  if (!outbound) {
    const calls = toCalls(p);
    if (calls.length === 0)
      throw new AgenticError(
        AGENTIC_ERROR_CODE.INVALID_RULE,
        'an empty call array cannot execute'
      );
    if (actx.door === 'owner') {
      wrappedData = gen.contracts.encodeExecute(calls);
    } else {
      const snap = await Snapshot.at(runtime.reader);
      const rule = await selectRuleForSend(
        snap,
        gen,
        wallet,
        actx.signerPushAccount,
        destination
      );
      rulesId = rule.rulesId as AgenticHex;
      wrappedData = gen.contracts.encodeExecuteAsAgent(rule.rulesId, calls[0]);
      if (calls.length > 1) {
        agentBatch = calls.map((call) => ({
          to: wallet,
          value: BigInt(0),
          data: gen.contracts.encodeExecuteAsAgent(rule.rulesId, call),
        }));
        nativeCalls = calls;
      }
    }
    logical =
      calls.length === 1
        ? { to: calls[0].target, data: calls[0].data, value: calls[0].value }
        : agentBatch
        ? { to: calls[0].target, data: calls[0].data, value: calls[0].value }
        : { to: wallet, data: wrappedData, value: BigInt(0) };
  } else {
    let ruleAssets: readonly Address[] | undefined;
    let maxGasPerCall: bigint | undefined;
    let expectedCEA: Address | undefined;
    const snap = await Snapshot.at(runtime.reader);
    if (actx.door === 'agent') {
      const rule = await selectRuleForSend(
        snap,
        gen,
        wallet,
        actx.signerPushAccount,
        destination
      );
      if (rule.mode !== MODE_UNIVERSAL || rule.vm !== VM_EVM) {
        throw new AgenticError(
          AGENTIC_ERROR_CODE.INVALID_RULE,
          `rule ${rule.rulesId} is not an EVM universal rule`
        );
      }
      rulesId = rule.rulesId as AgenticHex;
      const cfg = await snap.read<UniversalConfigRead>(
        gen.addresses.rulesPolicy,
        gen.contracts.abis.policy,
        'getConfig',
        [
          configId(
            wallet,
            rule.rulesId,
            actionId(gen.addresses.gateway, SEND_OUTBOUND_SELECTOR)
          ),
          wallet,
        ]
      );
      ruleAssets = cfg.assets.map((a) => getAddress(a.token));
      maxGasPerCall = cfg.maxGasPerCall;
      expectedCEA = getAddress(cfg.expectedCEA);
    }
    const out = await composeOutbound(runtime, gen, wallet, p, {
      ruleAssets,
      door: actx.door,
    });
    outboundChain = out.chain;
    meta = { route: 'UOA_TO_CEA', destinationAccount: out.destinationAccount };
    const [walletPc, tokenBalance, allowance] = await Promise.all([
      runtime.reader.getBalance({
        address: wallet,
        blockNumber: snap.blockNumber,
      }),
      out.amount > BigInt(0)
        ? snap.read<bigint>(
            out.token,
            ERC20_EVM as unknown as readonly unknown[],
            'balanceOf',
            [wallet]
          )
        : Promise.resolve(BigInt(0)),
      snap.read<bigint>(
        out.token,
        ERC20_EVM as unknown as readonly unknown[],
        'allowance',
        [wallet, gen.addresses.gateway]
      ),
    ]);
    if (walletPc < out.value) {
      throw new AgenticError(
        AGENTIC_ERROR_CODE.WALLET_BALANCE_INSUFFICIENT,
        `wallet ${wallet} holds ${walletPc} PC wei; this outbound needs ${out.value} (protocol fee + gas cap)`,
        { hint: "Fund the wallet's PC with an ordinary send to its address." }
      );
    }
    if (tokenBalance < out.amount) {
      throw new AgenticError(
        AGENTIC_ERROR_CODE.WALLET_BALANCE_INSUFFICIENT,
        `wallet ${wallet} holds ${tokenBalance} of ${out.token}; this outbound burns ${out.amount}`
      );
    }
    // Both doors only consume an allowance the owner set separately; the SDK
    // never writes one (a write from a stale read could restore revoked authority).
    if (out.amount > allowance) {
      throw new AgenticError(
        AGENTIC_ERROR_CODE.GATEWAY_ALLOWANCE_INSUFFICIENT,
        `the gateway may pull ${allowance} of ${out.token} from the wallet; this outbound needs ${out.amount}`,
        {
          hint: 'Set a bounded allowance first with an owner-door send: approve(gateway, cap) on the token (approve(gateway, 0) removes it).',
        }
      );
    }
    if (actx.door === 'agent') {
      if (expectedCEA && expectedCEA !== out.destinationAccount) {
        throw new AgenticError(
          AGENTIC_ERROR_CODE.INCONSISTENT_READ,
          `rule ${rulesId} committed destination account ${expectedCEA}, but the wallet's account on ${out.chain} now derives to ${out.destinationAccount}`,
          {
            hint: 'Destination-account derivation drift (obligation 13). The owner must regrant the rule.',
          }
        );
      }
      if (maxGasPerCall !== undefined && out.value > maxGasPerCall) {
        throw new AgenticError(
          AGENTIC_ERROR_CODE.RULE_LIMIT_EXCEEDED,
          `this outbound needs ${out.value} PC wei but the rule caps the wallet's PC per call at ${maxGasPerCall}`
        );
      }
      wrappedData = gen.contracts.encodeExecuteAsAgent(
        rulesId as Hex,
        out.gatewayCall
      );
    } else {
      wrappedData = gen.contracts.encodeExecute([out.gatewayCall]);
    }
    destinationCalls = out.destinationCalls;
    logical = outboundResponseCall(destinationCalls, {
      to: out.gatewayCall.target,
      data: out.gatewayCall.data,
      value: out.gatewayCall.value,
    });
  }

  await enforceSignerGas(runtime, signerFields(p).gasLimit);
  emitAgentic(
    runtime,
    hook,
    PROGRESS_HOOK.AGENTIC_TX_107,
    rulesId,
    outboundChain ?? destination,
    actx.door
  );

  let resp: UniversalTxResponse;
  try {
    const sendOptions = hook ? { ...options, progressHook: hook } : options;
    resp = agentBatch
      ? await runtime.executeAtomicBatch(
          {
            ...signerFields(p),
            to: wallet,
            value: BigInt(0),
            data: agentBatch,
          },
          sendOptions
        )
      : await runtime.execute(
          {
            ...signerFields(p),
            to: wallet,
            value: BigInt(0),
            data: wrappedData,
          },
          sendOptions
        );
  } catch (err) {
    const wrapped = wrapSendError(err) as {
      code?: string;
      message?: string;
      decodedError?: unknown;
    };
    emitAgentic(
      runtime,
      hook,
      PROGRESS_HOOK.AGENTIC_TX_199_02,
      'sendTransaction',
      wrapped?.code ?? 'UNKNOWN',
      wrapped?.message ?? String(err),
      wrapped?.decodedError
    );
    throw wrapped;
  }
  adaptAgenticResponse(resp, {
    wallet,
    door: actx.door,
    rulesId,
    chainNamespace: outboundChain ?? destination,
    destinationAccount: meta.destinationAccount as AgenticHex | undefined,
    destinationCalls,
    ...(nativeCalls
      ? {
          nativeCalls: nativeCalls.map((c) => ({
            to: c.target,
            data: c.data,
            value: c.value,
          })),
        }
      : {}),
    logical,
    route: meta.route,
    chain: outboundChain,
  });
  emitAgentic(
    runtime,
    hook,
    PROGRESS_HOOK.AGENTIC_TX_199_01,
    'sendTransaction',
    resp.hash
  );
  return resp;
}

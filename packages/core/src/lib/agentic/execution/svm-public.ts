import { PROGRESS_HOOK } from '../../progress-hook/progress-hook.types';
import { emitAgentic } from '../management/common';
import { bytesToHex, hexToBytes, erc20Abi, getAddress, type Hex } from 'viem';
import type { CHAIN } from '../../constants/enums';
import {
  isPC20Reference,
  type UniversalExecuteParams,
  type TransactionExecutionOptions,
} from '../../orchestrator/orchestrator.types';
import { resolveSvmCallForCea } from '../../orchestrator/svm-idl/resolve';
import type { AgenticRuntime } from '../runtime';
import type { AgenticExecutionContext } from '../context';
import { AgenticCapability, requireCapability } from '../capabilities';
import { selectRuleForSend } from '../reads/rules';
import { readSvmConfig } from '../reads/svm';
import { Snapshot } from '../reads/snapshot';
import { svmMetadata } from '../management/svm-public';
import { wrapSendError } from '../management/common';
import type { MoveableToken } from '../../constants/tokens';
import { svmKey, deriveAgwSvmCea } from '../codec/svm-accounts';
import { svmInvalid, UINT64_MAX } from '../codec/svm-terms';
import { AGENTIC_ERROR_CODE, AgenticError } from '../errors';
import { prepareSvmAgentExecution } from './svm-send';
import { encodeAgwSvmPayload } from './svm-payload';
import { quoteSvmRequest } from './svm-quote';
import { buildAgwSvmAction } from './svm-outbound';
import type { AgenticTxMetadata } from '../agentic.types';
import { adaptAgenticResponse } from '../response';

/** Public single-instruction route; the contract enforces the supplied rule. */
export async function sendPublicSvm(
  runtime: AgenticRuntime,
  actx: AgenticExecutionContext,
  p: UniversalExecuteParams,
  options?: TransactionExecutionOptions
) {
  const gen = actx.generation,
    wallet = actx.wallet;
  requireCapability(gen.capabilities, AgenticCapability.UNIVERSAL_SVM_RULES);
  requireCapability(
    gen.capabilities,
    actx.door === 'agent'
      ? AgenticCapability.AGENT_EXECUTE
      : AgenticCapability.OWNER_EXECUTE
  );
  const to = p.to as { address: string; chain: CHAIN };
  const target = svmKey(to.address);
  if (Array.isArray(p.data))
    throw svmInvalid('Solana AGW sends do not support instruction arrays');
  const hasInstruction = p.data !== undefined && p.data !== '0x';
  if (
    hasInstruction &&
    (typeof p.data !== 'string' || !/^0x(?:[0-9a-fA-F]{2})+$/.test(p.data))
  )
    throw svmInvalid('invalid Solana instruction bytes');
  if (!hasInstruction && actx.door === 'agent')
    throw svmInvalid('Solana agent sends require an encoded instruction');
  if (p.funds && isPC20Reference(p.funds.token))
    throw svmInvalid('PC20 SVM outbound is not supported');
  if (p.funds && (p.value ?? BigInt(0)) !== BigInt(0))
    throw svmInvalid('use either funds or value for the bridged amount');
  const amount = p.funds?.amount ?? p.value ?? BigInt(0);
  if (typeof amount !== 'bigint' || amount < BigInt(0) || amount > UINT64_MAX)
    throw svmInvalid('Solana outbound amount must fit uint64');
  if (!hasInstruction && amount === BigInt(0))
    throw svmInvalid('a funds-only send requires a positive amount');
  const metadata = svmMetadata(runtime),
    snap = await Snapshot.at(runtime.reader);
  let rulesId: Hex | undefined,
    data: Hex,
    instruction:
      | {
          recipient: Hex;
          instructionData: Uint8Array;
          accounts: readonly { pubkey: Hex; isWritable: boolean }[];
        }
      | undefined,
    cea: Hex;
  let destinationTransfer: AgenticTxMetadata['destinationTransfer'];
  let transferValue = BigInt(0);
  const gasLimit = p.gasLimit ?? BigInt(1_000_000);
  if (actx.door === 'agent') {
    const active = await selectRuleForSend(
      snap,
      gen,
      wallet,
      actx.signerPushAccount,
      to.chain
    );
    const stored = await readSvmConfig(
      snap,
      gen,
      wallet,
      active,
      runtime.pushChainNamespace
    );
    const token =
      p.funds || amount > BigInt(0)
        ? runtime.resolvePrc20(
            p.funds?.token as MoveableToken | undefined,
            to.chain
          )
        : getAddress(stored.config.assets[0].token);
    const prepared = await prepareSvmAgentExecution(
      runtime,
      gen,
      {
        wallet,
        rulesId: active.rulesId,
        token,
        amount,
        gasLimit,
        program: target,
        instructionData: hexToBytes(p.data as Hex),
      },
      metadata
    );
    data = prepared.data;
    instruction = prepared.instruction;
    cea = stored.config.expectedCEA;
    rulesId = active.rulesId;
  } else {
    const gateway = await metadata.gateway(to.chain as `solana:${string}`);
    cea = deriveAgwSvmCea(wallet, gateway.program).address;
    const resolved = hasInstruction
      ? resolveSvmCallForCea(
          {
            programAddress: target,
            data: hexToBytes(p.data as Hex),
            senderUea: wallet,
            targetChain: to.chain,
          },
          cea
        )
      : undefined;
    if (resolved)
      instruction = {
        recipient: resolved.targetProgram,
        instructionData: resolved.ixData,
        accounts: resolved.accounts,
      };
    const token = runtime.resolvePrc20(
      p.funds?.token as MoveableToken | undefined,
      to.chain
    );
    const quote = await quoteSvmRequest(
      runtime,
      snap,
      wallet,
      token,
      to.chain,
      gasLimit,
      amount
    );
    if (!hasInstruction) {
      destinationTransfer = { recipient: target, token, amount };
      transferValue = quote.isNative ? amount : BigInt(0);
    }
    const [pc, balance, allowance] = await Promise.all([
      runtime.reader.getBalance({
        address: wallet,
        blockNumber: snap.blockNumber,
      }),
      snap.read<bigint>(token, erc20Abi, 'balanceOf', [wallet]),
      snap.read<bigint>(token, erc20Abi, 'allowance', [
        wallet,
        gen.addresses.gateway,
      ]),
    ]);
    const value = quote.protocolFee + quote.nativeValueForGas;
    if (pc < value || balance < amount)
      throw new AgenticError(
        AGENTIC_ERROR_CODE.WALLET_BALANCE_INSUFFICIENT,
        'wallet cannot cover Solana outbound'
      );
    if (allowance < amount)
      throw new AgenticError(
        AGENTIC_ERROR_CODE.GATEWAY_ALLOWANCE_INSUFFICIENT,
        'set the wallet gateway allowance separately'
      );
    const call = buildAgwSvmAction({
      wallet,
      gateway: gen.addresses.gateway,
      token,
      amount,
      recipient: target,
      payload: resolved
        ? encodeAgwSvmPayload(
            resolved.targetProgram,
            resolved.accounts,
            resolved.ixData
          )
        : '0x',
      gasLimit: quote.gasLimitUsed,
      protocolFee: quote.protocolFee,
      maxPCForGas: quote.nativeValueForGas,
    });
    data = gen.contracts.encodeExecute([call]);
  }
  const hook = options?.progressHook ?? p.progressHook;
  emitAgentic(
    runtime,
    hook,
    PROGRESS_HOOK.AGENTIC_TX_107,
    rulesId,
    to.chain,
    actx.door
  );
  let response;
  try {
    response = await runtime.execute(
      {
        to: wallet,
        value: BigInt(0),
        data,
        ...(p.nonce === undefined ? {} : { nonce: p.nonce }),
        ...(p.maxFeePerGas === undefined
          ? {}
          : { maxFeePerGas: p.maxFeePerGas }),
        ...(p.maxPriorityFeePerGas === undefined
          ? {}
          : { maxPriorityFeePerGas: p.maxPriorityFeePerGas }),
        ...(p.deadline === undefined ? {} : { deadline: p.deadline }),
        ...(p.feeLockTxHash === undefined
          ? {}
          : { feeLockTxHash: p.feeLockTxHash }),
      },
      { ...options, progressHook: options?.progressHook ?? p.progressHook }
    );
  } catch (error) {
    const wrapped = wrapSendError(error) as AgenticError & {
      decodedError?: unknown;
    };
    emitAgentic(
      runtime,
      hook,
      PROGRESS_HOOK.AGENTIC_TX_199_02,
      'sendTransaction',
      wrapped.code ?? 'UNKNOWN',
      wrapped.message,
      wrapped.decodedError
    );
    throw wrapped;
  }
  const result = adaptAgenticResponse(response, {
    wallet,
    door: actx.door,
    rulesId,
    chainNamespace: to.chain,
    chain: to.chain,
    route: 'UOA_TO_CEA',
    ...(instruction
      ? {
          destinationAccount: cea,
          destinationInstruction: {
            program: instruction.recipient,
            data: bytesToHex(instruction.instructionData),
            accounts: instruction.accounts,
          },
        }
      : { destinationTransfer }),
    logical: instruction
      ? {
          to: instruction.recipient,
          data: bytesToHex(instruction.instructionData),
          value: BigInt(0),
        }
      : { to: target, data: '0x', value: transferValue },
  });
  emitAgentic(
    runtime,
    hook,
    PROGRESS_HOOK.AGENTIC_TX_199_01,
    'sendTransaction',
    response.hash
  );
  return result;
}

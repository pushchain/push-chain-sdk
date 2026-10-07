import { quoteSvmRequest } from './svm-quote';
/** Prepared-wire agent execution used by the public Solana route. */
import { getAddress, erc20Abi, type Address, type Hex } from 'viem';
import { CHAIN } from '../../constants/enums';
import type { AgenticGeneration } from '../deployments';
import type { AgenticRuntime } from '../runtime';
import { assertCanSign, wrapSendError } from '../management/common';
import { Snapshot } from '../reads/snapshot';
import { readSvmRule } from '../reads/svm';
import {
  resolveSvmContext,
  type SvmMetadataProvider,
} from '../management/svm-context';
import { buildAgwSvmAction } from './svm-outbound';
import { resolveAgwSvmInstruction } from './svm-instruction';
import { AGENTIC_ERROR_CODE, AgenticError } from '../errors';
import { verifySvmWallet } from '../management/svm';
import type { SvmPayloadAccount } from './svm-payload';

export interface PreparedSvmRequest {
  wallet: Address;
  rulesId: Hex;
  token: Address;
  amount: bigint;
  gasLimit: bigint;
  program: string;
  instructionData: Uint8Array;
  /** Already-resolved wire accounts for non-Anchor/dataless programs. */
  accounts?: readonly SvmPayloadAccount[];
}

export async function prepareSvmAgentExecution(
  runtime: AgenticRuntime,
  gen: AgenticGeneration,
  input: PreparedSvmRequest,
  metadata: SvmMetadataProvider
) {
  assertCanSign(runtime, 'internal SVM send');
  await verifySvmWallet(runtime, gen, input.wallet);
  const snap = await Snapshot.at(runtime.reader);
  const stored = await readSvmRule(
    snap,
    gen,
    input.wallet,
    input.rulesId,
    runtime.pushChainNamespace
  );
  if (getAddress(stored.agent) !== getAddress(runtime.signerPushAccount()))
    throw new AgenticError(
      AGENTIC_ERROR_CODE.NOT_OWNER_OR_AGENT,
      'signer is not this SVM rule agent'
    );
  const chain = stored.chainNamespace as CHAIN;
  const resolved = await resolveSvmContext(
    snap,
    input.wallet,
    stored.chainNamespace,
    stored.config.assets,
    metadata
  );
  if (
    resolved.expectedCEA.toLowerCase() !==
      stored.config.expectedCEA.toLowerCase() ||
    resolved.gatewayProgram.toLowerCase() !==
      stored.config.gatewayProgram.toLowerCase() ||
    resolved.ceaAccounts.some(
      (a) =>
        !stored.config.ceaAccounts.some(
          (b) => a.toLowerCase() === b.toLowerCase()
        )
    )
  )
    throw new AgenticError(
      AGENTIC_ERROR_CODE.INVALID_RULE,
      'stored SVM context does not cover the wallet and every asset'
    );
  const instruction = resolveAgwSvmInstruction(
    {
      wallet: input.wallet,
      chain,
      program: input.program,
      instructionData: input.instructionData,
      accounts: input.accounts,
    },
    stored.config
  );
  const quote = await quoteSvmRequest(
    runtime,
    snap,
    input.wallet,
    getAddress(input.token),
    chain,
    input.gasLimit,
    input.amount
  );
  const call = buildAgwSvmAction({
    ...input,
    gateway: gen.addresses.gateway,
    recipient: instruction.recipient,
    payload: instruction.payload,
    gasLimit: quote.gasLimitUsed,
    protocolFee: quote.protocolFee,
    maxPCForGas: quote.nativeValueForGas,
  });
  const walletPc = await runtime.reader.getBalance({
    address: input.wallet,
    blockNumber: snap.blockNumber,
  });
  if (walletPc < call.value)
    throw new AgenticError(
      AGENTIC_ERROR_CODE.WALLET_BALANCE_INSUFFICIENT,
      'wallet PC is below the SVM outbound quote'
    );
  if (input.amount > BigInt(0)) {
    const balance = await snap.read<bigint>(
      input.token,
      erc20Abi,
      'balanceOf',
      [input.wallet]
    );
    if (balance < input.amount)
      throw new AgenticError(
        AGENTIC_ERROR_CODE.WALLET_BALANCE_INSUFFICIENT,
        'wallet token balance is below the SVM amount'
      );
    const allowance = await snap.read<bigint>(
      input.token,
      erc20Abi,
      'allowance',
      [input.wallet, gen.addresses.gateway]
    );
    if (allowance < input.amount)
      throw new AgenticError(
        AGENTIC_ERROR_CODE.GATEWAY_ALLOWANCE_INSUFFICIENT,
        'owner must establish the SVM gateway allowance separately'
      );
  }
  const signerPc = await runtime.signerBalance();
  const gasReserve = (await runtime.getGasPrice()) * BigInt(10_000_000);
  if ((await runtime.signerAccountDeployed()) && signerPc < gasReserve)
    throw new AgenticError(
      AGENTIC_ERROR_CODE.AGENT_GAS_INSUFFICIENT,
      'deployed SVM agent identity has no Push gas balance'
    );
  return {
    stored,
    call,
    instruction,
    quote,
    data: gen.contracts.encodeExecuteAsAgent(input.rulesId, call),
  };
}

export async function sendSvmAgentWire(
  runtime: AgenticRuntime,
  gen: AgenticGeneration,
  input: PreparedSvmRequest,
  metadata: SvmMetadataProvider
) {
  const prepared = await prepareSvmAgentExecution(
    runtime,
    gen,
    input,
    metadata
  );
  try {
    const tx = await runtime.execute({
      to: input.wallet,
      value: BigInt(0),
      data: prepared.data,
    });
    // Return the ordinary signer response and explicit wire context internally.
    // The public wrapper applies the response presentation.
    return { tx, context: prepared.stored, instruction: prepared.instruction };
  } catch (error) {
    throw wrapSendError(error);
  }
}

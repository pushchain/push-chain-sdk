import { Snapshot } from './reads/snapshot';
import { readGasPrc20 } from './contracts/prc20-metadata';
import { parseAgwSvmPayload } from './execution/svm-payload';
import { deriveAgwSvmCea } from './codec/svm-accounts';
import { CHAIN_INFO } from '../constants/chain';
import { bytesToHex } from 'viem';
import {
  decodeAbiParameters,
  decodeFunctionData,
  getAddress,
  type Address,
  type Hex,
} from 'viem';
import { CHAIN } from '../constants/enums';
import { getBatchExecutorAddress } from '../constants/chain';
import { getPushChainForNetwork } from '../orchestrator/internals/helpers';
import { convertExecutorToOrigin } from '../universal/account/account';
import { pushChainNamespaceFor } from './chain';
import { UNIVERSAL_GATEWAY_PC } from '../constants/abi';
import type {
  TransactionRouteType,
  UniversalTxResponse,
} from '../orchestrator/orchestrator.types';
import {
  v5,
  SEND_OUTBOUND_SELECTOR,
  UEA_MULTICALL_PREFIX,
  type Call,
} from './contracts/v5';
import { generationsFor, resolveWalletGeneration } from './deployments';
import type { AgenticRuntime } from './runtime';
import type {
  AgenticAddress,
  AgenticHex,
  AgenticTxMetadata,
} from './agentic.types';

export interface LogicalCall {
  to: string;
  data: string;
  value: bigint;
}

/**
 * Present an AGW send as the wallet's own transaction: `from` is the AGW and
 * `to`/`data`/`value` are the logical call. The signer's `origin`, hashes,
 * nonce, gas and the on-chain `raw` fields are kept untouched; the wrapped
 * call the signer actually sent is recorded in `agentic.rawTo/rawData`.
 * Mutates in place so `wait()` (which reads these fields) reports the same
 * identity on the receipt.
 */
export function adaptAgenticResponse(
  resp: UniversalTxResponse,
  meta: Omit<AgenticTxMetadata, 'rawTo' | 'rawData'> & {
    logical: LogicalCall;
    route?: TransactionRouteType;
    chain?: CHAIN;
  }
): UniversalTxResponse {
  const rawTo = resp.to;
  const rawData = resp.data;
  if (!resp.raw) {
    resp.raw = {
      from: resp.from,
      to: resp.to,
      nonce: resp.nonce,
      data: resp.data,
      value: resp.value,
    };
  }
  resp.from = getAddress(meta.wallet);
  resp.to = meta.logical.to;
  resp.data = meta.logical.data;
  resp.value = meta.logical.value;
  if (meta.route) resp.route = meta.route;
  if (meta.chain) {
    resp.chain = meta.chain;
    resp.chainNamespace = meta.chain;
  }
  resp.agentic = {
    wallet: getAddress(meta.wallet) as AgenticAddress,
    door: meta.door,
    ...(meta.rulesId ? { rulesId: meta.rulesId } : {}),
    ...(meta.chainNamespace ? { chainNamespace: meta.chainNamespace } : {}),
    ...(meta.destinationAccount
      ? { destinationAccount: meta.destinationAccount }
      : {}),
    ...(meta.destinationCalls
      ? { destinationCalls: meta.destinationCalls.map((call) => ({ ...call })) }
      : {}),
    ...(meta.destinationInstruction
      ? { destinationInstruction: meta.destinationInstruction }
      : {}),
    ...(meta.destinationTransfer
      ? { destinationTransfer: { ...meta.destinationTransfer } }
      : {}),
    ...(meta.nativeCalls
      ? { nativeCalls: meta.nativeCalls.map((call) => ({ ...call })) }
      : {}),
    rawTo,
    rawData,
  };
  return resp;
}

/**
 * trackTransaction replay: if the tracked Push tx called execute/executeAsAgent
 * on a wallet of a registered, verified generation, restore the same logical
 * identity a live send reports. Anything unrecognised is returned unchanged.
 */
export async function adaptTrackedResponse(
  runtime: Pick<AgenticRuntime, 'reader' | 'network'>,
  resp: UniversalTxResponse
): Promise<UniversalTxResponse> {
  if (resp.agentic || generationsFor(runtime.network).length === 0) return resp;
  const batch = await adaptNativeAgentBatch(runtime, resp);
  if (batch) return batch;
  const decoded = v5.decodeWalletCall(resp.data as Hex);
  if (
    !decoded ||
    (decoded.kind !== 'execute' && decoded.kind !== 'executeAsAgent')
  )
    return resp;
  let wallet: Address;
  try {
    wallet = getAddress(resp.to);
  } catch {
    return resp;
  }
  let gen;
  try {
    gen = await resolveWalletGeneration(
      runtime.reader,
      runtime.network,
      wallet
    );
  } catch {
    return resp;
  }
  const door = decoded.kind === 'execute' ? 'owner' : 'agent';
  const rulesId =
    decoded.kind === 'executeAsAgent'
      ? (decoded.rulesId as AgenticHex)
      : undefined;
  const calls = decoded.calls;
  const outbound = calls.find(
    (c) =>
      getAddress(c.target) === gen.addresses.gateway &&
      c.data.toLowerCase().startsWith(SEND_OUTBOUND_SELECTOR)
  );
  if (outbound) {
    const out = decodeOutbound(outbound.data);
    const chain = await tokenChain(runtime, out.token);
    if (chain?.startsWith('solana:')) {
      if (
        door === 'owner' &&
        out.payload === '0x' &&
        out.amount > BigInt(0) &&
        /^0x[0-9a-fA-F]{64}$/.test(out.recipient)
      ) {
        try {
          const gas = await readGasPrc20(
            new Snapshot(runtime.reader, resp.blockNumber),
            chain
          );
          return adaptAgenticResponse(resp, {
            wallet,
            door,
            chainNamespace: chain,
            chain: chain as CHAIN,
            route: 'UOA_TO_CEA',
            destinationTransfer: {
              recipient: out.recipient,
              token: out.token,
              amount: out.amount,
            },
            logical: {
              to: out.recipient,
              data: '0x',
              value: getAddress(gas) === out.token ? out.amount : BigInt(0),
            },
          });
        } catch {
          // Preserve the actual gateway summary when historical token metadata
          // cannot be read; destination polling below still uses the known chain.
        }
      }
      try {
        const instruction = parseAgwSvmPayload(out.payload);
        const destinationInstruction = {
          program: instruction.program,
          accounts: instruction.accounts.map(({ pubkey, isWritable }) => ({
            pubkey,
            isWritable,
          })),
          data: bytesToHex(instruction.instructionData),
        };
        return adaptAgenticResponse(resp, {
          wallet,
          door,
          rulesId,
          chainNamespace: chain,
          chain: chain as CHAIN,
          route: 'UOA_TO_CEA',
          destinationInstruction,
          destinationAccount: deriveAgwSvmCea(
            wallet,
            CHAIN_INFO[chain as CHAIN].lockerContract ?? ''
          ).address,
          logical: {
            to: instruction.program,
            data: destinationInstruction.data,
            value: BigInt(0),
          },
        });
      } catch {
        // Historical owner calls may use another payload format. Preserve the
        // actual gateway call below instead of inventing instruction metadata.
      }
    }
    // The decoded wallet call is authoritative: core may have inferred a
    // Push-only route from an incomplete Cosmos record, which would stop
    // wait() from polling the destination leg.
    return adaptAgenticResponse(resp, {
      wallet,
      door,
      rulesId,
      chainNamespace: chain,
      logical: outboundResponseCall(out.calls, {
        to: outbound.target,
        data: outbound.data,
        value: outbound.value,
      }),
      ...(out.calls.length > 0 ? { destinationCalls: out.calls } : {}),
      route: 'UOA_TO_CEA',
      chain: (chain as CHAIN | undefined) ?? resp.chain,
    });
  }
  const single = calls.length === 1 ? calls[0] : undefined;
  return adaptAgenticResponse(resp, {
    wallet,
    door,
    rulesId,
    chainNamespace: undefined,
    logical: single
      ? { to: single.target, data: single.data, value: single.value }
      : { to: wallet, data: resp.data, value: BigInt(0) },
  });
}

/** Decode only supported sender-account batches, never an arbitrary forwarding helper. */
async function adaptNativeAgentBatch(
  runtime: Pick<AgenticRuntime, 'reader' | 'network'>,
  resp: UniversalTxResponse
): Promise<UniversalTxResponse | undefined> {
  let outer: Call[];
  const isUea = resp.data.toLowerCase().startsWith(UEA_MULTICALL_PREFIX);
  try {
    if (isUea) {
      const [entries] = decodeAbiParameters(
        [
          {
            type: 'tuple[]',
            components: [
              { name: 'to', type: 'address' },
              { name: 'value', type: 'uint256' },
              { name: 'data', type: 'bytes' },
            ],
          },
        ],
        `0x${resp.data.slice(10)}`
      );
      outer = entries.map((c) => ({
        target: getAddress(c.to),
        value: c.value,
        data: c.data,
      }));
    } else {
      const batch = v5.decodeWalletCall(resp.data as Hex);
      if (batch?.kind !== 'execute' || batch.mode !== `0x01${'00'.repeat(31)}`)
        return;
      outer = batch.calls;
    }
    if (
      outer.length < 2 ||
      outer.some((c) => c.value !== BigInt(0) || c.target !== outer[0].target)
    )
      return;
    const inner = outer.map((c) => v5.decodeWalletCall(c.data));
    const first = inner[0];
    if (first?.kind !== 'executeAsAgent' || first.calls.length !== 1) return;
    const nativeCalls: { to: Address; value: bigint; data: Hex }[] = [];
    for (const c of inner) {
      if (
        c?.kind !== 'executeAsAgent' ||
        c.calls.length !== 1 ||
        c.rulesId !== first.rulesId ||
        c.mode !== `0x${'00'.repeat(32)}`
      )
        return;
      const call = c.calls[0];
      nativeCalls.push({ to: call.target, value: call.value, data: call.data });
    }
    const senderAccount = getAddress(resp.from);
    if (isUea) {
      if (getAddress(resp.raw?.to ?? resp.to) !== senderAccount) return;
      const origin = await convertExecutorToOrigin(senderAccount, {
        _internal: true,
      });
      if (!origin.exists) return;
    } else {
      if (getAddress(resp.to) !== senderAccount) return;
      const executor = getBatchExecutorAddress(
        getPushChainForNetwork(runtime.network)
      );
      if (!executor) return;
      const code = await runtime.reader.getCode({
        address: senderAccount,
        blockNumber: resp.blockNumber,
      });
      if (code?.toLowerCase() !== `0xef0100${executor.slice(2).toLowerCase()}`)
        return;
    }
    const wallet = outer[0].target;
    const gen = await resolveWalletGeneration(
      runtime.reader,
      runtime.network,
      wallet
    );
    // This recognizer is only for native arrays; keep mixed/outbound batches raw.
    if (nativeCalls.some((c) => c.to === gen.addresses.gateway)) return;
    return adaptAgenticResponse(resp, {
      wallet,
      door: 'agent',
      rulesId: first.rulesId as AgenticHex,
      chainNamespace: pushChainNamespaceFor(runtime.network),
      nativeCalls,
      logical: { ...nativeCalls[0] },
    });
  } catch {
    // Unsupported payload or unverified sender/wallet: preserve the original response.
    return;
  }
}

/**
 * Canonical outbound summary for both send and replay: the first actual
 * destination call. The complete ordered calls live in agentic.destinationCalls.
 * Identical calldata can come from explicit calls or generated transfers, so
 * never infer the original input shape from a selector. For an unrecognized
 * historical payload, retain the actual gateway call instead of inventing one.
 */
export function outboundResponseCall(
  calls: readonly { to: Address; value: bigint; data: Hex }[],
  fallback: LogicalCall
): LogicalCall {
  const first = calls[0];
  return first
    ? { to: first.to, data: first.data, value: first.value }
    : fallback;
}

function decodeOutbound(data: Hex): {
  payload: Hex;
  recipient: Hex;
  amount: bigint;
  token: Address;
  calls: { to: Address; value: bigint; data: Hex }[];
} {
  const { args } = decodeFunctionData({ abi: UNIVERSAL_GATEWAY_PC, data });
  const req = args?.[0] as {
    token: Address;
    payload: Hex;
    recipient: Hex;
    amount: bigint;
  };
  let calls: { to: Address; value: bigint; data: Hex }[] = [];
  if (req.payload.toLowerCase().startsWith(UEA_MULTICALL_PREFIX)) {
    try {
      const [decodedCalls] = decodeAbiParameters(
        [
          {
            type: 'tuple[]',
            components: [
              { name: 'to', type: 'address' },
              { name: 'value', type: 'uint256' },
              { name: 'data', type: 'bytes' },
            ],
          },
        ],
        `0x${req.payload.slice(10)}`
      );
      calls = decodedCalls.map((c) => ({
        to: getAddress(c.to),
        value: c.value,
        data: c.data,
      }));
    } catch {
      calls = [];
    }
  }
  return {
    token: getAddress(req.token),
    payload: req.payload,
    recipient: req.recipient,
    amount: req.amount,
    calls,
  };
}

async function tokenChain(
  runtime: Pick<AgenticRuntime, 'reader'>,
  token: Address
): Promise<string | undefined> {
  try {
    return (await runtime.reader.readContract({
      address: token,
      abi: [
        {
          type: 'function',
          name: 'SOURCE_CHAIN_NAMESPACE',
          inputs: [],
          outputs: [{ type: 'string' }],
          stateMutability: 'view',
        },
      ],
      functionName: 'SOURCE_CHAIN_NAMESPACE',
    })) as string;
  } catch {
    return undefined;
  }
}

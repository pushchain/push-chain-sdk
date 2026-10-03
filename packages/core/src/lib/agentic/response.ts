import {
  decodeAbiParameters,
  decodeFunctionData,
  getAddress,
  type Address,
  type Hex,
} from 'viem';
import { CHAIN } from '../constants/enums';
import { UNIVERSAL_GATEWAY_PC } from '../constants/abi';
import type {
  TransactionRouteType,
  UniversalTxResponse,
} from '../orchestrator/orchestrator.types';
import { e704d5b, SEND_OUTBOUND_SELECTOR, UEA_MULTICALL_PREFIX } from './contracts/e704d5b';
import { generationsFor, resolveWalletGeneration } from './deployments';
import type { AgenticRuntime } from './runtime';
import type { AgenticAddress, AgenticHex, AgenticTxMetadata } from './agentic.types';

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
    resp.raw = { from: resp.from, to: resp.to, nonce: resp.nonce, data: resp.data, value: resp.value };
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
    ...(meta.destinationAccount ? { destinationAccount: meta.destinationAccount } : {}),
    ...(meta.destinationCalls ? { destinationCalls: meta.destinationCalls.map((call) => ({ ...call })) } : {}),
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
  const decoded = e704d5b.decodeWalletCall(resp.data as Hex);
  if (!decoded || (decoded.kind !== 'execute' && decoded.kind !== 'executeAsAgent')) return resp;
  let wallet: Address;
  try {
    wallet = getAddress(resp.to);
  } catch {
    return resp;
  }
  let gen;
  try {
    gen = await resolveWalletGeneration(runtime.reader, runtime.network, wallet);
  } catch {
    return resp;
  }
  const door = decoded.kind === 'execute' ? 'owner' : 'agent';
  const rulesId = decoded.kind === 'executeAsAgent' ? (decoded.rulesId as AgenticHex) : undefined;
  const calls = decoded.calls;
  const outbound = calls.find(
    (c) => getAddress(c.target) === gen.addresses.gateway && c.data.toLowerCase().startsWith(SEND_OUTBOUND_SELECTOR)
  );
  if (outbound) {
    const out = decodeOutbound(outbound.data);
    const chain = await tokenChain(runtime, out.token);
    // The decoded wallet call is authoritative: core may have inferred a
    // Push-only route from an incomplete Cosmos record, which would stop
    // wait() from polling the destination leg.
    return adaptAgenticResponse(resp, {
      wallet,
      door,
      rulesId,
      chainNamespace: chain,
      logical: outboundResponseCall(out.calls, { to: outbound.target, data: outbound.data, value: outbound.value }),
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
  return first ? { to: first.to, data: first.data, value: first.value } : fallback;
}

function decodeOutbound(data: Hex): {
  token: Address;
  calls: { to: Address; value: bigint; data: Hex }[];
} {
  const { args } = decodeFunctionData({ abi: UNIVERSAL_GATEWAY_PC, data });
  const req = args?.[0] as { token: Address; payload: Hex };
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
      calls = decodedCalls.map((c) => ({ to: getAddress(c.to), value: c.value, data: c.data }));
    } catch {
      calls = [];
    }
  }
  return { token: getAddress(req.token), calls };
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

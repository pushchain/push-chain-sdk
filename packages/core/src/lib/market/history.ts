import {
  decodeEventLog,
  getAbiItem,
  getAddress,
  keccak256,
  type Address,
  type Hex,
} from 'viem';
import { scanLogs } from '../agentic/reads/snapshot';
import { MARKETPLACE_ABI as ABI } from './contracts/UniversalMarketplace';
import { decodeAgentCardRules } from './rules';
import { embeddedCalls } from './data';
import { MarketError } from './errors';
import {
  deployment,
  snapshot,
  type MarketSnapshot,
  type StackRuntime,
} from './runtime';
import type { AgentCard } from './types';

/** Exact deposit-critical fields from an emitted version, including same-block updates.
 * Event content hashes, immutable provider/chain and the kernel token bind the recovered input.
 */
export async function historicalCard(
  rt: StackRuntime,
  cardId: bigint,
  version: bigint,
  openedAt: bigint,
  load: (cardId: bigint, at: MarketSnapshot) => Promise<AgentCard>
): Promise<
  Pick<
    AgentCard,
    | 'version'
    | 'provider'
    | 'paymentToken'
    | 'providerFee'
    | 'rulesBytes'
    | 'rules'
  >
> {
  let originalCause: unknown;
  try {
    const card = await load(cardId, await snapshot(rt, openedAt));
    if (card.version === version) return card;
  } catch (cause) {
    originalCause = cause;
  }
  const d = deployment(rt);
  const fail = (cause?: unknown): never => {
    throw new MarketError(
      'HISTORY_UNAVAILABLE',
      'Could not authenticate the exact opened card version from historical state or transaction input.',
      { cardId, cardVersion: version, openedAt },
      cause ?? originalCause
    );
  };
  if (!rt.agw.reader.getTransaction) return fail();
  const name =
    version === BigInt(1) ? 'AgentCardRegistered' : 'AgentCardUpdated';
  const records = await scanLogs(
    rt.agw.reader,
    {
      address: d.marketplace,
      event: getAbiItem({ abi: ABI, name }),
      args: { cardId },
    },
    d.startBlock,
    openedAt
  );
  const matches = records
    .map((log) => ({
      log,
      event: decodeEventLog({
        abi: ABI,
        eventName: name,
        data: log.data,
        topics: log.topics,
        strict: true,
      }).args,
    }))
    .filter(({ event }) => !('version' in event) || event.version === version);
  if (matches.length !== 1) return fail();
  const { log, event } = matches[0];
  if (!log.transactionHash || log.blockNumber === null) return fail();
  const tx = await rt.agw.reader.getTransaction({ hash: log.transactionHash });
  if (tx.blockNumber !== log.blockNumber) return fail();
  // The chain and provider cannot change on update. Do not decode today's potentially malformed template.
  const current = await (
    await snapshot(rt)
  ).read<{
    card: { provider: Address; chainNamespace: string; paymentToken: Address };
  }>(d.marketplace, ABI, 'getAgentCard', [cardId]);
  const fn = version === BigInt(1) ? 'registerAgentCard' : 'updateAgentCard';
  const candidates = embeddedCalls(tx.input, ABI, fn).filter((args) => {
    const i = version === BigInt(1) ? 0 : 1;
    const c = args[i] as {
      chainNamespace: string;
      paymentToken: Address;
      providerFee: bigint;
    };
    return (
      (i === 0 || args[0] === cardId) &&
      c.chainNamespace === current.card.chainNamespace &&
      getAddress(c.paymentToken) === getAddress(current.card.paymentToken) &&
      c.providerFee === event.providerFee &&
      keccak256(args[i + 1] as Hex) === event.rulesHash &&
      keccak256(args[i + 2] as Hex) === event.jobSpecHash
    );
  });
  // Identical byte sequences may appear more than once in a wrapper. Hash-bound content is identical.
  if (!candidates.length) return fail();
  const i = version === BigInt(1) ? 0 : 1;
  const rulesBytes = candidates[0][i + 1] as Hex;
  return {
    version,
    provider: getAddress(current.card.provider),
    paymentToken: getAddress(current.card.paymentToken),
    providerFee: event.providerFee,
    rulesBytes,
    rules: decodeAgentCardRules(rulesBytes),
  };
}

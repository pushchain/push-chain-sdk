import {
  decodeEventLog,
  encodeFunctionData,
  erc20Abi,
  getAbiItem,
  getAddress,
  zeroAddress,
  type Address,
  type Hex,
} from 'viem';
import { MARKETPLACE_ABI as ABI } from './contracts/UniversalMarketplace';
import { JOB_KERNEL_ABI } from './contracts/AgenticCommerce';
import { KERNEL_READ_ABI } from './kernel-wire';
import { decodeJobSpec } from '../job-spec/codec';
import { specOrigin } from '../job-spec/helpers';
import { currentGeneration } from '../agentic/deployments';
import { configId } from '../agentic/codec/ids';
import { scanLogs } from '../agentic/reads/snapshot';
import { confirmedLogs } from '../agentic/management/common';
import { decodeCardRulesWire } from './rules';
import { historicalCard } from './history';
import { MOVEABLE_TOKENS, type MoveableToken } from '../constants/tokens';
import { getPRC20Address } from '../universal/prc20-address';
import { MarketError } from './errors';
import {
  deployment,
  progress,
  snapshot,
  write,
  type MarketSnapshot,
  type StackRuntime,
} from './runtime';
import type {
  AgentCard,
  MarketDepositOptions,
  MarketDepositResult,
  MarketDepositStep,
} from './types';

type LoadCard = (cardId: bigint, at: MarketSnapshot) => Promise<AgentCard>;
export interface DepositCheckpoint {
  txs: MarketDepositStep[];
  pending?: MarketDepositResult['pending'];
}
interface Asset {
  step: MarketDepositStep['step'];
  token?: Address;
  required: bigint;
  originToken?: MoveableToken;
}
const uint256 = (n: bigint): void => {
  if (typeof n !== 'bigint' || n < BigInt(0) || n >= BigInt(1) << BigInt(256))
    throw new MarketError(
      'INVALID_AMOUNT',
      'Deposit amounts must fit uint256.'
    );
};
function submittedHash(
  cause: unknown,
  seen = new Set<unknown>()
): string | undefined {
  if (!cause || typeof cause !== 'object' || seen.has(cause) || seen.size > 16)
    return;
  seen.add(cause);
  const value = cause as Record<string, unknown>;
  for (const key of ['gatewayTxHash', 'pendingTransactionHash', 'txHash'])
    if (typeof value[key] === 'string' && value[key])
      return value[key] as string;
  for (const key of ['cause', 'error', 'details']) {
    const found = submittedHash(value[key], seen);
    if (found) return found;
  }
  return;
}
const sameAsset = (a?: Address, b?: Address): boolean =>
  a === undefined || b === undefined
    ? a === b
    : getAddress(a) === getAddress(b);

/** Recover amounts from the block that opened the job, never today's mutable card. */
export async function openedDeposit(
  rt: StackRuntime,
  jobId: bigint,
  loadCard: LoadCard
): Promise<{ result: MarketDepositResult; assets: Asset[]; rulesId: Hex }> {
  if (typeof jobId !== 'bigint' || jobId < BigInt(1))
    throw new MarketError(
      'INVALID_JOB_ID',
      'Job IDs are positive bigint values.'
    );
  const s = await snapshot(rt);
  const d = deployment(rt);
  const [cardId, version, wallet, rulesId, kernel] = await Promise.all([
    s.read<bigint>(d.marketplace, ABI, 'cardOfJob', [jobId]),
    s.read<bigint>(d.marketplace, ABI, 'cardVersionOfJob', [jobId]),
    s.read<Address>(d.marketplace, ABI, 'agwOfJob', [jobId]),
    s.read<Hex>(d.marketplace, ABI, 'rulesOfJob', [jobId]),
    s.read<{
      client: Address;
      status: number;
      expiredAt: number;
      provider: Address;
      description: Hex;
    }>(d.kernel, KERNEL_READ_ABI, 'getJob', [jobId]),
  ]);
  if (!cardId || getAddress(wallet) === zeroAddress)
    throw new MarketError(
      'NOT_MARKETPLACE_JOB',
      'This job was not opened through this marketplace.'
    );
  if (kernel.status !== 0 || kernel.expiredAt <= s.timestamp)
    throw new MarketError(
      'WRONG_STATUS',
      'Deposit only while the job is Open and unexpired.'
    );
  if (getAddress(kernel.client) !== getAddress(wallet))
    throw new MarketError(
      'INCONSISTENT_READ',
      'The marketplace wallet differs from the kernel client.'
    );

  let block = rt.jobBlocks?.get(jobId);
  if (block === undefined) {
    const created = await scanLogs(
      rt.agw.reader,
      {
        address: d.kernel,
        event: getAbiItem({ abi: JOB_KERNEL_ABI, name: 'JobCreated' }),
        args: { jobId },
      },
      d.startBlock,
      s.blockNumber
    );
    if (created.length !== 1 || created[0].blockNumber === null)
      throw new MarketError(
        'HISTORY_UNAVAILABLE',
        'Could not recover one creation block for this job.'
      );
    block = created[0].blockNumber;
  }
  const logs = await scanLogs(
    rt.agw.reader,
    {
      address: d.marketplace,
      event: getAbiItem({ abi: ABI, name: 'JobOpened' }),
      args: { cardId, agw: wallet },
    },
    block,
    block
  );
  const events = logs
    .map(
      (l) =>
        decodeEventLog({
          abi: ABI,
          eventName: 'JobOpened',
          data: l.data,
          topics: l.topics,
          strict: true,
        }).args
    )
    .filter((e) => e.jobId === jobId);
  if (events.length !== 1)
    throw new MarketError(
      'HISTORY_UNAVAILABLE',
      'Could not recover one marketplace opening for this job.'
    );
  const opened = events[0];
  const card = await historicalCard(rt, cardId, version, block, loadCard);
  if (opened.cardVersion !== version)
    throw new MarketError(
      'HISTORY_UNAVAILABLE',
      'The opening event does not match the recorded card version.'
    );
  const spec = decodeJobSpec(kernel.description, { format: 'spec' });
  if (
    !('origin' in spec) ||
    spec.origin !==
      specOrigin(d.marketplace, cardId, version, opened.principal) ||
    opened.rulesId !== rulesId ||
    getAddress(opened.agw) !== getAddress(wallet) ||
    getAddress(card.provider) !== getAddress(kernel.provider)
  )
    throw new MarketError(
      'INCONSISTENT_READ',
      'The historical opening does not match the stored job.'
    );
  const token = await s.read<Address>(d.kernel, JOB_KERNEL_ABI, 'paymentToken');
  if (getAddress(card.paymentToken) !== getAddress(token))
    throw new MarketError(
      'TOKEN_MISMATCH',
      'The opened card and kernel use different payment tokens.'
    );
  rt.jobBlocks?.set(jobId, block);
  const rules = decodeCardRulesWire(card.rulesBytes);
  return {
    result: {
      jobId,
      wallet: getAddress(wallet),
      cardId,
      cardVersion: version,
      txs: [],
    },
    assets: [
      {
        step: 'PRINCIPAL',
        token: getAddress(rules.assets[rules.principalAsset].token),
        required: opened.principal,
      },
      {
        step: 'PROVIDER_FEE',
        token: getAddress(token),
        required: card.providerFee,
      },
      { step: 'PC', required: card.rules.maxGasPerCall },
    ],
    rulesId,
  };
}

/** Separate, confirmed top-ups from the signer's Push identity. Does not fund kernel escrow. */
export async function depositJob(
  rt: StackRuntime,
  jobId: bigint,
  options: MarketDepositOptions,
  loadCard: LoadCard,
  checkpoints: Map<bigint, DepositCheckpoint>
): Promise<MarketDepositResult> {
  if (rt.agw.isReadOnly)
    throw new MarketError('READ_ONLY', 'Connect a signing wallet to deposit.');
  if ('skipApprovals' in options)
    throw new MarketError(
      'INVALID_DEPOSIT_OPTIONS',
      'V2 cards grant pinned approvals to the agent; deposit has no owner approval step.'
    );
  if (
    options.funding !== undefined &&
    !['push', 'origin'].includes(options.funding)
  )
    throw new MarketError(
      'INVALID_DEPOSIT_OPTIONS',
      'Choose push or origin deposit funding.'
    );
  if (options.funding === 'origin' && rt.agw.signerIsPushNative())
    throw new MarketError(
      'INVALID_DEPOSIT_OPTIONS',
      'Use push funding for a Push-native signer.'
    );
  if (options.pcAmount !== undefined) uint256(options.pcAmount);
  if (options.providerFee !== undefined) uint256(options.providerFee);
  const { result, assets, rulesId } = await openedDeposit(rt, jobId, loadCard);
  const previous = checkpoints.get(jobId);
  result.txs = [...(options.resume ?? previous?.txs ?? [])];
  if (
    previous?.pending &&
    !result.txs.some((t) => sameAsset(t.token, previous.pending?.token))
  )
    throw new MarketError(
      'DEPOSIT_INCOMPLETE',
      'A broadcast deposit still needs tracking. Rehydrate its response and pass it as a resume step before sending more.',
      { ...result, pending: previous.pending }
    );
  const fee = assets[1];
  fee.required = options.providerFee ?? fee.required;
  assets[2].required = options.pcAmount ?? assets[2].required;
  if (assets[0].token === fee.token) {
    assets[0].step = 'PRINCIPAL_AND_FEE';
    assets[0].required += fee.required;
    uint256(assets[0].required);
    assets.splice(1, 1);
  }
  const balance = async (asset: Asset, account: Address): Promise<bigint> =>
    asset.token
      ? (await snapshot(rt)).read<bigint>(asset.token, erc20Abi, 'balanceOf', [
          account,
        ])
      : rt.agw.reader.getBalance({ address: account });
  const available = async (): Promise<void> => {
    const s = await snapshot(rt);
    const d = deployment(rt);
    const job = await s.read<{ status: number; expiredAt: number }>(
      d.kernel,
      KERNEL_READ_ABI,
      'getJob',
      [jobId]
    );
    if (job.status !== 0 || job.expiredAt <= s.timestamp)
      throw new MarketError(
        'WRONG_STATUS',
        'The job is no longer Open and unexpired.'
      );
    const gen = currentGeneration(rt.agw.network);
    if (
      !(await s.read<boolean>(
        gen.addresses.sessionEngine,
        gen.contracts.abis.engine,
        'isPermissionEnabled',
        [rulesId, result.wallet]
      ))
    )
      throw new MarketError(
        'RULE_NOT_FOUND',
        'The job permission is no longer enabled.'
      );
    const actions = await s.read<readonly Hex[]>(
      gen.addresses.sessionEngine,
      gen.contracts.abis.engine,
      'getEnabledActions',
      [result.wallet, rulesId]
    );
    if (actions.length !== 1)
      throw new MarketError(
        'INCONSISTENT_READ',
        'The job permission has an unexpected action count.'
      );
    const config = await s.read<{
      initialized: boolean;
      assets: readonly { spent: bigint }[];
    }>(gen.addresses.rulesPolicy, gen.contracts.abis.policy, 'getConfig', [
      configId(result.wallet, rulesId, actions[0]),
      result.wallet,
    ]);
    if (!config.initialized || config.assets.some((a) => a.spent > BigInt(0)))
      throw new MarketError(
        'DEPOSIT_ALREADY_USED',
        'The job permission has already moved assets. Review funding manually before adding more.'
      );
  };
  const checkpoint: DepositCheckpoint = {
    txs: result.txs,
    pending: previous?.pending,
  };
  checkpoints.set(jobId, checkpoint);
  let submitting: Omit<MarketDepositStep, 'tx'> | undefined;
  try {
    // Uncertain prior receipts must settle before balances can authorize another transfer.
    for (const step of result.txs) await confirmedLogs(rt.agw, step.tx);
    checkpoint.pending = undefined;
    await available();
    for (const asset of assets) {
      const held = await balance(asset, result.wallet);
      if (held >= asset.required) continue;
      if (result.txs.some((t) => sameAsset(t.token, asset.token)))
        throw new MarketError(
          'DEPOSIT_BALANCE_CHANGED',
          'A confirmed deposit no longer covers its target balance. Review the wallet before sending more.'
        );
      const needed = asset.required - held;
      if (asset.token && options.funding === 'origin') {
        const chain = rt.agw.signerOrigin().chain;
        asset.originToken = (MOVEABLE_TOKENS[chain] ?? []).find((candidate) => {
          try {
            return (
              getAddress(
                getPRC20Address(
                  { chain, address: candidate.address },
                  { network: rt.agw.network }
                ).address
              ) === asset.token
            );
          } catch {
            return false;
          }
        });
        if (!asset.originToken)
          throw new MarketError(
            'TOKEN_ROUTE_UNAVAILABLE',
            'This deposit token has no registered route from the connected origin chain. Prefund it on Push or connect its origin.',
            { chain, token: asset.token }
          );
        continue;
      }
      const source = getAddress(rt.agw.signerPushAccount());
      if (source === result.wallet || (await balance(asset, source)) < needed)
        throw new MarketError(
          'INSUFFICIENT_FUNDS',
          'The connected signer’s Push account cannot cover this deposit.',
          { token: asset.token, required: needed, account: source }
        );
    }
    for (const asset of assets) {
      await available();
      const held = await balance(asset, result.wallet);
      if (held >= asset.required) continue;
      const amount = asset.required - held;
      if (result.txs.some((t) => sameAsset(t.token, asset.token)))
        throw new MarketError(
          'DEPOSIT_BALANCE_CHANGED',
          'A confirmed deposit balance changed before the next step. Review the wallet before sending more.'
        );
      submitting = { step: asset.step, token: asset.token, amount };
      const tx = asset.originToken
        ? await rt.agw.execute(
            { to: result.wallet, funds: { token: asset.originToken, amount } },
            { progressHook: options.progressHook }
          )
        : await write(
            rt,
            asset.token
              ? {
                  target: asset.token,
                  value: BigInt(0),
                  data: encodeFunctionData({
                    abi: erc20Abi,
                    functionName: 'transfer',
                    args: [result.wallet, amount],
                  }),
                }
              : { target: result.wallet, value: amount, data: '0x' },
            options.progressHook,
            'MARKET',
            true
          );
      result.txs.push({ step: asset.step, token: asset.token, amount, tx });
      submitting = undefined;
      progress(
        rt,
        options.progressHook,
        'MARKET-TX-111',
        'Deposit step submitted',
        { step: asset.step, token: asset.token, amount, txHash: tx.hash }
      );
      await confirmedLogs(rt.agw, tx);
      if ((await balance(asset, result.wallet)) < asset.required)
        throw new MarketError(
          'DEPOSIT_BALANCE_CHANGED',
          'The transfer did not establish the required wallet balance. Review the receipt before retrying.'
        );
    }
    checkpoints.delete(jobId);
    return result;
  } catch (cause) {
    const txHash = submitting && submittedHash(cause);
    if (submitting && txHash) {
      checkpoint.pending = {
        ...submitting,
        txHash,
        chain:
          options.funding === 'origin' && submitting.token
            ? rt.agw.signerOrigin().chain
            : rt.agw.pushChainNamespace,
      };
    }
    throw new MarketError(
      'DEPOSIT_INCOMPLETE',
      'The deposit did not finish. Resume with the recorded transactions after resolving the cause.',
      {
        ...result,
        ...(checkpoint.pending ? { pending: checkpoint.pending } : {}),
        causeCode: cause instanceof MarketError ? cause.code : undefined,
      },
      cause
    );
  }
}

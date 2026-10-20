import {
  encodeFunctionData,
  getAddress,
  domainSeparator,
  keccak256,
  stringToHex,
  toHex,
  zeroAddress,
  type Address,
  type Hex,
} from 'viem';
import { MARKETPLACE_ABI as ABI } from './contracts/UniversalMarketplace';
import { JOB_KERNEL_ABI } from './contracts/AgenticCommerce';
import { MARKET_RULES_ABI } from './contracts/UniversalMarketplaceRules';
import { currentGeneration } from '../agentic/deployments';
import {
  buildSession,
  encodeEnvelope,
  encodeSession,
} from '../agentic/codec/session';
import { encodeUniversalTerms } from '../agentic/codec/universal-terms';
import { assertLabel } from '../agentic/management/label';
import { decodeJobSpec, encodeJobSpec } from '../job-spec/codec';
import {
  resolveJobSpec,
  describeJobSpec,
  specOrigin,
} from '../job-spec/helpers';
import type { JobSpecTemplate } from '../job-spec/types';
import {
  decodeAgentCardRules,
  decodeCardRulesWire,
  encodeAgentCardRules,
  fillCardRules,
} from './rules';
import { decodeCreateJob } from './kernel-wire';
import { depositJob, type DepositCheckpoint } from './deposit';
import {
  deployment,
  eventArgs,
  progress,
  snapshot,
  write,
  type MarketSnapshot,
  type StackRuntime,
} from './runtime';
import { MarketError, stackError, unavailable } from './errors';
import type {
  AgentCard,
  AgentCardInput,
  AgentCardSummary,
  JobPlan,
  MarketJobInputs,
  MarketNamespace,
  MarketPreviewOptions,
  MarketWriteOptions,
  MarketDepositOptions,
  OwnerIntent,
} from './types';
import type { CHAIN } from '../constants/enums';

interface WireCard extends Omit<AgentCardInput, 'chain'> {
  provider: Address;
  chainNamespace: string;
  active: boolean;
}
interface WireView {
  card: WireCard;
  rules: Hex;
  jobSpecTemplate: Hex;
  version: bigint;
  verified: boolean;
  disabled: boolean;
}
const fp = (x: unknown): string =>
  JSON.stringify(x, (_, v) => (typeof v === 'bigint' ? v.toString() : v));
const ownerIntentFields = [
  ['owner', 'address'],
  ['wallet', 'address'],
  ['executor', 'address'],
  ['index', 'uint96'],
  ['sessionHash', 'bytes32'],
  ['mode', 'bytes32'],
  ['execCalldataHash', 'bytes32'],
  ['nonceKey', 'uint192'],
  ['nonceSeq', 'uint64'],
  ['grantNonce', 'uint64'],
  ['deadline', 'uint48'],
  ['signerChainId', 'uint256'],
].map(([name, type]) => ({ name, type }));
function id(n: bigint): void {
  if (typeof n !== 'bigint' || n < BigInt(1))
    throw new MarketError(
      'INVALID_CARD_ID',
      'Card IDs are positive bigint values.'
    );
}

export class MarketNamespaceImpl implements MarketNamespace {
  constructor(private readonly rt: StackRuntime) {}
  private readonly deposits = new Set<bigint>();
  private readonly depositCheckpoints = new Map<bigint, DepositCheckpoint>();
  private async viewAt(cardId: bigint, s: MarketSnapshot): Promise<WireView> {
    id(cardId);
    const d = deployment(this.rt);
    const v = await s.read<WireView>(d.marketplace, ABI, 'getAgentCard', [
      cardId,
    ]);
    if (getAddress(v.card.provider) === zeroAddress)
      throw new MarketError(
        'CARD_NOT_FOUND',
        'This agent card does not exist.'
      );
    return v;
  }
  private async summaryAt(
    cardId: bigint,
    s: MarketSnapshot,
    view?: WireView
  ): Promise<AgentCardSummary> {
    const v = view ?? (await this.viewAt(cardId, s));
    const d = deployment(this.rt);
    const { chainNamespace, ...card } = v.card;
    return {
      ...card,
      cardId,
      chain: chainNamespace,
      version: v.version,
      verified: v.verified,
      disabled: v.disabled,
      rating: await s.read<bigint>(d.marketplace, ABI, 'getAgentRating', [
        v.card.provider,
      ]),
    };
  }
  private async cardAt(cardId: bigint, s: MarketSnapshot): Promise<AgentCard> {
    const v = await this.viewAt(cardId, s);
    return {
      ...(await this.summaryAt(cardId, s, v)),
      rules: decodeAgentCardRules(v.rules),
      jobSpecTemplate: decodeJobSpec(v.jobSpecTemplate, {
        format: 'template',
      }) as JobSpecTemplate,
      rulesBytes: v.rules,
      jobSpecTemplateBytes: v.jobSpecTemplate,
    };
  }
  async card(cardId: bigint): Promise<AgentCard> {
    return this.cardAt(cardId, await snapshot(this.rt));
  }
  async cards(
    options: { provider?: Address; chain?: string; active?: boolean } = {}
  ): Promise<{ cards: AgentCardSummary[] }> {
    const s = await snapshot(this.rt);
    const d = deployment(this.rt);
    const count = options.provider
      ? await s.read<bigint>(d.marketplace, ABI, 'agentCardOf', [
          getAddress(options.provider),
        ])
      : await s.read<bigint>(d.marketplace, ABI, 'agentCardCount');
    const cards: AgentCardSummary[] = [];
    // Bounded requests. An indexer can replace the walk without changing the public result.
    for (
      let start = options.provider ? count : BigInt(1);
      start > BigInt(0) && start <= count;

    ) {
      const batch = options.provider
        ? [start]
        : Array.from(
            {
              length: Number(
                count - start + BigInt(1) > BigInt(8)
                  ? BigInt(8)
                  : count - start + BigInt(1)
              ),
            },
            (_, i) => start + BigInt(i)
          );
      const rows = await Promise.all(batch.map((n) => this.summaryAt(n, s)));
      for (const card of rows)
        if (
          (!options.chain || card.chain === options.chain) &&
          (options.active === undefined || card.active === options.active)
        ) {
          cards.push(card);
        }
      if (options.provider) break;
      start += BigInt(batch.length);
    }
    return { cards };
  }
  async job(jobId: bigint): Promise<{
    cardId: bigint;
    cardVersion: bigint;
    wallet: Address;
    rulesId: Hex;
  }> {
    const s = await snapshot(this.rt);
    const d = deployment(this.rt);
    const [cardId, cardVersion, wallet, rulesId] = await Promise.all([
      s.read<bigint>(d.marketplace, ABI, 'cardOfJob', [jobId]),
      s.read<bigint>(d.marketplace, ABI, 'cardVersionOfJob', [jobId]),
      s.read<Address>(d.marketplace, ABI, 'agwOfJob', [jobId]),
      s.read<Hex>(d.marketplace, ABI, 'rulesOfJob', [jobId]),
    ]);
    return { cardId, cardVersion, wallet, rulesId };
  }
  async activeJob(wallet: Address): Promise<{ jobId: bigint }> {
    const d = deployment(this.rt);
    return {
      jobId: await (
        await snapshot(this.rt)
      ).read<bigint>(d.marketplace, ABI, 'activeJobOf', [getAddress(wallet)]),
    };
  }

  async preview(
    cardId: bigint,
    options: MarketPreviewOptions
  ): Promise<JobPlan> {
    const rt = this.rt;
    const d = deployment(rt);
    const s = await snapshot(rt);
    const card = await this.cardAt(cardId, s);
    const gen = currentGeneration(rt.agw.network);
    const now = s.timestamp;
    if (card.disabled || !card.active)
      throw new MarketError(
        'AGENT_CARD_INACTIVE',
        'This agent card is inactive or disabled.'
      );
    if (card.jobSpecTemplate.allowedMutability !== 'NONE')
      unavailable('Mutable marketplace criteria');
    const [
      factory,
      kernel,
      paused,
      evaluator,
      hook,
      rulesHelper,
      kernelPaused,
    ] = await Promise.all([
      s.read<Address>(d.marketplace, ABI, 'AGW_FACTORY'),
      s.read<Address>(d.marketplace, ABI, 'KERNEL'),
      s.read<boolean>(d.marketplace, ABI, 'paused'),
      s.read<Address>(d.marketplace, ABI, 'evaluator'),
      s.read<Address>(d.marketplace, ABI, 'hook'),
      s.read<Address>(d.marketplace, ABI, 'RULES'),
      s.read<boolean>(d.kernel, JOB_KERNEL_ABI, 'paused'),
    ]);
    if (
      getAddress(factory) !== getAddress(gen.addresses.factory) ||
      getAddress(kernel) !== getAddress(d.kernel) ||
      getAddress(hook) !== getAddress(d.hook) ||
      getAddress(rulesHelper) !== getAddress(d.rules) ||
      getAddress(evaluator) !== getAddress(d.evaluator)
    )
      throw new MarketError(
        'CAPABILITY_UNAVAILABLE',
        'The marketplace deployment wiring has changed.'
      );
    if (paused || kernelPaused)
      throw new MarketError('PAUSED', 'The marketplace or kernel is paused.');
    if (getAddress(card.provider) === getAddress(evaluator))
      throw new MarketError(
        'PROVIDER_IS_EVALUATOR',
        'The provider cannot be the evaluator.'
      );
    const job: MarketJobInputs = {
      principal: options.principal,
      expiredAt: options.expiredAt,
      executeBy: options.executeBy,
      params: options.params ?? [],
    };
    if (
      typeof job.principal !== 'bigint' ||
      job.principal < card.principalMin ||
      job.principal > card.principalMax
    )
      throw new MarketError(
        'PRINCIPAL_OUT_OF_RANGE',
        'The principal is outside this card’s range.'
      );
    if (
      !Number.isSafeInteger(job.expiredAt) ||
      job.expiredAt < now + card.minDuration ||
      job.expiredAt > now + card.maxDuration ||
      job.expiredAt >= 2 ** 48
    )
      throw new MarketError(
        'EXPIRY_OUT_OF_RANGE',
        'Choose an expiry inside the card’s duration window.'
      );
    if (
      !Number.isSafeInteger(job.executeBy) ||
      job.executeBy < now + card.minExecuteWindow ||
      job.executeBy + card.settleWindow > job.expiredAt
    )
      throw new MarketError(
        'EXECUTE_BY_OUT_OF_RANGE',
        'Choose an execution deadline that leaves the settlement window.'
      );
    const owner = getAddress(rt.agw.signerPushAccount());
    if (owner === getAddress(card.provider))
      throw new MarketError(
        'CLIENT_IS_PROVIDER',
        'The wallet owner and provider must be different.'
      );
    if (
      options.walletIndex !== undefined &&
      (!Number.isSafeInteger(options.walletIndex) || options.walletIndex < 0)
    )
      throw new MarketError(
        'INVALID_WALLET_INDEX',
        'The wallet index must be a nonnegative safe integer.'
      );
    const index =
      options.walletIndex === undefined
        ? await s.read<bigint>(
            factory,
            gen.contracts.abis.factory,
            'walletCount',
            [owner]
          )
        : BigInt(options.walletIndex);
    const [wallet, deployed] = await s.read<[Address, boolean]>(
      factory,
      gen.contracts.abis.factory,
      'predictWallet',
      [owner, index]
    );
    if (
      deployed &&
      getAddress(
        await s.read<Address>(factory, gen.contracts.abis.factory, 'ownerOf', [
          wallet,
        ])
      ) !== owner
    )
      throw new MarketError(
        'NOT_OWNER',
        'The connected account does not own this wallet.'
      );
    if (
      (await s.read<bigint>(d.marketplace, ABI, 'activeJobOf', [wallet])) !==
      BigInt(0)
    )
      throw new MarketError(
        'WALLET_HAS_ACTIVE_JOB',
        'This wallet already has an active marketplace job.'
      );
    const accounts: Record<string, Address> = {};
    const chains = new Set([
      card.chain,
      ...card.jobSpecTemplate.reads
        .filter(
          (r, i) =>
            r.fills?.some((f) => f.source === 'WALLET') ||
            card.jobSpecTemplate.checks.some(
              (c) => c.read === i && c.target === 'agentic:wallet'
            )
        )
        .map((r) => `${r.chainNamespace}:${r.chainId}`),
    ]);
    for (const chain of chains) {
      const [independent, onchain] = await Promise.all([
        rt.agw.resolveCEA(wallet, chain as CHAIN),
        s.read<Address>(d.marketplace, ABI, 'computeCEA', [
          wallet,
          keccak256(stringToHex(chain)),
        ]),
      ]);
      if (getAddress(independent.cea) !== getAddress(onchain))
        throw new MarketError(
          'CEA_MISMATCH',
          'The independently derived destination wallet differs from the marketplace.',
          { chain, wallet, expectedCEA: onchain, derivedCEA: independent.cea }
        );
      accounts[chain] = getAddress(onchain);
    }
    const rules = decodeCardRulesWire(card.rulesBytes);
    const terms = fillCardRules(
      rules,
      job.principal,
      accounts[card.chain],
      job.expiredAt
    );
    const session = buildSession({
      validator: gen.addresses.sessionValidator,
      agent: card.provider,
      rulesPolicy: gen.addresses.rulesPolicy,
      actions: [
        {
          target: gen.addresses.gateway,
          selector: '0x77b86bec',
          initData: encodeEnvelope(card.chain, encodeUniversalTerms(terms)),
        },
      ],
    });
    const rawChain = rt.agw.signerOrigin().chain;
    if (!/^eip155:[1-9]\d*$/.test(rawChain))
      unavailable('Non-EVM OwnerIntent signing');
    const deadline = options.deadline ?? Math.min(now + 3600, job.expiredAt);
    if (
      !Number.isSafeInteger(deadline) ||
      deadline <= now ||
      deadline >= 2 ** 48
    )
      throw new MarketError(
        'INVALID_DEADLINE',
        'The intent deadline must be a future uint48 timestamp.'
      );
    const request = {
      cardId,
      owner,
      index,
      job,
      deadline,
      signerChainId: BigInt(rawChain.split(':')[1]),
    };
    const [intent, [mode, calldata]] = await Promise.all([
      s.read<OwnerIntent>(d.marketplace, ABI, 'previewIntent', [
        request,
        session,
      ]),
      s.read<[Hex, Hex]>(d.marketplace, ABI, 'buildCreateJobCalldata', [
        cardId,
        owner,
        index,
        job,
      ]),
    ]);
    const spec = resolveJobSpec(card.jobSpecTemplate, {
      principal: job.principal,
      params: job.params,
      accounts,
      origin: specOrigin(d.marketplace, cardId, card.version, job.principal),
      executeBy: job.executeBy,
      settleWindow: card.settleWindow,
    });
    if (
      getAddress(intent.owner) !== owner ||
      intent.index !== index ||
      intent.deadline !== deadline ||
      intent.signerChainId !== request.signerChainId
    )
      throw new MarketError(
        'INTENT_MISMATCH',
        'The preview intent names a different owner, wallet index, chain or deadline.'
      );
    const bytes = encodeJobSpec(spec);
    const packedTarget = getAddress(('0x' + calldata.slice(2, 42)) as Address);
    const kernelCall = decodeCreateJob(('0x' + calldata.slice(106)) as Hex);
    if (
      packedTarget !== getAddress(d.kernel) ||
      BigInt('0x' + calldata.slice(42, 106)) !== BigInt(0) ||
      kernelCall.description !== bytes ||
      getAddress(kernelCall.provider) !== getAddress(card.provider) ||
      getAddress(kernelCall.evaluator) !== getAddress(evaluator) ||
      getAddress(kernelCall.hook) !== getAddress(hook) ||
      kernelCall.expiredAt !== BigInt(job.expiredAt) ||
      intent.execCalldataHash !== keccak256(calldata) ||
      intent.sessionHash !== keccak256(encodeSession(session)) ||
      intent.mode !== mode ||
      getAddress(intent.wallet) !== getAddress(wallet) ||
      getAddress(intent.executor) !== getAddress(d.marketplace)
    )
      throw new MarketError(
        'INTENT_MISMATCH',
        'The marketplace preview disagrees with the independently built job or permissions.'
      );
    await s.read(d.rules, MARKET_RULES_ABI, 'checkRulesMatchCard', [
      card.rulesBytes,
      session,
      {
        agent: card.provider,
        chainHash: keccak256(stringToHex(card.chain)),
        principal: job.principal,
        expiredAt: job.expiredAt,
        expectedCEA: accounts[card.chain],
      },
    ]);
    const label = options.label ?? 'Agent job';
    assertLabel(label);
    const description = describeJobSpec(spec);
    return {
      cardId,
      cardVersion: card.version,
      wallet: getAddress(wallet),
      walletDeployed: deployed,
      session,
      intent,
      calldata,
      jobSpec: { spec, bytes },
      job,
      label,
      deposit: {
        principal: {
          prc20: terms.assets[rules.principalAsset].token,
          amount: job.principal,
        },
        providerFee: { token: card.paymentToken, amount: card.providerFee },
        pc: card.rules.maxGasPerCall,
      },
      preview: {
        mayDo: terms.allowedCalls.map(
          (c) =>
            `${card.chain}: ${c.target} ${c.selector}; ${c.pins.length} argument conditions; max value ${c.maxValue}.`
        ),
        mayMove: terms.assets.map(
          (a) =>
            `${a.token}: up to ${a.maxPerCall} per outbound, ${a.maxTotal} total; gas budget ${terms.maxGasPerCall} PC wei.`
        ),
        judgedBy: [...description.checks, description.logic],
        until: new Date(job.expiredAt * 1000).toISOString(),
      },
    };
  }
  async openJob(
    plan: JobPlan,
    options: MarketWriteOptions & { relay?: boolean } = {}
  ) {
    if (options.relay) unavailable('Marketplace relaying');
    if (this.rt.agw.isReadOnly)
      throw new MarketError(
        'READ_ONLY',
        'Connect a signing wallet to open a job.'
      );
    if (this.rt.canSignTypedData?.() === false)
      unavailable('EIP-712 signing with this wallet');
    if (!this.rt.agw.reader.call)
      unavailable('Signed marketplace transaction simulation with this reader');
    const ownerCode = await this.rt.agw.reader.getCode({
      address: this.rt.agw.signerPushAccount(),
    });
    if (!this.rt.agw.signerIsPushNative() && (!ownerCode || ownerCode === '0x'))
      throw new MarketError(
        'OWNER_NOT_DEPLOYED',
        'Deploy the connected signer’s UEA on Push before signing a marketplace intent.'
      );
    const fresh = await this.preview(plan.cardId, {
      ...plan.job,
      walletIndex: Number(plan.intent.index),
      deadline: plan.intent.deadline,
      label: plan.label,
    });
    if (fp(fresh) !== fp(plan))
      throw new MarketError(
        'STALE_PLAN',
        'The plan changed. Preview and review it again before signing.'
      );
    const d = deployment(this.rt);
    const gen = currentGeneration(this.rt.agw.network);
    progress(this.rt, options.progressHook, 'MARKET-TX-101', 'Plan verified', {
      cardId: plan.cardId,
      wallet: plan.wallet,
    });
    const domain = {
      name: 'AGWFactory',
      version: '1',
      chainId: Number(plan.intent.signerChainId),
      verifyingContract: gen.addresses.factory,
      salt: toHex(BigInt(this.rt.agw.pushChainNamespace.split(':')[1]), {
        size: 32,
      }),
    };
    const separator = await (
      await snapshot(this.rt)
    ).read<Hex>(
      gen.addresses.factory,
      gen.contracts.abis.factory,
      'domainSeparator',
      [plan.intent.signerChainId]
    );
    if (separator.toLowerCase() !== domainSeparator({ domain }).toLowerCase())
      throw new MarketError(
        'INTENT_MISMATCH',
        'The factory EIP-712 domain differs from the signing domain.'
      );
    let sig: Hex;
    try {
      sig = (await this.rt.signTypedData({
        domain,
        types: { OwnerIntent: ownerIntentFields },
        primaryType: 'OwnerIntent',
        message: { ...plan.intent },
      })) as Hex;
    } catch (error) {
      throw stackError(error);
    }
    progress(
      this.rt,
      options.progressHook,
      'MARKET-TX-102',
      'Owner intent signed'
    );
    const call = {
      target: d.marketplace,
      value: BigInt(0),
      data: encodeFunctionData({
        abi: ABI,
        functionName: 'openJob',
        args: [
          {
            cardId: plan.cardId,
            cardVersion: plan.cardVersion,
            job: plan.job,
            session: plan.session,
            intent: plan.intent,
            sig,
            label: plan.label,
          },
        ],
      }),
    };
    try {
      // Runs the actual factory, owner verifier (UEA / ERC-1271 / EOA), grant and kernel create.
      // This catches unsupported 7702 delegates without spending gas or bypassing owner verification.
      await this.rt.agw.reader.call({
        to: call.target,
        data: call.data,
        account: this.rt.agw.signerPushAccount(),
      });
    } catch (cause) {
      throw new MarketError(
        'OPEN_JOB_SIMULATION_FAILED',
        'The signed marketplace request failed simulation. No transaction was submitted.',
        { contractError: stackError(cause) },
        cause
      );
    }
    const tx = await write(this.rt, call, options.progressHook, 'MARKET', true);
    const e = await eventArgs(this.rt, tx, d.marketplace, ABI, 'JobOpened');
    if (
      e['cardId'] !== plan.cardId ||
      e['cardVersion'] !== plan.cardVersion ||
      getAddress(e['agw'] as Address) !== plan.wallet ||
      e['principal'] !== plan.job.principal ||
      getAddress(e['owner'] as Address) !== plan.intent.owner
    )
      throw new MarketError(
        'RECEIPT_MISMATCH',
        'The opened job does not match the signed plan.',
        { txHash: tx.hash }
      );
    return {
      jobId: e['jobId'] as bigint,
      wallet: getAddress(e['agw'] as Address),
      rulesId: e['rulesId'] as Hex,
      tx,
    };
  }
  async deposit(jobId: bigint, options: MarketDepositOptions = {}) {
    if (this.deposits.has(jobId))
      throw new MarketError(
        'DEPOSIT_IN_PROGRESS',
        'A deposit for this job is already running on this client.'
      );
    this.deposits.add(jobId);
    try {
      return await depositJob(
        this.rt,
        jobId,
        options,
        (id, s) => this.cardAt(id, s),
        this.depositCheckpoints
      );
    } finally {
      this.deposits.delete(jobId);
    }
  }
  readonly agent = {
    card: async (): Promise<AgentCard | undefined> => {
      const d = deployment(this.rt);
      const s = await snapshot(this.rt);
      const n = await s.read<bigint>(d.marketplace, ABI, 'agentCardOf', [
        this.rt.agw.signerPushAccount(),
      ]);
      return n ? this.cardAt(n, s) : undefined;
    },
    register: async (
      card: AgentCardInput,
      options: Parameters<MarketNamespace['agent']['register']>[1]
    ) => this.cardWrite(undefined, card, options),
    update: async (
      cardId: bigint,
      card: AgentCardInput,
      options: Parameters<MarketNamespace['agent']['update']>[2]
    ) => this.cardWrite(cardId, card, options),
    setActive: async (
      cardId: bigint,
      active: boolean,
      options: MarketWriteOptions = {}
    ) => {
      const card = await this.summaryAt(cardId, await snapshot(this.rt));
      this.assertProvider(card);
      const d = deployment(this.rt);
      return write(
        this.rt,
        {
          target: d.marketplace,
          value: BigInt(0),
          data: encodeFunctionData({
            abi: ABI,
            functionName: 'setAgentCardActive',
            args: [cardId, active],
          }),
        },
        options.progressHook,
        'MARKET',
        true
      );
    },
  };
  private assertProvider(card: Pick<AgentCard, 'provider'>): void {
    if (
      getAddress(card.provider) !== getAddress(this.rt.agw.signerPushAccount())
    )
      throw new MarketError(
        'NOT_CARD_PROVIDER',
        'Connect the provider that registered this card.'
      );
  }
  private async cardWrite(
    cardId: bigint | undefined,
    card: AgentCardInput,
    options: Parameters<MarketNamespace['agent']['register']>[1]
  ) {
    const d = deployment(this.rt);
    const s = await snapshot(this.rt);
    if (
      !card.jobType ||
      !/^eip155:[1-9]\d*$/.test(card.chain) ||
      !card.metadataURI ||
      !/^0x[\da-f]{64}$/i.test(card.metadataHash) ||
      /^0x0{64}$/i.test(card.metadataHash)
    )
      throw new MarketError(
        'INVALID_AGENT_CARD',
        'Supply a job type, EVM execution chain, metadata URI and nonzero metadata hash.'
      );
    for (const v of [card.providerFee, card.principalMin, card.principalMax])
      if (
        typeof v !== 'bigint' ||
        v < BigInt(0) ||
        v >= BigInt(1) << BigInt(256)
      )
        throw new MarketError(
          'INVALID_AGENT_CARD',
          'Card amounts must fit uint256.'
        );
    if (
      card.principalMax === BigInt(0) ||
      card.principalMin > card.principalMax ||
      [
        card.minDuration,
        card.maxDuration,
        card.minExecuteWindow,
        card.settleWindow,
      ].some((n) => !Number.isInteger(n) || n < 0 || n > 0xffffffff) ||
      card.minDuration < 3600 ||
      card.minDuration > card.maxDuration ||
      card.settleWindow < 1 ||
      card.minExecuteWindow + card.settleWindow > card.maxDuration
    )
      throw new MarketError(
        'INVALID_AGENT_CARD',
        'The principal or duration ranges are invalid.'
      );
    if (cardId !== undefined) {
      const current = await this.summaryAt(cardId, s);
      this.assertProvider(current);
      if (current.chain !== card.chain)
        throw new MarketError(
          'CARD_IDENTITY_IMMUTABLE',
          'An existing card cannot change its execution chain.'
        );
    }
    if (options.jobSpecTemplate.allowedMutability !== 'NONE')
      unavailable('Mutable marketplace criteria');
    const token = await s.read<Address>(
      d.kernel,
      JOB_KERNEL_ABI,
      'paymentToken'
    );
    if (getAddress(card.paymentToken) !== getAddress(token))
      throw new MarketError(
        'TOKEN_MISMATCH',
        'This deployment accepts only the kernel payment token.'
      );
    const rules = encodeAgentCardRules(options.rules, {
      chain: card.chain,
      network: this.rt.agw.network,
    });
    const template = encodeJobSpec(options.jobSpecTemplate);
    const { chain, ...input } = card;
    const jobType = /^0x[\da-f]{64}$/i.test(card.jobType)
      ? (card.jobType as Hex)
      : keccak256(stringToHex(card.jobType));
    const c = {
      ...input,
      jobType,
      chainNamespace: chain,
      provider: this.rt.agw.signerPushAccount(),
      active: true,
    };
    const data =
      cardId === undefined
        ? encodeFunctionData({
            abi: ABI,
            functionName: 'registerAgentCard',
            args: [c, rules, template],
          })
        : encodeFunctionData({
            abi: ABI,
            functionName: 'updateAgentCard',
            args: [cardId, c, rules, template],
          });
    const tx = await write(
      this.rt,
      { target: d.marketplace, value: BigInt(0), data },
      options.progressHook,
      'MARKET',
      true
    );
    const e = await eventArgs(
      this.rt,
      tx,
      d.marketplace,
      ABI,
      cardId === undefined ? 'AgentCardRegistered' : 'AgentCardUpdated'
    );
    return {
      cardId: e['cardId'] as bigint,
      version: cardId === undefined ? BigInt(1) : (e['version'] as bigint),
      tx,
    };
  }
}

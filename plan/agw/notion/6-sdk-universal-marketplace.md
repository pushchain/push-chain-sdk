# 6. SDK: Universal Marketplace

<aside>
🏪

**Where we are going.** A user picks an agent card, gives a principal, signs once. Behind that one signature the SDK deploys the AGW, funds it, grants the rules the card needs, creates the 8183 job and funds it. A provider publishes a signed card and never touches the user's signature.

**What this page is.** The `client.market` namespace: the convenience path that composes `agentic` (page 5), `job` (page 7) and `evaluation` (page 8). Examples first, types second.

**How to read.** User side, provider side, types, open. Anything marked PROPOSED follows the recommendation on the main page and changes if the decision goes the other way.

**Depends on.** Page 2 decisions: start job A vs B, fixed fee vs quote, card storage.

</aside>

# 1. User side, by example

Browse and compile. Nothing is sent until `start`.

```tsx
const cards = await client.market.cards({ skill: 'yield', chain: CHAIN.ETHEREUM_SEPOLIA });
const card  = await client.market.card(cards[0].id);

const plan = await client.market.compile(card, {
  principal: { amount: parseUnits('1000', 6), token: MOVEABLE.TOKEN.ETHEREUM_SEPOLIA.USDC },
  duration: 30 * 86400,
  choices: { pool: aavePool },                     // card-declared choices, validated against the card
});

plan.wallet;        // derived AGW address (client.agentic.derive under the hood)
plan.rules;         // Rule[] the card requires, placeholders resolved (beneficiary = the AGW's account on that chain)
plan.criteria;      // encoded Criteria bytes + hash, placeholders resolved (ACCOUNT, PRINCIPAL)
plan.fee;           // { amount, token } from the card (PROPOSED: fixed fee on the card)
plan.calls;         // MultiCall[]: deployWallet, fund, grantRules, createJob, approve, fund(job)
plan.preview;       // human-readable: what the agent may do, what it may not, what "done" means
```

Start: one signature.

```tsx
const { wallet, rulesId, jobId, txHash } = await client.market.start(plan, {
  progressHook: (p) => console.log(p.id, p.message),   // MARKET-TX-1xx
});
// External user: UEA multicall. Push-native user: one tx from the EOA. Same call either way. (PROPOSED: path A)
```

After start, everything is on the primitives:

```tsx
await client.job.status(jobId);                       // page 7
await client.evaluation.status(jobId);                // page 8
client.agentic.wallet(wallet).rules.list();           // page 5
```

# 2. Provider side, by example

A card is a signed document. The signature is over the card hash, by the provider's agent key, so `compile` and the fund hook can both recompute it.

```tsx
const card = await client.market.publish({
  skill: 'yield',
  title: 'Aave USDC optimiser',
  version: '1.0.0',
  chains: [CHAIN.ETHEREUM_SEPOLIA],
  agent: '0xAgentOnPush',                                  // the Push address that will act: an EOA, or the UEA of an external key
  requiredCalls: [
    { chain: CHAIN.ETHEREUM_SEPOLIA, target: aavePool,    selector: 'supply(address,uint256,address,uint16)', beneficiary: 2 },
    { chain: CHAIN.ETHEREUM_SEPOLIA, target: usdcSepolia, selector: 'approve(address,uint256)' },
  ],
  limits: { maxAmountPerCall: 'PRINCIPAL', maxAmountTotal: 'PRINCIPAL', maxPCPerCall: parseUnits('0.5', 18) },
  fee: { amount: parseUnits('5', 6), tokens: [USDC_ETH, USDT_ETH] },   // fixed (PROPOSED); tokens the provider accepts, client picks one at start
  duration: { min: 7 * 86400, max: 90 * 86400 },
  criteriaTemplate,                                        // page 8: Criteria with placeholders, unresolved
  choices: [{ key: 'pool', type: 'address', allowed: [aavePool] }],
});
// signs with the connected signer (must be the agent or the provider's owner key), stores, returns { id, hash, signature }

await client.market.mine();                                // cards published by this signer
await client.market.retire(card.id);                       // stops new starts; live jobs unaffected
```

# 3. Types

```tsx
interface MarketNamespace {
  cards(filter?: CardFilter): Promise<AgentCardSummary[]>;
  card(id: string): Promise<AgentCard>;
  compile(card: AgentCard, input: UserInput): Promise<StartJobPlan>;
  start(plan: StartJobPlan, opts?: { progressHook? }): Promise<StartResult>;
  publish(card: AgentCardDraft): Promise<AgentCard>;        // provider side
  mine(): Promise<AgentCardSummary[]>;
  retire(id: string): Promise<void>;
  prepare: { start(plan: StartJobPlan): Promise<MultiCall[]> };   // the calls without sending, to add your own
}

interface AgentCard {
  id: string;                                              // keccak of the canonical card, hex
  provider: Address;                                       // who signed the card, as a Push address
  agent: Address;                                          // the Push address that will act: becomes rules.agent and the kernel's provider
  skill: string;  title: string;  version: string;
  chains: CHAIN[];
  requiredCalls: RequiredCall[];                           // become AllowedCall[] per chain
  limits: { maxAmountPerCall: bigint | 'PRINCIPAL'; maxAmountTotal?: bigint | 'PRINCIPAL'; maxPCPerCall: bigint };
  fee: { amount: bigint; tokens: Address[] };              // PROPOSED fixed; tokens the provider accepts; client chooses one in UserInput
  duration: { min: number; max: number };
  criteriaTemplate: Criteria;                              // page 8, unresolved placeholders
  choices?: Choice[];
  signature: Hex;
}

interface RequiredCall { chain: CHAIN; target: Address; selector: Selector; beneficiary?: number; maxValue?: bigint }
interface Choice { key: string; type: 'address' | 'uint' | 'enum'; allowed?: unknown[]; default?: unknown }

interface UserInput {
  principal: { amount: bigint; token: MoveableToken | Address };
  feeToken: Address;                                       // one of card.fee.tokens; becomes Job.paymentToken (K-12)
  duration: number;
  choices?: Record<string, unknown>;
  pc?: bigint;                                             // native PC for outbound fees, default from card
  walletIndex?: number;                                    // reuse a derived slot, default next
}

interface StartJobPlan {
  card: AgentCard;
  wallet: Address;
  rules: Rule[];
  criteria: { bytes: Hex; hash: Hex; resolved: Criteria };
  fee: { amount: bigint; token: Address };
  expiredAt: number;
  calls: MultiCall[];
  preview: PlanPreview;
}

interface StartResult { wallet: Address; rulesId: Hex; jobId: bigint; txHash: Hex }

class MarketError extends AgenticError {}                 // CARD_SIGNATURE, CHOICE_INVALID, DURATION_OUT_OF_RANGE, CHAIN_UNSUPPORTED
// progress family: MARKET-TX-1xx
```

# 4. Open for review

1. Path A vs B. On A (PROPOSED) `start` is an SDK multicall and `prepare.start` exists. On B `start` is one call to an on-chain `startJob` with the WithSig variants from page 1; the surface stays identical, only what is under `start` changes.
2. Fixed fee vs quote. Fixed (PROPOSED) keeps the provider out of the user's signature. Quote means `start` splits into `start` (create, no fund) and `fundQuoted(jobId)` after `setBudget`, and the user signs twice.
3. Card storage. Off-chain index signed by the provider (fast, POC) vs on-chain registry (slow, verifiable). `publish` hides the choice; `id` is the card hash in both.
4. Card versioning. A new version is a new card and a new id; live jobs keep the hash they funded with.
5. Who may `publish`. Provider owner key vs agent key vs either. Fund hook recomputes the card hash and checks the signature against `card.provider`.
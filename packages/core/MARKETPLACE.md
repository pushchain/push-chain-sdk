# Agentic marketplace and jobs

The SDK targets UniversalMarketplace **2.1.0 on Push Donut**, AGW v6 and the timing-free PRE/POST UniversalEvaluator. The kernel uses **eUSD** (`0x8E1eD40770cd197c80048cB3a86D3c8173cd560D`) for provider escrow. PC pays transaction gas, outbound gas and evaluator reads through their respective mechanisms. Principal is a separate routed asset.

Use `client.market` for cards and marketplace jobs, `client.job` for the kernel lifecycle, `PushChain.utils.market` for card rules and `PushChain.utils.job` for criteria. Constants are under `PushChain.CONSTANTS.AGENTIC`. `utils.job.prePost` exposes the same criteria helpers for explicitly configured integrations.

The default marketplace is `0x940744d96b14Bc030163C6084d602d57CE42ba48`. The retired 2.0 marketplace and its job/card identifiers are not accepted as a compatible deployment. Rebuild saved plans and templates for 2.1; never replay old signed intents against the new address.

## Cards and execution limits

One provider owns one card. Each card has `minDuration` and `maxDuration`; its ordered rules carry their own execution chains. There is no card-level chain, principal range, execution window or settlement window. A job supplies `principal`, `expiredAt` and `params`.

Cards support up to four distinct external EVM chains, subject to the live `maxRulesPerCard`. Discovery exposes `chains`, `verified`, `disabled` and the cap. Registration and update simulate the contract call; a verified label applies to the current version, not every future revision.

**Multi-rule execution is gated.** The current UniversalHook binds only one rules ID, despite the marketplace cap being four. The SDK supports multi-rule authoring, registration and previews but refuses opening, funding and deposits for multi-rule jobs. It never silently chooses the first rule. Existing jobs remain inspectable and owner cancellation handles all recorded permissions. Raising the cap alone does not remove this gate.

Exactly one asset across all rules has a `PRINCIPAL` total. It belongs to its own source chain. Every listed asset must have a compatible PRC20 route; symbols do not establish routing. There is no PUSD redemption or basket conversion. Native Push rules and Solana marketplace rules are outside this contract format.

## Author a card

Use verified destination addresses and raw token units. Approval calls require spender and maximum-amount pins. Transfers must pin their recipient to `WALLET`. Per-chain wallet markers resolve to that chain's CEA.

```ts
import { PushChain, type AgentCardInput, type AgentCardRules, type JobPlan } from '@pushchain/core';
import { parseAbi, type Address } from 'viem';

function authorCard(app: Address, token: Address, receiptToken: Address) {
  const { WALLET, PRINCIPAL, JOB } = PushChain.CONSTANTS.AGENTIC;
  const read = PushChain.utils.job.prepareRead({
    chain: PushChain.CONSTANTS.CHAIN.BNB_TESTNET,
    target: receiptToken,
    abi: parseAbi(['function balanceOf(address) view returns (uint256)']),
    functionName: 'balanceOf',
    args: [WALLET],
  });
  const jobSpecTemplate = PushChain.utils.job.buildJobSpecTemplate({
    reads: [read],
    checks: [{ left: [0], right: [], evaluation: JOB.EVALUATION.COMPARE,
      operation: JOB.OPERATION.GREATER_OR_EQUAL, target: { principalBps: 9990n } }],
    logic: 'ALL',
  });
  const rules: AgentCardRules = [{
    chain: PushChain.CONSTANTS.CHAIN.BNB_TESTNET,
    assets: [{ token, maxPerCall: PRINCIPAL, maxTotal: PRINCIPAL }],
    maxGasPerCall: 10n ** 18n,
    allowedCalls: [
      { target: token, selector: 'approve(address,uint256)', pins: [{arg: 0, expected: app}, {arg: 1, max: PRINCIPAL}] },
      { target: app, selector: 'supply(address,uint256,address,uint16)', pins: [{arg: 0, expected: token}, {arg: 1, max: PRINCIPAL}, {arg: 2, expected: WALLET}] },
    ],
  }];
  PushChain.utils.market.validateAgentCardRules(rules);
  return { rules, jobSpecTemplate };
}
async function register(provider: PushChain, card: AgentCardInput, app: Address, token: Address, receiptToken: Address) {
  return provider.market.agent.register(card, authorCard(app, token, receiptToken));
}
```

A template has reads, checks, logic and parameter bounds. Reads default to POST_EXECUTION; explicit PRE_EXECUTION reads capture funding-time state. Check sides are arrays of read indexes. Logic uses COMPARE leaves (numeric value zero), ALL, ANY or AT_LEAST. Criteria have no embedded execution deadlines. The marketplace builder always resolves criteria with `allowedMutability = NONE`.

The SDK validates evaluable criteria before signing even though the marketplace contract can store templates that an evaluator later rejects. Paid previews incur read fees and require explicit historical block numbers for PRE reads. Unknown or failed reads never count as a passing condition. Preview recovery can reuse authenticated request IDs without paying again.

## Review and open

```ts
async function openReviewed(owner: PushChain, cardId: bigint) {
  const plan = await owner.market.preview(cardId, {
    principal: 100_000_000n,
    expiredAt: Math.floor(Date.now() / 1000) + 7200,
  });
  // Display mayDo, mayMove, judgedBy, expiry and all budgets before signing.
  return owner.market.openJob(plan);
}
async function recoverOpening(owner: PushChain, plan: JobPlan, hash: string) {
  const tx = await owner.universal.trackTransaction(hash);
  return owner.market.openJob(plan, { resume: tx });
}
```

Opening deploys or reuses an AGW and executes an owner-signed batch: each permission grant followed by kernel job creation. It transfers no principal or escrow. The SDK independently compares the batch, criteria, CEA derivations and signature domain, then simulates the signed request. External EVM owners need a deployed UEA and typed-data signing support. Contract/delegated owners need compatible signature verification.

Results contain `jobId`, `wallet`, `rulesIds` and `tx`. Preserve the original plan and transaction hash if confirmation is uncertain. Recovery validates mined input, event content, wallet ownership and kernel/marketplace mappings without signing again.

## Deposit and fund

```ts
async function deposit(owner: PushChain, jobId: bigint) {
  return owner.market.deposit(jobId, { pcAmount: 10n ** 18n, funding: 'push' });
}
async function fundReviewed(owner: PushChain, jobId: bigint, budget: bigint, specHash: `0x${string}`) {
  return owner.job.fund(jobId, {
    expectedBudget: budget,
    evaluation: { expectedSpecHash: specHash, maxReadFee: 10n ** 18n },
  });
}
```

Deposit reconstructs the exact opened card version and tops the wallet up to principal, provider-fee and PC targets. A shared principal/fee token combines requirements. A PC target is not a whole-job fee quote. `funding: 'origin'` requires actual registered routes for the needed assets; eUSD must be available on Push when no origin route exists. Deposit never substitutes today's card terms for the signed historical version.

The provider sets the budget. The client funds against its reviewed budget and criteria hash. Use `job.quoteEvaluation` to inspect snapshot/evaluation read costs and existing prepaid PC. Funding validates the compatible evaluator and hook, checks the criteria hash and batches required approvals, PC prepayment and kernel funding atomically. Read-fee caps bound the quoted/additional payment; they do not promise a fixed future fee.

## Execute, evaluate and recover

The provider executes only the granted rules, then calls `job.submit`. Optional `executionBlocks` maps each POST chain to the block containing actual work. The SDK checks that Push has tracked those blocks with fresh observations before submitting. This preflight does not change on-chain block selection or enable multi-rule marketplace funding.

`job.status` and `job.watch` expose kernel lifecycle and compatible evaluator facts. `job.verify` supports snapshot/evaluation retries and settlement; a retry may require the client, and retrying does not silently add funds. A recorded verdict may need settlement if kernel completion could not run. `job.claimReadFees` returns eligible remaining prepaid PC to the client.

`job.cancel` uses client authority and revokes recorded marketplace permissions in the owner batch. It does not withdraw deposited wallet assets. Expiry/grace refunds use `job.claimRefund`. Provider completion or evaluator rejection does not automatically acquire permission-revocation authority. Permission binding itself does not prevent later owner revocation.

Use structured errors and retain pending transaction hashes. A submitted atomic transaction never falls back to sequential transfers. Coordinate concurrent funding clients rather than automatically repeating a partially observed transaction.

## Custom evaluator integrations

`client.job.withEvaluator({ profile: 'pre-post-v1', evaluator, hook, kernel?, startBlock? })` creates a scoped job namespace. It verifies code and matching wiring; it does not mutate the original client. A different kernel disables default marketplace mappings. Custom deployments must use the same reviewed PRE/POST format and compatible fund payload. Mutable replacement proposals remain unsupported by the SDK write flow.

Job lists return snapshot state and evaluator facts without scanning submission history for each row. Use `job.status` or `job.watch` for deliverables. Unsupported criteria are reported as `evaluation.available = false`, reason `UNSUPPORTED_JOB_SPEC`, with `jobSpecDecodeError`; writes still refuse unsupported formats.

Donut eUSD is the demo E2EPaymentToken with open test minting. It is not a routed USDC asset or a requirement to swap PC. Fund only the amounts needed for test escrow; production token behavior must be checked independently.

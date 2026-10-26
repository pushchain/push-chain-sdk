# Agentic marketplace and jobs

This SDK checkpoint targets UniversalMarketplace v2 on Push Donut, its pUSDC kernel and AGW v6. It implements card management, JobSpec authoring and paid previews, preview/open, historical deposits and the kernel lifecycle. The default Donut evaluator is currently an EOA. The explicit PRE/POST profile below supports a separately configured compatible evaluator; it does not change the live marketplace deployment.

`PushChain.initialize` now exposes `client.market` and `client.job`. Helpers are `PushChain.utils.market` and `PushChain.utils.job`; vocabulary is under `PushChain.CONSTANTS.AGENTIC`. There is no separate `client.evaluation` namespace. Read-only clients can discover cards and jobs.

## Author a card

Use verified application/token addresses and raw token units. The following helper returns permissions and a criteria template; it does not sign or send anything.

```ts
import { PushChain, MarketError, type AgentCardInput, type AgentCardRules, type JobPlan, type JobWatchCursor, type MarketDepositResult, type PreviewJobSpecOptions } from '@pushchain/core';
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
    checks: [{ read: 0, evaluation: JOB.EVALUATION.COMPARE, operation: JOB.OPERATION.GREATER_OR_EQUAL, target: { principalBps: 9990n } }],
    logic: JOB.LOGIC.ALL,
    allowedMutability: JOB.ALLOWED_MUTABILITY.NONE,
  });
  const rules: AgentCardRules = {
    assets: [{ token, maxPerCall: PRINCIPAL, maxTotal: PRINCIPAL }],
    principalAsset: 0,
    maxGasPerCall: 10n ** 18n,
    allowedCalls: [
      { target: token, selector: 'approve(address,uint256)', pins: [{ arg: 0, expected: app }, { arg: 1, max: PRINCIPAL }] },
      { target: app, selector: 'supply(address,uint256,address,uint16)', pins: [{ arg: 0, expected: token }, { arg: 1, max: PRINCIPAL }, { arg: 2, expected: WALLET }] },
    ],
  };
  PushChain.utils.market.validateAgentCardRules(rules);
  return { rules, jobSpecTemplate };
}
```

`client.universal.read.prepare(options)` is the same pure authoring helper. `client.universal.read(prepared, options?)` sends a resolved prepared call and returns raw consensus bytes. WALLET/PARAM holes must first be resolved; the sender rejects them before a paid request. Existing async `universal.prepareRead(subject, options)` remains the paid-request preparation API. They produce different representations. A literal zero is never guessed to be a placeholder. Dynamic-layout placeholders are refused. Descriptions retain ABI function names in memory when available and apply explicit token decimals while retaining raw targets; chain-decoded specs fall back to selectors and addresses.

Cards name one execution chain and one provider. Destination tokens resolve to verified Push PRC20 routes on that chain. An explicit `{ prc20: address }` is available for already-known Push tokens and is returned by lossless rule decoding. No route or same-symbol alias is invented. Structural validation alone does not establish deployment or liquidity readiness.

Approvals are **allowed calls with spender/amount pins** in v2. There is no separate `approvals[]` field or automatic owner-approval deposit step. Principal caps meter outbound tokens from Push; they are not a destination-lifetime trading budget. Spec comparisons use raw units; the receipt token must have the units expected by the criterion.

## Register, preview and open

```ts
async function registerOffer(
  provider: PushChain,
  listing: AgentCardInput,
  app: Address,
  token: Address,
  receiptToken: Address,
) {
  const authored = authorCard(app, token, receiptToken);
  return provider.market.agent.register(listing, authored);
}

async function openReviewedJob(owner: PushChain, cardId: bigint) {
  const now = Math.floor(Date.now() / 1000);
  const plan = await owner.market.preview(cardId, {
    principal: 100_000_000n,
    executeBy: now + 3600,
    expiredAt: now + 86400,
  });
  // Render every mayDo/mayMove/judgedBy entry and the logic before signing.
  return owner.market.openJob(plan, {
    progressHook: event => console.log(event.id, event.message),
  });
}
```

Opening deploys/reuses the AGW, grants the card's exact resolved permissions and creates an Open job. It moves no principal or fee. The plan is revalidated before signing; changed card versions, nonces, occupancy or plan content require a new preview. OwnerIntent authorization uses the factory EIP-712 domain. Client submission can require a second wallet interaction; no relay is supplied in this checkpoint.

Opening supports EVM typed-data signers. An external owner's UEA must already be deployed on Push (`OWNER_NOT_DEPLOYED` otherwise). The SDK checks the factory domain before prompting, then simulates the complete signed request through the real owner verifier before broadcasting. UEA and ERC-1271 acceptance follows the deployed contract; an EIP-7702 delegate without a compatible verifier fails simulation. Signing capability checks run before prompting; a verifier can reject the resulting signature after prompting. Provider writes use the connected signer's ordinary Push identity, including when the instance also has an AGW execution context.

```ts
async function recoverOpening(client: PushChain, reviewedPlan: JobPlan, txHash: string) {
  const tx = await client.universal.trackTransaction(txHash);
  return client.market.openJob(reviewedPlan, { resume: tx });
}
```

If receipt lookup or post-state verification fails, keep the original plan and reported transaction hash. Resume verifies the mined input, event, permission ID, wallet ownership, kernel record and marketplace mappings without another signature or submission. A read-only client can recover an existing opening. Normal writes copy reviewed inputs before awaiting RPCs or wallet prompts. Provider registration/update also simulate the exact card write before submission. A reference ERC-1271 contract-owner adapter and compatible/incompatible EIP-7702 verifiers are exercised against real contracts in the local acceptance suite; custom wallets supply their own `UniversalSigner` transport.

Native transport errors also retain `txHash` and, when confirmation is uncertain, `pendingTransactionHash` after broadcast. Atomic native sends never fall back to sequential calls after a hash exists. Track that hash before another attempt; a confirmed revert retains its hash without claiming that it is still pending.

**Current destination readiness:** BSC Testnet has passing live open/cancel coverage. Sepolia, Base Sepolia and Arbitrum Sepolia have different CEA factories in the marketplace configuration and current SDK routing table; preview returns `CEA_MISMATCH`. The SDK does not substitute the marketplace's account for an independently derived account. Align the deployment/routing configuration before opening on those chains.

Card IDs, versions, ratings and job IDs are bigint. `jobType` reads are the canonical bytes32 hash, not a guessed original name. `cards` walks IDs with bounded concurrency; summaries remain readable even if an unverified provider stored a malformed template. Full `card` decoding/preview rejects unsupported content. `agent.card`, `agent.update` and `agent.setActive` manage the provider's one card. Preserve raw `rulesBytes`/`jobSpecTemplateBytes` for archival rather than serializing away unknown wire metadata.

## Fund and track the kernel lifecycle

```ts
async function depositForJob(owner: PushChain, jobId: bigint): Promise<MarketDepositResult> {
  return owner.market.deposit(jobId, {
    // Target wallet PC balance, not a gas quote for the whole job.
    pcAmount: 10n ** 18n,
    funding: 'push',
    progressHook: event => console.log(event.id, event.message),
  });
}
```

`deposit` recovers the original principal and card version from the opening event and historical card state. It never sizes an old job from today's updated card. It tops up wallet balances to the principal, original reference fee and PC target; a shared principal/fee token is combined before subtracting the balance. `providerFee` explicitly overrides the fee reserve and `pcAmount` overrides the PC target. The default PC target is one per-call card gas cap, not a promise that all job execution is covered. This operation leaves the kernel escrow Open and makes no destination approval calls: those are pinned permissions granted to the agent in v2.

The default source is the connected signer's Push identity, even on an instance configured to execute through an AGW. `funding: 'origin'` explicitly uses normal inbound `funds` transfers for registered assets from the connected origin chain; required tokens without such a route fail before any leg is sent. PC still comes from the signer's Push holdings. The underlying gateway's normal route, liquidity, balance and fee checks apply.

Steps are separate transactions. `DEPOSIT_INCOMPLETE` retains `details.txs`, any `details.pending` broadcast hash and chain, and the original cause. The same client remembers submitted steps; pass `resume: previousSteps` when continuing with another client. After restarting, rehydrate recorded hashes with `universal.trackTransaction(hash, { chain })` before passing their transaction responses. Pending receipts must settle before another transfer, and a confirmed transfer whose target balance has since fallen requires manual review. Concurrent deposits on the same client are rejected. Coordinate other clients and avoid running the agent during deposits. Deposits require an Open, unexpired job and an enabled permission with no recorded asset spend. When archive state is unavailable or updates share the opening block, the SDK recovers the version from registration/update events and canonical transaction input, checking emitted content hashes, fee and immutable card identity. If neither source can authenticate it, `HISTORY_UNAVAILABLE` stops the operation.

```ts
async function priceAndFund(provider: PushChain, owner: PushChain, jobId: bigint) {
  // First deposit the payment token, principal and PC appropriate to the job.
  await (await provider.job.setBudget(jobId, 5_000_000n)).wait();
  // Explicitly pass the price the client reviewed; never silently accept a re-quote.
  return owner.job.fund(jobId, { expectedBudget: 5_000_000n });
}

async function trackJob(client: PushChain, provider: PushChain, jobId: bigint) {
  const stop = client.job.watch(jobId, event => console.log(event.kind));
  const job = await client.job.status(jobId);
  await (await provider.job.submit(jobId, { deliverable: 'ipfs://deliverable' })).wait();
  stop();
  return job;
}
```

The kernel currently accepts pUSDC (`USDC.eth`, 6 decimals) only; explicit mismatching payment tokens are rejected. A card's providerFee is a reference price. For an unchanged marketplace card version, omitted expectedBudget uses that reference; plain jobs or changed card versions need an explicit reviewed amount. A zero-price job is valid.

For AGW clients, fund verifies ownership, rule/provider identity and expiry, then batches any necessary ERC20 allowance change and escrow funding through the owner door. This allowance is distinct from the AGW's automatic gateway allowance. Plain-client allowance/fund batching requires a supported atomic signer transport; the SDK does not silently fall back to sequential acceptance.

`status` reads the kernel and hook, retains binary description bytes, decodes supported v2 JobSpecs, and recovers deliverable from submission logs. `evaluation.available` is false for this manual/unverified evaluator profile; frozen/baseline/verdict data is not fabricated. Plain text descriptions may have no decoded JobSpec. `list` can filter client/provider/status; `watch` polls bounded event ranges, reports read errors, supports a starting block and returns a stop function. It is not an indexer or a reorg-finality service.

```ts
function resumeJobEvents(client: PushChain, jobId: bigint, cursor?: JobWatchCursor) {
  return client.job.watch(jobId, event => {
    // Persist cursor only after your application handles the event.
    if (event.kind !== 'Error') console.log(event.kind, event.cursor);
  }, cursor ? { cursor } : { pollIntervalMs: 3000 });
}
```

Each delivered event has an exact block/log cursor. Resuming excludes already delivered logs within the same block; duplicate RPC logs are delivered once. RPC failures retry the same range, consumer callback errors do not rewind delivery, and unsubscribe suppresses pending callbacks. A changed canonical cursor emits `WATCH_REORG` and stops; reload status and choose a reviewed restart block.

```ts
async function stopOpenJob(owner: PushChain, jobId: bigint) {
  // For marketplace AGWs, one owner batch rejects the Open job and revokes its recorded grant.
  return owner.job.cancel(jobId);
}

function marketplaceErrorText(error: unknown): string {
  return error instanceof MarketError ? error.userMessage : 'Check transaction activity before retrying.';
}
```

Cancellation is client-side Open-job rejection. It does not withdraw deposited wallet balances; those remain under the owner's existing transfer authority. A plain job has no marketplace grant to infer. Other terminal paths do not imply AGW permission revocation. `claimRefund` respects expiry/grace and remains available while the kernel is paused; a third party may trigger it, with funds returned to the recorded client.

Plain jobs can use `job.create` with provider/evaluator/hook/expiry/paymentToken plus either binary jobSpec or text description. The kernel's Solidity string slot can carry binary JobSpec bytes; the SDK preserves them and retains the original createJob selector.

## Paid criteria preview

```ts
async function previewCriteria(client: PushChain, template: ReturnType<typeof authorCard>['jobSpecTemplate'], wallet: Address) {
  const options: PreviewJobSpecOptions = {
    client, wallet, principal: 100_000_000n,
    maxTotalFee: 10n ** 16n,
    advanced: { timeout: 120_000 },
  };
  return PushChain.utils.job.previewJobSpec(template, options);
}
```

This prepares every raw read, checks the total callback/protocol fee cap, then executes through the existing universal-read registry (or an explicit `callback`). Native transaction gas is separate from `maxTotalFee`. A real SDK client derives destination CEAs for template wallet holes using its configured routes; `accounts` supplies explicit destination addresses when needed. An AGW's Push address is never substituted for its destination account.

The result includes raw values, decoded fields, request responses and fees. `pass` and each check are `true`, `false`, or `null` (unknown). NUMBER and PERCENTAGE require an explicit per-read `baseline`; missing baselines, zero percentage denominators and unavailable reads stay unknown. A preview is an observation, not an automatic evaluator verdict or proof that a job is complete. Raw EVM calls are also available as `universal.read(target, { chain, callData })` and return consensus bytes.

`PREVIEW_INCOMPLETE` retains all known request IDs and transaction hashes. Track uncertain submissions before retrying. Pass `resume: requestIds` (one per read, in order) to finish without new requests or payment. Resume checks each on-chain destination, call, pin and confirmation requirement before evaluating; unrelated reads are refused. `fees.newlyPaid` is zero on recovery, while `fees.paid` retains the original request deposits. A zero `maxTotalFee` is valid for recovery.

## Explicit placeholders

- `job.verify`, baseline/prefund/retry integration: no compatible automatic evaluator is configured. A different linked evaluator source has a different wire and enum values.
- Replacement JobSpecs, non-NONE marketplace criteria, recurring jobs and relay are unavailable.

Unsupported paths throw before signing/sending. They do not return successful dummy results. Keep message, code, details and cause for diagnostics.

## PRE/POST evaluator profile

The next evaluator integration is pinned to `feat/universal-evaluator-pre-post-reads@8666c2a`. Use `utils.job.prePost` explicitly; the existing `utils.job` encoders continue using deployed v2. The new JobSpec has PRE/POST reads, summed left/right check sides, CHECK logic leaves and no timing fields. Its card template has no mutability field; resolving it produces NONE=1. There is no automatic conversion of existing signed bytes.

```ts
import type { JobEvaluatorConfig, PrePostJobSpec, SubmitJobOptions } from '@pushchain/core';
import { keccak256 } from 'viem';

function authorPrePostCriteria(receiptToken: Address, destinationWallet: Address) {
  const read = PushChain.utils.job.prepareRead({
    chain: PushChain.CONSTANTS.CHAIN.BASE_SEPOLIA,
    target: receiptToken,
    abi: parseAbi(['function balanceOf(address) view returns (uint256)']),
    functionName: 'balanceOf', args: [destinationWallet],
  });
  return PushChain.utils.job.prePost.buildJobSpec({
    reads: [{ read, at: 'POST_EXECUTION' }, { read, at: 'PRE_EXECUTION' }],
    checks: [{ left: [0], right: [1], evaluation: 'NUMBER', operation: 'GREATER_OR_EQUAL', target: 5_000_000n }],
    logic: 'ALL', allowedMutability: 'NONE',
  });
}

async function fundEvaluatedJob(
  client: PushChain, deployment: JobEvaluatorConfig, jobId: bigint,
  rulesId: `0x${string}`, reviewedSpec: PrePostJobSpec, reviewedBudget: bigint,
  maxReadFee: bigint,
) {
  const jobs = client.job.withEvaluator(deployment);
  // Hash the criteria the client reviewed, rather than accepting a freshly read replacement.
  const expectedSpecHash = keccak256(PushChain.utils.job.prePost.encodeJobSpec(reviewedSpec));
  return jobs.fund(jobId, {
    rulesId, expectedBudget: reviewedBudget,
    evaluation: { expectedSpecHash, maxReadFee },
  });
}

function submitAfterWork(
  provider: PushChain, deployment: JobEvaluatorConfig, jobId: bigint,
  executionBlocks: Record<string, bigint>,
) {
  // Include the receipt block for every destination where work was performed.
  const options: SubmitJobOptions = { deliverable: 'work completed', executionBlocks };
  return provider.job.withEvaluator(deployment).submit(jobId, options);
}
```

Configure `{ profile: 'pre-post-v1', evaluator, hook }` with verified deployment addresses. Optional `kernel` and `startBlock` select a standalone kernel, and optional `evaluatorCodeHash` / `hookCodeHash` pin its executable code. `withEvaluator` returns a separate namespace. Before using the evaluator, the SDK checks its code and kernel/hook wiring at one block; jobs on other evaluators retain their manual/unknown status. No future evaluator address is assumed or installed as a default.

Use `quoteEvaluation(jobId)` to inspect the initial PRE and POST read costs, existing prepaid PC, current spec hash and minimum top-up. Funding requires the reviewed budget/hash and `maxReadFee`, checks the quote against that cap, and atomically batches token approvals, PC prepayment and kernel funding through the client AGW. The wallet must hold the payment tokens and PC. `prefundAmount` can explicitly add headroom within the cap. The cap bounds the observed quote and additional PC sent; it is not a contract-level cap on future spending from an existing prepaid pool. Transaction gas and later retry fees are separate. Fee increases can make funding revert atomically; the SDK does not automatically increase an approved payment.

`submit` fixes POST measurement blocks and tries to dispatch reads. Pass optional `executionBlocks` with the destination receipt blocks: the SDK checks that each named chain is in the frozen POST criteria, Push has tracked at least that block, and the observation is fresh. An unmet height returns `EXECUTION_BLOCK_NOT_TRACKED` before signing; a stale observation returns `TRACKED_HEIGHT_STALE`. This is a preflight check using the configured evaluator's UniversalCore, not a new on-chain guarantee. It does not approve multi-chain cards or bind additional rules. Dispatch is best effort, so inspect status and use `jobs.verify(jobId)` when reads were not sent. It chooses snapshot recovery before evaluation, `retryEvaluation` for submitted undecided jobs, or public `settle` for a decided verdict the kernel could not apply. Explicit `action` may be `retrySnapshot`, `retryEvaluation` or `settle`. Retries preserve recorded blocks and require the client or provider; a client AGW uses its owner's batch. A PC addition must be explicit through `value` and bounded by `maxReadFee`. No hook-only verification method is called directly. Owner-side retries can change the recorded owner-touch observation; that observation is reported separately from the verdict.

Status includes the actual frozen criteria, phase-aware answers, request IDs, heights, single evidence hashes, readiness, prepaid PC, verdict and settlement state. Watch delivers evaluator/hook events with the same cursor/reorg rules as kernel events. `claimReadFees` returns unspent evaluator PC to the recorded client after the job ends. Mutable proposals remain deferred; namespace creation/funding accepts immutable criteria only.

The new paid `prePost.previewJobSpec` requires explicit historical `blockNumbers` for PRE reads, so a current observation cannot silently stand in for a baseline. Both phases use the paid-read fee cap and authenticated request-ID recovery. Percentage checks use exact cross-multiplication; a tiny loss cannot round into a passing zero. Missing data/overflow stays unknown, and nonpositive percentage denominators fail as in the evaluator. Oversized answers and forged array lengths are unreadable.

This branch's marketplace contract predates the live v2 card/rules interface. The new template codec and evaluator/kernel integration are available locally; the v2 `client.market` provider/open/deposit adapter continues targeting its deployed schema until a compatible marketplace builder/interface and rollout are supplied. Do not register a new-format template through the legacy adapter. Local acceptance uses real kernel, hook, evaluator, Read State and AGW contracts, mocked tracked chain metadata and manually delivered consensus results; it does not establish a live automatic-evaluator rollout.

The demo app and the pasted conversation use different deployment addresses, and both demo stacks retain timing-first JobSpecs. They must not be configured as `pre-post-v1`. The marketplace CEA registry is aligned with SDK/vault/gateway factories and proxy implementations on all four supported chains as of Donut block 24663931.

## E2E validation

From the repository root:

```sh
# Real deployed stack on an isolated Anvil fork; no private keys or public-chain writes.
node node_modules/jest/bin/jest.js --config packages/core/jest.marketplace-local.config.ts --runInBand
# New evaluator/kernel/AGW on an isolated local chain, with no public RPC execution.
# Requires the reviewed core-contracts checkout and Foundry/cached compilers.
AGW_LOCAL_DIR=$(bash packages/core/scripts/agw-local/prepare.sh | tail -1) \
  node node_modules/jest/bin/jest.js --config packages/core/jest.evaluator-local.config.ts --runInBand
# Read-only live Donut acceptance.
node node_modules/ts-node/dist/bin.js --compiler-options '{"module":"commonjs"}' packages/core/__e2e__/ci/run.ts --group marketplace
# Explicit funded smoke, using packages/core/.env: fresh provider/card/owner/wallet, then cancel/revoke/deactivate.
node node_modules/ts-node/dist/bin.js --compiler-options '{"module":"commonjs"}' packages/core/__e2e__/ci/run.ts --group marketplace-live
# Owned-token acceptance: actual deposits, native/AGW escrow and payouts, BSC-origin principal bridging.
node node_modules/ts-node/dist/bin.js --compiler-options '{"module":"commonjs"}' packages/core/__e2e__/ci/run.ts --group marketplace-funding
```

Marketplace groups stay out of the runner's default `all`. The basic live group spends bounded PC for gas/test wallets and read callbacks. The separate funding group uses owned test assets: 0.01 pUSDC per paid job, 0.01 USDT of bridged principal and up to 0.01 pBNB for source-gas setup. It cancels/revokes market jobs, completes plain jobs with a fresh controlled manual evaluator, returns principal/reserve/payout tokens and deactivates its card. The deployed marketplace evaluator remains unchanged. Pause/refund and signature variants use the local fork. The fork's UEA signature test uses a native submitter because Anvil has no Cosmos transport; live cases exercise actual external-owner transport. No automated verdict is implied by those results. Signature fixtures compile from repo-owned source at harness startup; Foundry and cached solc 0.8.26 are prerequisites.

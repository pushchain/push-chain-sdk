# Agentic marketplace and jobs

This SDK checkpoint targets UniversalMarketplace v2 on Push Donut, its pUSDC kernel and AGW v6. It implements card management, JobSpec authoring, preview/open for native owners without delegation, and the kernel lifecycle. The evaluator is currently an EOA: there is no automatic verification, baseline or rating claim.

`PushChain.initialize` now exposes `client.market` and `client.job`. Helpers are `PushChain.utils.market` and `PushChain.utils.job`; vocabulary is under `PushChain.CONSTANTS.AGENTIC`. There is no separate `client.evaluation` namespace. Read-only clients can discover cards and jobs.

## Author a card

Use verified application/token addresses and raw token units. The following helper returns permissions and a criteria template; it does not sign or send anything.

```ts
import { PushChain, MarketError, type AgentCardInput, type AgentCardRules } from '@pushchain/core';
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

`client.universal.read.prepare(options)` is the same pure authoring helper. Existing async `universal.prepareRead(subject, options)` remains the paid-request preparation API. They produce different representations. WALLET/PARAM holes retain explicit positions; a literal zero is never guessed to be a placeholder. Dynamic-layout placeholders are refused.

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

Opening currently requires a Push-native owner with no contract/delegation code. External/contract/delegated owner signing returns `CAPABILITY_UNAVAILABLE` before prompting. Provider writes use the connected signer's ordinary Push identity, including when the instance also has an AGW execution context.

**Current destination readiness:** BSC Testnet has passing live open/cancel coverage. Sepolia, Base Sepolia and Arbitrum Sepolia have different CEA factories in the marketplace configuration and current SDK routing table; preview returns `CEA_MISMATCH`. The SDK does not substitute the marketplace's account for an independently derived account. Align the deployment/routing configuration before opening on those chains.

Card IDs, versions, ratings and job IDs are bigint. `jobType` reads are the canonical bytes32 hash, not a guessed original name. `cards` walks IDs with bounded concurrency; summaries remain readable even if an unverified provider stored a malformed template. Full `card` decoding/preview rejects unsupported content. `agent.card`, `agent.update` and `agent.setActive` manage the provider's one card. Preserve raw `rulesBytes`/`jobSpecTemplateBytes` for archival rather than serializing away unknown wire metadata.

## Fund and track the kernel lifecycle

```ts
async function priceAndFund(provider: PushChain, owner: PushChain, jobId: bigint) {
  // First fund the AGW with the payment token, principal and PC appropriate to the job.
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
async function stopOpenJob(owner: PushChain, jobId: bigint) {
  // For marketplace AGWs, one owner batch rejects the Open job and revokes its recorded grant.
  return owner.job.cancel(jobId);
}

function marketplaceErrorText(error: unknown): string {
  return error instanceof MarketError ? error.userMessage : 'Check transaction activity before retrying.';
}
```

Cancellation is client-side Open-job rejection. A plain job has no marketplace grant to infer. Other terminal paths do not imply AGW permission revocation. `claimRefund` respects expiry/grace and remains available while the kernel is paused; a third party may trigger it, with funds returned to the recorded client.

Plain jobs can use `job.create` with provider/evaluator/hook/expiry/paymentToken plus either binary jobSpec or text description. The kernel's Solidity string slot can carry binary JobSpec bytes; the SDK preserves them and retains the original createJob selector.

## Explicit placeholders

- `market.deposit`: historical-card deposit/resumption policy remains pending. Fund the wallet explicitly; do not recompute an old job from the current card version.
- `job.verify`, baseline/prefund/retry integration: no compatible automatic evaluator is configured. A different linked evaluator source has a different wire and enum values.
- Replacement JobSpecs, non-NONE marketplace criteria, recurring jobs, relay and external/delegated OwnerIntent signing are unavailable.
- `utils.job.previewJobSpec`: paid read/callback and fee behavior remains gated. Pure build/encode/decode/describe helpers work without a network.

Unsupported paths throw before signing/sending. They do not return successful dummy results. Keep message, code, details and cause for diagnostics.

## E2E validation

From the repository root:

```sh
# Real deployed stack on an isolated Anvil fork; no private keys or public-chain writes.
node node_modules/jest/bin/jest.js --config packages/core/jest.marketplace-local.config.ts --runInBand
# Read-only live Donut acceptance.
node node_modules/ts-node/dist/bin.js --compiler-options '{"module":"commonjs"}' packages/core/__e2e__/ci/run.ts --group marketplace
# Explicit funded smoke, using packages/core/.env: fresh provider/card/owner/wallet, then cancel/revoke/deactivate.
node node_modules/ts-node/dist/bin.js --compiler-options '{"module":"commonjs"}' packages/core/__e2e__/ci/run.ts --group marketplace-live
```

Marketplace groups stay out of the runner's default `all`. Live smoke spends bounded PC for gas/test wallets and does not move principal or escrow tokens. Nonzero escrow, allowance, payout, manual completion and pause/refund are tested separately on the local fork. No destination protocol execution or automated verdict is implied by those results.

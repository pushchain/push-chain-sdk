# Questions to share — drafts, not posted

**SDK-only implementation and acceptance are complete for the current EVM v2 scope.** This includes real ERC-1271/7702 fixtures, receipt and same-block history recovery, paid-read resumption, watcher cursors, live origin bridging, principal deposits, atomic escrow and manual-evaluator payouts. No question or comment has been posted. See [SDK readiness](sdk-readiness.md) before sharing anything below.

## Current team dependencies — only these need answers now

1. **Canonical CEA deployment on Sepolia, Base Sepolia and Arbitrum Sepolia:** which factory/implementation manifests should the live routing stack and marketplace both use? [Exact differences and evidence](implementation-status.md#destination-rollout-mismatch). Both factories answer but derive different accounts. BSC matches and passes live. The SDK retains its independent derivation check; global routing addresses were not changed to force a match.
2. **Automatic evaluation:** which shared JobSpec package/commit, compatible hook/evaluator deployment, and public verify/retry ABI are authoritative? Current v2 and the linked evaluator differ in field order, enums, reads, checks and logic. The SDK has no safe automatic endpoint to invoke until that contract boundary is delivered. Details below.

Prepared October 20 after fresh Notion discussions, pinned source review, unfunded tests and Donut read-only checks. Lead with the concrete mismatch and proposal; do not resend historical questions already answered below.

## Zaryab, with Nilesh / Aman: canonical wire before automatic evaluation

**Which exact shared JobSpec package/commit should the SDK target for the next compatible marketplace + hook + evaluator deployment?** Deployed marketplace v2 `443b4e2` uses `(reads,checks,logic,allowedMutability,origin,executeBy,failFinalAt)`, direct check indices, and NONE=0. Nilesh's [October 16 linked source](https://github.com/pushchain/push-chain-core-contracts/blob/8059817591cca16c59f1cc154f475f51e1736a67/src/agentic-commerce-8183/libraries/JobSpecTypes.sol) uses timing first, PRE/POST reads, left/right sums, CHECK leaves, and NONE=1/BOTH=0. Controlled vectors are incompatible. Proposal: build the current v2/manual-evaluator SDK profile now; coordinate one shared schema and deployment change before automated evaluation, without an SDK-only translation of signed bytes.

## Historical — public approvals and deposit shape

Implemented against deployed v2. This is documentation alignment, not a remaining SDK blocker.

**Should the SDK now follow deployed v2 D1 and remove `rules.approvals[]`, `skipApprovals`, and owner-approval deposit steps from page 6?** V2 permits agent `approve` with a pinned nonzero spender and capped amount and has no approvals array. Page 6 still rejects approve and exposes the old fields. Proposal: retain pinned approvals as allowedCalls and make deposit about principal/fee/PC, with explicit execution prerequisites. This confirms the public contract rather than asking for a feature already delivered.

## Deferred product scope — M4 in the first release

**Can marketplace authoring require `allowedMutability: NONE` for the initial release, leaving other enum values representable but unsupported until the proposal/acceptance protocol is delivered?** Current hook ignores replacements; non-NONE flags are accepted but inert. A future mutable flow needs the client's exact expectedSpecHash/revision checked atomically at fund alongside budget. SDK rereads cannot close the same-price front-run. If mutability is required now, define the authenticated CLIENT/BOTH route and versioned fund payload with the evaluator team first.

## Historical — cancel surface and permission cleanup

Client cancel/revoke is implemented and accepted locally/live. Automatic provider/evaluator cleanup needs a contract authority design only if that later feature is requested.

**Add `client.job.cancel` for an Open job, and should the AGW owner path atomically reject + revoke that job's permission?** The kernel already permits client reject; the SDK draft omits the method after removing evaluatorOnly.reject. Real-v6 fork proof shows cancel alone frees the marketplace slot but old permissions remain enabled after a new job opens. A single existing owner batch rejects and revokes successfully, with no new AGW role. Provider/evaluator-driven automatic cleanup remains a separate contract design; confirm that boundary and the expected behavior for terminal jobs.

## Historical — accepted price

Explicit reviewed budgets are implemented; the client does not silently accept a re-quote.

**For the first marketplace release, is funding fixed to the opened card version's reviewed providerFee, or may a user explicitly accept a different provider quote?** Page 7 alternates between passing the card price and reading the latest stored budget. Contract test proves a job can fund at 3× card fee if the client supplies that expectedBudget. Proposal: never silently adopt the latest price; fixed-price flow uses the opened version, negotiation requires an explicit reviewed quote/expected amount.

## Historical — pure read-authoring interface

Implemented: additive pure preparation, direct sending of resolved prepared reads and paid JobSpec preview/resumption.

**Confirm an additive pure `client.universal.read.prepare` authoring API alongside existing async `universal.prepareRead(subject, options)`, or choose an adapter over that existing surface.** Current prepareRead produces paid-request/preflight data and does network reads; the page needs synchronous logical reads with output-layout codes and preserved WALLET/PARAM metadata. These are different representations. Proposal: share parsing/ABI encoding while retaining existing read APIs and introducing a distinct typed authoring representation.

## Zaryab / Aman: smaller delivery discrepancies

- Page 3 calls createJob hookable on Push, while the deployed kernel has no createJob hooks. Is this intentionally deferred? It need not block current marketplace SDK work; label it accurately.
- Confirm the eventual compatible evaluator delivery/ABI instead of wrapping a guessed `verify`: linked code uses hook-only verifyFromSubmit and public sendReads/retrySnapshot; the live marketplace evaluator is an EOA. Capability gating can ship now.

## Wording to confirm during UX acceptance

Page 6's dated decision chooses client submission and defers relay, while an example still defaults external users to relay=true. Follow the dated decision. Verify the native/EVM-owner signing UX and distinguish “one OwnerIntent authorization” from “one total wallet prompt”: self-submitting the transaction may require another signature. No relayer service is identified by these docs.

## Already answered — do not block SDK work on these again

- **K-12/payment token:** v2 intentionally ships with kernel pUSDC only; registration rejects other tokens. Future per-job tokens are a separately versioned kernel extension, not a prerequisite to implement v2.
- **Page 8:** no client.evaluation namespace in v1. Helpers are utils.job/utils.market; job-side reads belong to client.job.
- **Card enumeration:** agentCardCount + getAgentCard and agentCardOf exist; SDK can walk IDs with bounded reads. No list/indexer service is required for the demo.
- **Card identity/versioning:** on-chain integer ID, one card per provider, update increments version and clears verification; old hash-ID/signed-document proposals are superseded.
- **Opening funds:** openJob moves none; deposits and escrow funding are separate.
- **Markers:** contract FillSource.CEA/TargetSource.CEA stay named that way; public SDK uses WALLET. Marker wire hashes are published.
- **Recurring jobs/fees/ratings:** future research or placeholders; do not invent a renewal flow, rating service or fee policy.

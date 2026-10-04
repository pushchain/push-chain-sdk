# AGW contract and SDK gap register

Updated October 4, 2026 after [Harsh’s replies](product-decisions-2026-10-04.md) and implementation commit `cae7206`. This register distinguishes unresolved dependencies, implemented SDK work, deferred scope and historical corrections. G01–G25 are tracking IDs, not a count of open defects.

Evidence: [current baseline](current-baseline.md), [implementation status](implementation-status.md), [product alignment validation](research/product-alignment-2026-10-04/README.md). The SDK implementation passes 1,917 unit tests and 36 local-contract tests. Local tests do not establish live deployment or settlement support.

Source baseline: AGW `pushAgenticWallet_v3@e704d5b`, core marketplace `cb69e0b`, gateway `bcbf7df`. Page 5 was downloaded again October 4 and its body matches the October 3 snapshot after link normalization. Harsh’s newer scope replies supersede conflicting recommendations in that snapshot. No compatible release deployment has been verified or registered.

## Remaining standalone external dependencies

| Dependency | Owner | Related IDs |
| --- | --- | --- |
| Exact limit/default table and the referenced maxValueTotal change | [Harsh H3](questions-harsh.md#h3) | G19 |
| Public raw-offset read/write representation | [Harsh H4.5](questions-harsh.md#h4-5) | G25 |
| Final multi-asset encoding, internal per-token reads and expected-spend assertions | [Zaryab Z1](questions-zaryab.md#z1) | G23, G24 |
| Target ref/label/envelope scope, SVM artifacts and compatible deployment | [Zaryab Z1/Z3](questions-zaryab.md#z3) | G01, G02, G08, G22 |

Approval screening, public generation context, public spend shape, revoked-history reconstruction and compileCard are no longer unresolved standalone product questions. Native agent batching is implemented through a sender-preserving outer transport; it does not require a new batch-mode AGW agent entry point.

## Current disposition

P0 blocks agreed authorization/accounting or safe final integration. P1 affects correctness, compatibility or delivery. P2 covers optional scope or documentation. “Implemented locally” means source and local evidence exist; live acceptance is tracked separately.

| ID | Priority | Status | Current finding or resolution | Remaining action |
| --- | --- | --- | --- | --- |
| G01 | P1 | Open deployment dependency | Reviewed source is e704d5b; build/source tests are available. SDK deployment registry remains empty. | Obtain and verify the selected generation’s manifest, wiring, source artifacts, capabilities and start blocks before live acceptance. |
| G02 | P0 | Source implemented; deployment pending | D3 executeAsAgent/agentOf and sender adapter exist; SmartSession is unchanged. SDK uses this model. | Verify the selected deployment and retain sender-binding/alternate-path coverage; do not reopen the withdrawn engine-fork proposal. |
| G03 | P1 | SDK question resolved and implemented | Validator/nonce ID calculation and generation-specific derivation are internal. Public generation-context helpers were removed per Harsh H4.1. IDs remain wallet-scoped and receipt-confirmed. | Revalidate vectors for the final generation under G01/G23; no public context-signature approval is needed. |
| G04 | P1 | ABI history corrected; release note | Six-field main is older; inspected current gateway and historical Donut dispatcher use eight fields. A hypothetical future field removal is not a present SDK blocker. | Encode the selected manifest’s gateway ABI and track any actual migration with that deployment. |
| G05 | P1 | Downstream marketplace alignment | Core cb69e0b requires rule/job expiry equality; supporting Notion pages have conflicting inequalities. | Align the marketplace/compiler track. Do not impose job equality on every standalone AGW rule. |
| G06 | P2 | Closed for v1 | Binder was never in the reviewed code and is dropped for v1. | No binder implementation or binder-dependent lifecycle requirement in standalone AGW. Preserve historical snapshots as evidence. |
| G07 | P1 | Known platform dependency | creditRevert depends on Push-core executor work. Until delivered, a far-side failure can leave spend inflated. | Track platform delivery and document/test the limitation. This is not an unanswered AGW redesign question. |
| G08 | P1 | Reads implemented; metadata pending | Stored checkpoint count/event reads are implemented. Editable labels and grant ref remain generation dependencies. Harsh deferred revoked history, so it is no longer a requirement here. | Deliver agreed ref/label capabilities and verify deployment. Do not request agent-event additions solely for deferred historical reads. |
| G09 | P1 | Deferred from standalone AGW | Canonical card schema/encoding remains a marketplace issue. Harsh H5 removes compileCard from standalone AGW; its public stub was removed. | Resume schema/compiler vectors under the future marketplace scope, not as an AGW release blocker. |
| G10 | P1 | Downstream marketplace scope | Current marketplace binds one EVM chain and one rulesId; broader card binding remains unresolved downstream. | Align future marketplace/job cardinality. Standalone AGW does not invent multi-rule job bindings. |
| G11 | P1 | Downstream job dependency | Payment-token selection differs between the target job SDK and the one-token-per-deployment kernel. | Align selected K-12/deployment design in the job track. |
| G12 | P1 | Downstream evaluator/hook delivery | Current start/fund guards exist; evaluator baseline/submit integration is incomplete. | Verify lifecycle placement and bypasses in the separate marketplace/job/evaluator work. |
| G13 | P1 | SDK implemented locally; spec wording stale | Core supports native 7702 batching with a sequential fallback. Creation uses actual capability, index-bound deployment and receipt/recovery metadata. | Correct the stale factory-batch requirement in source docs when maintained; verify final-generation/UEA creation on the release deployment. |
| G14 | P1 | Native update implemented locally; universal ABI pending | Existing-wallet assert → revoke → grant is one atomic owner batch. Native stale-spend rollback and five checkpoint ticks are tested. | Implement final universal per-token assertions after G23/G24 artifacts arrive; recheck on the selected deployment. |
| G15 | P2 | SDK implemented locally | create deploys/grants only; funding is separate. No required new createWallet factory method. Index binding prevents grants on a raced wallet; partial recovery preserves operation receipts and unknown state. | Verify final-generation events and native/UEA strategies; do not restore removed funding inputs. |
| G16 | P1 | Implemented; migration documentation pending | READ.CHAIN.WEB2 is web2. Legacy web2:https input is normalized to unchanged wire identity. Deprecated aliases now use the new public value. | Document the observable alias/literal-comparison migration and run relevant read acceptance before release. |
| G17 | P1 | SDK decision implemented locally | Read-only write guards and explicit agenticWallet selection on reinitialize are implemented. Signer/network/wallet changes rebuild role/capability context. | Preserve compatibility coverage and verify with the release deployment. |
| G18 | P1 | SDK behavior implemented locally | Initialization uses enabled-rule identity; sends perform uncached lookup without expiry filtering. Missing/ambiguous candidates fail before signing. Public list is enabled-only; unknown/revoked get returns RULE_NOT_FOUND. | Verify final-generation and live permission-change cases; public history is deferred, not an open v1 question. |
| G19 | P0/P1 | Approval policy resolved; H3 defaults open | Harsh assigns approval screening to UI/marketplace. SDK selector rejection and mandatory-spender policy were removed, while ABI/chain/caller-requested pin validation remains. Defaults are byte-for-byte unchanged pending the exact H3 table. | Clarify omitted values, explicit zero and maxValueTotal. Obtain final token/native-marker fixtures with G23. Do not keep approval-policy sign-off as an SDK blocker. |
| G20 | P1 | Composer/responses implemented locally; live acceptance pending | Dedicated AGW composer uses wallet CEA/refund context, explicit owner-established allowance and separate signer gas. Live/replay summaries are canonical with ordered call metadata; real response-builder wait is covered locally. | Prove actual production pull/burn, node/TSS acceptance, recipient/executor correlation and tracking against the compatible deployment. |
| G21 | P1 | Product direction resolved; batching implemented locally | NativeRule remains one action. Arrays use a sender-preserving UEA/7702 outer batch of single executeAsAgent calls, each checked by policy. Native sequential fallback is prohibited. Local real-type-4 tests prove sender identity, cumulative counters and mined rollback. | Run release-deployment UEA/7702 acceptance. The local executor is a fixture; arbitrary forwarding helpers are not a substitute for the agent account. |
| G22 | P1 | Open SVM contract/capability dependency | Solana-origin identity through UEA is distinct from Solana destination rules. Harsh refers destination work to Zaryab; SDK destination capability remains gated. | Obtain representable terms/payloads, supported capabilities and deployment, then implement/verify obligations 19–23. |
| G23 | P0 | Open final universal ABI dependency | Target assets[]/maxGasPerCall is not implemented by the tested single-asset source. New per-asset enforcement, zero/omission semantics, empty-assets routing and expectedCEA representation need matched artifacts. | Deliver final terms/read/event ABI and vectors; no silent single-asset substitution for the public multi-asset target. |
| G24 | P1 | Public spend question resolved; internal assertion ABI open | Public Spent and RulesRecord.spent were removed per Harsh H4.2. Internal per-token counters remain necessary. A getter returning totals cannot replace caller-supplied expected-value checks for atomic update. | Obtain per-token read/assertion ABI and prove stale state rejects across all old-rule assets. No public per-token result-shape approval is required. |
| G25 | P1 | Open raw-offset public API decision | R5 fix returns exact calldata offsets/words instead of invented argument indexes and accepts that form for round trips. This extends the public NativeRule shape; the later change was not covered by Harsh’s initial replies. | Decide public raw authoring versus a separate decoded/internal wire representation; preserve ABI-based validation at the agreed boundary. |

## Validation and release boundaries

The [October 4 alignment evidence](research/product-alignment-2026-10-04/README.md) records 1,917 passing unit tests, 36 passing local-contract tests, clean build/typechecks and seven existing lint errors in unchanged files. AGW E2E selection has 23 opt-in scenarios; default all remains 76. Live E2Es have not been run.

Local batch proof uses actual AGW/factory/engine/policy and real Anvil EIP-7702 transactions, with a small fixture executor. UEA shaping/replay is unit-tested and reuses the existing transport; live UEA, production executor/gateway and destination acceptance remain outstanding.

## Rules for closure

- A product decision can close a question without completing a contract or deployment dependency.
- Implemented source/local behavior and live acceptance are separate statuses; do not count the same deployment dependency once per SDK method as independent defects.
- expectedCEA derives from AGW plus destination context. Signer CEA and arbitrary pasted addresses are not substitutes.
- Checkpoint consumers compare counts; allowance-driven balance changes are not always checkpointed. Current single replacement adds five ticks.
- Internal spend assertions remain required even when public spend records are removed.
- H3 defaults and raw-offset representation remain open. Keep current defaults until the former is explicitly clarified.
- Harsh’s replies have been received. The linked question documents now contain remaining follow-ups; no outbound team messages were sent by this agent.

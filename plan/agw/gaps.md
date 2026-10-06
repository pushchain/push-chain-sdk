# AGW contract and SDK gap register

Updated October 6, 2026 after the [v4 deployment/owner-guide review](research/deployment-review-2026-10-06/README.md), [Harsh’s replies](product-decisions-2026-10-04.md), v4 implementation on feat/agw-sdk-v4, and [live Notion comments](research/notion-comments-2026-10-05.md). This register distinguishes unresolved dependencies, implemented SDK work, deferred scope and historical corrections. G01–G26 are tracking IDs, not a count of open defects.

Evidence: [current baseline](current-baseline.md), [implementation status](implementation-status.md), [product alignment validation](research/product-alignment-2026-10-04/README.md), and [extended live E2Es](research/extended-e2e-2026-10-06/README.md). The unrestricted v4 SDK run passes 1,982 unit tests and 75 local-contract tests. All 39 scenarios in the opt-in AGW group pass selected-run live coverage; default E2E selection remains unchanged. Public SVM destinations remain gated.

Current contract baseline: reported deployed source `e8db748`, documentation head `deploy-agw@10a24f1` (src unchanged between them). Donut v4 addresses/code/wiring and URP 3.1.0 were checked at block 23931055; verified ABIs were saved. The SDK now uses v4 only, registers Donut and has a ported actual-contract harness. [Implementation evidence](research/v4-implementation-2026-10-06/README.md). Core marketplace cb69e0b and gateway bcbf7df remain prior source pins; they were not freshly fetched. Notion bodies were not refreshed in this pass.

## Remaining standalone external dependencies

| Dependency | Owner | Related IDs |
| --- | --- | --- |
| Native PC omission defaults and token wording; current target retains maxValueTotal | [Harsh H3](questions-harsh.md#h3) | G19 |
| Public Solana authoring/read model; wire/backend supplied | [Harsh H4.4 with Zaryab](questions-harsh.md#h4-4) | G22 |
| Public raw-offset read/write representation | [Harsh H4.5](questions-harsh.md#h4-5) | G25 |
| Multiple-rule send selection (same-agent capacity is supplied) | [Harsh H6](questions-harsh.md#h6) | G26 |
| V1 ref/label scope | [Zaryab Z1.3 with Harsh](questions-zaryab.md#z1-3) | G08 |

The [October 6 source recheck](research/question-source-recheck-2026-10-06/README.md) narrowed the questions. Subsequent [live wire validation](research/live-svm-wire-2026-10-06/README.md) supplies our own Solana fixture and successful delivery/replay, closing Z1.4. The rejected outbound initially timed out, then reached REVERTED and read-only replay classified it failed. [Concrete API proposals](public-api-proposals.md) are ready; retry/terminalization timing is an operational follow-up.

Multi-asset wire/read/assertion ABI, EVM CEA width, envelope version and SVM wire layouts are now supplied. G23/G24 and the native/EVM adapter/registry migration are implemented locally; SVM mapping/live acceptance remain SDK work; do not keep asking for those delivered definitions.

Approval screening, public generation context, public spend shape, revoked-history reconstruction and compileCard are no longer unresolved standalone product questions. Native agent batching is implemented through a sender-preserving outer transport; it does not require a new batch-mode AGW agent entry point.

## Current disposition

P0 blocks agreed authorization/accounting or safe final integration. P1 affects correctness, compatibility or delivery. P2 covers optional scope or documentation. “Implemented locally” means source and local evidence exist; live acceptance is tracked separately.

| ID | Priority | Status | Current finding or resolution | Remaining action |
| --- | --- | --- | --- | --- |
| G01 | P1 | V4 registered; live coverage passes | Checked new deployment and reproduced ABIs are integrated in the Donut-only registry; no legacy adapter fallback. | All 39 AGW scenarios have passing live coverage. Refresh wiring/source for future releases. |
| G02 | P0 | Source deployed; native/UEA acceptance passes | D3 executeAsAgent/agentOf and sender adapter exist in v4; documented wiring matches live reads. SmartSession is unchanged. | Sender-binding/alternate-path tests and live native/UEA/7702 acceptance pass; do not reopen the engine-fork proposal. |
| G03 | P1 | SDK question resolved and implemented | Validator/nonce ID calculation and generation-specific derivation are internal. Public generation-context helpers were removed per Harsh H4.1. IDs remain wallet-scoped and receipt-confirmed. | V4 vectors and receipt-confirmed IDs are verified; no public context-signature approval is needed. |
| G04 | P1 | ABI history corrected; release note | Six-field main is older; inspected current gateway and historical Donut dispatcher use eight fields. A hypothetical future field removal is not a present SDK blocker. | Encode the selected manifest’s gateway ABI and track any actual migration with that deployment. |
| G05 | P1 | Downstream marketplace alignment | Core cb69e0b requires rule/job expiry equality; supporting Notion pages have conflicting inequalities. | Align the marketplace/compiler track. Do not impose job equality on every standalone AGW rule. |
| G06 | P2 | Closed for v1 | Binder was never in the reviewed code and is dropped for v1. | No binder implementation or binder-dependent lifecycle requirement in standalone AGW. Preserve historical snapshots as evidence. |
| G07 | P1 | Known platform dependency | creditRevert depends on Push-core executor work. Until delivered, a far-side failure can leave spend inflated. | Track platform delivery and document/test the limitation. This is not an unanswered AGW redesign question. |
| G08 | P1 | Metadata scope still open | V4 keeps checkpoints but still has no grant ref or setLabel; label is event-only at deployment. Revoked history is deferred. | Confirm ref/label v1 scope with Zaryab/Harsh. Keep absent capabilities explicit; do not fabricate storage/events or request additions solely for historical reads. |
| G09 | P1 | Deferred from standalone AGW | Canonical card schema/encoding remains a marketplace issue. Harsh H5 removes compileCard from standalone AGW; its public stub was removed. | Resume schema/compiler vectors under the future marketplace scope, not as an AGW release blocker. |
| G10 | P1 | Downstream marketplace scope | Current marketplace binds one EVM chain and one rulesId; broader card binding remains unresolved downstream. | Align future marketplace/job cardinality. Standalone AGW does not invent multi-rule job bindings. |
| G11 | P1 | Downstream job dependency | Payment-token selection differs between the target job SDK and the one-token-per-deployment kernel. | Align selected K-12/deployment design in the job track. |
| G12 | P1 | Downstream evaluator/hook delivery | Current start/fund guards exist; evaluator baseline/submit integration is incomplete. | Verify lifecycle placement and bypasses in the separate marketplace/job/evaluator work. |
| G13 | P1 | SDK implemented locally; race classification verified live | Core supports native 7702 batching with a sequential fallback. Creation uses actual capability, index-bound deployment and receipt/recovery metadata. The extended live race test verifies no rules reach the competing wallet, reports `INDEX_RACE`, and retries at the next slot. | Correct the stale factory-batch requirement in source docs when maintained; native creation and UEA identity acceptance pass on the verified deployment. |
| G14 | P1 | V4 native/EVM update implemented locally | Ordered all-token assertions precede revoke/grant; actual second-token spend races roll back the entire update and checkpoints. Native per-action guards retained. | Native/EVM updates pass live. Public SVM wrapper remains. |
| G15 | P2 | SDK implemented locally | create deploys/grants only; funding is separate. No required new createWallet factory method. Index binding prevents grants on a raced wallet; partial recovery preserves operation receipts and unknown state. | Final-generation events/native batching and UEA identities are verified; do not restore removed funding inputs. |
| G16 | P1 | Implemented; migration documentation supplied | READ.CHAIN.WEB2 is web2. Legacy web2:https input is normalized to unchanged wire identity. Deprecated aliases now use the new public value. | The consumer guide documents the alias/literal migration; Web2 normalization/read-source tests pass. |
| G17 | P1 | SDK decision implemented locally | Read-only write guards and explicit agenticWallet selection on reinitialize are implemented. Signer/network/wallet changes rebuild role/capability context. | Preserve compatibility coverage and verify with the release deployment. |
| G18 | P1 | SDK behavior implemented locally; selection under review | Initialization uses enabled-rule identity; sends perform uncached lookup without expiry filtering. Missing/ambiguous candidates fail before signing. Public list is enabled-only; unknown/revoked get returns RULE_NOT_FOUND. The October 5 multiple-rules comment may change selection/cardinality assumptions. | Resolve G26 before treating uniqueness/ambiguous-candidate behavior as final. Verify final-generation and live permission-change cases; public history is deferred. |
| G19 | P0/P1 | Universal defaults implemented; H3 native PC choices open | Universal omission uses maxUint256 and explicit zero is hard zero; empty input gets a gas-token 0/0 route. Native PC omission remains provisional at 0. Current live NativeRule retains maxValueTotal; wire sentinel meanings are supplied. | Confirm omitted native PC limits and intended token model; preserve the current field unless an explicit revision is supplied. |
| G20 | P1 | V4 composer/response and live EVM acceptance pass | Uses selected listed token, maxGasPerCall, wallet CEA/refund context, separate allowance and signer gas. Local requests pass actual URP with fixture gateway. | Production token debit, node/TSS delivery, CEA execution attribution/balance, replay identity and destination-revert classification pass. Public SVM integration remains tracked under G22. |
| G21 | P1 | Product direction resolved; batching implemented locally | NativeRule remains one action. Arrays use a sender-preserving UEA/7702 outer batch of single executeAsAgent calls, each checked by policy. Native sequential fallback is prohibited. Local real-type-4 tests prove sender identity, cumulative counters and mined rollback. | Release-deployment UEA identities and native 7702 batch/rollback cases pass. The local executor is a fixture; arbitrary forwarding helpers are not a substitute for the agent account. |
| G22 | P1 | Internal SVM delivery and terminal replay verified; public integration pending | Actual CEA transfer/CPI, replay and deployed policy refusals pass. Initial rejection wait timed out; the same outbound later became REVERTED and replay returned failed. Public capability stays gated. | H4.4: agree public authoring/read mapping, connect adapters and complete public acceptance. Z1.4 fixture delivery is closed; terminalization timing is an operational follow-up, not a newly inferred delivery blocker. |
| G23 | P0 | V4 EVM integration verified locally and live | Multi-asset codecs/reads/outbound, envelope 1, source chain/token identity, hard-zero semantics and empty-input routing are implemented. Old adapter/ABIs/fixtures removed. | Registered EVM acceptance passes. Public SVM SDK mapping/composition remains. |
| G24 | P1 | Internal per-token update verified locally and live | Reads/stores every expected counter in asset order; array assertion catches intervening second-token spend. Public spent stays absent. | Live two-asset replacement passes; public SVM integration remains. |
| G25 | P1 | Public raw-offset decision open | Exact native pin/amount offsets and EVM beneficiaryOffset are returned/accepted losslessly; no invented argument indexes. This extends the target input shape. | H4.5: public raw authoring versus separate decoded wire records. |
| G26 | P1 | Management implemented; send selection open | Same-agent/same-chain grants are accepted. Multiple matching send candidates fail with AMBIGUOUS_RULE and their IDs. | H6: choose explicit versus automatic selection, including arrays/overlapping rules; never arbitrarily select or revoke. |

## Validation and release boundaries

The [existing acceptance evidence](research/live-acceptance-2026-10-06/README.md) records the original native/EVM coverage. The [extended report](research/extended-e2e-2026-10-06/README.md) records 1,982 passing unit tests, build/typechecks, and 14/14 additional funded tests; default all remains 76. Extended cases cover management races/batching and native policy pins, caps and rollback. Public Solana destination coverage remains outstanding.

Local batch proof uses actual AGW/factory/engine/policy and real Anvil EIP-7702 transactions, with a small fixture executor. UEA shaping/replay is unit-tested and reuses the existing transport; all registered native/EVM/UEA acceptance scenarios now pass. Public Solana destination coverage remains outstanding.

## Rules for closure

- A product decision can close a question without completing a contract or deployment dependency.
- Implemented source/local behavior and live acceptance are separate statuses; do not count the same deployment dependency once per SDK method as independent defects.
- expectedCEA derives from AGW plus destination context. Signer CEA and arbitrary pasted addresses are not substitutes.
- Checkpoint consumers compare counts; allowance-driven balance changes are not always checkpointed. Current single replacement adds five ticks.
- Internal spend assertions remain required even when public spend records are removed.
- H3 native defaults and raw-offset representation remain open. Universal total semantics are now supplied; the old zero/unlimited row must not carry into v4.
- H6 remains a send-selection choice. Same-agent capacity is supplied; uniqueness validation is provisional/stale. Token-independence wording is a product follow-up, not permission to remove policy checks.
- Harsh’s replies have been received. The linked question documents now contain remaining follow-ups; no outbound team messages were sent by this agent.

The October 5 historical table is superseded for new integrations by the October 6 v4 completion notice and address book. Contract delivery/code/wiring checks are recorded in the review; Native/EVM migration and registered funded acceptance pass. Delayed-index local acceptance and consumer documentation are complete; public SVM destination integration remains.

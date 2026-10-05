# Complete AGW SDK implementation plan

Updated October 6, 2026. The v4-only native/EVM implementation uses deployed source e8db748 and the Donut manifest. Old runtime/test adapters and single-asset codecs are removed. The unfiltered unit suite passes 1,947 tests; all 53 actual-contract Anvil cases pass; build and four typechecks pass. All 25 registered AGW live scenarios pass across selected runs; remaining work is public SVM integration and release scope decisions. [Current acceptance and remaining coverage](research/live-acceptance-2026-10-06/README.md).

SVM internal terms/accounts/payload/builder are implemented and validated. Public SVM mapping/dispatch remains gated. Remaining decisions are H3 native defaults, H4.5 raw-offset public shape, H6 send selection and ref/label v1 scope. Earlier plan recommendations below are qualified by those accepted decisions and the current implementation status.

> October 5 comment update: [live review](research/notion-comments-2026-10-05.md) adds [H6](questions-harsh.md#h6) for same-agent multiple-rule scope and send selection. Any one-rule-per-agent/chain or DUPLICATE_RULE recommendation below describes the earlier implementation baseline and is provisional. Once clarified, revise steps 6–8 and 10–12 plus their tests together. Do not choose the first rule arbitrarily. Token-independence wording is included in H3/Z1.1; defaults remain unresolved.

> October 4 update: [Harsh’s replies](product-decisions-2026-10-04.md) supersede earlier provisional approval/default/helper/history/compiler recommendations below. Use [remaining dependencies](external-blockers.md) for current blockers. The clear scope changes and sender-preserving native batching are now implemented; H3 defaults remain unchanged pending clarification. See [alignment evidence](research/product-alignment-2026-10-04/README.md).

This is the step-by-step plan for the complete AGW surface in Notion page 5 inside `@pushchain/core`. It covers management, rules, execution, responses, helpers, compatibility, documentation and release validation. Marketplace, job and evaluator clients are separate projects; `compileCard` is deferred to their later delivery and is not exposed by standalone AGW. Settled implementation is recorded in [implementation status](implementation-status.md); remaining contract capabilities stay gated.

Target: [SDK spec](notion/5-sdk-agw.md), exported October 3, 2026 at 13:23 IST. Tested contract source: AGW v4 `e8db748`. SDK production baseline: `167fdc6`. See [current baseline](current-baseline.md), [SDK design](sdk-design-review.md), [SDK-owned decisions](sdk-owned-review.md) and [external blockers](external-blockers.md). The October 6 deployment/owner guide and October 5 comment review qualify the older Notion snapshot; a newer full Notion export is not claimed.

## How to execute this plan

Proceed in numbered order, taking the independent Web2 work alongside the foundation if useful. A step marked **Start now** has settled internal boundaries. **Partial** means implementation can proceed behind a contract adapter or provisional type, but the listed dependency must be resolved before that feature is complete. **Waiting** identifies a feature whose final behavior cannot be honestly implemented from available artifacts.

Implementation and verification are listed separately so development progress can be measured independently. A placeholder is scaffolding, not completed behavior. All new files listed below are proposed paths, not existing implementation.

| Step | Deliverable | Start status | Depends on |
| --- | --- | --- | --- |
| 1 | Source and capability contract | Start now | Existing snapshots and evidence |
| 2 | Module skeleton, public types, exports and errors | Partial | 1; disputed types isolated under A04–A06 |
| 3 | Signer/wallet context, initialization and lifecycle | Start now | 2; final deployment validation in 14 |
| 4 | Generation registry and contract adapter | Partial | 1–3; A07 for real deployment entries |
| 5 | Wallet and checkpoint reads | Partial | 4; A06/A07 for full history/metadata |
| 6 | Rule normalization, identities and codecs | Partial | 4; A01/A03/A04/A05 |
| 7 | Create, add and revoke | Partial | 3–6; matching grant ABI |
| 8 | Atomic rule replacement | Partial | 6–7; A05 expected-spend assertion |
| 9 | Owner execution and allowance setup | Start now through pinned adapters | 3–4; 11 for destination approval transport |
| 10 | Agent rule selection and native execution | Partial | 3–6; A02 for array scope |
| 11 | EVM universal execution and gas handling | Partial | 6, 9–10; A05/A07 |
| 12 | SVM destination support | Partial | 6, 10; final schema and advertised capabilities (A05/A07) |
| 13 | Responses, tracking, progress and transaction-creating reads | Partial | 3, 9–12; final wire adapters |
| 14 | Deployment onboarding and full acceptance | Waiting for matching deployment | 4–13; A07 |
| 15 | Web2 compatibility | Start now; independent | Existing read-state modules |
| 16 | Card compiler and ecosystem boundary | Outside standalone AGW v1 | Future marketplace track |
| 17 | Documentation, examples and release | Draft now, finish after acceptance | 1–16 or explicit accepted feature scope |

Do not interpret this table as an equal-effort percentage. Steps 6, 11–14 carry substantially more integration risk than namespace and export work.

## Assumptions and placeholder rules

These are working assumptions for development, not accepted product changes. Replace each with an owner decision and source reference when answered.

| ID | Working assumption or placeholder | Confirmation | Replacement point |
| --- | --- | --- | --- |
| A01 | Approval policy is UI/marketplace-owned; SDK retains structural validation without selector deny-lists or mandatory spender policy | Harsh H1 resolved October 4; implemented | Native/universal validation |
| A02 | Multiple native actions use a sender-preserving UEA/7702 outer batch of single agent-door calls; never sequential fallback | Harsh H2 direction; implemented and locally validated | Atomic transport and batch response adapters |
| A03 | Exact revised default table remains open; existing defaults are unchanged until H3 is clarified | Harsh H3 / E03 | One defaults module |
| A04 | Generation-dependent IDs, derivation and encoding context remain internal; client.agentic.derive remains public | Harsh H4.1 resolved; implemented | Public utility exports and internal codecs |
| A05 | Spend stays internal. V4 supplies ordered per-token wire/read/assertion ABI, address EVM CEA and zero-cap gas-token routing for empty user assets | Native/EVM v4 integration and live outbound tests pass; public SVM pending | V4 accounting/codec/outbound adapter |
| A06 | V1 lists enabled rules only; unknown/revoked get returns RULE_NOT_FOUND. No historical record reconstruction | Harsh H4.3 deferred; implemented | Public read model |
| A07 | New v4 addresses/wiring/ABIs are supplied and checked; V4 adapter/manifest are implemented and verified. Envelope is version 1; grant ref/setLabel remain absent | Deployment delivered October 6; Z1.3 metadata scope remains | Deployment manifest, v4 migration and capability gates |
| A08 | No compileCard in standalone AGW; canonical cards belong to later marketplace work | Harsh H5: outside AGW v1 | No public compiler stub/export |

### What closes each assumption

- A01/A02/A04: clear product scope is implemented. A03 defaults still need exact agreed wording.
- A05: delivered v4 definitions unblock SDK codec/read/assertion work. Preserve internal accounting, correct zero semantics and prove all-asset replacement rollback.
- A06: revoked history is outside v1; active-only reads and explicit RULE_NOT_FOUND behavior are implemented.
- A07: deployment notice received; new addresses supersede the historical table. The v4 manifest/registry and native/EVM integration are verified; track remaining acceptance in the live report. Ref/label remain a scope/delivery question; no new address request is needed.
- A08: closed for standalone AGW by deferring compileCard to the marketplace track.

Record design decisions and artifact/deployment readiness separately. All eight have an explicit question owner, but answers alone do not mean all eight are implemented or verified.

Placeholder implementation rules:

- Use explicit internal capabilities and typed failures. A missing codec or unsupported generation must fail before signature/broadcast; never return empty success records, zero addresses, fabricated IDs or dummy transactions.
- Keep historical source snapshots only as planning evidence. Runtime and tests use v4 artifacts; assets[] must never become an arbitrary first asset or unrelated split rules.
- Keep provisional wire types internal. Do not publish `any`, guessed envelope versions, guessed deployment addresses or fixed ABI tuples as the final SDK contract.
- Do not implement both sides of a product choice speculatively. Isolate the boundary and implement the selected behavior after confirmation.
- `setLabel`, full historical reads, SVM destination encoding and compileCard may be explicitly unsupported in development builds while their dependencies are incomplete. A complete release must implement the promised surface or record an approved scope change.

## Proposed module layout

All paths below are relative to `packages/core/src/lib/`.

| Proposed location | Responsibility |
| --- | --- |
| `agentic/index.ts`, `agentic.types.ts`, `errors.ts` | Public namespace/types and error surface |
| `agentic/agentic.ts`, `wallet.ts`, `rules.ts` | derive/create/list/wallet and lifecycle coordination |
| `agentic/context.ts`, `deployments.ts` | Separate signer/execution identity; generation capabilities |
| `agentic/contracts/` | Verified ABIs, view/event adapters, owner-intent encoding |
| `agentic/codec/` | Native/universal/SVM terms, IDs, ABI argument positions, defaults and token resolution |
| `agentic/reads/` | Snapshot reads, wallet enumeration, checkpoints and historical reconstruction |
| `agentic/execution/` | Owner/agent wrappers, rule selection, native/universal composition |
| `agentic/response.ts` | Logical identity and AGW metadata adaptation over core responses |
| `agentic/card.ts` | Canonical card compiler once the shared schema is approved |

Existing integration points: `push-chain/push-chain.ts`, `utils.ts`, `index.ts`, `constants/index.ts`, `orchestrator/orchestrator.ts`, `orchestrator/internals/context.ts`, `response-builder.ts`, `read-state.ts`, `errors.ts`, `progress-hook/*` and the `read-state/*` public parser/types. Keep generic core behavior generic; AGW-specific ABI logic belongs in the adapter. Avoid broad route rewrites merely to add this execution context.

## Step 1 Pin the implementation contract

Implementation:

1. Record exact SDK, AGW, core, gateway and spec revisions in the development issue/PR.
2. Inventory every public page-5 method, its contract dependency and capability. Use the coverage table below.
3. Register A01–A08 with explicit unresolved status. Store contract-generated vectors with their originating revision.
4. Define supported-generation lookup by Push network and verified factory/implementation/wiring. AccountId is supporting evidence, not the sole discriminator.

Verification: inspect source hashes and ABI selectors, including imported gateway request layout. Refresh sources again when an external answer arrives. Existing 183 SDK unit tests and four allowance experiments are the baseline, not tests of future SDK behavior.

Done when: implementation has a pinned target and unresolved features cannot be mistaken for supported runtime capabilities.

## Step 2 Add the namespace and type boundaries

Implementation:

1. Add client.agentic, the management handle, AGENTIC constants and public actionId/configId/decodeRules utilities. Keep generation-dependent utilities internal; no AGW compileCard.
2. Model create results, wallet summaries, checkpoint records, public rules without spend, internal counters, errors and progress. Separate internal wire terms from the public Rule input.
3. Add `agenticWallet` to the shared initialize/reinitialize option path without changing ordinary-client defaults.
4. Add AgenticError and AgenticRevertError using core's structured failure model. Preserve cause/decoded error data and batch-recovery hashes; expose the base execution error if required for public instanceof checks.
5. Isolate A04/A05/A06 in small interfaces. A registered method with no implementation throws a clear unsupported-capability error; the final public error names are documented before release.

Verification: package type checks, import/export checks and consumer snippets for ordinary, agentic and read-only clients. Ensure the new namespace does not make market/job/evaluation appear implemented.

Done when: the settled public surface compiles and incomplete features fail explicitly.

## Step 3 Implement execution context and lifecycle

Implementation:

1. Resolve and store signer origin, signer Push identity, optional AGW execution account, Push network and selected generation separately.
2. Expose AGW as universal.account only in agentic execution mode. Keep universal.origin and getAccountStatus signer-scoped.
3. Validate deployed wallet and factory membership/capabilities. Determine owner versus agent from connected Push identity. External keys resolve to the UEA for their actual origin chain.
4. For agents, require an enabled rule naming that identity. Do not filter enabled rules by expiry at initialization or replace on-chain expiry checks.
5. Preserve read-only behavior across every signing entry point. A management handle remains a handle, never a hidden account switch.
6. On reinitialize, require explicit agenticWallet selection to retain/switch AGW mode, as our recorded SDK decision. Rebuild role/capability state; preserve inheritance of existing ordinary options.
7. Enforce FROM_NOT_ALLOWED and the spec's prohibited methods before signing. Audit auxiliary entry points, including transaction-creating reads, for bypasses.

Verification: native owner/agent, EVM-origin agent, SVM-origin agent, unknown identity, changed signer/network/wallet, read-only writes and ordinary-client compatibility. Role checks must not grant signing authority to a read-only address.

Done when: changing displayed account cannot change gas-payer or ownership derivation accidentally.

## Step 4 Build the contract and deployment adapter

Implementation:

1. Centralize ABI selection, wiring reads, supported features, start blocks and cached immutable data per generation.
2. Add reads for owner, factory registry/count/prediction, enabled permission IDs, agent config, policy mode/config and checkpoints.
3. Add encoders for owner execute, agent executeAsAgent, grants/revokes and owner-authorized signature variants where used by the chosen transport.
4. Generate any OwnerIntent typed data from the exact contract ABI/domain/nonce scheme. Never copy the simplified signatures in a proposal over the delivered ABI; bind ref if the final signed-grant design includes it.
5. Validate proxy/implementation/wiring information supplied by the selected manifest. Include network, factory and implementation identity in caches; invalidate on incompatible configuration changes.
6. Leave A07 deployment entries absent until verified. Do not use old Donut addresses as placeholders for new capabilities.

Verification: mocked mismatched wiring and unsupported generations, ABI encode/decode vectors, intent domain/nonce/deadline tests. Final artifact comparisons occur again in step 14.

Done when: other modules can operate against a typed adapter without knowing contract-version details.

## Step 5 Implement wallet and checkpoint reads

Implementation:

1. Implement client-bound derive from signer identity and factory next index; honor the contract's index range. Implement pure derive internally with explicit generation context pending A04 public signature.
2. Implement list using walletCount and predicted indices; include the next undeployed slot shown in the spec as our documented interpretation, with zero rules and deployed=false.
3. Implement wallet(address), owner and info with snapshot-consistent reads. Reconstruct current deployment label from the event when required by the selected generation.
4. Implement checkpoints from bounded/paginated logs, ordered by block/transaction/log index. Preserve seq, kind, ref, blockNumber and txHash. Account for reorgs and sinceBlock inclusion.
5. Implement active rules.get/list internals using enabled IDs followed by agent/action/policy reads at one block. Distinguish unknown, revoked, expired and zero-valued configurations.
6. V1 has no historical records: list returns enabled rules and get rejects unknown/revoked IDs. Do not claim info/rule lookup is one RPC request if it requires dependent reads.
7. Add setLabel only for a matching supported capability. Respect the chosen cosmetic/checkpoint semantics from the final contract.

Verification: empty owner, next slot, index races, multiple wallets/generations, paginated logs, same-block changes, unknown IDs, revoked-history limits and RPC failures.

Done when: supported management reads return honest, complete records for their declared capability.

## Step 6 Implement rule normalization and codecs

Implementation:

1. Normalize destination: omitted chainNamespace means connected Push; foreign rules retain their verified CAIP-2 chain identity. Reject owner-as-agent and duplicate agent/chain grants as specified.
2. Resolve destination token/native marker to the intended Push PRC20 with trusted chain context and exact SOURCE_CHAIN_NAMESPACE checks. Treat token amounts in their own units; reject ambiguous/duplicate asset resolution.
3. Derive expectedCEA from AGW and destination deployment, not from the agent. Supply it to the encoder and preview data; document and detect derivation drift. Separate asynchronous registry/RPC resolution from pure encodeRules/decodeRules helpers: pure helpers receive pre-resolved token, ABI and deployment context and perform no hidden network calls.
4. Derive selectors, actionId/configId and rulesId against contract vectors. Wallet-scope record keys. Use explicit validator context internally; receipt-assigned IDs remain authoritative.
5. Generate native argument pins and beneficiary positions from ABI layout. Static tuples can occupy multiple words; dynamic arguments require layout-aware handling. Reject unsupported layouts or a bare selector with insufficient ABI context for required pins.
6. Implement native terms with explicit values first. Centralize provisional A03 defaults; approval policy is external to the SDK.
7. Add a versioned universal multi-asset codec only after A05 artifacts arrive. Keep encode/decode inverse behavior and validation for 0–8 assets, per-token limits and call lists.
8. Define empty-assets call routing, expectedCEA byte width, zero/unlimited semantics and envelope-version behavior from fixtures. Do not guess these to make a test pass.

Verification: contract-generated round trips, wrong token chain, wrong beneficiary, oversized values, dynamic ABI layouts, duplicate assets, native marker, boundary values and generation mismatch. Existing pinned single-asset vectors remain explicitly historical.

Done when: every supported public rule has a deterministic, verified wire representation and decode result.

## Step 7 Implement create, add and revoke

Implementation:

1. create validates all inputs before signing, resolves the next wallet, then deploys and grants in input order. Empty rules are valid. It never adds funding or PC top-ups.
2. Select supported UEA batching, native EIP-7702 batching or the documented native sequential fallback. Return the actual atomicity and transaction history through existing core metadata.
3. Parse matching wallet/rule events, preserve input ordering and distinguish predicted from confirmed IDs. Return the specified wallet/index/rulesIds/tx.
4. If a sequential step fails, retain deployed wallet identity, confirmed hashes and any pending hash. Re-read chain state before retry; do not silently deploy another wallet or repeat successful grants.
5. rules.add batches grants through the existing owner wallet. Recheck owner, nonce and duplicate candidates before signing.
6. rules.revoke accepts explicit IDs or all=true; reject bare revoke. Use one owner-wallet batch where needed and preserve failure atomicity.
7. Use signature-authorized contract variants only with matching verified intent encoding from step 4; a native execution path is not permission to invent a relay flow.

Verification: partial creation, pending transaction, nonce/index races, zero/multiple rules, ID ordering, wrong owner, mixed-success prevention and all-rules revocation.

Done when: a failed operation tells the caller exactly what committed and what can safely be retried.

## Step 8 Implement atomic rules.update

Implementation:

1. Read old rules and all relevant spend counters at a consistent block, and validate every replacement before signing.
2. Encode assert(expected spend) → revoke(old ID) → grant(new rule) for every pair inside one owner execute batch.
3. Require an adapter with A05 expected-value assertions. A getter returning current totals is not a substitute. Never use the core sequential fallback for this operation.
4. Return old/new ID pairs in input order. New counters start at zero; do not silently subtract prior consumption from new caps.
5. Surface stale-spend failures clearly. A retry requires refreshed state and a new owner authorization; do not loop signatures automatically.
6. Decode checkpoint effects using final generation semantics; current single replacement adds five ticks.

Verification: intervening spend, failed new grant, multiple assets/pairs, complete rollback, unusable old rule, usable new rule and same-block checkpoints.

Done when: replacement preserves all-or-nothing behavior and cannot accept stale budget assumptions.

## Step 9 Implement owner execution and setup

Implementation:

1. Wrap normal owner sends through AGW execute with single/batch ERC-7579 encoding. Preserve owner authority without applying agent rules.
2. Document separate funding of AGW assets/outbound PC and signer gas balance. Creation remains deployment/grants only.
3. Support bounded per-token gateway approvals through ordinary owner sends to the token from AGW. Include explicit replenishment/removal and tokens requiring a zero-reset approval strategy where applicable.
4. Use the same owner execution client for destination approvals after universal composition exists. Keep its policy-free owner authority visible to callers.
5. Reflect checkpoint changes for owner operations; do not claim allowance-driven balance changes always produce checkpoints.

Verification: owner identity, unauthorized caller, approval success/removal, failed token call, allowance consumption and checkpoint deltas. Four local allowance experiments already demonstrate the mechanism; production gateway validation is still step 14.

Done when: existing owner operations suffice to prepare and manage wallet funds without a new approval-specific SDK API.

## Step 10 Implement agent selection and native sends

Implementation:

1. Resolve the actual transaction destination and query matching enabled rules on every send at a consistent block.
2. Zero candidates: NO_RULES_FOR_CHAIN before signing. Multiple candidates: DUPLICATE_RULE with a clear hint. Do not choose the first result.
3. Encode executeAsAgent with the selected ID and exact native single call. Leave expiry, allowance, amount and policy execution to contracts; do not build a second authorization engine in the SDK.
4. Reuse the signer transport so a foreign key calls from its own UEA. Reject any from route override before transport selection.
5. For native arrays, encode one single-call executeAsAgent per item and use only an atomic sender-preserving UEA/7702 transport. A missing/deferred 7702 authorization must never trigger sequential fallback. Keep the one-action public rule; each action remains subject to that rule.

Verification: revoked/expired rules, ambiguous direct grants, changed grants after lookup, native value/data calls, foreign-key identity and policy revert decoding. A rule can change after lookup; the contract remains authoritative.

Done when: an agent's normal sendTransaction executes from AGW under the correct rule without stale authorization caching.

## Step 11 Implement EVM universal sends

Implementation:

1. Build a dedicated AGW outbound composer using shared low-level payload/gas/token helpers. Do not call the signer-based Route 2 unchanged.
2. Resolve AGW destination CEA and construct the allowed destination multicall with its beneficiary context and destination-value fields.
3. Under the pinned policy, set empty recipient bytes, AGW revertRecipient and a nonzero maxPCForGas; adapt exact fields to the matched final gateway ABI.
4. Resolve the token moved by this outbound against the multi-asset rule; a list of permitted assets does not by itself mean one gateway request transfers all of them. Do not invent multi-token request batching.
5. Quote wallet outbound PC and validate the structural request. Keep signer Push gas and wallet outbound fees separate. Avoid silently adding approvals or swapping tokens in the agent path.
6. Preserve the specified first-use external UEA exception. Later agentic sends enforce signer gas balance rather than silently triggering a new origin lock. Unsupported gas helpers fail as specified.
7. Handle zero-amount/empty-assets calls only through the approved A05 routing. Use adapter capabilities for EVM multicall limits and supported token kinds.

Verification: correct CEA/refund identity, empty bytes versus zero-address bytes, fee value/caps, positive/zero amount, token resolution, insufficient signer gas, first-use UEA path and policy rejection.

Done when: the encoded outbound satisfies the matching policy and transport; live settlement remains an additional gate.

## Step 12 Implement SVM destination support

Implementation:

1. Treat Solana-origin signers separately from Solana destination rulebooks. A Solana signer can use its UEA without implying SVM outbound support.
2. Add the supported SVM codec/adapter using final contract terms and gateway payload fixtures. Resolve 32-byte accounts, trusted gateway identity, program/discriminator allow-lists and asset mapping.
3. Compile account/data constraints from the program interface with explicit layout and interface-hash context; reject unrepresentable rules.
4. Cover intermediary/aggregator program substitutions, amount ratios/slippage and output-token-account setup. Expose limitations to callers rather than assuming arbitrary instructions are safe.
5. Implement obligations 19–23 before advertising SVM destination support. The current public Rule type may need an explicit approved extension to represent these constraints; record that dependency rather than improvising a public type.

Verification: golden instruction payloads, wrong authority/beneficiary/mint/program, invalid layouts, missing token accounts and generation-specific enablement.

Done when: the advertised SVM surface is representable and tested. Do not silently call this deferred if the agreed release promises it.

## Step 13 Integrate responses, tracking and reads

Implementation:

1. Preserve logical AGW from and signer origin on sends and waited receipts. Keep raw transaction metadata/hashes available. Management writes retain the owner from specified by the API.
2. Extend wallet/UEA calldata reconstruction for trackTransaction; a correct live response alone does not prove replay correctness.
3. Reuse hash/event-based UTX tracking. Preserve Push failure versus destination failure and do not mark success merely because a destination hash exists.
4. Add AGENTIC progress events from the refreshed spec; no removed AGENTIC-TX-103. Emit core Push events plus the specified outbound wait events, without signer Route-2 setup events.
5. Carry init/per-call hooks through send and wait once per event. Decode AGW, factory, policy and engine errors while retaining structured core metadata.
6. Audit universal.read/executeReads: these submit transactions through the execution layer. Use explicit request-budget/refund/funding context, and preserve read-only restrictions. Management RPC reads remain non-signing.
7. Ensure prohibited prepareTransaction/executeTransactions routes cannot bypass AGW restrictions; keep supported pure preparation of read specs distinct from transaction execution.

Verification: EOA/UEA owner and agent responses, replayed tracking, failed Push without outbound polling, destination failure/timeout, hook deduplication, read request/refund context and compatibility with ordinary routes.

Done when: every execution path reports the right account, lifecycle state and error, including asynchronous completion.

## Step 14 Onboard a matched deployment and run acceptance

Implementation:

1. Obtain A07 manifest and final artifact revisions. Verify factory/implementation/wiring, proxy details, policy/engine compatibility, capabilities and start blocks.
2. Replace provisional adapters and close A05/A07 only against verified artifacts. Detect any new spec/source changes before proceeding.
3. With separately authorized funding and broadcasts, exercise native/external owners and agents. Start universal acceptance with bounded allowance, positive token amount, empty recipient, AGW refund recipient and permitted multicall.
4. Confirm actual gateway token pull/burn, fee accounting, node/TSS acceptance, correct destination CEA, receipt hashes and tracking.
5. Exercise cap/expiry/beneficiary failures, revocation, atomic replacement, allowance exhaustion and destination failure. Document currently inert creditRevert behavior rather than assuming a refund restores spend.
6. Verify supported SVM paths and ordinary SDK routes. Record network, block, deployment and transaction IDs for reproducibility.

Done when: supported capabilities have real acceptance evidence, unresolved failures are explained, and the release does not rely solely on mocked success.

## Step 15 Complete Web2 compatibility

Implementation:

1. Add enumerable READ.CHAIN containing real chains plus WEB2='web2'. Keep the specified deprecated CHAIN.WEB2 alias and compatibility for the existing READ.WEB2 surface.
2. Accept both new and legacy literal inputs, normalize to internal web2/https, and preserve wire identity web2:https.
3. Update ReadChain types, query discrimination, public parsers, prepared specs and response/tracker normalization consistently.
4. Ensure transaction destinations never accept the Web2 read-only marker.

Verification: both literal spellings, enum iteration, compile-time read/transaction distinctions, serialized wire vectors and tracked legacy results.

Done when: new public syntax works without breaking the existing read wire protocol.

## Step 16 Deferred marketplace integration

Harsh H5 removes compileCard from standalone AGW. Do not expose a public stub or block AGW release on card schema decisions. Canonical schema/encoding and SDK/hook vectors remain future marketplace work, with a separate scope and acceptance plan.

## Step 17 Finish examples, obligations and release

Implementation:

1. Publish examples for create with no funding, separate funding/allowance, native agent sends, EVM destination sends, lifecycle updates and recovery from partial creation.
2. Show signer gas, wallet PC, destination idle balances, expiry and unlimited caps distinctly. Explain cap reset, outstanding outbound execution after revoke, allowance checkpoint blind spots and generation migration.
3. Map all 23 [integrator obligations](contract-integrator-obligations.md) to implementation, documentation or UI responsibilities. EVM/native items 1–18 primarily map to steps 5–11 and 17; SVM items 19–23 map to step 12 and destination acceptance.
4. Document unsupported capabilities and approved scope decisions. Remove or close all A01–A08 placeholders for advertised features, including public helper and history types.
5. Run relevant package type/build/lint and regression checks. Prepare changeset/version notes for public additions and Web2 alias migration, using repository release conventions.
6. Review public examples against actual exported methods and the selected deployment. Update tutorial/design/gap records to describe delivered behavior.

Done when: the package can be used from its published exports as documented, supported routes have acceptance evidence and remaining scope limits are explicit.

## Public surface coverage

| Public surface | Implementation steps |
| --- | --- |
| agentic.derive, agentic.list | 4–5 |
| agentic.create | 6–7 |
| agentic.wallet, info, owner, checkpoints | 2, 5 |
| setLabel | 4–5, 14; matching capability required |
| rules.list/get | 5–6; A05/A06 |
| rules.add/revoke | 6–7 |
| rules.update | 8 |
| initialize/reinitialize with agenticWallet | 3–4 |
| owner/agent sendTransaction | 9–12 |
| response.wait, trackTransaction, errors/hooks | 13 |
| Public utils.agentic actionId/configId/decodeRules; internal generation IDs/derivation/encoding | 4, 6 |
| Internal encoding and public native decoding | 6, 12 |
| compileCard | Outside standalone AGW; future marketplace |
| AGENTIC constants and READ.CHAIN | 2, 4, 15 |
| forbidden methods, gas behavior and transaction-creating reads | 3, 10–13 |

## Suggested implementation increments

Each increment can be a focused PR; incomplete runtime features stay capability-gated and are not advertised as released support.

1. **Foundation:** steps 1–3, adapter interfaces and SDK lifecycle tests. Start here.
2. **Independent compatibility:** step 15 plus public error export cleanup where appropriate.
3. **Read and identity adapters:** steps 4–5 and settled ID/ABI utilities from 6.
4. **Management:** final rule codecs, create/add/revoke, atomic replacement and recovery (6–8), when their required answers arrive.
5. **Execution:** owner/native agent paths, then EVM universal composition and gas (9–11).
6. **Responses and SVM:** step 13 integrated as execution lands; step 12 when its schema/capabilities are confirmed.
7. **Matched-deployment acceptance:** step 14 and fixes driven by observed integration results.
8. **Card compiler and release:** step 16 when its downstream schema exists; step 17 for the explicitly approved release surface.

Track each increment as not started, in progress, implemented, verified or externally blocked. “Implemented” excludes placeholders; “verified” includes the listed checks. The earlier 50–60% estimate is provisional and should be replaced with task-level effort estimates after the first implementation breakdown.

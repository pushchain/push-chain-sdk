# Marketplace and job SDK implementation plan

Planning only, October 20, 2026. Start from existing `feat/agw-sdk-v4` without disturbing its uncommitted AGW error improvements. Keep marketplace delivery separate from AGW release history. This is a proposed implementation sequence; product decisions still open are listed in [questions](questions.md).

## First delivery boundary

Target verified Donut marketplace v2 and its own pUSDC kernel, AGW v6 and interim rules hook. Support the four configured EVM testnets. Deliver card discovery/provider management, permission/spec authoring, preview/open, explicit deposits, and the kernel lifecycle with manual evaluator status. Do not advertise mutable criteria, automated verification, K-12, recurring jobs, verified ratings, mainnet or non-EVM cards.

No `client.evaluation`, `compileCard`, `market.compile`, `start`, `publish`, hash card IDs, public address dump under `CONSTANTS.MARKET`, admin SDK or generic prepare namespace. These were superseded. Public vocabulary goes under `AGENTIC`; helpers go under `PushChain.utils.job` / `PushChain.utils.market`, not under CONSTANTS.

## Public surface to implement

| Surface | Target behavior |
| --- | --- |
| `client.market.cards/card` | Count/ID walk or per-provider lookup; full decoded card/version/tags/rating; bounded concurrent reads |
| `client.market.preview` | Exact card-version snapshot, independent CEA match, session + intent + kernel calldata + JobSpec + readable permissions/criteria; no signing/broadcast |
| `client.market.openJob` | Revalidate same plan, authorize exact OwnerIntent, client-submit by dated decision, validate JobOpened and actual wallet/job/rules association, return `{jobId,wallet,rulesId,tx}` |
| `client.market.deposit` | Separate recorded steps with receipts/recovery; exact opened-card snapshot; fee/PC/principal funding only after revised approval design is agreed |
| `client.market.job/activeJob` | Marketplace mappings and occupancy, distinct from kernel/evaluator facts |
| `client.market.agent.register/update/setActive/card` | One provider card, on-chain integer IDs, new version clears verification, immutable provider/chain |
| `client.job.create/setBudget/fund/submit/claimRefund` | Current kernel ABI, correct client/provider identity, exact reviewed expectedBudget, rulesId optParams only with compatible hook |
| `client.job.status/list/watch` | Kernel + hook reads, stable event-derived deliverable where absent in storage, unavailable evaluator facts represented honestly; stop callback and cursor/deduplication |
| `client.job.cancel` | Proposed addition to resolve the decided client-cancel capability; owner atomic reject+revoke for marketplace AGWs if approved; plain clients reject Open jobs directly |
| `client.job.verify` | Deferred/gated until a compatible contract exposes an agreed retry entry point; fail before signing on current EOA deployment |
| `utils.job` | buildJobSpec, buildJobSpecTemplate, encode/decode/describe/previewJobSpec; pure except explicit paid preview |
| `utils.market` | validate/encode/decodeAgentCardRules using deployed 4-field shape, v6 pins and published markers |
| `AGENTIC` | Preserve WALLET/PRESETS; add PRINCIPAL and JOB EVALUATION/OPERATION/LOGIC/ALLOWED_MUTABILITY vocabulary. Per-chain JOB.ADDRESS is the page 7 exception to internal deployment constants; confirm EOA evaluator representation. No public encoder-context or limit dumps. |

Every write follows existing UniversalTxResponse and progress-hook conventions. Reads and previews are available in read-only mode where no paid reads are requested. MarketError / JobError / JobSpecError need additive typed codes and decoded causes; do not force new codes into the current closed AgenticErrorCode union with casts.

## Module shape and reuse

Proposed new directories: `packages/core/src/lib/market`, `job`, and `job-spec`. Keep wire encoders, on-chain reads, transaction composition and public authoring normalization separate. Add namespace integration in `push-chain/push-chain.ts`, helper exposure in `utils.ts`, and exports in the package entry points. Do not duplicate the whole orchestrator or AGW backend.

| Existing source | Reuse / qualification |
| --- | --- |
| `agentic/contracts/{donut-v6,v6}.ts`, `deployments.ts`, ABI snapshots | Same AGW generation and verified reader; add an internal marketplace deployment profile with kernel/hook/token/evaluator capabilities and source pins |
| `agentic/codec/{session,universal,abi-layout,pins,ids}.ts` | SessionWire, canonical envelope, static tuple/fixed-array paths, v6 EQ/MAX pins and hashes. Card markers need a separate unresolved representation; publicRule normalization resolves wallet values too early for stored templates. |
| `agentic/runtime.ts`, `context.ts`, `reads/*`, `management/common.ts` | Signer Push identity versus execution wallet, snapshot reads, transaction/error/progress conventions. Add typed signing narrowly; external ERC-1271/home-chain semantics need independent acceptance. |
| `agentic/response.ts`, core transaction response/tracker | Preserve signer origin, actual sender, hashes, wait/replay and decoded errors. Do not claim relayer is owner or AGW is provider. |
| `universal/signer/*`, `universal.signTypedData` | Existing EIP-712 facility; capability-check signer before prompting. Factory domain includes signer home chain, factory address and Push-chain salt. Do not rebuild a generic EIP-712 domain from guesses. |
| `orchestrator/cea-utils.ts`, PRC20 metadata/source helpers, registry | Independent CEA derivation and exact source-token identity. PRC20 on Push and destination token address are distinct. Missing route stays explicit. |
| `read-state/read-params.ts`, query encoders/result shapes, `prepareRead` | Reuse logical parsing/ABI data; existing async prepared request is not the pure JobSpec read shape. Add the agreed adapter without replacing read/prepareRead or hiding fee/height preflight inside pure builders. |
| Existing AGW E2E runner/local harness conventions | New opt-in marketplace group, actual receipt/event evidence, separate unfunded/fork/funded reports; default runner selection remains intentional |

## Phase 1 — freeze profiles, types and ABI bindings

Import verified ABIs including all 40 errors from the error library (marketplace ABI alone omits helper errors). Register only the supplied deployment; fail unsupported networks before signatures. Pin exact JobSpec/Template tuple definitions and enum ordinals for deployed v2. Keep the linked evaluator schema as a distinct comparison profile, not an automatic decoder fallback. Canonical public types retain bigint IDs/hashes and lossless selector/word positions; optional metadata supplies names without inventing them.

Acceptance: imports/declarations, selector/event/error vectors, deployment wiring/capability checks, no legacy names accidentally exported, unsupported signer/network failures before signature.

## Phase 2 — card rules and JobSpec authoring

Implement deployed AgentCardRules including principal marker caps, fixed/nonprincipal caps, WALLET/PRINCIPAL pins, approved spender literals and amount maximums. Preserve ordered assets/calls/pins exactly. Validate duplicate/overlapping alternatives and contract ceilings. Keep intended on-chain behavior and SDK validation differences explicit.

Implement output-layout type codes from ABI (including nested tuples/arrays), field paths, signed targets, tree validation/flattening with higher child indices, template fills and bounded params. ABI encode/decode must be canonical. Decode known card templates/jobs contextually; the convenience decoder must validate shape and canonical re-encoding and reject ambiguous/unsupported inputs. ABI bytes are not a self-describing version tag.

Add the pure logical-read preparation form agreed for W08. Preserve placeholder location/ABI metadata so an address sentinel can become a zero word plus a fill record; never pass the sentinel directly to viem's address encoder or infer holes from all zero-valued arguments. Pure encoding accepts verified deterministic token data; network-dependent resolution stays explicit.

Describe exact permissions, alternatives, amount units, gas, expiry and every criteria check. Do not turn a preview with missing baseline into a successful NUMBER/PERCENTAGE result. Preview using universal reads incurs explicit fees; reuse the supported request client path. Defer optional free-RPC fallback until semantics are agreed. Keep EVM-only evaluation read claims for this wire.

Acceptance: Solidity↔TypeScript vectors from the pinned builder/decoder, encode→decode→encode equality, template fill/PRINCIPAL_BPS rounding, deeply nested logic/ABI returns, bounds/overflow/negative targets, no unresolved placeholders in complete specs, named errors, descriptive output faithful to OR/AT_LEAST behavior. Cross-profile payloads must fail closed.

## Phase 3 — card reads/provider writes

Implement all discovery and provider methods, using agentCardOf for provider lookup and count/getAgentCard for enumeration. Keep consistent block reads, bounded concurrency and cancellation for large walks. Preserve disabled/inactive distinctions, version and verification resets. Registration/update validate locally and simulate actual contract behavior before sending. Reject unsupported payment tokens explicitly.

Metadata is untrusted optional display content: hash-check fetched bytes, retain raw jobType/selector, and do not change permissions from metadata. No indexer or hosting service is implied by publishing a metadata URI.

Acceptance: real local contracts for registration, duplicate provider, update immutability, stale versions, inactive/disabled and verified tags, correct event-derived IDs, read-only client behavior and unknown ID/provider results.

## Phase 4 — preview, intent, signing and opening

Take one card/config snapshot. Derive the connected **owner's** wallet index even when another execution context is present. Obtain destination CEA independently and compare computeCEA. Resolve markers into a v6 session, preserving all constraints and matching actual helper checks. Read nonces/lane/deadline, obtain previewIntent and buildCreateJobCalldata, and independently verify sessionHash/execCalldataHash/origin. Check all openJob eligibility conditions, not just previewIntent success.

Before signing, re-read current version, configuration, ownership, wallet slot/occupancy and nonces. If any signed content changes, return STALE_PLAN for user review; never silently produce a new plan. Label is outside the signed intent and must be described as cosmetic. Validate signer typed-data support/home-chain identity, EOA and ERC-1271 flows. Use the dated client-submission default; relay remains a future transport until an actual service is supplied.

After receipt, verify emitted wallet, card version, principal, rules ID, job ID and actual kernel/AGW association. Preserve submitted hash if receipt lookup fails. No duplicate opening on retry; recover by receipt/events. OwnerIntent authorization is one signature, while submitting a transaction can require another signing interaction; document the verified UX.

Acceptance: fresh/existing wallet, index race, parallel plans, stale card/config/nonces, signature replay, tampered calldata/spec/session/CEA, native owner and external EVM UEA, unsupported signer, user rejection, receipt failure/recovery. Fork tests must use real AGW signatures, not only MockAGW.

## Phase 5 — kernel lifecycle and historical deposits

Create plain jobs through the connected ordinary account or AGW owner door. Provider calls go through provider identity. Fund composes token allowance plus exact-budget funding atomically for AGW, with no sequential fallback disguised as atomic success. The interim hook expects exactly rulesId; no speculative specHash payload. Keep allowance/funding distinction from the wallet's automatic **gateway** approval.

Market deposits must use the **opened version** and original principal, recovered from the validated plan or verified historical source/events/transaction input. Do not use today's mutated card. Separate principal, fee and PC assets, combine repeated token requirements correctly, quote gas and routes explicitly, and report partial progress/hashes so resuming does not pay every step again. Revise obsolete approval fields before implementing them. “Any account can transfer funds” does not grant it owner authority for wallet operations.

Implement status/list/watch with kernel state, hook binding and explicitly unavailable evaluator state on today's deployment. Recover deliverable from JobSubmitted where kernel storage lacks it. Deduplicate logs, cleanly unsubscribe, resume from a cursor, and re-read status after gaps. Refund goes to recorded client even if a third party triggers claimRefund. Never pausable by an SDK convenience guard when the kernel allows it.

If approved, client cancel on an AGW uses one owner batch: reject Open job + revoke that job's rulesId. Fork evidence shows existing v6 permits this. Check current permission/status and protect against races; handle already-revoked permissions without revoking unrelated grants. Provider/evaluator rejection cannot claim owner cleanup it lacks authority to perform. Existing grants after earlier jobs can cause AMBIGUOUS_RULE; reopening must not silently pick or widen one.

Acceptance: fixed reviewed budget versus re-quote, same/different fee/principal token, zero budgets (kernel allows free jobs), insufficiency/allowance, hook payload shape, plain/AGW identity, cancel cleanup/rollback, card update between open/deposit, interrupted deposit resumption, refund while paused, grace boundaries, terminal events/replay, existing overlapping grants.

## Phase 6 — evaluation delivery after alignment

Require a compatible deployed hook/evaluator and a single canonical wire before adding baselines, prefund, automatic submit→verify and retry. Bind job context to kernel/chain/evaluator configuration. Shared Solidity/SDK vectors must cover enum values as well as field order. If mutability is approved, fund must atomically commit expectedSpecHash/revision and budget. Current 32-byte interim payload cannot provide that.

Tests include attested reads, exact baseline/end heights, UNKNOWN/INCONCLUSIVE, percentage zero denominator, owner checkpoints, duplicate/late callbacks, retries, fee shortfalls and settlement/refunds. Do not infer automatic behavior from a zero-code EOA evaluator or an unrelated demo stack.

## Delivery and validation order

Suggested PR sequence: (1) profile/types/codecs + authoring helpers, (2) card/provider namespace, (3) preview/open + signing/receipts, (4) job lifecycle and agreed deposit/cancel behavior, (5) documentation/examples/package validation, (6) automatic evaluation only after compatible contract delivery. Independent layers may progress while the specific product questions are resolved.

Run focused meaningful unit vectors and pinned real-contract tests per phase; then build/typechecks, consumer examples and CJS/ESM declaration/API checks. Add funded Donut execution only for the completed public path, as a separate opt-in acceptance stage. The research tests in this folder establish current contract behavior; they are not passing tests for SDK features that have not been written.

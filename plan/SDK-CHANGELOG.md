# Agentic SDK development history

Running history for work continued on `feat/agw-sdk-v4`, covering AGW, marketplace and job SDK delivery. This is a development record; package releases remain tracked in `packages/core/CHANGELOG.md`.

For each meaningful checkpoint, add a dated entry with the change, decisions, validation, remaining work and relevant commit/evidence links. Keep earlier entries as history and mark superseded decisions explicitly. Distinguish implemented code, planning, local/fork checks, funded execution, Git delivery and package publication. Git history for this file records the exact commit introducing each checkpoint.

## 2026-10-26 — commit v4 and implementation-only v5

Committed the evaluator/marketplace work and AGW cleanup as `ad75da0e` on `feat/agw-sdk-v4` and cherry-picked the same implementation as `1076106b` on `feat/agw-sdk-v5`. Planning/research stays on v4. V5's existing `6.0.27-alpha.7` package metadata, release changelog, lockfile and inherited plan tree are unchanged; only the new implementation/test/consumer-doc paths were applied.

Made the PRE/POST unit fixture self-contained under `packages/core/src/lib/job-spec/__fixtures__`, so the tests do not require excluded plan evidence. Its 20 focused tests pass. V5 independently passes 2,306 units (12 existing skips), nine local evaluator SDK scenarios, build/API/package and both guide checks. [Branch delivery evidence](marketplace/research/git-delivery-2026-10-26/README.md). Package publication remains separate.

## 2026-10-26 — demo review, resolved CEA rollout and submit safeguards

Reviewed the user's downloaded `marketplace_demo` snapshot, matching seven entrypoints to `0d765e0`. Its config uses a different demo deployment from the pasted conversation; both stacks still store timing-first criteria and the app opens directly through the kernel (`marketplace: null`). Neither establishes compatibility with the latest timing-free profile. Confirmed the single-rule fund binding and kept multi-chain card/fee/timing choices open.

**Implemented locally:** optional `job.submit({ executionBlocks })` validates the frozen POST chains, tracked work blocks and observation freshness before signing. Inputs are copied before reads; early or stale tracking produces explicit retryable errors without submission. Added a real-contract cross-chain sum/measurement-height scenario. Corrected the obsolete live-readiness claim that deposit orchestration is a placeholder.

**Verified:** all four marketplace CEA factories, proxy implementations, vault/gateway factory getters and sample derived addresses match at Donut block 24663931. Removed the resolved CEA question; SDK address constants and mismatch guards remain. Current questions cover approved format/stack, card/open timing fields and multi-chain card scope/format. 2,306 unit tests and nine local evaluator SDK scenarios pass; build/types, lint, package/API/guide checks and scenario selection verification pass. [Evidence and limits](marketplace/research/demo-alignment-2026-10-26/README.md). No public-chain write, contract upgrade/deployment, commit, push or publication.

## 2026-10-26 — remove obsolete AGW compatibility plumbing

The AGW runtime was already v6-only. Removed its all-enabled capability enum/set/check plumbing and manifest capability overrides, plus the unused non-index-bound deployment encoder. Factory/source/account/wiring checks, ownership, policy validation and spend assertions remain. Replaced the obsolete public name `ReadyPresetOptions` with `PresetOptionsWithAgent`, without an alias. Renamed v5-labelled current-contract test files, E2E case IDs/evidence labels and docs to the actual v6 target; runner mappings were updated. Current Solana token-program handling and v6 wire encoders are retained.

**Validation:** 2,302 unit tests (12 existing skips), 108 local AGW contract tests and eight local evaluator SDK cases pass. Build/types, source/built API comparison, CJS/ESM/declaration/npm-content checks, both consumer guides and all 76 E2E scenario mappings pass. Production lint has zero errors/warnings; three pre-existing warnings remain in tests whose labels were corrected. [Cleanup evidence](agw/research/v6-cleanup-2026-10-26/README.md). No live transactions, commit or push; this cleanup and the preceding evaluator work remain local.

## 2026-10-26 — local PRE/POST SDK implementation

**Implemented locally:** explicit `utils.job.prePost` codecs/templates, phase-aware authoring/resolution/descriptions and paid previews, exact summed/percentage checks, explicit baseline pins and no-new-payment recovery. Added `job.withEvaluator` with deployment/code/wiring checks, criteria-hash acceptance and capped PC prepayment batched atomically with escrow, public retry/settlement/prepaid-refund actions, and evaluator status/watch. Existing v2 encoders/default addresses remain in use. Mutable proposals remain deferred.

**Validation:** 2,302 unit tests pass (12 existing skips), plus eight SDK scenarios against actual local v6 AGW, kernel, hook, evaluator and Read State. Solidity template bytes, payout/refund, retries/expiry, settlement fallback and a legacy manual job pass. Build/types, nine guide blocks, production lint, source/built API equality and CJS/ESM/declaration/npm-content checks pass. The API checker now canonicalizes overloaded function references. The older deployed-stack fork rerun is RPC-limited: the default endpoint pruned its pinned block; the archive endpoint returned 429s. Its 11 reported failures are retained and are not counted as acceptance. [Evidence and limits](marketplace/research/sdk-evaluator-local-2026-10-26/README.md).

**Boundary:** the evaluator branch's marketplace uses an older card/rules interface. Wiring the new template into current v2 register/open/deposit needs the compatible contracts integration commit/rollout; no older marketplace interface was silently substituted. Team questions remain crisp. No public-chain transaction, deployment, package publication, commit or push for this checkpoint; changes remain local as requested.

## 2026-10-26 — corrected current evaluator branch

Nilesh's correction names `feat/universal-evaluator-pre-post-reads`, fetched at `8666c2a` and matched to open contracts PR #132. This supersedes the older branch as the next SDK target. The source now removes JobSpec timing fields and exposes `retryEvaluation` to client or provider. Recorded the full migration scope; source selection no longer blocks local SDK work. Narrowed the second team question to compatible Donut rollout details.

**Validation:** 170 local contract tests pass across 11 suites, including PRE/POST criteria, builder conformance, hook binding, deployment, gas and settlement fallback; fuzz tests run 64 iterations. ABI examples confirm the new schema differs from both deployed v2 and the earlier `8059817` snapshot. [Evidence and migration tasks](marketplace/research/evaluator-pre-post-2026-10-26/README.md). Documentation/evidence only; the SDK runtime migration is pending. No funded E2Es or deployments.

## 2026-10-26 — explicit universal-evaluator branch check

Fetched `feat/universal-evaluator@46e7902` and compared its JobSpec, hook and evaluator with the deployed marketplace and the previously reviewed Notion-linked `8059817`. The branch defines funding spec-hash protection and concrete snapshot/verification/retry APIs, but its wire remains incompatible with the deployed marketplace. Narrowed the second [team question](marketplace/questions.md) to the target commit and compatible deployment/ABI delivery.

**Validation:** 69 focused local contract tests pass, with 64 runs per fuzz test. Controlled ABI vectors confirm the marketplace/branch mismatch. A fresh read-only Donut probe at block 24655950 confirms the marketplace still points to the EOA evaluator. [Evidence and API mapping](marketplace/research/evaluator-branch-2026-10-26/README.md). No SDK runtime changes, funded E2Es or deployments.

## 2026-10-24 — team answers: working presets, tokens-only rules, ALL

**Implemented:**
- Presets contain only the six testnet entries that work: Uniswap V3 and Aave V3 on Sepolia, Base Sepolia and Arbitrum Sepolia. They send native ETH, wrap it on arrival and return `{ rules }` without readiness.
- Tokens-only EVM rules become transfers back to the owner, plus `transferTo`.
- `MOVEABLE.TOKEN.<CHAIN>.ALL` and `utils.agentic.assets.all`.
- The 8-function Push limit is reported first.
- `fromEnd` Solana pins are refused on write.
- Two encode-only URP errors are now decoded.

**Decisions:** recorded in `plan/agw/questions-{harsh,aman,zaryab}.md`. The `.old` Circle mapping stays for hand-written rules.

**Validation:**
- Units, 108 local v6 contract tests, build, docs/package checks, read-only on-chain compatibility (6/6) and Donut preparation (6/6) pass.
- Live: all six presets pass with first and subsequent sends, and `agw-tokens-only` passes 2/2.
- The DEX acceptance now picks the Uniswap fee tier with QuoterV2, because Arbitrum Sepolia's 0.05% pool returns nothing for small swaps.
- One Base outbound stayed node-`PENDING` after delivering; a re-run passed.

**Git delivery:** pending on `feat/agw-sdk-v4`.

## 2026-10-20 — concise contracts-team handoff

Reduced [pending questions](marketplace/questions.md) to the two current dependencies: canonical CEA deployments and the shared JobSpec/evaluator interface. Removed resolved and deferred discussions from the handoff; earlier context remains in Git history and the research docs. Documentation only; no SDK behavior changed.

## 2026-10-20 — SDK-only completion before contract/deployment handoff

**Implemented:** opening proof and mined-input recovery without re-signing; immutable reviewed inputs; event-hash/transaction-input recovery for same-block and archive-less card history; resumable paid previews with zero new payment, direct prepared-read sending and ABI-name/decimal descriptions; exact watcher cursors, deduplication, callback isolation and canonical-cursor reorg stop; provider write simulation. Native single/atomic sends now preserve broadcast hashes after receipt/index failures and cannot fall back after broadcast. Signature fixtures compile from repo-owned source; the CI reporter derives success from final counts instead of Jest's pre-final flag.

**Validation:** 2,246 units pass (12 existing skips), 11 real-stack fork cases, six live cases across serial basic/funding runs. Real principal and BSC-origin bridging, native/AGW atomic pUSDC escrow, provider submission and controlled manual-evaluator payouts pass. Cards 4/5 are inactive; market jobs 4/7/8/9 are Rejected with grants revoked, plain jobs 5/6 Completed, and deposited/reserve/payout tokens returned. Real local ERC-1271/7702 variants and same-block history pass. Build/types, production lint, package/API checks and eight guide blocks pass. [Evidence and limits](marketplace/research/sdk-independent-2026-10-20/README.md).

**Boundary:** [SDK-only checklist complete](marketplace/sdk-readiness.md). Current team dependencies are the three CEA rollout mismatches and a compatible automatic evaluator/shared schema/verify ABI. Older SDK placeholders and acceptance gaps above are superseded. Future product scope and package publication remain separate; no marketplace, hook, kernel or evaluator was deployed/upgraded. No team messages were sent.

## 2026-10-20 — deposits, paid preview and external EVM owners

**Implemented:** `market.deposit` recovers the opened card version and principal, combines shared-token requirements, tops up principal/fee/PC separately and retains receipts/pending hashes for recovery. Explicit registered-origin funding is available. Deployed v2 grants pinned approvals to the agent; deposit performs no retired owner-approval step. Paid `previewJobSpec` uses raw universal reads, total request-fee caps, ABI layout decoding, configured CEA resolution and unknown-aware logic/baselines. Opening checks the actual EIP-712 domain and simulates the complete signed request before broadcast; deployed external EVM UEAs are supported.

**Validation:** 2,228 units pass (12 existing skips), eight real-stack fork E2Es, and three live cases: native open/cancel, paid validator-consensus preview, external-owner UEA open/cancel. Nonzero principal/fee deposits, escrow and payout remain fork-only; origin-bridge deposits are unit-tested. Live card 3 is inactive and jobs 2/3 are Rejected with permissions revoked. Build/types, production lint, package/API checks and six guide blocks pass. [Evidence and limits](marketplace/research/sdk-completion-2026-10-20/README.md).

**Coverage:** 28 of the 29 named APIs on SDK pages 6/7 have implementations against deployed v2. This supersedes the first checkpoint's deposit, paid-preview and external-EVM placeholders. The remaining method placeholder is `job.verify`, awaiting a compatible evaluator/hook and shared wire. Three CEA destination rollouts, arbitrary ERC-1271 acceptance, full live principal/protocol execution and package publication remain separate work. Continue on `feat/agw-sdk-v4`; no marketplace/kernel/evaluator deployment or npm publication was performed.

## 2026-10-20 — first marketplace SDK implementation

**Implemented:** client.market discovery/provider management, exact preview and native plain-EOA open; client.job create/pricing/funding/submit/status/list/watch/cancel/refund; deployed v2 JobSpec/template/card-rule codecs, marker resolution and authoring helpers; additive universal.read.prepare; constants/types/errors and a [consumer guide](../packages/core/MARKETPLACE.md). Binary kernel description bytes survive encoding and reads. Default E2E selection stays unchanged.

**Validation:** 2,205 units pass (12 existing skips); six real-stack SDK fork E2Es pass, including nonzero pUSDC escrow/payout and paused refunds; two read-only live cases and one funded register/open/cancel/revoke/deactivate smoke pass. Build/typechecks, new-production lint, source/built API equality and compiled guide/package checks pass. [Details](marketplace/research/sdk-implementation-2026-10-20/README.md).

**New findings:** three destination CEA factory tables disagree, so preview fails closed there; BSC Testnet matches and passes live. The shared test master is delegated, so the passing live path uses a fresh native owner. Current open signing explicitly gates delegated/contract/external owners. An initial live attempt registered/deactivated card 1 without opening; the later fresh-owner run opened/cancelled job 1 and deactivated card 2.

**Placeholders:** historical deposit orchestration, paid read preview, compatible automatic evaluation/retry, mutable criteria, relayer, external/delegated signing, recurring jobs and ratings. No successful dummy responses or deployment substitutions were added. No package or contract was published/deployed. Continue on feat/agw-sdk-v4; [status and next requirements](marketplace/implementation-status.md).

## 2026-10-20 — marketplace research and implementation handoff

**Planning delivered:** [plan/marketplace](marketplace/README.md) contains fresh exports of Notion pages 2/6/3/7/4/8, separately reviewed discussions, immutable contract/ABI snapshots, live Donut observations, a gap register, M4/K-12 analysis, the implementation sequence and draft team questions. This checkpoint adds no marketplace SDK runtime and sends no public-chain transactions or team comments.

**Baseline:** deployed v2 from `sdk-iteration-v1@443b4e2dd9ca5dd9ffc8efebdfcecd619dd66c47`, AGW v6, pUSDC-only kernel and manual EOA evaluator. Work continues on `feat/agw-sdk-v4`. The latest AGW code checkpoint is `a542f303`.

**Findings:** linked evaluator `8059817` has an incompatible JobSpec wire and enum ordinals; page 6's owner-approval array predates deployed pinned agent approvals; mutable criteria are inert; cancel frees occupancy but leaves AGW authority live; providerFee is a reference price. Recommendations and outstanding choices remain explicit in [questions](marketplace/questions.md), not silently treated as approved product changes.

**Validation:** 248 ordinary contract tests, 2 separately run fork tests, 10 invariants at 64×64, and 4 independent review cases pass. All 5 executable runtime comparisons and all 4 CEA checks match. No funded live acceptance or automated evaluator execution is claimed. [Evidence and limits](marketplace/research/2026-10-20/validation.md).

**Evidence handling:** the 45 MB invariant JSON log is retained losslessly as gzip with original/compressed checksums. Source exports remain byte-for-byte snapshots. Follow the implementation plan for the next SDK checkpoint and append its decisions, tests and remaining work here.

## 2026-10-20 — AGW creation errors and UI messages

**Implemented:** readable `userMessage` on SDK/revert errors; typed token-route and request-cancellation failures; rule/asset/call field context; complete per-rule constraint counts; destination read failures retain their classification and original causes. Updated the consumer guide and regression/contract assertions.

**Validation:** the [creation-error review](agw/research/creation-error-review-2026-10-20/README.md) records 2,181 passing units, 12 skipped, 21 passing local v6 contract cases, build/type/package/API checks and changed-production lint. Before the Git checkpoint, all 72 tests across the three changed unit suites and the spec typecheck passed again; [exact checked-file hashes](agw/research/creation-error-review-2026-10-20/git-checkpoint-validation.json) are retained. No funded E2E or package publication was run for this change.

**Remaining:** the DEX UI overflow trigger needs the installed SDK version and exact create payload. Stock presets have 20 conditions; duplicating generated calls reproduces 40. Do not remove permission conditions to fit the limit.

**Git delivery:** `a542f303` (`fix(core): clarify agentic creation and rule errors`) on `feat/agw-sdk-v4`; a release-branch sync and npm publication are separate actions.

## 2026-10-18 — starting AGW baseline

AGW v6, bounded preset defaults, route-aware readiness and destination-funded preset grants were already implemented before this continued marketplace work. Lighter SDK-only PR checks were delivered in `6108348f`; the previous planning checkpoint is `4206fae6`.

Recorded evidence: 2,142 full units, 107 local contract tests and 9/9 read-only factory simulations. Earlier v6 funded evidence covers 69 distinct cases across multiple runs, not one clean full invocation. Publication remained manual at that checkpoint. See [AGW status](agw/implementation-status.md) and [release-readiness evidence](agw/research/preset-release-readiness-2026-10-18/README.md).

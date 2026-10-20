# Agentic SDK development history

Running history for work continued on `feat/agw-sdk-v4`, covering AGW, marketplace and job SDK delivery. This is a development record; package releases remain tracked in `packages/core/CHANGELOG.md`.

For each meaningful checkpoint, add a dated entry with the change, decisions, validation, remaining work and relevant commit/evidence links. Keep earlier entries as history and mark superseded decisions explicitly. Distinguish implemented code, planning, local/fork checks, funded execution, Git delivery and package publication. Git history for this file records the exact commit introducing each checkpoint.

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

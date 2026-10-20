# Agentic SDK development history

Running history for work continued on `feat/agw-sdk-v4`, covering AGW, marketplace and job SDK delivery. This is a development record; package releases remain tracked in `packages/core/CHANGELOG.md`.

For each meaningful checkpoint, add a dated entry with the change, decisions, validation, remaining work and relevant commit/evidence links. Keep earlier entries as history and mark superseded decisions explicitly. Distinguish implemented code, planning, local/fork checks, funded execution, Git delivery and package publication. Git history for this file records the exact commit introducing each checkpoint.

## 2026-10-20 — AGW creation errors and UI messages

**Implemented:** readable `userMessage` on SDK/revert errors; typed token-route and request-cancellation failures; rule/asset/call field context; complete per-rule constraint counts; destination read failures retain their classification and original causes. Updated the consumer guide and regression/contract assertions.

**Validation:** the [creation-error review](agw/research/creation-error-review-2026-10-20/README.md) records 2,181 passing units, 12 skipped, 21 passing local v6 contract cases, build/type/package/API checks and changed-production lint. Before the Git checkpoint, all 72 tests across the three changed unit suites and the spec typecheck passed again; [exact checked-file hashes](agw/research/creation-error-review-2026-10-20/git-checkpoint-validation.json) are retained. No funded E2E or package publication was run for this change.

**Remaining:** the DEX UI overflow trigger needs the installed SDK version and exact create payload. Stock presets have 20 conditions; duplicating generated calls reproduces 40. Do not remove permission conditions to fit the limit.

**Git delivery:** included in the AGW error-fix commit on `feat/agw-sdk-v4`; a release-branch sync and npm publication are separate actions.

## 2026-10-18 — starting AGW baseline

AGW v6, bounded preset defaults, route-aware readiness and destination-funded preset grants were already implemented before this continued marketplace work. Lighter SDK-only PR checks were delivered in `6108348f`; the previous planning checkpoint is `4206fae6`.

Recorded evidence: 2,142 full units, 107 local contract tests and 9/9 read-only factory simulations. Earlier v6 funded evidence covers 69 distinct cases across multiple runs, not one clean full invocation. Publication remained manual at that checkpoint. See [AGW status](agw/implementation-status.md) and [release-readiness evidence](agw/research/preset-release-readiness-2026-10-18/README.md).

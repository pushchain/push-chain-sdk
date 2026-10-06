# AGW SDK planning

This package contains the SDK implementation plan, source snapshots, open decisions and validation evidence. Current work is on feat/agw-sdk-v4. Runtime commits are a66ff7d (v4/SVM foundations) and b68bab7 (gas headroom); current validation is linked below. Native/EVM support now uses the checked Donut v4 deployment; old runtime adapters/ABIs/fixtures were removed. All 25 registered AGW scenarios have passing bounded live coverage, including native/UEA identities and Sepolia outbound success/failure.

Latest: [live acceptance and fixes](research/live-acceptance-2026-10-06/README.md), following the [v4 migration](research/v4-implementation-2026-10-06/README.md). The unrestricted full core unit run passes 1,975 tests; the actual-contract harness passes 75. Build and four typechecks pass. Native defaults/raw-offset API/multi-rule selection decisions, absent ref/labels, public SVM integration and release scope remain explicit.

The public target remains [Notion page 5](notion/5-sdk-agw.md), qualified by [Harsh's replies](product-decisions-2026-10-04.md) and [live comments](research/notion-comments-2026-10-05.md). The [v4 deployment/owner-guide review](research/deployment-review-2026-10-06/README.md) records the supplied deployed wire definitions. Historical adapter-absence statements in that review describe the pre-migration inspection, not current implementation.

Latest SVM work: [internal codec/account/payload foundation](research/svm-internals-2026-10-06/README.md) now passes 23 unit and 10 in-process actual-contract checks. Public mapping/dispatch remains gated. Network permissions are restored. All seven SVM Anvil tests now pass and the unfiltered core unit suite passes, including the four previously network-blocked titles. Public Solana execution remains untested.

Latest SDK-owned work: [delayed-index contract acceptance and checked consumer guide](research/sdk-independent-followup-2026-10-06/README.md). No public API decision was changed by this follow-up.

Latest: [all nine SDK-owned items completed](research/sdk-independent-completion-2026-10-06/README.md). Internal SVM integration, Solana confirmation, CI and package/API checks are complete; public SVM remains gated.

Latest validation: [selected differential/race/API/runtime hardening](research/sdk-hardening-2026-10-06/README.md). Both Node 20/24 pass; existing live E2E receipts are independently rechecked.

## Start here

| Document | Purpose |
| --- | --- |
| [Consumer AGW guide](../../packages/core/AGW.md) | Public SDK examples for creation, funding, rules, execution and recovery |
| [Current baseline](current-baseline.md) | Source revisions, capabilities and remaining differences |
| [SDK design review](sdk-design-review.md) | Proposed internal architecture and execution flows |
| [Gap register](gaps.md) | Current G01–G26 findings and closure criteria |
| [SDK owned review](sdk-owned-review.md) | Internal decisions, existing-code evidence and 183 passing unit tests |
| [Implementation plan](implementation-plan.md) | Complete 17-step roadmap, module layout, assumptions, API coverage and PR sequence |
| [Implementation agent prompt](implementation-agent-prompt.md) | Handoff instructions, unit/E2E requirements and existing runner conventions |
| [Implementation status](implementation-status.md) | Per-step matrix (unit / local real-contract / live) and A01–A08 status |
| [Implementation review handoff](implementation-review-handoff.md) | Revisions, changed modules, commands and counts, real-vs-mock evidence, review hotspots |
| [Interactive tutorial](agw-tutorial.html) | Account, rule, funding and execution diagrams; open in a browser |
| [Integrator obligations](contract-integrator-obligations.md) | Contract-delegated SDK/product requirements |
| [External blockers](external-blockers.md) | Remaining defaults/type clarification and contract/deployment dependencies |
| [Questions for Harsh](questions-harsh.md) | Product decisions and recommendations |
| [Questions for Zaryab](questions-zaryab.md) | Ref/label v1 scope and representative SVM integration fixtures |
| [Review summary](review-summary.md) | Consequential independent-review corrections |

## Sources and evidence

- [Notion links and refresh instructions](SOURCES.md); [source manifest](source-manifest.json).
- Latest copies of all 12 registered pages under notion/. September references are labeled historical in the index.
- [October 3 refresh report](research/notion-refresh-2026-10-03.md): pages 1 and 5 changed; ten are unchanged. Latest raw exports and changed-page diffs are retained.
- [e704d5b validation](research/validation-e704d5b/README.md): build and revised source pin pass; 563 passed, 0 failed, 6 skipped, plus seven passing review tests. Generated ABIs describe that tested revision, not the new multi-asset target.

Older planning revisions, duplicated exports, superseded validation runs and the full independent-review working package were archived locally outside this repository. The review summary preserves the key corrections. Historical paths in the retained prior manifest describe the earlier pull and may refer to pruned archives.

Before sharing questions, refresh remote refs and Notion again, record exact revisions and remove questions answered by newer evidence. No team messages or contract deployments have been sent by this work. Authorized, bounded testnet transactions are recorded in the live acceptance evidence.

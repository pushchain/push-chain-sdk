# AGW SDK planning

This package contains planning, source snapshots and review evidence for `feat/agw-sdk-v4`. Current runtime uses Donut v4 source `e8db748`; legacy runtime adapters have been removed.

**October 7:** product decisions are settled. Public named-IDL Solana lifecycle/sends/reads/replay are implemented, rule `ref` is removed, zero native PC defaults are confirmed, and native/EVM raw-offset authoring is approved. Seven additional E2Es passed on Donut/devnet, bringing the opt-in AGW group to 46 scenarios with selected-run live coverage. The final local/unit/build results are in [implementation status](implementation-status.md).

The remaining AGW contract delivery item is editable labels. The existing agent door already validates the supplied rule; the SDK retains its ambiguity guard when several candidates match. [Zaryab delivery items](questions-zaryab.md); [confirmed decisions](questions-harsh.md).

Consumer documentation lives in [packages/core/AGW.md](../../packages/core/AGW.md). Earlier dated reports below are historical evidence; their pending-capability statements describe those earlier revisions.

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
| [Questions for Zaryab](questions-zaryab.md) | Ref/label v1 scope and joint Solana review; fixture request closed |
| [Public API proposals](public-api-proposals.md) | Historical proposals with their final dispositions |
| [Review summary](review-summary.md) | Consequential independent-review corrections |

## Sources and evidence

- [Notion links and refresh instructions](SOURCES.md); [source manifest](source-manifest.json).
- Latest copies of all 12 registered pages under notion/. September references are labeled historical in the index.
- [October 3 refresh report](research/notion-refresh-2026-10-03.md): pages 1 and 5 changed; ten are unchanged. Latest raw exports and changed-page diffs are retained.
- [e704d5b validation](research/validation-e704d5b/README.md): build and revised source pin pass; 563 passed, 0 failed, 6 skipped, plus seven passing review tests. Generated ABIs describe that tested revision, not the new multi-asset target.

Older planning revisions, duplicated exports, superseded validation runs and the full independent-review working package were archived locally outside this repository. The review summary preserves the key corrections. Historical paths in the retained prior manifest describe the earlier pull and may refer to pruned archives.

Before sharing questions, refresh remote refs and Notion again, record exact revisions and remove questions answered by newer evidence. No team messages or contract deployments have been sent by this work. Authorized, bounded testnet transactions are recorded in the live acceptance evidence.

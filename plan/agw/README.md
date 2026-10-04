# AGW SDK planning

This package contains the current SDK plan, source snapshots, open decisions and contract validation evidence. Implementation of the unblocked steps is on branch `feat/agw-sdk-impl`; see [implementation status](implementation-status.md) and the [review handoff](implementation-review-handoff.md). No live AGW transaction has been sent; no compatible deployment has been verified or registered. Harsh has replied; remaining follow-ups are in the updated question docs.

The target API is [Notion page 5](notion/5-sdk-agw.md), exported October 3, 2026 at 13:23 IST. The tested contract baseline is pushAgenticWallet_v3@e704d5b: sender-authorized execution and checkpoints exist in source, while the new multi-asset format, grant reference, editable label and envelope version still require matching artifacts and deployment verification.

Latest direction: [Harsh product decisions, October 4](product-decisions-2026-10-04.md). Page 5 was downloaded again and its body is unchanged after link normalization. These newer product replies supersede the older provisional recommendations; the clear scope changes are now implemented. H3 defaults and raw-offset API clarification remain pending.

## Start here

| Document | Purpose |
| --- | --- |
| [Current baseline](current-baseline.md) | Source revisions, capabilities and remaining differences |
| [SDK design review](sdk-design-review.md) | Proposed internal architecture and execution flows |
| [Gap register](gaps.md) | Current G01–G24 findings and closure criteria |
| [SDK owned review](sdk-owned-review.md) | Internal decisions, existing-code evidence and 183 passing unit tests |
| [Implementation plan](implementation-plan.md) | Complete 17-step roadmap, module layout, assumptions, API coverage and PR sequence |
| [Implementation agent prompt](implementation-agent-prompt.md) | Handoff instructions, unit/E2E requirements and existing runner conventions |
| [Implementation status](implementation-status.md) | Per-step matrix (unit / local real-contract / live) and A01–A08 status |
| [Implementation review handoff](implementation-review-handoff.md) | Revisions, changed modules, commands and counts, real-vs-mock evidence, review hotspots |
| [Interactive tutorial](agw-tutorial.html) | Account, rule, funding and execution diagrams; open in a browser |
| [Integrator obligations](contract-integrator-obligations.md) | Contract-delegated SDK/product requirements |
| [External blockers](external-blockers.md) | Remaining defaults/type clarification and contract/deployment dependencies |
| [Questions for Harsh](questions-harsh.md) | Product decisions and recommendations |
| [Questions for Zaryab](questions-zaryab.md) | Contract surface, funding and deployment questions |
| [Review summary](review-summary.md) | Consequential independent-review corrections |

## Sources and evidence

- [Notion links and refresh instructions](SOURCES.md); [source manifest](source-manifest.json).
- Latest copies of all 12 registered pages under notion/. September references are labeled historical in the index.
- [October 3 refresh report](research/notion-refresh-2026-10-03.md): pages 1 and 5 changed; ten are unchanged. Latest raw exports and changed-page diffs are retained.
- [e704d5b validation](research/validation-e704d5b/README.md): build and revised source pin pass; 563 passed, 0 failed, 6 skipped, plus seven passing review tests. Generated ABIs describe that tested revision, not the new multi-asset target.

Older planning revisions, duplicated exports, superseded validation runs and the full independent-review working package were archived locally outside this repository. The review summary preserves the key corrections. Historical paths in the retained prior manifest describe the earlier pull and may refer to pruned archives.

Before sharing questions, refresh remote refs and Notion again, record exact revisions and remove questions answered by newer evidence. No messages, deployments or testnet transactions have been sent by this planning work.

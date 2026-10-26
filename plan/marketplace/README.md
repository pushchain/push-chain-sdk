# Agentic marketplace SDK planning

October 26 update: Nilesh confirmed `feat/universal-evaluator-pre-post-reads` as the current evaluator branch. [Checked target, SDK migration work and local contract validation](research/evaluator-pre-post-2026-10-26/README.md). This resolves the source-selection question; implementing the newer profile locally can proceed before its Donut deployment. The completion figures below describe the existing deployed v2 scope.

Updated October 20, 2026. **SDK-only work is complete for the current EVM v2 scope:** see [readiness and external boundaries](sdk-readiness.md) and [coverage/acceptance](implementation-status.md). 28 of the 29 named APIs are implemented; `job.verify` awaits compatible contracts. Real token deposits, origin bridging and native/AGW payouts pass live. The initial contract-only research below remains history. No package was published.

**Build against deployed UniversalMarketplace v2, pinned at `sdk-iteration-v1@443b4e2dd9ca5dd9ffc8efebdfcecd619dd66c47`.** The six supplied Notion pages were exported again through signed-in Chrome, and their visible discussion panels were reviewed. The older marketplace pages in `plan/agw/notion` remain historical.

## Start here

| Document | Purpose |
| --- | --- |
| [SDK development history](../SDK-CHANGELOG.md) | Running checkpoints, decisions, validation and Git delivery on feat/agw-sdk-v4 |
| [Implementation status](implementation-status.md) | Implemented SDK methods, explicit placeholders, current CEA mismatch and passing local/live coverage |
| [Verified baseline](current-baseline.md) | Deployment, capabilities, exact wire, and shipped versus future behavior |
| [Source inventory](SOURCES.md) | Fresh exports, immutable contract pins, comments and source priority |
| [Spec/contract gaps](analysis/spec-and-contract-gaps.md) | Concrete mismatches, ownership and effect on delivery |
| [Mutability and payment analysis](analysis/mutability-and-payment.md) | Answers to the supplied M4 / M6 / K-12 questions |
| [Implementation plan](implementation-plan.md) | SDK surfaces, module boundaries, sequence and acceptance requirements |
| [Questions to share](questions.md) | Questions for Zaryab, Harsh and the evaluator team; drafts only |
| [Validation](research/2026-10-20/validation.md) | Reproduced tests, read-only RPC checks, limits and commands |
| [Current Notion discussions](research/2026-10-20/notion-discussions.md) | Author/date/context, separate from exported page bodies |

## Main conclusions

- The deployed stack supports card management, one card per provider, one active marketplace job per wallet, v6 multi-asset sessions and pinned agent approvals. Opening deploys/reuses the wallet, grants rules and creates an **Open** job. It moves no funds.
- Payment is currently **pUSDC only**. The evaluator is an EOA; automated baseline, criteria replacement, verification and rating are not live capabilities.
- Page 8 retires `client.evaluation`. Plan `client.market`, `client.job`, `PushChain.utils.market`, `PushChain.utils.job`, and vocabulary under `PushChain.CONSTANTS.AGENTIC`.
- The evaluator source linked by Nilesh's October 16 comment is **wire-incompatible** with deployed marketplace v2, including different enum ordinals. Align contracts before automatic evaluation; never combine these encoders implicitly.
- The deployed card-rule struct has **no `approvals[]`**. Page 6 still describes the earlier owner-approval design. The SDK follows deployed v2: deposit moves principal/fee/PC, while the agent has pinned approval calls in its granted permissions.
- Kernel cancellation releases the marketplace slot but leaves AGW permissions enabled. Independent fork checks examine that behavior and an existing owner-batch cleanup path.

Current SDK validation is linked from [implementation status](implementation-status.md); the earlier contract-only results remain in [validation.md](research/2026-10-20/validation.md). Dated source snapshots are unchanged.

# Agentic marketplace SDK planning

Updated October 20, 2026. **Actual SDK implementation has started:** see [current implementation and acceptance](implementation-status.md). The initial contract-only research below is preserved as history; its planning-only statements predate the SDK and live smoke checkpoint. No package was published.

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
- The deployed card-rule struct has **no `approvals[]`**. Page 6 still describes the earlier owner-approval design. This needs an explicit SDK contract with product before those deposit fields are advertised.
- Kernel cancellation releases the marketplace slot but leaves AGW permissions enabled. Independent fork checks examine that behavior and an existing owner-batch cleanup path.

Validation totals and evidence limitations are maintained in [validation.md](research/2026-10-20/validation.md), rather than copied into dated source snapshots.

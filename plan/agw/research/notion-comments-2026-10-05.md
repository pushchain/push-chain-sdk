# Live Notion comment review — October 5, 2026

Checked through Shoaib’s connected Chrome browser on October 5, 2026, starting around 08:03 UTC (13:33 IST); a local clock check during the review recorded 08:09:35 UTC. This is a focused comment review, not a new twelve-page Markdown export or contract/deployment refresh. Native Notion exports exclude discussions. Saved canonical snapshots and the full-export manifest remain unchanged.

## Pages checked

| Page | Method and observation |
| --- | --- |
| [5. SDK: AGW](https://app.notion.com/p/pushprotocol/5-SDK-AGW-3e9188aea7f481cf8e8de324956549b9) | Opened **All discussions**, including threads displaying Reopen (resolved). One thread was marked New/Today. Read the attached create example, validation paragraph and rule type block. |
| [1. AGW Contract Changes](https://app.notion.com/p/pushprotocol/1-AGW-Contract-Changes-nomenclature-standard-change-set-3e9188aea7f4813aa31fc95ceb4e684d) | Opened All discussions. Visible comments dated September 29 and October 1; no newer substantive reply was visible. |
| [AGW overview](https://app.notion.com/p/pushprotocol/AGW-UniversalMarketplace-8183-UniversalEvaluator-3e9188aea7f481c8b38ccba332b0afa2) | Page displayed Edited Oct 1 and Add comment; no page-body discussion was visible. No claim about hidden/resolved overview discussions. |

The other nine registered pages were not checked in this pass. Relative comment ages below are UI observations, not independently verified creation timestamps. No comments were posted, resolved or edited.

## SDK comments and their meaning

### C1 — Multiple rules per chain (new)

**Author:** Harsh Rajat. **UI:** Today, New, initially 9m and later 13m/14m.

**Exact comment:** “multiple rules per chain is also acepted @Shoaib Mohammed”

**Context:** [create example block](https://app.notion.com/p/pushprotocol/5-SDK-AGW-3e9188aea7f481cf8e8de324956549b9#f9712c13f75c4398aef2dbf7628450b2). The example still contains `// one entry per chain per agent`, and its parameter notes still say `one per chain per agent`. The [validation paragraph](https://app.notion.com/p/pushprotocol/5-SDK-AGW-3e9188aea7f481cf8e8de324956549b9#af9c3fac35d94f2585cb27310271c1d8) still rejects two rules sharing agent and chain.

**Confirmed:** multiple rules on a chain are accepted product direction. **Unresolved:** whether this includes multiple rules for the *same agent*, and how an agent send chooses a rulesId when several candidates exist. Different agents sharing one chain were already allowed. The attached wording makes relaxing same-agent uniqueness plausible, but the comment alone does not specify selection behavior.

**SDK impact:** [codec/rules.ts](../../../packages/core/src/lib/agentic/codec/rules.ts) rejects duplicate agent/chain pairs in create/add/update, while [reads/rules.ts](../../../packages/core/src/lib/agentic/reads/rules.ts) rejects more than one matching enabled rule at send time. Existing tests assert that behavior. These are provisional pending [H6](../questions-harsh.md#h6), not settled product invariants. Do not remove the guard and silently pick the first grant or try several transactions.

### C2 — Tokens independent from the rule (needs interpretation)

**Author:** Harsh Rajat. **UI:** Last Saturday, 1d. Both comments are attached to the validation paragraph linked above.

**Exact comments:** “iterative SDK only, step”; “we usually want the tokens to be independent and not attached to this”.

**Unresolved:** “this” and the intended token model are not defined. It may concern token resolution/validation, the attachment of assets to a rule, or staged SDK delivery. The current UniversalRule still contains assets[]. Treat this as a clarification within H3/Z1.1, not authorization to remove asset policy enforcement or invent a new schema.

### C3 — Earlier resolved universal-limit discussion

The thread displays **Original content deleted** and **Reopen**. Harsh’s visible messages, October 1–2, discuss whether constraints belong per allowed call, defining token/native treatment, removing redundant maxPCPerCall and keeping maxGasPerCall/AllowedAmount. No visible Zaryab answer accompanies them.

These provide background for the existing multi-asset/gas-cap proposal. Their deleted source context and abbreviated wording do not settle the current native omission/default table or the precise final universal ABI. Keep H3 and Z1 open.

### C4 — Update counters

An October 1 comment tagging Zaryab is attached to `rules.update resets spend counters because it is revoke plus grant`. No substantive reply was visible. It does not change the implemented atomic replacement or remove internal stale-spend assertions.

## Contract-page comments

All visible comments were from Harsh:

- October 1: “Need explaination here @Zaryab Afser”, with Original content deleted.
- October 1 and September 29: tag-only comments with deleted original content.
- October 1 (edited): the existing page-level request to review editable owner-only setLabel, its LabelSet event, cosmetic/non-checkpoint status, D3 and the D4 rename boundary.

No new contract artifact, limit/default decision, deployment confirmation or raw-offset answer was provided by these visible threads. Deleted original context cannot be reconstructed from this UI.

## Actions from this review

- Added H6 for same-agent multiplicity and send selection; tracked as G26.
- Added the token-independence clarification to H3 and referenced it in Z1.1.
- Updated the source index, gap register, external dependencies and implementation-plan warning.
- H3 defaults and H4.5 raw offsets remain unresolved. The live rule type block still declares optional maxValueTotal and arg-based pins/amount.
- No production SDK code, contract source, snapshot body, deployment registry or team message was changed.

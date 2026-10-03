# External decisions before AGW implementation and release

October 3, 2026. The 24 gap-register entries cover implementation work, historical findings and downstream dependencies. For the standalone target SDK, this review isolates **seven decision/dependency areas**, presented as **four Harsh question groups and two active Zaryab requests**. A separate shared-compiler request, Harsh H5/Zaryab Z5, covers assumption A08. This is a release-planning count, not a count of confirmed contract defects.

## What needs an external answer

| ID | Owner and draft | Required answer or artifact | What it blocks |
| --- | --- | --- | --- |
| E01 | Harsh H1 | Approval-safety policy and corrected universal example; owner-controlled approval can use the existing owner client | Public rule validation and safe examples |
| E02 | Harsh H2 | Reject native agent arrays in v1, or require a batching contract change | Full transaction-array promise; single native calls and supported EVM destination multicalls can proceed |
| E03 | Harsh H3 | Accept or change the explicit omission/default table | Final authorization defaults and encoder expectations |
| E04 | Harsh H4.1 | Approve generation/validator context in pure helper signatures | Public helper types; internal derivation can proceed with explicit context |
| E05 | Harsh H4.2 and Zaryab Z1 | Per-token Spent shape, matching multi-asset terms/read/assertion ABI and vectors | Final universal codec, metering reads and safe replacement integration |
| E06 | Harsh H4.3 and conditionally Zaryab Z1 | Define revoked-rule history; provide reliable metadata if promised | Complete rules.list/get behavior, not basic agent execution |
| E07 | Zaryab Z1/Z3 | Target ref/envelope/metadata surface and verified compatible deployment manifest | Required target features and live release acceptance; proposed setLabel is separately capability-gated pending scope |

Highest-impact integration dependencies are the approval policy, multi-asset accounting/encoding and compatible target generation. Defaults and native-array scope also need answers before their public behavior is finalized. SDK structure and independent work can proceed before all seven are closed.

## Shared compiler dependency

A08 is outside the seven standalone areas: Harsh H5 must establish the canonical card/userInput schema and supported binding scope; Zaryab Z5 must supply matching encoding/verification artifacts and shared vectors. This blocks compileCard completion, not the standalone foundation. Product answers settle design; missing artifacts and deployments remain delivery dependencies until verified.

## Removed from external blockers

- **Gateway allowance mechanism:** resolved locally. Owner execute can approve and remove a bounded allowance. Four new local tests pass. Production integration remains to be tested; no new AGW method is required.
- **How to approve on the destination:** use the existing owner agentic client and sendTransaction. Harsh decides the agent permission policy, not a new helper architecture.
- **Whether NativeRule needs multiple actions:** follow the existing one-action public type. Only the incompatible array promise needs a scope decision.
- **Creation batching and recovery:** SDK capability selection, partial hashes and retry handling. No required factory createWallet method.
- **Owner replacement batching:** established contract path. Only the new multi-asset expected-spend assertion remains external.
- **Duplicate candidate selection:** fail before signing with DUPLICATE_RULE and a hint; never pick arbitrarily. Document this use of the existing error code.
- **Gateway six-versus-eight-field history:** encode the known selected generation. Any future migration belongs in deployment compatibility, not a speculative blocker.
- **Version string alone:** the SDK can use an explicit factory/implementation registry and verified wiring; unchanged accountId does not force a contract redesign.
- **Read-only lifecycle, Web2 normalization, receipts, errors and progress:** SDK-owned decisions in [SDK review](sdk-owned-review.md).
- **D3, checkpoints, binder and creditRevert:** implemented source, dropped proposal or known platform dependency, as recorded in the gap register.

## Work we can do before answers arrive

The design decisions, read reconstruction strategy, source mapping, test acceptance cases and creation/recovery strategy are recorded. Future implementation can start with namespace/context separation, read-only guards, Web2 compatibility, error exports and receipt/hook adapters. Keep final universal encoding, defaults and disputed public types behind the unresolved decisions. Production implementation has not begun in this planning package.

## Evidence and freshness

The 183 existing SDK unit tests passed, plus four new allowance experiments at pinned e704d5b. These support local mechanisms only; no live transaction was broadcast. [Review evidence](research/sdk-owned-review-2026-10-03/README.md) records commands, hashes, source pins and limits.

Remote AGW/core/gateway branch refs were rechecked and are unchanged. Notion remains the October 3 13:23 IST export; edits after that time are unknown. Refresh the Notion bodies before sending the [Harsh](questions-harsh.md) and [Zaryab](questions-zaryab.md) drafts.

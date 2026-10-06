# Remaining AGW product follow-ups for Harsh

Rechecked October 6, 2026 against all twelve saved Notion pages, your replies, live pages 1/5 and their All discussions, freshly fetched contract branches, the owner guide and SDK code. [Evidence and dispositions](research/question-source-recheck-2026-10-06/README.md). Accepted decisions remain in [product decisions](product-decisions-2026-10-04.md). No questions have been sent.

| Item | Answer needed |
| --- | --- |
| [H3](#h3) | Native PC omission defaults and the intended token model |
| [H4.4](#h4-4) | Public Solana rule representation, jointly with Zaryab |
| [H4.5](#h4-5) | Public raw-offset authoring versus separate decoded records |
| [H6](#h6) | Choosing a rule for a send when several match |

[Concrete API proposals](public-api-proposals.md) provide input/decoded-type and rule-selection examples for review. The internal [live Solana wire validation](research/live-svm-wire-2026-10-06/README.md) now proves positive delivery and replay; public SVM remains gated.

## Source check

The live [SDK page](https://app.notion.com/p/pushprotocol/5-SDK-AGW-3e9188aea7f481cf8e8de324956549b9) still has optional native maxValueTotal, argument-index inputs and the older unique-rule lookup wording. Its visible active/resolved discussions supply no further answer to the questions below. This was a live inspection, not a new Markdown export; the last full export remains October 3.

The freshly fetched [owner guide](https://github.com/pushchain/push-agentic-wallets/blob/10a24f101e2e6e0a9b76517b29f5cdb1aa967796/docs/5_SDK_Owner_Integration.md) is unchanged. It supplies universal total encoding, same-agent multiplicity and SVM wire definitions. Those delivery questions are closed. Your later scope replies continue to take precedence over older page-body helper/spend/compiler entries.

<a id="h3"></a>

## H3 Native PC defaults and token model

The delivered contracts distinguish hard zero from uint256 maximum, keep maxValueTotal, use maxCalls=0 for unlimited calls and destination maxValue=0 for non-payable calls. We will apply the guide's universal no-total-limit encoding and preserve explicit zeros.

**Decision needed:** should omitted native maxValuePerCall and maxValueTotal both encode uint256 maximum? Your earlier reply was tentative for the former and referred to a change to the latter. The current live NativeRule still includes maxValueTotal, so we retain that field unless you specify a replacement.

| Optional input | Proposed omission behavior | Current SDK |
| --- | --- | --- |
| Native maxValuePerCall | uint256 maximum | 0, provisional |
| Native maxValueTotal | uint256 maximum | 0, provisional |

Explicit zero stays zero. We are not asking again what the on-chain sentinels mean. The other implemented conventions are native amount.maxTotal=uint256 maximum, maxCalls=0 and destination allowedCalls[].maxValue=0; these are context, not additional wire-format questions.

Your [token-independence comment](https://app.notion.com/p/pushprotocol/5-SDK-AGW-3e9188aea7f481cf8e8de324956549b9#af9c3fac35d94f2585cb27310271c1d8) needs one scope clarification: the delivered guide keeps assets[] on the rule and allows each listed token with every allowed call. Is that the intended SDK model, or does your comment request a different public model?

<a id="h4-4"></a>

## H4.4 Public Solana rules — jointly with Zaryab

Your earlier reply assigned SVM work to Zaryab. The SVM contract rulebook and its wire types are now delivered; our internal reads, metadata/IDL resolution, lifecycle and outbound backend are implemented. We are not asking for contract structs again.

**Decision needed:** agree how those constraints appear in public Rule inputs and rules.get/list results. The current live AllowedCall is EVM-shaped: address target, function selector and beneficiary argument index. It does not represent Solana programs, instruction discriminators, account pins or instruction-data pins.

**SDK proposal for review:** add a Solana-specific Rule variant selected by its solana: chainNamespace, keep asset caps/expiry/gas fields, and compile IDL instruction/account/field inputs into program/account/data constraints. Gateway, wallet CEA and protected token-account derivation stay internal. Confirm that model, or approve explicit constraints as a public authoring alternative. The decoded result must preserve stored constraints without inventing an IDL. [Types and examples](public-api-proposals.md#h44-solana-rule-inputs-and-decoded-records).

This is a public SDK design agreement, not missing contract support. We have supplied our own verified gateway/program/account/payload fixture, successful live wire execution and later terminal-rejection replay, so no external fixture is needed to unblock this design review. Retry timing has an optional [operational follow-up](research/live-svm-wire-2026-10-06/platform-followup.md).

<a id="h4-5"></a>

## H4.5 Decoded rules and raw offsets

This question was added during implementation review and was not covered by your earlier replies. The historical SDK document already used raw offsets; current page 5 instead uses argument indexes. Stored native rules contain byte offsets without the ABI needed to recover indexes. Returning a guessed arg index was incorrect for arrays/tuples.

The current fix returns native pins as `{ offset, expected }` and amount limits with `{ offset, maxPerCall, maxTotal }`. V4 EVM allowed-call reads also return exact beneficiaryOffset because stored selectors do not include the ABI needed to recover beneficiary argument indexes. It also accepts these raw forms when granting/updating so decoded rules can round-trip without loss.

Please confirm whether this raw form should be public and accepted for new authoring, or whether decoded wire records should be separate from the ABI-based `{ arg, ... }` input. Accepting arbitrary raw offsets is a different public validation boundary from generating them from ABI information. We will keep internal accounting/codec needs separate from the reduced public spend/helper surface.

**References:** [follow-up review](implementation-review/followup-9e16b23/review.md), [current public types](../../packages/core/src/lib/agentic/agentic.types.ts), [integrator obligations](contract-integrator-obligations.md).

<a id="h6"></a>

## H6 Multiple rules and choosing a rule for a send

Your new [create-example comment](https://app.notion.com/p/pushprotocol/5-SDK-AGW-3e9188aea7f481cf8e8de324956549b9#f9712c13f75c4398aef2dbf7628450b2) says multiple rules per chain are accepted. We already support different agents sharing a chain. The page body still says one per agent and chain; the v4 SDK now permits multiple during create/add/update.

The new owner guide explicitly permits multiple rules for the **same agent and chain**, so the capacity question is answered. How should sendTransaction select rulesId: an explicit caller choice, or a defined automatic selection rule? Please include native arrays whose calls need different rules and cross-chain calls with overlapping permissions.

Lifecycle validation is already aligned with multiple rules. The SDK reports AMBIGUOUS_RULE with candidate IDs before signing; choosing the first rule would make grants, budgets and expiry determine execution accidentally. An explicit selector would add to the public API, so we will not introduce it without agreement.

## Supporting context

Native array implementation is validated locally and on Donut through sender-preserving UEA/7702 batching. Universal/SVM wire definitions and deployment are supplied; all 25 registered native/EVM live scenarios have passing coverage. Internal Solana delivery/replay and later terminal-rejection classification are verified; its initial ten-minute timeout is retained as evidence. Public SVM mapping/acceptance remains. [Zaryab's draft](questions-zaryab.md) asks only about metadata release scope and links this joint API review. compileCard and revoked history remain outside standalone AGW v1.

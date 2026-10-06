# Remaining AGW product follow-ups for Harsh

Updated October 6, 2026 after your replies, [live Notion comment review](research/notion-comments-2026-10-05.md) and the [v4 owner guide/deployment review](research/deployment-review-2026-10-06/README.md). Accepted decisions and implementation impact are recorded in [product decisions](product-decisions-2026-10-04.md); this document contains only remaining questions.

| Item | Answer needed |
| --- | --- |
| [H3](#h3) | Remaining native omission defaults/public maxValueTotal and token wording |
| [H4.5](#h4-5) | Raw-offset representation introduced by the SDK review fix |
| [H6](#h6) | Choosing a rule for a send when several match |

## Source check

We downloaded [page 5](https://app.notion.com/p/pushprotocol/5-SDK-AGW-3e9188aea7f481cf8e8de324956549b9) again on October 4. Its exported body still matches our October 3 snapshot after link normalization, including maxValueTotal and the old public helper/Spent/compileCard entries. [Comparison evidence](research/notion-check-2026-10-04/comparison.json). We will apply your newer scope directions rather than repeat those answered questions.

On October 5 we read live discussions, including resolved threads. Your new multiple-rules comment is captured under H6. The token-independence comment is included in H3 below. Neither comment provides the missing default table or answers H4.5.

The October 6 owner guide now settles universal total encoding: omitted/no-limit maxTotal uses uint256 maximum, explicit zero forbids movement. It supplies the versioned multi-asset wire layout and confirms same-agent multiplicity. These are no longer questions below. It does not determine every public SDK omission default or the rule-selection API.

<a id="h3"></a>

## H3 Remaining native defaults and public fields

The delivered contracts distinguish hard zero from uint256 maximum, keep maxValueTotal, use maxCalls=0 for unlimited calls and destination maxValue=0 for non-payable calls. We will apply the guide's universal no-total-limit encoding and preserve explicit zeros.

Please confirm the remaining public SDK choices:

- Should omitted native maxValuePerCall and maxValueTotal both mean uint256 maximum? Your earlier reply was tentative for the former and said the latter had changed.
- Is maxValueTotal retained in the public NativeRule, or replaced/removed? The new owner guide still includes it on the wire.
- May we use native amount.maxTotal=uint256 maximum, maxCalls=0 and destination allowedCalls[].maxValue=0 as the omission defaults? The wire meanings are clear; this confirms the public optional-input behavior.

Your [token-independence comment](https://app.notion.com/p/pushprotocol/5-SDK-AGW-3e9188aea7f481cf8e8de324956549b9#af9c3fac35d94f2585cb27310271c1d8) needs one scope clarification: the delivered guide keeps assets[] on the rule and allows each listed token with every allowed call. Is that the intended SDK model, or does your comment request a different public model?

<a id="h4-5"></a>

## H4.5 Decoded rules and raw offsets

This was added during implementation review and was not part of the earlier question set. Stored native rules contain calldata byte offsets, but do not contain the ABI needed to recover argument indexes. Returning a guessed arg index was incorrect for arrays/tuples.

The current fix returns native pins as `{ offset, expected }` and amount limits with `{ offset, maxPerCall, maxTotal }`. V4 EVM allowed-call reads also return exact beneficiaryOffset because stored selectors do not include the ABI needed to recover beneficiary argument indexes. It also accepts these raw forms when granting/updating so decoded rules can round-trip without loss.

Please confirm whether this raw form should be public and accepted for new authoring, or whether decoded wire records should be separate from the ABI-based `{ arg, ... }` input. Accepting arbitrary raw offsets is a different public validation boundary from generating them from ABI information. We will keep internal accounting/codec needs separate from the reduced public spend/helper surface.

**References:** [follow-up review](implementation-review/followup-9e16b23/review.md), [current public types](../../packages/core/src/lib/agentic/agentic.types.ts), [integrator obligations](contract-integrator-obligations.md).

<a id="h6"></a>

## H6 Multiple rules and choosing a rule for a send

Your new [create-example comment](https://app.notion.com/p/pushprotocol/5-SDK-AGW-3e9188aea7f481cf8e8de324956549b9#f9712c13f75c4398aef2dbf7628450b2) says multiple rules per chain are accepted. We already support different agents sharing a chain. The page body still says one per agent and chain; the v4 SDK now permits multiple during create/add/update.

The new owner guide explicitly permits multiple rules for the **same agent and chain**, so the capacity question is answered. How should sendTransaction select rulesId: an explicit caller choice, or a defined automatic selection rule? Please include native arrays whose calls need different rules and cross-chain calls with overlapping permissions.

Lifecycle validation is already aligned with multiple rules. The SDK reports AMBIGUOUS_RULE with candidate IDs before signing; choosing the first rule would make grants, budgets and expiry determine execution accidentally. An explicit selector would add to the public API, so we will not introduce it without agreement.

## Supporting context

Native array implementation is now validated locally and on Donut: use sender-preserving outer UEA/7702 batching of single executeAsAgent calls, and handle unsupported atomic transports explicitly. Universal/SVM wire definitions and the deployment are supplied; Native/EVM adapter/codec work and all 25 registered live scenarios pass; public SVM destination mapping and acceptance remain. [Zaryab's draft](questions-zaryab.md) now asks only about missing metadata scope and representative SVM integration fixtures. compileCard and revoked history remain outside standalone AGW v1.

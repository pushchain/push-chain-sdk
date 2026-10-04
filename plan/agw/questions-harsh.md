# Remaining AGW product follow-ups for Harsh

Updated October 4, 2026 after your replies. Accepted decisions and implementation impact are recorded in [product decisions](product-decisions-2026-10-04.md); this document contains only remaining questions.

| Item | Answer needed |
| --- | --- |
| [H3](#h3) | Exact revised limit fields, omission defaults and explicit-zero behavior |
| [H4.5](#h4-5) | Raw-offset representation introduced by the SDK review fix |

## Source check

We downloaded [page 5](https://app.notion.com/p/pushprotocol/5-SDK-AGW-3e9188aea7f481cf8e8de324956549b9) again on October 4. Its exported body still matches our October 3 snapshot after link normalization, including maxValueTotal and the old public helper/Spent/compileCard entries. [Comparison evidence](research/notion-check-2026-10-04/comparison.json). We will apply your newer scope directions rather than repeat those answered questions.

<a id="h3"></a>

## H3 Revised limits and exact defaults

We understand the direction as omitted maxTotal and maxValuePerCall meaning unlimited, encoded as `type(uint256).max`, rather than zero. Your reply says maxValueTotal changed in the SDK document, but the current page body still contains the earlier NativeRule declaration.

Please point us to the revised section or provide the final field/default table, specifically:

- Which maxTotal inputs should default to uint256 maximum: universal assets[].maxTotal, native amount.maxTotal, or both?
- What replaces or changes native maxValueTotal, and what is its omitted default?
- Should native maxCalls still default to 0 (unlimited), and allowedCalls[].maxValue to 0 (no attached destination value)? These rows were not settled in the reply.
- What should explicit zero mean on each field? In particular, the older multi-asset contract proposal made maxTotal=0 unlimited, while native value/amount zero forbids positive amounts.

The SDK can normalize omitted values independently from the wire representation, but we need one exact agreed table to avoid changing authority accidentally.

<a id="h4-5"></a>

## H4.5 Decoded native rules and raw offsets

This was added during implementation review and was not part of the earlier question set. Stored native rules contain calldata byte offsets, but do not contain the ABI needed to recover argument indexes. Returning a guessed arg index was incorrect for arrays/tuples.

The current fix returns pins as `{ offset, expected }` and amount limits with `{ offset, maxPerCall, maxTotal }`. It also accepts these raw forms when granting/updating so decoded rules can round-trip without loss.

Please confirm whether this raw form should be public and accepted for new authoring, or whether decoded wire records should be separate from the ABI-based `{ arg, ... }` input. Accepting arbitrary raw offsets is a different public validation boundary from generating them from ABI information. We will keep internal accounting/codec needs separate from the reduced public spend/helper surface.

**References:** [follow-up review](implementation-review/followup-9e16b23/review.md), [current public types](../../packages/core/src/lib/agentic/agentic.types.ts), [integrator obligations](contract-integrator-obligations.md).

## Supporting context

Native array implementation is now an SDK validation task: use sender-preserving outer UEA/7702 batching of single executeAsAgent calls, and handle unsupported atomic transports explicitly. SVM and the final universal ABI/deployment remain with [Zaryab](questions-zaryab.md). compileCard and revoked history are outside standalone AGW v1 scope per your reply.

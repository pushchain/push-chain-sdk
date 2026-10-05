# Harsh product replies and SDK impact

October 6 follow-up: [v4 owner guide/deployment review](research/deployment-review-2026-10-06/README.md) supplies universal hard-zero/maxUint256 semantics, wire/read/assertion layouts, SVM structs and same-agent multiplicity. These are no longer missing contract definitions. Native SDK omission defaults/public fields, raw-offset authoring and send selection remain product choices; see the narrowed question drafts.

October 5 follow-up: [live Notion comments](research/notion-comments-2026-10-05.md) add multiple-rules direction and ambiguous token-independence wording. See [H6](questions-harsh.md#h6) for same-agent scope/send selection and H3 for final token/limit definitions. The October 4 decisions below remain recorded evidence; uniqueness is now provisional and defaults/raw offsets remain unresolved.

Recorded October 4, 2026 from the screenshot supplied by Shoaib. The message is attributed to Harsh Rajat and displays 1:35 AM; no Slack permalink or explicit message timezone was supplied. These replies supersede the earlier recommendations where clear. This file records decisions and interpretation; no SDK source changes were made in this pass.

## Source check

We downloaded [SDK page 5](https://app.notion.com/p/pushprotocol/5-SDK-AGW-3e9188aea7f481cf8e8de324956549b9) again on October 4. Its body is byte-identical to the saved snapshot after normalizing five known page-1 links. It still contains maxValueTotal, public pure helpers, Spent and compileCard. The visible menu says last edited October 2 at 8:39 PM. The message therefore carries newer scope direction than the page body currently exposes. [Export comparison and hash evidence](research/notion-check-2026-10-04/comparison.json). Comments are excluded from the native export; this is not a full twelve-page refresh.

AGW remote pushAgenticWallet_v3 was rechecked and remains e704d5b. No new deployment was verified.

## Decisions and interpretations

| Item | Harsh's reply | Disposition and implementation impact |
| --- | --- | --- |
| H1 / A01 | Approval safety belongs to UI/marketplace; SDK should not decide it | Product policy resolved: remove the SDK's blanket approval-selector rejection. Keep structural/ABI/chain validation and actual contract enforcement. Audit the related native mandatory-spender-pin policy under the same boundary; do not confuse it with the ability to encode a caller-requested pin. The approval exposure still exists and belongs in UI/marketplace guidance. |
| H2 / A02 | Multicall or EIP-7702 should handle multiple transactions | Product wants batching. Our earlier blanket rejection was too broad: a sender-preserving outer batch can contain multiple single-call executeAsAgent operations. Source review supports that mechanism; SDK implementation/local validation is pending. See the dedicated analysis below. |
| H3 / A03 | Omitted maxTotal should use uint256 rather than zero; maxValuePerCall “same I guess”; maxValueTotal has changed in the spec | Partial. Interpret “uint256” as an intended uint256 maximum/unlimited default, not a literal type value, and confirm the exact table against the revised spec. The downloaded page body does not expose the referenced maxValueTotal revision. Other optional defaults and explicit-zero semantics were not fully answered. |
| H4.1 / A04 | Generation context for pure helpers does not need to be public | Keep generation/validator/factory machinery internal; stop asking for approval of public context parameters. Adjust generation-dependent helper exposure accordingly. This is not removal of client.agentic.derive or internal generation validation. Do not infer that every unrelated utility must disappear. |
| H4.2 / A05 | Multi-asset spend does not need to be public | Drop the request for a public per-token Spent shape. Internal per-token counters and expected-spend assertions are still required for rules.update. Align RulesRecord exposure with the narrowed public surface; do not remove on-chain/internal accounting. |
| H4.3 / A06 | Revoked history is not public in v1; reconsider later | Closed as deferred v1 scope. Active rule reads remain; no complete historical reconstruction or new grant metadata is required solely for this feature. Define revoked-ID lookup as an explicit unavailable/not-active result in the revised SDK behavior. |
| H4.4 | Zaryab is working on SVM destinations | Contract dependency remains. Obtain matching terms, payloads, capability/deployment and representable SDK input before enabling it. This is not proof that SVM support is delivered. |
| H5 / A08 | Marketplace nomenclature is not ready; compileCard should not come with AGW | Closed for standalone AGW scope: remove the public AGW compileCard stub/export and move card schema/compiler work to the later marketplace track. It is no longer a standalone AGW release blocker. |

The later raw-offset NativeRule extension from review R5 was not included in these replies. Its public input/output contract still needs agreement if those records remain public.

## H2 Correction to our batching analysis

The wallet's agent door rejects ERC-7579 batch mode inside one executeAsAgent call. That does not prohibit an outer transaction from making several single-call entries:

```text
Agent UEA multicall or delegated EIP-7702 account
  → AGW.executeAsAgent(ruleId, single, call1)
  → AGW.executeAsAgent(ruleId, single, call2)
```

Each call still arrives from the authorized agent account and gets its own policy checks. This is separate from factory deployment/grant batching. It cannot be replaced with an arbitrary helper contract, whose address would become msg.sender.

Source evidence: [UEA_EVM multicall and failure propagation at cb69e0b](https://github.com/pushchain/push-chain-core-contracts/blob/cb69e0ba101bef1bb4440e54b2c45396be3e92ce/src/uea/UEA_EVM.sol#L155) calls each target from the UEA and reverts the containing transaction on failure. The SDK's PushBatchExecutor uses delegated EIP-7702/ERC-7821 execution. Native rule expressiveness is separate: a single-action NativeRule cannot authorize different target/selector pairs merely because the transport can batch them.

SDK work: encode one agent-door call per item, preserve signer identity, test cumulative counters and all-or-nothing rollback, and adapt response/progress reconstruction for the outer batch. Current core can fall back from 7702 to sequential sends. Require an atomic-capable transport for atomic AGW arrays or explicitly settle sequential behavior; never silently claim atomicity. This is a technical implementation/verification task, not evidence that a new AGW batch entry point is required.

## Implementation queue

1. Align the public surface: internal generation details; no public universal Spent proposal, no revoked-history promise in v1, and no AGW compileCard.
2. Remove approval-policy rejection from the SDK while retaining encoding and contract validation.
3. Resolve H3's exact field/default table. Do not guess the referenced maxValueTotal change from the screenshot.
4. Implement and test sender-preserving native agent batching using the existing transport capabilities; keep unsupported transport cases explicit.
5. Retain Zaryab dependencies for final multi-asset wire/read/assertion ABI, ref/envelope/metadata scope, SVM artifacts and compatible deployment.
6. Obtain the separate raw-offset public-type decision before release.

Existing implementation at a852777 still contains provisional approval/default rules, public generation-context helpers, Spent fields and the compileCard stub. These are now recorded alignment work, not claims that the new decisions have already been implemented. No production files, external pages or messages were changed.

## Implementation follow-through

The subsequent alignment implements the clear decisions: generation-dependent helpers and spend counters are internal, active-only v1 reads use RULE_NOT_FOUND for unknown/revoked IDs, compileCard is removed, approval policy is external, and native agent arrays use sender-preserving atomic UEA/7702 transport. H3 defaults and the raw-offset public-type question remain unchanged/pending. See [validation and limits](research/product-alignment-2026-10-04/README.md). The earlier a852777 statements above record the pre-alignment state.

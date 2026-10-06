# Remaining-question source recheck

October 6, 2026; the evidence capture timestamp is recorded in [evidence.json](evidence.json). SDK baseline feat/agw-sdk-v4@9e9d8424. This review verifies whether our team-question drafts ask for information already supplied. It changes planning documents only; no production code, contract checkout, remote document or team message is changed.

## Result

The technical definitions are supplied. Four existing decision areas remain: native PC defaults/token intent, raw-offset public representation, multiple-rule send selection and ref/label release scope. The public Solana representation also needs joint SDK/product/contract review and is now explicit as H4.4. The representative SVM fixture request is optional supporting evidence, not a hard external blocker.

The defaults and decoded-rule implementation remain provisional; this review does not approve them or silently change runtime behavior. The SDK team can prepare a concrete public Solana proposal and perform wire-level live validation while these decisions are pending.

## Sources checked and freshness

| Source | Inspection |
| --- | --- |
| All 12 registered Notion snapshots | Searched relevant defaults, rule selection, metadata, offsets and SVM sections. Stable inventory/hashes remain in [source-manifest](../../source-manifest.json). Marketplace/job/evaluator designs do not select standalone send rules or supply the missing public SVM input. |
| Live Notion page 5 | Opened through connected Chrome; reviewed current rules/types, agent selection, label scope and All discussions, including resolved/deleted-context threads. Native maxValueTotal remains optional; inputs remain arg-based and AllowedCall EVM-shaped. No new substantive answer beyond the recorded October 5 comments was visible. Header displayed Edited 23h ago; this is a UI observation, not a body-diff result. |
| Live Notion page 1 | Reviewed current metadata/SVM proposals and All discussions. Header displayed Edited Oct 2. Editable labels remain proposed; no release inclusion/deferral answer was visible. |
| Harsh's supplied replies | Re-read the [recorded product decisions](../../product-decisions-2026-10-04.md), preserving clear scope decisions and the tentative/default-revision wording. No Slack search or new Slack messages were accessed. |
| AGW public remote | Fetched all eight current branch heads from the explicit public repository into isolated local refs; [fetch evidence](evidence.json). deploy-agw=10a24f1 and pushAgenticWallet_v3=e8db748 are unchanged. Other heads are historical and do not supersede the delivered generation. No refs in the contract checkout were changed. |
| Current AGW docs/source/ABI | Re-read owner guide §§3–4, 9–10; design/policy docs; wallet interface/implementation; SVM tests; saved verified ABIs. deploy-agw src is identical to the reported deployment source. This pass did not re-probe live wiring or assert bytecode freshness. |
| SDK implementation/evidence | Public types, defaults, native encoder/decoder, rule selector, SVM capability gate, internal backend and actual-contract evidence. Existing local tests prove contract enforcement with a fixture gateway, not live Solana settlement. |
| Sibling core/gateway documents | Searched 11 core and 24 gateway docs in the existing checkouts for direct NativeRule/default/metadata/SVM public-schema/selection definitions. No direct answer to these product questions. These repositories were not freshly fetched; prior baseline pins remain authoritative only for earlier inspections. |

This was not a full Notion export or a fresh inspection of every live Notion page. The last full export remains October 3; only pages 1 and 5 and their discussions were freshly inspected. No claim that all twelve live bodies are unchanged.

## Question-by-question disposition

| Item | What the sources already answer | What still needs agreement | Draft change |
| --- | --- | --- | --- |
| H3 limits | Owner guide §§4.3/4.5 defines uint256 maximum/zero, retains NativeTerms.maxValueTotal, maxCalls=0 unlimited, and destination maxValue=0 non-payable. Live NativeRule still retains maxValueTotal. Universal omitted total is supplied. | Exact omitted native PC limits; Harsh's reference to a changed field/default has no matching revised specification. | Removed the separate retained-field and wire-sentinel questions; asks about the two PC omission rows, preserving maxValueTotal unless an explicit revision is supplied. Other defaults are shown as SDK conventions, not newly confirmed product decisions. |
| H3 token intent | Owner guide §4.3: caps per token, each listed asset usable with every allowed call. Target page still contains assets[]. | Whether the token-independence comment requests a public-model change. | Keep one clarification; do not infer permission to remove token enforcement. |
| H4.5 offsets | Wire structs store offsets without ABI signatures. Historical SDK already used raw offsets; current public target uses arg indexes. Raw decoded values are necessary for lossless representation. | Whether raw-offset authoring is public, or decoded records are distinct from ABI-based authoring inputs. | Correct the implication that raw offsets are an invented contract feature; retain the current public API choice. |
| H6 multiplicity | Owner guide §9 explicitly allows several same-agent/same-chain rules; Harsh's comment accepts multiplicity. | Selection under overlapping rules/arrays. Current target lookup assumes uniqueness; no source defines a replacement algorithm. | Keep selection only; do not re-ask capacity or silently pick the first match. |
| Z1.3 metadata | Page 1 already proposes grant ref and setLabel/LabelSet, with labels excluded from checkpoints. Delivered IAGW has grantRules(Session) and a four-field RulesGranted event, without job ref or setLabel. | Include these in this release or defer with product. | Ask release scope and confirm the existing proposal if included; remove the broad request to redesign parameter/event shapes. |
| H4.4 public SVM | Owner guide §4.4 and Types.sol supply SvmTerms, programs, account/data pins, CEA/ATA derivation obligations. Internal SDK backend is complete. | Public authoring and decoded-record representation: current AllowedCall cannot express those constraints. | Add an explicit joint review item; this is SDK design agreement, not missing contract structs. |
| Z1.4 fixture | SDK chain constants contain a devnet gateway; a counter IDL exists. Contract SVM tests deliberately use synthetic keys. | Live program/IDL/configuration compatibility must be checked. | Mark fixture optional. Read-only preflight and a bounded internal wire test are SDK-owned work; a fixture is useful independent evidence. |

## Exact evidence pointers

Paths below are relative to the SDK repository; contract line numbers refer to the saved deploy-agw source whose relevant files match the freshly fetched head.

- Public target: plan/agw/notion/5-sdk-agw.md:484 (unique lookup), :582 (NativeRule), :610 (EVM AllowedCall), :633 (setLabel proposal). The live page still shows those relevant declarations.
- Historical raw inputs: plan/agw/notion/legacy-agw-sdk-v1.md:205 and :206. They describe an older, different public API; they do not authorize the current extension by themselves.
- Owner guide: plan/agw/research/deployment-review-2026-10-06/source/docs/5_SDK_Owner_Integration.md:142, :167, :176, :179, :212, :422, :433.
- Delivered metadata: same bundle src/interfaces/IAGW.sol:57 and :107; src/AGW.sol:483 and :636. Grant checkpoint ref names the rulesId, not an application job reference.
- SVM wire responsibilities: same bundle src/libraries/Types.sol:486–525. Remote test/unit/9_svmRulebook.t.sol at 10a24f1:72 explicitly describes synthetic Solana keys; the fixture has hash-generated CEA/ATA/program values.
- Runtime defaults: packages/core/src/lib/agentic/codec/defaults.ts:21–56; native PC omission is still 0, with provisional markers.
- Raw inputs/outputs: packages/core/src/lib/agentic/agentic.types.ts:43–71; codec/native.ts:147 and :255. Arbitrary raw authoring and ABI-generated pins have different validation boundaries; H1's UI approval direction does not answer this API question.
- Rule selection: packages/core/src/lib/agentic/reads/rules.ts:131–169; public SVM read gate :179–183.
- Existing SVM candidate config: packages/core/src/lib/constants/chain.ts:399 (devnet gateway CFVSincHYbETh2k7w6u1ENEkjbSLtveRCEBupKidw2VS); orchestrator/svm-idl/__fixtures__/test_counter.idl.json:2 (program 8yNqjrMnFiFbVTVQcKij8tNWWTMdFkrDf9abCGgc2sgx). These are candidate fixture inputs, not new live acceptance proof.
- Completed backend and limits: [nine-item completion report](../sdk-independent-completion-2026-10-06/README.md), qualified by the newer [hardening report](../sdk-hardening-2026-10-06/README.md).

Primary remote links: [owner guide](https://github.com/pushchain/push-agentic-wallets/blob/10a24f101e2e6e0a9b76517b29f5cdb1aa967796/docs/5_SDK_Owner_Integration.md), [wallet interface](https://github.com/pushchain/push-agentic-wallets/blob/10a24f101e2e6e0a9b76517b29f5cdb1aa967796/src/interfaces/IAGW.sol), [SVM contract test](https://github.com/pushchain/push-agentic-wallets/blob/10a24f101e2e6e0a9b76517b29f5cdb1aa967796/test/unit/9_svmRulebook.t.sol), [live SDK spec](https://app.notion.com/p/pushprotocol/5-SDK-AGW-3e9188aea7f481cf8e8de324956549b9), [live contract target](https://app.notion.com/p/pushprotocol/1-AGW-Contract-Changes-nomenclature-standard-change-set-3e9188aea7f4813aa31fc95ceb4e684d).

## What not to send as questions

Do not re-open deployment/address delivery, the validator/engine design, checkpoint storage, the universal envelope or multi-asset layouts, EVM CEA width, internal spend accounting, same-agent capacity, revoked history, approval-screening ownership or compileCard. Those are supplied, accepted, implemented or explicitly out of standalone scope.

creditRevert remains a documented Push-core executor dependency. It is a tracked platform limitation, not another unanswered AGW design question. No live Solana test or refund-credit integration is claimed by this source review.

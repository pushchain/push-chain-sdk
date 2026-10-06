# Remaining external dependencies for AGW

Rechecked October 6, 2026 against live Notion pages 1/5 and All discussions, all saved sources, freshly fetched contract refs and SDK code. [Question dispositions and evidence](research/question-source-recheck-2026-10-06/README.md). Contract wire/accounting definitions and deployment addresses are supplied; distinguish remaining decisions from SDK implementation and live acceptance.

## Remaining team input

| Area | Owner | Remaining answer |
| --- | --- | --- |
| Native PC optional-input defaults/token intent | Harsh H3 | Exact omitted maxValuePerCall/maxValueTotal behavior and whether token-independence requests a public-model change; current target retains maxValueTotal |
| Public Solana representation | Harsh H4.4 with Zaryab | Solana-specific authoring/read shape, explicit program/account/data constraints versus higher-level IDL inputs; wire structs are supplied |
| Decoded-rule representation | Harsh H4.5 | Public native/EVM raw-offset authoring versus separate decoded records |
| Multiple-rule execution | Harsh H6 | Explicit caller rule selection versus a defined automatic strategy, including arrays/overlapping rules; same-agent capacity is supplied |
| Metadata scope | Zaryab Z1.3 with Harsh | Whether absent grant ref/editable label will be delivered or explicitly deferred from v1 |

Zaryab Z1.4 is an **optional fixture request**, not a hard dependency. The SDK already has a candidate devnet gateway and counter-program IDL. We can verify their current deployment/compatibility read-only and prepare a bounded wire-level test ourselves. A known-good team fixture would improve independent comparison; this review does not claim those candidate inputs have passed live AGW delivery.

The owner guide retains assets[] on the rule, with each listed token usable by every allowed call. Harsh's token-independence comment is not treated as permission to remove token limits. SVM wire types are supplied; the remaining fixture request does not reopen struct delivery.

## Delivered — now SDK work

- V4 factory/URP addresses and implementation/engine/validator wiring: checked read-only on Donut block 23931055. The new book supersedes the earlier historical address table for new integrations.
- Multi-asset EVM/SVM wire layouts, envelope version 1, address EVM expectedCEA and per-asset spend reads/assertions: delivered and verified ABIs saved.
- Universal total encoding: maxUint256 means no total limit; explicit zero permits no movement. Empty user assets need one destination gas PRC20 routing cap at 0/0, not an empty wire array.
- Multiple same-agent/same-chain rules: contract guide explicitly permits them; product accepts multiplicity. Choosing the rule for a send remains H6.
- Separate owner allowance, immutable-wallet generations, internal accounting and sender-preserving native batching: preserve the existing design while migrating to v4.

Native/EVM v4 migration and the internal SVM read/context/instruction/lifecycle/execution backend are implemented. The actual-contract harness is ported; runtime/test legacy artifacts were removed. [Backend evidence](research/sdk-independent-completion-2026-10-06/README.md). Public SVM adapters/presentation and live destination acceptance remain SDK work after agreeing the public model; internal wire-level validation can proceed independently.

## Previously settled scope

Approval screening belongs to UI/marketplace; structural/ABI validation remains in the SDK. Generation details and spend stay internal, public revoked history is deferred, and compileCard remains outside standalone AGW. Native arrays use atomic sender-preserving UEA/7702 batching, with explicit failure when unavailable. No request for those answered choices is reopened.

## Platform and release gates

creditRevert still depends on Push-core executor integration; the source explicitly says failures are not yet credited. Ordinary money returning does not lower spent. No-code at the module account is not by itself evidence of a defect.

All 25 registered AGW live scenarios have passing bounded selected-run coverage, including UEA/7702 identities/batching, lifecycle, allowance, response hooks/replay and Sepolia outbound success/failure. This resolves the outstanding native/EVM acceptance tasks; public Solana destinations still need integration and live coverage. External product/scope decisions above remain separate. [Current evidence](research/live-acceptance-2026-10-06/README.md).

## Freshness

Fresh fetch confirms AGW source e8db748 and documentation head deploy-agw@10a24f1, with identical src. Explorer-verified ABIs and the earlier pinned RPC probe are saved in the [review bundle](research/deployment-review-2026-10-06/README.md); no new deployment probe in this question pass. Current evidence is 1,975 unit tests, 75 actual-contract tests and 25 registered live scenarios with passing selected-run coverage. [Validation](research/sdk-hardening-2026-10-06/README.md). Core/gateway source pins were not refreshed.

Notion's last full export remains October 3, with October 4 body comparison, October 5 comments and a fresh October 6 live inspection of pages 1/5 and All discussions. The GitHub guide supplies deployed wire behavior; the target public API remains qualified by Harsh's replies.

## SVM foundation and current execution environment

[SVM internals](research/svm-internals-2026-10-06/README.md) are implemented and tested, including all seven Anvil cases. Full permissions and RPC access are restored. Authorized bounded Donut tests have completed; networking and test funding are no longer blockers. Public SVM destination mapping/dispatch and live Solana acceptance remain separate work.

## SDK-owned follow-up completed

The [independent SDK follow-up](research/sdk-independent-followup-2026-10-06/README.md) closes deliberate delayed-index replay/wait coverage using real local transactions/receipts and controlled indexer responses. The consumer AGW guide and public-export example checker are supplied. Neither change chooses unresolved defaults, raw-offset authoring or a multiple-rule selection API.

The [nine-item completion report](research/sdk-independent-completion-2026-10-06/README.md) records the finished internal SVM integration and automated checks. These are no longer missing SDK backend components; public adapters/capability enablement and live destination acceptance remain after the external decisions.

# Remaining external dependencies for AGW

Updated October 6, 2026 after the [v4 deployment and owner-guide review](research/deployment-review-2026-10-06/README.md). Contract wire/accounting definitions and deployment addresses are supplied; distinguish remaining decisions from SDK implementation and live acceptance.

## Remaining team input

| Area | Owner | Remaining answer |
| --- | --- | --- |
| Native optional-input defaults/public fields | Harsh H3 | Native value omission defaults, referenced public maxValueTotal change, confirmation of remaining omission rows and token-independence wording |
| Native decoded-rule representation | Harsh H4.5 | Public raw-offset read/write authoring versus separate decoded/internal form |
| Multiple-rule execution | Harsh H6 | Explicit caller rule selection versus a defined automatic strategy, including arrays/overlapping rules; same-agent capacity is supplied |
| Metadata scope | Zaryab Z1.3 with Harsh | Whether absent grant ref/editable label will be delivered or explicitly deferred from v1 |
| Representative SVM integration fixture | Zaryab Z1.4, where available | Cluster gateway/registry and protected-account derivation inputs, valid envelope/outbound example and expected failure cases |

The owner guide retains assets[] on the rule, with each listed token usable by every allowed call. Harsh's token-independence comment is not treated as permission to remove token limits. SVM wire types are supplied; the remaining fixture request does not reopen struct delivery.

## Delivered — now SDK work

- V4 factory/URP addresses and implementation/engine/validator wiring: checked read-only on Donut block 23931055. The new book supersedes the earlier historical address table for new integrations.
- Multi-asset EVM/SVM wire layouts, envelope version 1, address EVM expectedCEA and per-asset spend reads/assertions: delivered and verified ABIs saved.
- Universal total encoding: maxUint256 means no total limit; explicit zero permits no movement. Empty user assets need one destination gas PRC20 routing cap at 0/0, not an empty wire array.
- Multiple same-agent/same-chain rules: contract guide explicitly permits them; product accepts multiplicity. Choosing the rule for a send remains H6.
- Separate owner allowance, immutable-wallet generations, internal accounting and sender-preserving native batching: preserve the existing design while migrating to v4.

Native/EVM v4 migration is now implemented: adapter/registry, envelopes, multi-asset reads/codecs, ordered assertions, outbound token choice and ABI integration. The actual-contract harness is ported; runtime/test legacy artifacts were removed. [Current evidence](research/v4-implementation-2026-10-06/README.md). SVM SDK mapping/composition and live acceptance remain.

## Previously settled scope

Approval screening belongs to UI/marketplace; structural/ABI validation remains in the SDK. Generation details and spend stay internal, public revoked history is deferred, and compileCard remains outside standalone AGW. Native arrays use atomic sender-preserving UEA/7702 batching, with explicit failure when unavailable. No request for those answered choices is reopened.

## Platform and release gates

creditRevert still depends on Push-core executor integration; the source explicitly says failures are not yet credited. Ordinary money returning does not lower spent. No-code at the module account is not by itself evidence of a defect.

All 25 registered AGW live scenarios have passing bounded selected-run coverage, including UEA/7702 identities/batching, lifecycle, allowance, response hooks/replay and Sepolia outbound success/failure. This resolves the outstanding native/EVM acceptance tasks; public Solana destinations still need integration and live coverage. External product/scope decisions above remain separate. [Current evidence](research/live-acceptance-2026-10-06/README.md).

## Freshness

AGW deployment source e8db748; documentation head deploy-agw@10a24f1, with identical src. Explorer-verified ABIs and a pinned RPC probe are saved in the [review bundle](research/deployment-review-2026-10-06/README.md). The native/EVM migration was rebuilt and validated: 1,947 unit tests, 25 distinct registered live scenarios and the expanded actual-contract suite pass. See the current validation report. Core/gateway source pins were not refreshed.

Notion's last full export remains October 3, with focused October 4 body and October 5 comment checks. The GitHub guide is a separate deployed-wire source, not a silent replacement for the target public SDK API.

## SVM foundation and current execution environment

[SVM internals](research/svm-internals-2026-10-06/README.md) are implemented and tested, including all seven Anvil cases. Full permissions and RPC access are restored. Authorized bounded Donut tests have completed; networking and test funding are no longer blockers. Public SVM destination mapping/dispatch and live Solana acceptance remain separate work.

## SDK-owned follow-up completed

The [independent SDK follow-up](research/sdk-independent-followup-2026-10-06/README.md) closes deliberate delayed-index replay/wait coverage using real local transactions/receipts and controlled indexer responses. The consumer AGW guide and public-export example checker are supplied. Neither change chooses unresolved defaults, raw-offset authoring or a multiple-rule selection API.

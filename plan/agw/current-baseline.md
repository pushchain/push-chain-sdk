# Current validated AGW baseline

Updated October 7, 2026 after confirmed product decisions, fresh contract refs, and public Solana/native acceptance. **The v5 deployment and native/EVM SDK adapter/codecs are integrated locally. The opt-in `agw` group now includes 58 scenarios with selected-run live coverage, including owner funds-only Solana transfers and mapped policy refusals.** [Extended E2E evidence](research/extended-e2e-2026-10-06/README.md); [full deployment review](research/deployment-review-2026-10-06/README.md).

The public SDK target remains Notion page 5, qualified by Harsh's later replies/comments. The new owner guide establishes deployed wire behavior; the October 7 decisions remove rule ref, confirm defaults and existing ambiguity handling, and include the delivered v5 editable-label interface. [Prior October 3–5 baseline](research/deployment-review-2026-10-06/previous-current-baseline.md) is retained as historical evidence.

## Pinned sources

| Source | Revision and role |
| --- | --- |
| AGW deployment source | 2e61e133e641b4e0e1ddbdc9306b0903b60e4dbb, reported by address book/owner guide |
| AGW documentation | deploy-agw@bd230d20dbf778d9994b1f1082f79b1a8829a10f; includes the v5 deployment and label docs |
| SDK contract adapter | V5 only (2e61e13); Donut registry populated; old runtime/test generation removed |
| Core marketplace | Refreshed universalMarketplace_v1@9479aeff5291bb06fa306f7efa98be9c45324cb0; docs-only advance over cb69e0b, source unchanged |
| Gateway source | Refreshed pc20-3rd-iteration@bcbf7df42e8e6dd11088a43bcc0b056a54ea0a18; code and live implementation slot unchanged |
| Notion | Full 12-page export October 7 at 15:57 IST; page 5 create-example ref removed; current primary discussions reviewed |

[Saved GitHub sources and hashes](research/deployment-review-2026-10-06/source-manifest.json) are separate from the Notion manifest. [Verified ABIs](research/deployment-review-2026-10-06/abis/) came from the explorer. The earlier October 6 wire review is historical. [V5 SDK migration and acceptance](research/v5-implementation-2026-10-07/README.md) records the latest rebuild and test results.

## Donut v5 deployment

Chain 42101, RPC https://evm.donut.rpc.push.org/, pinned block **23991912**. [Probe](research/deployment-review-2026-10-07-v5/donut-probe.json).

| Component | Address |
| --- | --- |
| Factory proxy | 0x8137F96A50EBF41d904e3678c84c391a0D1BCcc5 |
| URP proxy | 0x603E7f0aF6e1aAFf46DDfb28b1e99364f8BC59af |
| Wallet implementation | 0x4D459Da499C14548aa16c46c57fD92880A88EBb4 |
| AgentValidator | 0x068EE2388475A98EE1f5a434C58bFF3444fffFe6 |
| SmartSession | 0x165A5E6782f39D30B38c7D97e1303e4CB2aD102a |
| Gateway | 0x00000000000000000000000000000000000000C1 |

Code sizes, factory/policy implementation slots, policy admin and wallet/policy wiring match the new book. Factory is unpaused; URP version is 3.1.0; pushChainHash matches eip155:42101. Wallet accountId remains push.agw.1.0.0 and is insufficient to distinguish envelope generations. Address book reports deployment blocks 23989983–23989987; release manifest should preserve deployment/log provenance.

The earlier supplied historical addresses are superseded for new v5 integrations. Wallet clones remain generation-specific and do not migrate; prediction is stable within its factory context, not globally across factories.

## Compatibility and remaining work

| Surface | Deployed definition | SDK status/action |
| --- | --- | --- |
| Owner/agent doors | execute and sender-gated executeAsAgent; unchanged SmartSession | Preserve model, adapt/test selected generation; no engine fork |
| Session/IDs | abi.encode(agent), salt overwritten by grantNonce; rulesId wallet-scoped | Existing identity logic retained, new validator context |
| All policy envelopes | uint16 version=1, chainNamespace, body | Envelope 1 implemented; old envelope rejected by actual contracts |
| Universal EVM | 1–8 ordered AssetCaps, maxGasPerCall, address expectedCEA | Implemented, including source-chain/token identity validation and v5 reads |
| No-movement rules | One destination gas PRC20 cap at 0/0 when user assets empty | Implemented; actual-contract call-only case passes |
| Total ceilings | maxUint256 unlimited, zero hard zero | Universal max default/explicit zero and confirmed zero native PC defaults implemented |
| Internal replacement guard | assertSpent(configId,wallet,uint256[]) compares all totals in asset order | SDK implemented; second-token intervening spend rolls back replacement |
| Native terms | Same body layout, one config per action; envelope changed | V5 native tests pass; ABI offset validation retained |
| Multiple rules | Several same-agent/same-chain grants supported | Management permits multiplicity; ambiguous sends are refused by the SDK, and the contract enforces the supplied rule |
| Checkpoints | Stored count/last block, three event kinds, per-owner-call/lifecycle ticks | Local and registered live native/EVM lifecycle acceptance pass |
| Grant ref / label | Grant has no ref; label stored on wallet; owner/self setLabel, 64-byte cap, empty reset | Ref removed; v5 labels implemented. SDK owner-door rename adds one checkpoint |
| SVM | Full multi-asset terms/program/account/data pins supplied | Public named-IDL grants/reads/replacement/sends/revoke pass live, including destination CEA transfer and replay; unsupported IDL layouts are rejected explicitly. Prior internal rejection/terminal replay evidence remains valid. |
| Gateway request | Eight-field live implementation, selector 0x77b86bec | Dedicated context, listed-token choice and maxGasPerCall implemented |
| Allowance | Consume separate owner-established allowance | Keep existing race-safe behavior; Live allowance/token debit passes; remaining identity coverage explicit |
| Refund spend credit | creditRevert gains token; executor still does not call it | Known Push-core dependency; ordinary returns do not lower spent |
| Tracking/events | Metered/revert events include token | ABIs/imports updated; live call-only, positive-amount and external-failure tracking pass |

The historical v3-to-v4 ABI comparison found changed policy getters, assertions, credit and events. [Comparison](research/deployment-review-2026-10-06/abi-comparison.json). V5 additionally changes the wallet initializer and adds label functions/event/error; those updated ABIs are generated from the isolated v5 build.

## Focused verification

Four checks passed: version-1 envelope round-trip/old first-word incompatibility; synthetic ordered two-asset tuple round-trip; live v4 getConfig decode with old-ABI rejection; array assertion encoding. [Results and limits](research/deployment-review-2026-10-06/wire-checks.json). This is not a rule-grant, stale-spend transaction or funded E2E proof.

See [implementation status](implementation-status.md) for the final unit and actual-contract counts. All five explorer ABI sets match the isolated build. Donut is registered and all 48 registered AGW native/EVM/identity/management/policy/public-Solana cases have passing selected-run live coverage. The `agw` group remains opt-in; default `all` remains 76 scenarios. [Extended E2E evidence](research/extended-e2e-2026-10-06/README.md); [prior acceptance evidence](research/live-acceptance-2026-10-06/README.md).

## Remaining delivery and acceptance

The [full source refresh](research/source-refresh-2026-10-07/README.md) found SDK alignment follow-ups G27/G28: policy-preflight/error parity and Solana owner funds-only support. Both are now fixed and validated in the [follow-up report](research/sdk-alignment-fixes-2026-10-07/README.md). Contract/code deployment drift was not found.

Product choices are settled: zero native PC defaults, current token budgets, named IDL Solana authoring, dual native/EVM argument-index/raw-offset inputs, and removal of rule ref. The implementation and seven new selected live cases cover these choices.

Zaryab delivery is still needed for editable labels. The existing contract already enforces the supplied rule and rejects unauthorized actions. Keep AMBIGUOUS_RULE for multiple candidates; no automatic-selection interface or caller-facing selector is required. [Delivery items](questions-zaryab.md).

Public Solana acceptance now passes. Source-authoring supports fixed Anchor layouts, one instruction per send, and configured devnet. See the [consumer guide](../../packages/core/AGW.md) for exact limits. The destination failure/retry and creditRevert platform limitations remain as recorded in the historical wire report.

Checkpoint count semantics remain per action, not per transaction: assert/revoke/grant adds five ticks; failed transactions unwind ticks; agent calls do not tick. Pre-existing allowances may change balances without checkpoints. Preserve internal spend assertions even though public spent records are removed.

The historical [October 6 source recheck](research/question-source-recheck-2026-10-06/README.md) records unchanged contract heads; the October 7 fetch confirmed the same refs. It records answered definitions separately from remaining public decisions and SDK-owned fixture validation; it does not claim a fresh live bytecode probe.

Current v5 acceptance: 2,014 units and 90 actual-contract SDK cases pass. Expanded live evidence covers labels, native/lifecycle behavior, EVM, native SOL and SPL destinations; the full 58-case group has not run in one invocation. [Expanded results](research/extended-v5-e2e-2026-10-07/README.md). Fresh Sepolia CEA positive cases use an explicit 2m destination-gas budget; the current upstream 500k default was insufficient. SPL quoting/authoring/reads now handle absent source-mint metadata through the existing verified-chain token registry.

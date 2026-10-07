# Current validated AGW baseline

Updated October 7, 2026 after confirmed product decisions, fresh contract refs, and public Solana/native acceptance. **The v4 deployment and native/EVM SDK adapter/codecs are integrated locally. The opt-in `agw` group now includes 46 scenarios with selected-run live coverage: 39 previous cases and seven decision-alignment cases.** [Extended E2E evidence](research/extended-e2e-2026-10-06/README.md); [full deployment review](research/deployment-review-2026-10-06/README.md).

The public SDK target remains Notion page 5, qualified by Harsh's later replies/comments. The new owner guide establishes deployed wire behavior; the October 7 decisions remove rule ref, confirm defaults and existing ambiguity handling, and leave editable labels pending contract delivery. [Prior October 3–5 baseline](research/deployment-review-2026-10-06/previous-current-baseline.md) is retained as historical evidence.

## Pinned sources

| Source | Revision and role |
| --- | --- |
| AGW deployment source | e8db74815cfbbf5389593805e464fe8d85f7f735, reported by address book/owner guide |
| AGW documentation | deploy-agw@10a24f101e2e6e0a9b76517b29f5cdb1aa967796; src identical to e8db748 |
| SDK contract adapter | V4 only (e8db748); Donut registry populated; old runtime/test generation removed |
| Core marketplace | Prior pin cb69e0ba101bef1bb4440e54b2c45396be3e92ce; not freshly fetched |
| Gateway source | Prior eight-field pin bcbf7df42e8e6dd11088a43bcc0b056a54ea0a18; live implementation slot checked |
| Notion | Last full export October 3 at 13:23 IST; October 4 body comparison, October 5 comments, October 6 live pages 1/5 and All discussions inspection; no new export |

[Saved GitHub sources and hashes](research/deployment-review-2026-10-06/source-manifest.json) are separate from the Notion manifest. [Verified ABIs](research/deployment-review-2026-10-06/abis/) came from the explorer. This review did not locally rebuild runtime bytecode or rerun the full contract/SDK suites.

## Donut v4 deployment

Chain 42101, RPC https://evm.donut.rpc.push.org/, pinned block **23931055**. [Probe](research/deployment-review-2026-10-06/donut-probe.json).

| Component | Address |
| --- | --- |
| Factory proxy | 0xaF88D0FD947afAe7bBb8F34e8417DCfc165e1aaF |
| URP proxy | 0x603E7f0aF6e1aAFf46DDfb28b1e99364f8BC59af |
| Wallet implementation | 0x96D69ec7e6cDdaD414e656B5c9DCA24587DF713c |
| AgentValidator | 0x068EE2388475A98EE1f5a434C58bFF3444fffFe6 |
| SmartSession | 0x165A5E6782f39D30B38c7D97e1303e4CB2aD102a |
| Gateway | 0x00000000000000000000000000000000000000C1 |

Code sizes, factory/policy implementation slots, policy admin and wallet/policy wiring match the new book. Factory is unpaused; URP version is 3.1.0; pushChainHash matches eip155:42101. Wallet accountId remains push.agw.1.0.0 and is insufficient to distinguish envelope generations. Address book reports deployment blocks 23923806–23923810; release manifest should preserve deployment/log provenance.

The earlier supplied historical addresses are superseded for new v4 integrations. Wallet clones remain generation-specific and do not migrate; prediction is stable within its factory context, not globally across factories.

## Compatibility and remaining work

| Surface | Deployed definition | SDK status/action |
| --- | --- | --- |
| Owner/agent doors | execute and sender-gated executeAsAgent; unchanged SmartSession | Preserve model, adapt/test selected generation; no engine fork |
| Session/IDs | abi.encode(agent), salt overwritten by grantNonce; rulesId wallet-scoped | Existing identity logic retained, new validator context |
| All policy envelopes | uint16 version=1, chainNamespace, body | Envelope 1 implemented; old envelope rejected by actual contracts |
| Universal EVM | 1–8 ordered AssetCaps, maxGasPerCall, address expectedCEA | Implemented, including source-chain/token identity validation and v4 reads |
| No-movement rules | One destination gas PRC20 cap at 0/0 when user assets empty | Implemented; actual-contract call-only case passes |
| Total ceilings | maxUint256 unlimited, zero hard zero | Universal max default/explicit zero and confirmed zero native PC defaults implemented |
| Internal replacement guard | assertSpent(configId,wallet,uint256[]) compares all totals in asset order | SDK implemented; second-token intervening spend rolls back replacement |
| Native terms | Same body layout, one config per action; envelope changed | V4 native tests pass; ABI offset validation retained |
| Multiple rules | Several same-agent/same-chain grants supported | Management permits multiplicity; ambiguous sends are refused by the SDK, and the contract enforces the supplied rule |
| Checkpoints | Stored count/last block, three event kinds, per-owner-call/lifecycle ticks | Local and registered live native/EVM lifecycle acceptance pass |
| Grant ref / label | Grant has no ref; label is deployment event only; no setLabel | Rule ref removed from SDK scope; editable labels await contract delivery |
| SVM | Full multi-asset terms/program/account/data pins supplied | Public named-IDL grants/reads/replacement/sends/revoke pass live, including destination CEA transfer and replay; unsupported IDL layouts are rejected explicitly. Prior internal rejection/terminal replay evidence remains valid. |
| Gateway request | Eight-field live implementation, selector 0x77b86bec | Dedicated context, listed-token choice and maxGasPerCall implemented |
| Allowance | Consume separate owner-established allowance | Keep existing race-safe behavior; Live allowance/token debit passes; remaining identity coverage explicit |
| Refund spend credit | creditRevert gains token; executor still does not call it | Known Push-core dependency; ordinary returns do not lower spent |
| Tracking/events | Metered/revert events include token | ABIs/imports updated; live call-only, positive-amount and external-failure tracking pass |

The ABI comparison found matching factory/wallet/engine function/event/error signatures and return shapes, but changed policy getters, assertions, credit and events. Same wallet ABI does not imply same semantics: its envelope decoder changed. [Comparison](research/deployment-review-2026-10-06/abi-comparison.json).

## Focused verification

Four checks passed: version-1 envelope round-trip/old first-word incompatibility; synthetic ordered two-asset tuple round-trip; live v4 getConfig decode with old-ABI rejection; array assertion encoding. [Results and limits](research/deployment-review-2026-10-06/wire-checks.json). This is not a rule-grant, stale-spend transaction or funded E2E proof.

See [implementation status](implementation-status.md) for the final unit and actual-contract counts. All five explorer ABI sets match the isolated build. Donut is registered and all 46 AGW native/EVM/identity/management/policy/public-Solana cases have passing selected-run live coverage. The `agw` group remains opt-in; default `all` remains 76 scenarios. [Extended E2E evidence](research/extended-e2e-2026-10-06/README.md); [prior acceptance evidence](research/live-acceptance-2026-10-06/README.md).

## Remaining delivery and acceptance

Product choices are settled: zero native PC defaults, current token budgets, named IDL Solana authoring, dual native/EVM argument-index/raw-offset inputs, and removal of rule ref. The implementation and seven new selected live cases cover these choices.

Zaryab delivery is still needed for editable labels. The existing contract already enforces the supplied rule and rejects unauthorized actions. Keep AMBIGUOUS_RULE for multiple candidates; no automatic-selection interface or caller-facing selector is required. [Delivery items](questions-zaryab.md).

Public Solana acceptance now passes. Source-authoring supports fixed Anchor layouts, one instruction per send, and configured devnet. See the [consumer guide](../../packages/core/AGW.md) for exact limits. The destination failure/retry and creditRevert platform limitations remain as recorded in the historical wire report.

Checkpoint count semantics remain per action, not per transaction: assert/revoke/grant adds five ticks; failed transactions unwind ticks; agent calls do not tick. Pre-existing allowances may change balances without checkpoints. Preserve internal spend assertions even though public spent records are removed.

The historical [October 6 source recheck](research/question-source-recheck-2026-10-06/README.md) records unchanged contract heads; the October 7 fetch confirmed the same refs. It records answered definitions separately from remaining public decisions and SDK-owned fixture validation; it does not claim a fresh live bytecode probe.

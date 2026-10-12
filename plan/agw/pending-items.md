# AGW SDK pending items

October 12, 2026. The newly downloaded SDK sections 6/7 supersede the earlier `actions[]` proposal and multiple-rule creation decision. See [the item-by-item feedback list](section6-action-items.md).

| Item | Owner / dependency | Completion condition |
| --- | --- | --- |
| Exact outbound allowance inside both wallet doors | Contract team, §6.1 | Verified source/ABI/deployment; SDK can then remove manual-allowance preflight |
| Atomic factory create and initial grants | Contract team, §6.2 | Verified entry points, owner/signed variants and index-race behavior; remove partial recovery only then |
| General EVM destination EQ/MAX pins | Contract team, §6.3 | Deployed policy encoding; currently only one WALLET beneficiary pin is supported |
| Native 1..32 calls in spec versus deployed maximum 8 | Product/contracts | Align spec or deploy increased ceiling; SDK enforces 8 now |
| Presets (§7) | Product/app catalog | Approved apps/addresses/chains, struct-field pins and multi-spender approval representation; framework is implemented, missing caps default to zero, incomplete results are typed templates |
| ABI compound argument reconstruction | Product/spec metadata | Define struct fields and how layouts survive reads; unsupported layouts fail explicitly |
| Native historical lifetime limits | Spec/migration | Define a lossless public representation if these old grants must be editable; never drop their restrictions silently |
| Revert credit | Push-core executor | Executor invokes creditRevert; verify restored spend independently |
| Delivery/terminal latency | Platform | Resolve delayed terminal status and bounded polling expectations |
| Single clean live run / new-contract acceptance | SDK, then new deployment | Current 68 cases pass across the full run plus targeted rerun; a single clean full invocation and new-contract acceptance remain distinct |

User decisions recorded October 12: multi-action native `spent` uses per-action entries. Decoded Solana rules may use an explicit raw form for lossless get→update; authored rules use arg/account positions. These no longer require clarification.

The first-use EVM gas default is being fixed in the SDK and is no longer an external core/gateway question. `setLabel` already exists on v5; direct invocation requires no contract change.

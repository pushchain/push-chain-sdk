# AGW SDK pending items

October 15, 2026. The newly downloaded SDK sections 6/7 supersede the earlier `actions[]` proposal and multiple-rule creation decision. See [the item-by-item feedback list](section6-action-items.md).

| Item | Owner / dependency | Completion condition |
| --- | --- | --- |
| Native 1..32 calls in spec versus deployed maximum 8 | Product/contracts | Align spec or deploy increased ceiling; SDK enforces 8 now |
| Additional preset protocols / chains | SDK + protocol prerequisites | Every shipped testnet protocol/chain combination now has a positive live flow. Remaining coverage is borrow/repay, other markets/methods and mainnet; expand excluded protocol rows only after deployment/function/permission checks |
| Exact authored ABI reconstruction on reads | Spec metadata, optional | Static tuple/fixed-array paths now work. Raw selector + word positions roundtrip losslessly; recovering original names/types requires metadata not stored by contracts |
| Native historical lifetime limits | Spec/migration | Define a lossless public representation if these old grants must be editable; never drop their restrictions silently |
| Revert credit | Push-core executor | Executor invokes creditRevert; verify restored spend independently |
| Delivery/terminal latency | Platform | Resolve delayed terminal status and bounded polling expectations |
| Single clean live run / new-contract acceptance | SDK, then new deployment | All 69 v6 cases have passing coverage across the full run plus focused follow-up. One clean 69-case invocation remains a separate optional release checkpoint |

User decisions recorded October 12: multi-action native `spent` uses per-action entries. Decoded Solana rules may use an explicit raw form for lossless get→update; authored rules use arg/account positions. These no longer require clarification.

The first-use EVM gas default is implemented and is no longer an external core/gateway question. `setLabel` already exists on v5; direct invocation requires no contract change.

V6 accounting note: generic native MAX pins enforce a per-call bound but do not increment the separate `amountSpent` meter. The SDK returns the actual counter (normally zero for the new public shape), plus value/call counters per action; it does not infer token spending from arbitrary numeric arguments. If the UI needs native per-token spend totals, that requires an explicit accounting design.

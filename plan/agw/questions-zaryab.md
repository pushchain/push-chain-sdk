# AGW SDK — contract delivery and confirmation

October 12, 2026. Local draft; nothing has been sent. Source: [contract feedback §6](https://app.notion.com/p/pushprotocol/1-AGW-Contract-Changes-nomenclature-standard-change-set-3e9188aea7f4813aa31fc95ceb4e684d). V6 is deployed; contract-owner dry runs are still ongoing. Existing v5 labels and ref removal are already delivered.

## V6 delivery received October 14

Atomic factory creation, automatic gateway approvals and general EVM EQ/MAX pins are delivered in source `ffd567d` and the v6 address book. The SDK has migrated these locally; 99 contract-backed cases and all 69 live scenarios have passing coverage (full run plus focused follow-up). Your independent dry runs remain separate. No repeat request for these delivered interfaces or deployment addresses.

New wire details are accounted for: native maxCalls = uint32 maximum, Solana any-count = 255, pins = (offset, op, value). The policy still reports 3.1.0, so deployment wiring/source pin identify v6.

## Confirmations still needed

1. **Native call ceiling:** SDK §6.h says 1..32 allowed calls; deployed AGW permits eight native actions. Should this deployment increase the native ceiling, or should the spec explicitly retain eight?
2. **Solana wallet-token-account pins:** SDK §6.k asks whether the policy enforces these in every supported case. The SDK derives the wallet CEA and token-program-specific ATA and has local/live SPL evidence; please confirm the intended policy boundary beyond those tested cases.

Push-core revert credit and platform terminal-status latency remain downstream items, separate from this contract change set. [Full implementation/deployment boundary](section6-action-items.md).

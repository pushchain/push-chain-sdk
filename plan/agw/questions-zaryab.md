# AGW SDK — contract delivery and confirmation

October 12, 2026. Local draft; nothing has been sent. Source: [contract feedback §6](https://app.notion.com/p/pushprotocol/1-AGW-Contract-Changes-nomenclature-standard-change-set-3e9188aea7f4813aa31fc95ceb4e684d). The user confirms these changes are not deployed. Existing v5 labels and ref removal are already delivered.

## Delivery already requested by Harsh

- **§6.1:** exact gateway approval inside each outbound, on both doors, cleared afterward. SDK allowance checks stay until the implementation/deployment is verified.
- **§6.2:** atomic factory create plus grants. Supply the final ABI and owner/signed entry points, preserving the intended wallet/index binding. Partial-create recovery stays until every supported owner uses the atomic path.
- **§6.3:** general EQ/MAX pins on EVM destination calls. SDK supports the current single WALLET pin and rejects other destination pins until the new policy is available.

These are delivery dependencies, not requests to reconsider the agreed design. Deployment addresses do not need to be supplied again here; the SDK will verify the updated address book and implementation when notified.

## Confirmations still needed

1. **Native call ceiling:** SDK §6.h says 1..32 allowed calls; deployed AGW permits eight native actions. Should this deployment increase the native ceiling, or should the spec explicitly retain eight?
2. **Solana wallet-token-account pins:** SDK §6.k asks whether the policy enforces these in every supported case. The SDK derives the wallet CEA and token-program-specific ATA and has local/live SPL evidence; please confirm the intended policy boundary beyond those tested cases.

Push-core revert credit and platform terminal-status latency remain downstream items, separate from this contract change set. [Full implementation/deployment boundary](section6-action-items.md).

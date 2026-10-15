# AGW SDK — remaining preset catalog decisions

Updated October 12, 2026 after the user authorized the section-7 framework. Local draft; nothing sent.

## Catalog to provide later

Which verified apps, functions, deployed addresses and chains should ship for `DEXES` and `LENDING`? The framework is implemented, but all categories currently have empty `chains` lists. UI callers should hide them.

The contract/SDK review of those entries must settle tuple-field positions and how multiple apps can safely receive approvals for the same token. V6 now supplies general EVM pins and OR-matching alternatives. The SDK supports separate spender-pinned approval alternatives and rejects unpinned bypasses. Approved app-specific entries and tuple-field conventions still need review.

## Decisions already made — no repeated question

The user chose zero defaults for either omitted preset asset cap and deferred the catalog. Omitting agent or expiry returns a typed `PresetRuleTemplate`; providing both yields `Rule[]`. Per-action native spend and raw decoded Solana get→update were already approved. The new preset namespace contains only `list/get`; encoding and ID helpers remain internal.

[Implementation and acceptance](section7-presets.md).

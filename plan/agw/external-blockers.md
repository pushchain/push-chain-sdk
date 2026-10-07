# Remaining AGW external dependencies

Updated October 7, 2026. Product decisions are settled: keep zero native PC defaults and the current token model; use named IDL inputs for Solana; retain dual native/EVM argument-index/raw-offset inputs; remove rule `ref`.

| Dependency | Owner | Needed artifact |
| --- | --- | --- |
| Editable labels | Zaryab | Implemented owner-only label function/event ABI and compatible deployment |

Fresh fetch still shows `deploy-agw@10a24f1` / source `e8db748`. Its agent door already enforces the supplied `rulesId`. The SDK retains AMBIGUOUS_RULE for multiple candidates and maps contract rejections. No automatic-selection interface is requested. Only setLabel needs a new AGW interface/deployment.

Public Solana SDK integration is now implemented. Its supported IDL layouts and validation are documented in the [consumer guide](../../packages/core/AGW.md). See [implementation status](implementation-status.md) for test results.

`creditRevert` remains a separate Push-core executor dependency. Returned funds do not restore policy spend. This does not require a new product decision or permit the SDK to decrement counters itself.

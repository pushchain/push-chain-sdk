# Successful Notion refresh on October 3 2026

Downloaded and imported all **12 registered pages** on October 03, 2026 at 13:23 IST (2026-10-03T07:53:10.278902+00:00). The earlier browser download block is resolved for this run. Two page bodies changed: **1 AGW Contract Changes** and **5 SDK AGW**. Ten are unchanged. No registered pages are missing and no unexpected page IDs appeared.

## SDK target changes

- `create` now deploys the wallet and grants rules; it no longer funds it. `CreateOptions.funds` and `pc` were removed. Funding uses ordinary account tooling separately.
- Universal rules now use `assets: AssetCap[]`, with per-token `token`, `maxPerCall` and optional `maxTotal`, replacing single `asset` and amount caps.
- Asset inputs are destination-chain token addresses/Moveable constants or the native marker; the SDK resolves them to Push PRC20 addresses and checks source-chain identity.
- `maxGasPerCall` replaces `maxPCPerCall`. It still caps PC wei attached to one outbound, not a lifetime gas budget.
- Creation progress event `AGENTIC-TX-103` was removed.

## New contract proposal section 4c

The proposal adds 0–8 asset caps, per-token spend accounting, a token on OutboundMetered, the gas-field rename, and a changed assertSpent surface. Asset maxTotal zero means no total cap in this proposal. Empty assets means calls that move no tokens. These changes are proposed; the tested e704d5b source still has the previous single-asset terms and assertion overloads.

## New alignment items

1. Page 5's universal Spent remains a scalar amountSpent despite per-token accounting. A per-asset return shape and corresponding error/event fields are needed.
2. Section 4c describes `assertSpent(configId, account)` as returning totals. A read alone cannot enforce the existing replacement race guard. Define the expected per-token assertion input/behavior separately from the spend getter.
3. Empty-asset execution needs an agreed routing token/destination mechanism: the existing gateway derives its destination from token context, and current URP requires a configured asset. Do not assume the new call-only mode works without new fixtures.
4. The new EVM UniversalTerms sketch uses bytes32 expectedCEA; current source uses address. Confirm canonical EVM/SVM representation and codec validation.
5. Pages 6–8 are unchanged, so their card/compiler limits and funding orchestration still need reconciliation with the new multi-asset and separate-funding target.

The headline destination approve remains unpinned. Binder still says dropped for v1. D3 wording and gateway-removal narrative remain older than verified contract evidence. Existing questions remain relevant after the updates recorded in the drafts.

## Evidence

- [Per-page comparison](../notion/history/20261003T075310278902Z/refresh.json)
- [Manifest](../source-manifest.json)
- [Contract page diff](../notion/history/20261003T075310278902Z/1-agw-contract-changes.diff)
- [SDK page diff](../notion/history/20261003T075310278902Z/5-sdk-agw.diff)

Raw exports, previous manifest, previous changed snapshots and unified diffs are retained. Known links were normalized by page ID. Comment threads are not included in exports. Notion itself was not edited, and no questions were sent.

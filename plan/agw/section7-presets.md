# Section 7 preset framework

Source: [SDK spec §7](https://app.notion.com/p/pushprotocol/5-SDK-AGW-3e9188aea7f481cf8e8de324956549b9), [October 12 snapshot](notion/5-sdk-agw.md). Implementation is tracked on feat/agw-sdk-v4, with non-plan changes mirrored to feat/agw-sdk-v5.

## User decisions

- Build the framework now; approved app/address catalog comes later.
- Missing asset maxPerCall or maxTotal defaults to zero, superseding the spec's proposed throw.
- An incomplete result is an editable PresetRuleTemplate; supplying agent and expiry narrows the return to Rule[]. This avoids pretending a template is ready for create.

## Implemented

- Enumerable, frozen CATEGORY constants: DEXES, LENDING, PREDICTION.
- Public utils.agentic.presets.list/get, with no encoder, ID or deployment helpers restored.
- All production categories currently expose chains: []; get without a chain filter returns rules: []. A requested unavailable chain fails explicitly. No placeholder addresses ship.
- Internal bundled catalog schema and fixture-injectable builder; no public runtime registration or network fetching.
- One rule per chain, chain filtering, identity/expiry propagation and asset placement; unknown/mismatched chains and duplicate assets fail.
- Caller/caller-result mutation cannot modify the catalog or subsequent results.
- Missing caps become 0; explicit uint256 values are retained and invalid values fail.
- Approvals for catalog-declared EVM spenders are pinned to that spender and bounded by maxPerCall. Native assets receive none. Conflicting spender entries or duplicate function entries fail rather than broadening permissions.
- Full signatures and the 32-call ceiling (including approvals) are checked. Metadata app/label is display-only.
- Standard create/add capability checks still reject general destination pins on the old policy; presets cannot bypass contract-delivery gates.

## Remaining activation work

Approved catalog data, tuple-field convention and review of approval combinations against the new policy. Solana approvals require a separately reviewed instruction template; no EVM approval is fabricated for them. App ABIs stay in the UI. No funded app-preset E2E is meaningful until approved entries exist.

## Validation

Preset/public-surface tests: 30 passed (20 new preset cases). Pinned-contract multi-asset suite: 11 passed, including a new fixture preset passed through public create and actual policy execution/accounting (stub gateway, no live app). Guide: 5 TypeScript blocks typechecked. Final full unit regression: 2,075 passed, 12 skipped, no failures. Build, typechecks, compiled package/declaration examples and API comparison pass. [Commands and logs](research/section7-presets-2026-10-12/commands.md). An earlier 100ms timing failure passed on retry and in the final full run.

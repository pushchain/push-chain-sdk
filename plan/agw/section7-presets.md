# Section 7 presets — current alignment

Updated October 18, 2026. [Live SDK §7](https://app.notion.com/p/pushprotocol/5-SDK-AGW-3e9188aea7f481cf8e8de324956549b9#07ce163677ef44dfae03a38ea4c16da0) and the [catalog proposal snapshot](notion/agw-presets-proposal-and-rules.md) are the sources. Work is on v4; non-plan changes are mirrored to v5.

## Approved decisions

- Missing asset caps default to zero, superseding the SDK page's proposed throw.
- Mainnet templates are included following the user's October 15 scope expansion. Live tests remain testnet-only.
- DEX get without a complete token pair returns zero-input-cap review templates. Call get again after choosing both tokens. The user explicitly approved this flow; merely adding assets to an earlier result cannot enable its swaps.
- Static struct/fixed-array fields use argument paths such as [0,3]. Decoded EVM rules use raw selectors and exact ABI word positions for lossless get/update; no ABI metadata is invented.

## Implemented

Enumerable DEXES/LENDING/STAKING/PREDICTION constants; list/get only; one rule per chain; full signatures; wallet recipient pins; token pair pins; bounded spender-pinned approvals; mutation isolation; omitted identity/expiry; explicit chain filtering; zero cap defaults; 32-call and 32-pin limits. Unfiltered discovery includes both mainnet and testnet templates. PREDICTION remains empty.

[Catalog coverage, read-only mainnet verification and exclusions](research/preset-mainnet-2026-10-15/README.md). [Testnet source snapshots and review flow](research/preset-catalog-2026-10-15/implementation-status.md).

## Remaining

- Remote Notion wording needs synchronization: zero-cap review/regenerate flow, missing caps default zero, STAKING, [0,3] tuple paths. No remote page was edited.
- Additional protocol rows need deployment/function/permission review. Dynamic paths and currently unrepresentable Solana flows are not silently enabled.
- Live protocol tests are separate from local policy tests and from read-only address verification. Coverage does not extend to every app/chain merely because its templates are present.

## Validation

Latest full unit run: 2,096 passed, 12 skipped, zero failures. Focused preset tests: 44 passed. The zero-cap review flow passed 16 local real-v6 contract tests. Test selection includes two separate opt-in agw-presets scenarios (Uniswap and Aave), and leaves the default all group unchanged. Uniswap and Aave LINK live scenarios passed in separate runs; Aave USDC hit its protocol supply cap before the LINK correction. [Live results and transaction evidence](research/preset-live-2026-10-15/README.md).


## Expanded live acceptance (October 15)

Five additional scenarios now pass across focused runs: EigenLayer Sepolia; Base Uniswap; Arbitrum Uniswap/Aave; BNB PancakeSwap/Venus; Base Aave/Moonwell. Combined with the earlier Sepolia runs, every shipped testnet protocol/chain combination has at least one positive live flow. The runs found and fixed destination-aware native ETH PRC20 resolution. Borrow/repay, every market and mainnet execution are not claimed. [Evidence and exact limits](research/preset-expanded-live-2026-10-15/README.md).


## October 16 — operation limits and readiness supersede earlier behavior

get returns additive readiness metadata; supported lending/staking calls now have token/amount restrictions. Market redemption uses underlying units. Dynamic/position-derived claims are excluded and explained. [Current implementation, API changes and live validation boundary](research/preset-configuration-2026-10-16/README.md). Earlier live runs predate these restrictions; new live attempts timed out during setup and are not accepted as passes.


## October 18 — SDK supplies curated tokens

Riyanshu clarified that presets should include tokens across their networks without frontend token selection. This supersedes the earlier omitted-assets discovery flow: `get` now supplies a curated token subset per chain whenever `assets` is omitted. DEX defaults include a complete pair with generated token constraints. Explicit `assets` replaces defaults, including an empty list or a list covering only some chains.

Spending caps retain the agreed zero default. Gas and expiry defaults are not invented. Automatic token inclusion is implemented; fully executable presets still require an agreed permission policy. Suggested 10 USDC/call, 100 USDC Push-outbound total and 7-day expiry are proposals only, not shipped defaults; native/other token caps and chain-specific gas budgets require separate values. There is no implied conversion to USD, batch aggregate cap or destination lifetime cap.

The default subsets use existing reviewed catalog/source addresses and fit the deployed 32-call/32-pin ceilings. Mainnet remains template-only and no new funded live run is performed for this change. See the [consumer guide](../../packages/core/AGW.md) for the per-network token table and replacement semantics.


## October 18 — default permission policy approved and implemented

The user authorized preset-generated limits, gas budgets and expiry. This supersedes the pending-policy note above. Omitted assets selects curated tokens with explicit caps: stablecoins 10/call and 100 cumulative Push-outbound; ETH-family 0.001/0.01; WBNB 0.01/0.1; LINK 1/10. Decimals were checked by chain/address using read-only RPC calls at recorded blocks. Omitted expiry becomes seven days from get time; the catalog gas ceiling is 20 PC. Actual sends still quote at runtime. Mainnet execution is not newly certified.

Supplying only agent (plus an optional chain filter) now produces typed Rule[] and complete local configuration. Explicit expiry/gas and asset arrays remain authoritative; zero gas and zero asset caps are preserved. General rule authoring keeps zero defaults. No public helper or new required argument is introduced.

Operational prerequisites remain: asset PRC20 mappings, funded source/destination accounts, protocol liquidity and live routes. Some testnet protocol mocks have no PRC20 mapping; their prior live tests used prefunded CEAs with bridge assets empty. Configuration readiness does not guarantee that those default source assets can be bridged or that an unmodified default rule can be created on every network. No unavailable mapping is fabricated or silently dropped.


## October 18 — release correction for funding availability

Configuration completeness alone is no longer advertised as readiness. Ready additionally checks the SDK's verified AGW network registry, supported gateway destinations and selected source-token registry. Push mode preserves missing assets and reports them. Destination mode explicitly requests empty bridge authority with unchanged call constraints and selectedAssets review metadata. This is additive and avoids inventing PRC20 identities. Sepolia WETH/stETH mappings and EVM address-word source metadata are now supported and read-only verified. [Final release evidence](research/preset-release-readiness-2026-10-18/README.md) supersedes prior readiness descriptions.

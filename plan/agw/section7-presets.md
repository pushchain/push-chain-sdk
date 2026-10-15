# Section 7 presets — current alignment

Updated October 15, 2026. [Live SDK §7](https://app.notion.com/p/pushprotocol/5-SDK-AGW-3e9188aea7f481cf8e8de324956549b9#07ce163677ef44dfae03a38ea4c16da0) and the [catalog proposal snapshot](notion/agw-presets-proposal-and-rules.md) are the sources. Work is on v4; non-plan changes are mirrored to v5.

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

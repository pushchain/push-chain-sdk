# Mainnet preset templates — October 15, 2026

The user expanded the earlier testnet-only scope to include mainnet templates. Execution tests remain testnet-only. No mainnet signatures, approvals or transactions were made.

## Included

| Category | Mainnet coverage |
| --- | --- |
| DEXES | Uniswap SwapRouter02: Ethereum, Base, Arbitrum; PancakeSwap V3 SmartRouter: BNB |
| LENDING | Aave V3: Ethereum, Base, Arbitrum, BNB; Moonwell USDC/WETH + controller: Base; Venus USDT/USDC + controller: BNB |
| STAKING | Ethereum: EigenLayer deposits; Lido stake/wrap/unwrap/request withdrawal/claim |

Existing testnet entries remain. `list` and unfiltered `get` now include both environments. Use a chainNamespace filter for a specific environment. Catalog discovery is pure: it does not imply the connected Push network supports a destination or that every token has a PRC20 mapping.

## Verification

Official protocol address/source snapshots are in sources.json and ../preset-catalog-2026-10-15/protocol-sources.json. Uniswap addresses.ts supplies the default Ethereum/Arbitrum SwapRouter02 at its fallback and the explicit Base address. PancakeSwap addresses.md supplies the BNB SmartRouter. EigenLayer README.md names the StrategyManager proxy. Aave, Moonwell and Venus mainnet address files are retained here.

rpc-verification.json records chain IDs, pinned blocks, code hashes/lengths and money-market underlying addresses. All 18 included mainnet contract addresses had code (15 in rpc-verification.json, three Lido contracts in lido-rpc-verification.json). These are read-only presence/wiring checks, not an audit or proof of execution/liquidity. Existing call shapes are reused, with Lido additions checked against its official method documentation. Lido request ownership is pinned to WALLET; claim methods require/payout to msg.sender. ETH submit has maxValue zero until a caller explicitly supplies a value cap.

## Exclusions

This adds mainnet counterparts of the verified/representable testnet catalog. It does not activate every proposal row. Compound, Morpho/Lista, Rocket Pool/ether.fi, additional routers and prediction venues still require independent deployment/function/permission review. Dynamic-path swaps and currently unrepresentable Solana protocol flows remain excluded. One V3 router per chain keeps the two-token expansion below the 32-pin policy limit; two routers with both exact-input/output and both directions would exceed it.

## Validation

44 focused preset tests pass, including full-signature pin offsets for all eight DEX chains, one-rule-per-chain discovery, review templates and complete-pair generation. No mainnet transaction was used as validation.

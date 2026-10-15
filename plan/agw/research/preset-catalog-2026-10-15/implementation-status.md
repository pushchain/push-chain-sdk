# Testnet preset catalog — October 15, 2026

User scope: testnet templates only. Missing caps default to zero. Source body and original native export are retained here; source.json records the Notion URL and observed edit date. The sibling README.md is downloaded EigenLayer documentation, not this implementation report.

## Implemented

- DEXES: Uniswap V3 (Sepolia, Base Sepolia, Arbitrum Sepolia), PancakeSwap V3 (BSC testnet). Explicit ERC20 pairs, wallet-recipient pins, amount caps, spender-pinned approvals.
- LENDING: Aave on the three Ethereum testnets, Moonwell Base Sepolia mUSDbC/mWETH, Venus BSC testnet vUSDT/vUSDC and their controllers.
- STAKING: EigenLayer Sepolia deposits only.
- Static tuple/fixed-array argument paths; exact decoded word-offset roundtrips remain supported.
- Explicit optional maxGasPerCall; omitted caps remain zero.

DEX token omission is rejected rather than granting unrestricted swaps. This follows the conservative assumption stated during implementation; the optional follow-up question had no answer. Two supplied tokens fit; larger expansions exceeding 32 pins fail explicitly.

## Exclusions and limits

| Entry | Reason |
| --- | --- |
| Mainnet | User requested testnets only |
| Prediction | No approved entries |
| Dynamic-path V2 swaps | Cannot statically pin token paths with this policy |
| Solana protocol templates | Required ratios/layouts or multi-instruction flows are not represented by the current template API |
| Hoodi | Not a supported Push destination |
| Morpho, Compound, Jupiter Lend entries | Unconfirmed, unmaintained or stale deployments in the proposal |
| BNB StakeHub | Needs an explicit validator input |
| EigenLayer withdrawals | Proposal omits complete usable signatures; deposit-only template is labelled |

Protocol sources and rpc-verification.json record official addresses, signatures, code presence and block numbers. These checks are not protocol audits or live trade tests. Aave/Moonwell/Venus testnet mock underlying assets can differ from SDK MOVEABLE tokens. Verify reserves, liquidity, destination balances and PRC20 routes separately.

## Validation

- Full unit suite: 2,084 passed, 12 skipped; 124 passing suites, one skipped.
- Targeted real-v6 contract suite: 14 passed, including generated DEX permissions, invalid recipient/token/amount rejection and get-to-update roundtrip. Gateway is a local recording fixture; destination protocols are not executed.
- Library, unit and local-harness TypeScript checks passed.
- No funded protocol transactions or mainnet broadcasts performed for this catalog.

---
'@pushchain/core': patch
---

Price the outbound gas leg off the destination chain's own USD feed.

`sizeOutboundGas` and `computeGasUsd` converted the destination gas fee to USD
using a feed chosen by the destination's *VM type*, so every EVM destination was
priced with the ETH feed and every Solana one with the SOL feed. `gasFee` is
denominated in the destination native, which for a BNB destination is BNB, not
ETH. A BNB outbound was therefore mispriced by the ETH/BNB ratio, about 5x at
current prices.

The consequence was not only a wrong number. `sizeOutboundGas` buckets the result
into cases A/B/C at $1 and $10, so a BNB fee of $6.00 read as $30.00, crossed the
$10 threshold, and landed in Case C, depositing a gas leg sized for the inflated
figure. The user over-deposits native PC for gas and the overflow leg is
triggered that should not have been.

Both call sites now select the feed by destination chain, using the same key set
`PriceFetch` is configured with (`USDT_ETH` / `USDT_BSC` / `USDT_SOL`). Chains
with no configured feed, currently the mainnet entries, keep the previous
VM-based fallback rather than throwing.

# Push Chain Stable Pool Config

Last updated: 2026-05-16

Confirmed Push Chain PRC-20 stable-token addresses and their WPC/stable Uniswap V3 pool addresses for testnet moveable/payable token resolution, gas sizing, and oracle reads.

| Token | Token address | Pool address |
|---|---|---|
| USDC.bsc | `0x120EBf25Dad7D6a09Ad2316f23f9Be95DBb90639` | `0xf09aD7D5e8800d0863F5ea845509bC1B1aCAe37a` |
| USDT.eth | `0x0f97A213207703923F5f0C613C9827f7C9A0f96B` | `0x1e3f6b38582535A8eB021829853A08Bb1C7b604B` |
| USDT.arb | `0xFE6E9DF2BbC9ce05D98b83B1365df6DcA9951891` | `0x5EBEa067F75C0661EC37577547209E38C8b93c18` |
| USDT.base | `0x148823809B853e1db187BC09A9ac909BC42F971a` | `0x0c906B6FE47f1666F4723273Cf8E681b3e35aFF0` |
| USDT.bsc | `0x731aF1Da5365259d27528557EE4aFBA4baC90ef2` | `0x735010da121541515CB509339Ea0A0fD4f48d4a9` |

## Notes

- Token addresses are PRC-20 stable tokens on Push Chain.
- Pool addresses are the WPC/stable pools used by SDK gas sizing to derive PC/USD.
- BSC currently has both `USDC.bsc` and `USDT.bsc` pool entries available.

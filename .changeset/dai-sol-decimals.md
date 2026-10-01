---
'@pushchain/core': patch
---

Report DAI.sol as 6 decimals instead of 18.

`PushChain.utils.tokens.getMoveableTokens()` described the Solana devnet DAI
mint and its Push synthetic `DAI.sol` as 18-decimal tokens. Both are 6:

```
$ curl -s https://api.devnet.solana.com -X POST -d '{"jsonrpc":"2.0","id":1,
    "method":"getAccountInfo","params":["G2ZLaRhpohW23KTEX3fBjZXtNTFFwemqCaWWnWVTj4TB",
    {"encoding":"base64"}]}'     # 82-byte SPL Mint, decimals at byte 44
$ curl -s https://evm.donut.rpc.push.org -X POST -d '{"jsonrpc":"2.0","id":1,
    "method":"eth_call","params":[{"to":"0x5861f56A556c990358cc9cccd8B5baa3767982A8",
    "data":"0x313ce567"},"latest"]}'   # → 0x…06
```

18 is Ethereum mainnet DAI's value, which the devnet deployment does not share.
Anything that formats a DAI.sol amount from this table was off by 1e12: a
1 DAI balance read as 0.000000000001, and an amount parsed from a display
string scaled down by the same factor before being sent.

The value is corrected in all three places it is written (the origin mint row,
the Push synthetic list, and the `pDai` accessor). No other token row changes.
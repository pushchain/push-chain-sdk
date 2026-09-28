---
'@pushchain/ui-kit': patch
---

Fix MetaMask network switching when a chain is not yet known to the wallet.

Switching to a chain the wallet has not seen rejected with `4902`, and the SDK
added it — but stopped there. `wallet_addEthereumChain` does not switch to the
chain it adds, so the wallet stayed on the previous network and the next
transaction was sent to the wrong chain. The add is now followed by an explicit
`wallet_switchEthereumChain`.

The add call also passed `blockExplorerUrls` as a bare string where EIP-3085
declares `string[]`, so wallets validating the request rejected the add. It is
now an array, and an empty one when the chain has no explorer.

The `4902` check also now recognises `-32603` and `Unrecognized chain ID`, which
wallets use for the same condition, matching the Rabby and Zerion providers.

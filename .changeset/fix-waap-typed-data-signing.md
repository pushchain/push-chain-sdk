---
'@pushchain/ui-kit': patch
---

Fix WaaP (embedded Push Wallet) EIP-712 signing of migration payloads.

`waapSignTypedData` rewrote `typedData.types` to always contain a
`UniversalPayload` key. When Core's `signMigrationPayload` is the caller,
`primaryType` is `MigrationPayload` and `types.UniversalPayload` is undefined,
so the outgoing request carried `primaryType: 'MigrationPayload'` with no
matching entry in `types`, which the wallet cannot resolve. Any UEA upgrade
signed through the embedded wallet failed.

The rewrite now follows `primaryType`, matching the MetaMask, Rabby and Zerion
adapters, which already handle both payloads.

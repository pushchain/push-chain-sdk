---
'@pushchain/ui-kit': patch
---

Fix WaaP (embedded Push Wallet) EIP-712 signing.

`waapSignTypedData` could not sign either payload Core sends to it:

- `UniversalPayload` carries its uint256 fields (`value`, `gasLimit`,
  `maxFeePerGas`, `maxPriorityFeePerGas`, `nonce`, `deadline`) as `bigint`, and
  the adapter passed the object straight to `JSON.stringify`, which throws
  `TypeError: Do not know how to serialize a BigInt`. Every universal
  transaction signed through the embedded wallet failed.
- The `types` rewrite hardcoded `UniversalPayload`, so when `primaryType` was
  `MigrationPayload` (Core's `signMigrationPayload`) the outgoing request
  carried `primaryType: 'MigrationPayload'` with no matching entry in `types`,
  which no wallet can resolve.

Both now match the injected-wallet adapters, which already handled them.

---
'@pushchain/core': patch
---

Reject a CAIP-2 string in either half of a read destination.

`resolveDestination` split a destination into `chainNamespace` and `chainId`, and
the node joins the two back with `":"`. A colon was rejected in the namespace but
not the chain id, so a destination assembled from a joined CAIP-2 string in the
wrong half produced a three-part id:

```ts
resolveDestination({ chainNamespace: 'eip155', chainId: '1:1' });
// before: { chainNamespace: 'eip155', chainId: '1:1', caip2: 'eip155:1:1' }
```

`caip2` is what the SDK passes to `UniversalCore.chainHeightByChainNamespace`, and
`{ chain: 'eip155:1:1' }` hit the same path because it splits on the first colon.
The oracle has no entry for the resulting id, so the request escrows its protocol
fee and expires unfulfilled instead of failing at prepare time with a typed error.

Both halves are now checked, and a colon in the chain id is reported by name:

```
UnsupportedReadDestinationError: chainId must be the bare chain id, not CAIP-2: 1:1
```

Destinations already in the documented shape are unaffected.
